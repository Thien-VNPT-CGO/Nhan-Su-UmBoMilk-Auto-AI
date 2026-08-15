import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { nextId } from '../lib/id';
import { env } from '../config/env';
import { audit } from './AuditService';
import type { Request, Response } from 'express';

const COOKIE_NAME = 'umbo_session';

export function toSafeUser(u: { id: string; username: string; fullName: string; role: string }) {
  return { id: u.id, username: u.username, fullName: u.fullName, role: u.role };
}

export class AuthService {
  async login(username: string, password: string, req: Request, res: Response) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active || !bcrypt.compareSync(password, user.password)) {
      throw ApiError.unauthorized('Sai tên đăng nhập hoặc mật khẩu.');
    }
    const sessionId = nextId('SES');
    await prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
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
    await audit({
      user: user.username,
      action: 'LOGIN',
      entity: 'user',
      entityId: user.id,
      ip: req.ip ?? null,
    });
    return toSafeUser(user);
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
}

export const authService = new AuthService();
export { COOKIE_NAME };