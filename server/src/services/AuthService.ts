import bcrypt from 'bcryptjs';
import { createHmac } from 'crypto';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { nextId } from '../lib/id';
import { env } from '../config/env';
import { audit } from './AuditService';
import { verifyTOTP, generateTOTPSecret, otpauthUrl } from '../lib/totp';
import { emit } from '../sockets';
import type { Request, Response } from 'express';

const COOKIE_NAME = 'umbo_session';
const TWO_FACTOR_TTL_MS = 5 * 60 * 1000; // token xác nhận 2FA sống 5 phút

export function toSafeUser(u: {
  id: string;
  username: string;
  fullName: string;
  role: string;
  twoFactorEnabled?: boolean;
  branchScope?: unknown;
  allowedTabs?: unknown;
}) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    twoFactorEnabled: !!u.twoFactorEnabled,
    branchScope: Array.isArray(u.branchScope) ? (u.branchScope as string[]) : null,
    allowedTabs: Array.isArray(u.allowedTabs) ? (u.allowedTabs as string[]) : null,
  };
}

// ===== Token ký HMAC (không cần JWT) cho bước xác nhận 2FA =====
function signToken(payload: string): string {
  const sig = createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifyToken(token: string): { uid: string } | null {
  const [b64, sig] = String(token ?? '').split('.');
  if (!b64 || !sig) return null;
  const expected = createHmac('sha256', env.sessionSecret).update(b64).digest('base64url');
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as {
      uid?: string;
      exp?: number;
    };
    if (!payload.uid || !payload.exp || payload.exp < Date.now()) return null;
    return { uid: payload.uid };
  } catch {
    return null;
  }
}

export class AuthService {
  async login(username: string, password: string, req: Request, res: Response) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active || !bcrypt.compareSync(password, user.password)) {
      throw ApiError.unauthorized('Sai tên đăng nhập hoặc mật khẩu.');
    }

    // 2FA bật -> chỉ cấp token tạm, đợi mã xác thực
    if (user.twoFactorEnabled) {
      const token = signToken(
        JSON.stringify({ uid: user.id, exp: Date.now() + TWO_FACTOR_TTL_MS }),
      );
      return { needsTwoFactor: true, twoFactorToken: token, user: toSafeUser(user) };
    }

    await this.createSession(user.id, req, res);
    await audit({
      user: user.username,
      action: 'LOGIN',
      entity: 'user',
      entityId: user.id,
      ip: req.ip ?? null,
    });
    return { needsTwoFactor: false, user: toSafeUser(user) };
  }

  /** Bước 2 của đăng nhập: xác thực mã TOTP rồi mới cấp session. */
  async verifyTwoFactor(token: string, code: string, req: Request, res: Response) {
    const payload = verifyToken(token);
    if (!payload) throw ApiError.unauthorized('Phiên xác thực đã hết hạn. Đăng nhập lại.');
    const user = await prisma.user.findUnique({ where: { id: payload.uid } });
    if (!user || !user.active || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw ApiError.unauthorized('Sai mã xác thực.');
    }
    if (!verifyTOTP(user.twoFactorSecret, code)) {
      throw ApiError.unauthorized('Sai mã xác thực. Thử lại.');
    }
    await this.createSession(user.id, req, res);
    await audit({
      user: user.username,
      action: 'LOGIN_2FA',
      entity: 'user',
      entityId: user.id,
      ip: req.ip ?? null,
    });
    return toSafeUser(user);
  }

  /** Bật 2FA cho user đang đăng nhập: trả secret để quét QR, verify code để kích hoạt. */
  async setupTwoFactor(userId: string, code?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'Không tìm thấy tài khoản.');
    if (user.twoFactorEnabled) {
      throw ApiError.badRequest('TWO_FACTOR_ENABLED', '2FA đã được bật cho tài khoản này.');
    }
    const secret = user.twoFactorSecret ?? generateSecret();
    if (!user.twoFactorSecret) {
      await prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });
    }
    if (code) {
      if (!verifyTOTP(secret, code)) {
        throw ApiError.badRequest('INVALID_TOTP', 'Sai mã xác thực. Vui lòng thử lại.');
      }
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: true, twoFactorSecret: secret },
      });
      await audit({ user: user.username, action: 'ENABLE_2FA', entity: 'user', entityId: user.id });
      return { enabled: true };
    }
    return { enabled: false, secret, otpauthUrl: otpauthUrl(secret, user.username) };
  }

  /** Tắt 2FA (cần mã hiện tại để xác nhận). */
  async disableTwoFactor(userId: string, code: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) {
      throw ApiError.badRequest('TWO_FACTOR_DISABLED', '2FA chưa được bật.');
    }
    if (!verifyTOTP(user.twoFactorSecret, code)) {
      throw ApiError.badRequest('INVALID_TOTP', 'Sai mã xác thực.');
    }
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    await audit({ user: user.username, action: 'DISABLE_2FA', entity: 'user', entityId: user.id });
    return { disabled: true };
  }

  /** Đổi mật khẩu: yêu cầu mật khẩu cũ; nếu 2FA bật phải kèm mã xác thực. */
  async changePassword(userId: string, oldPassword: string, newPassword: string, totpCode?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'Không tìm thấy tài khoản.');
    if (!bcrypt.compareSync(oldPassword, user.password)) {
      throw ApiError.unauthorized('Sai mật khẩu hiện tại.');
    }
    if (user.twoFactorEnabled && user.twoFactorSecret && !verifyTOTP(user.twoFactorSecret, totpCode ?? '')) {
      throw ApiError.badRequest('INVALID_TOTP', 'Sai mã xác thực 2FA.');
    }
    if (newPassword.length < 6) {
      throw ApiError.badRequest('INVALID_PASSWORD', 'Mật khẩu mới phải có ít nhất 6 ký tự.');
    }
    await prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });
    await audit({ user: user.username, action: 'CHANGE_PASSWORD', entity: 'user', entityId: user.id });
    return { changed: true };
  }

  /** Reset mật khẩu Admin: Đưa mật khẩu về gốc "ubm123123" & Đá Logout Realtime thiết bị hiện tại */
  async adminResetPassword(adminUsername: string, targetUserId: string, defaultPassword = 'ubm123123') {
    const user = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'Không tìm thấy tài khoản.');

    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    await prisma.user.update({
      where: { id: targetUserId },
      data: { password: hashedPassword },
    });

    // Xóa tất cả session hiện tại của tài khoản bị Reset
    await prisma.session.deleteMany({ where: { userId: targetUserId } }).catch(() => undefined);

    // Ghi log Audit
    await audit({
      user: adminUsername,
      action: 'ADMIN_RESET_PASSWORD',
      entity: 'user',
      entityId: user.id,
      newValue: JSON.stringify({ resetToDefault: defaultPassword }),
    });

    // Phát thông báo Realtime Socket.io đá Logout tài khoản này lập tức!
    emit('user:password_reset', {
      userId: user.id,
      username: user.username,
      defaultPassword,
      message: `Mật khẩu của tài khoản ${user.username} đã được Admin Reset về gốc (${defaultPassword}).`,
    });

    return { reset: true, username: user.username, defaultPassword };
  }

  async logout(req: Request, res: Response) {
    const sessionId = req.cookies?.[COOKIE_NAME];
    if (sessionId) {
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (session) {
        await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
        const user = await prisma.user.findUnique({ where: { id: session.userId } });
        if (user) {
          await audit({ user: user.username, action: 'LOGOUT', entity: 'user', entityId: user.id, ip: req.ip ?? null });
        }
      }
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
  }

  async me(req: Request): Promise<{ user: ReturnType<typeof toSafeUser> } | null> {
    const sessionId = req.cookies?.[COOKIE_NAME];
    if (!sessionId) return null;
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (!session) return null;
    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
      return null;
    }
    if (!session.user.active) return null;
    return { user: toSafeUser(session.user) };
  }

  private async createSession(userId: string, req: Request, res: Response) {
    const sessionId = nextId('SES');
    await prisma.session.create({
      data: {
        id: sessionId,
        userId,
        expiresAt: new Date(Date.now() + env.sessionTtlDays * 24 * 60 * 60 * 1000),
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
      },
    });
    res.cookie(COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.nodeEnv === 'production',
      maxAge: env.sessionTtlDays * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
}

function generateSecret(): string {
  return generateTOTPSecret();
}

export const authService = new AuthService();
export { COOKIE_NAME };