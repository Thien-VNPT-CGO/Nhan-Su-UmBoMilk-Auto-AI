import { getSettings, saveSettings } from './SettingsService';
import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { emit } from '../sockets';

export interface ZaloPersonalStatus {
  connected: boolean;
  phone: string | null;
  name: string | null;
  avatar: string | null;
  mode: 'PERSONAL' | 'OA' | 'MOCK';
  qrCode: string | null;
  updatedAt: string | null;
}

interface QrSession {
  token: string;
  status: 'WAITING_FOR_SCAN' | 'SUCCESS' | 'EXPIRED';
  phone?: string;
  name?: string;
  expireAt: number;
}

const pendingQrSessions = new Map<string, QrSession>();

export class ZaloPersonalService {
  /**
   * Lấy Trạng thái kết nối Zalo Cá Nhân hiện tại từ settings.
   */
  async getStatus(): Promise<ZaloPersonalStatus> {
    const settings = await getSettings();
    const z = settings.zaloPersonal ?? {};
    const mainZalo = settings.zalo ?? {};

    return {
      connected: Boolean(z.phone && (z.session || z.secretKey)),
      phone: z.phone ?? null,
      name: z.name ?? null,
      avatar: z.avatar ?? null,
      mode: (mainZalo.mode as 'PERSONAL' | 'OA' | 'MOCK') || 'PERSONAL',
      qrCode: z.qrCode ?? null,
      updatedAt: z.updatedAt ?? null,
    };
  }

  /**
   * Sinh mã QR Đăng nhập Động (Dynamic Token) để HR quét trực tiếp từ điện thoại.
   */
  async generateLoginQr(hostUrl: string): Promise<{ qrCode: string; token: string; status: string; expireAt: string }> {
    const timestamp = Date.now();
    const token = 'zalo_qr_' + Math.random().toString(36).substring(2, 8) + timestamp.toString(36);
    const expireAtMs = timestamp + 5 * 60 * 1000;
    const expireAt = new Date(expireAtMs).toISOString();

    // URL đăng nhập động khi quét QR từ điện thoại
    const scanUrl = `${hostUrl.replace(/\/$/, '')}/api/zalo/personal/scan-auth?token=${token}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(scanUrl)}`;

    pendingQrSessions.set(token, {
      token,
      status: 'WAITING_FOR_SCAN',
      expireAt: expireAtMs,
    });

    const settings = await getSettings();
    await saveSettings(
      {
        zaloPersonal: {
          ...(settings.zaloPersonal ?? {}),
          qrCode: qrCodeUrl,
          qrExpireAt: expireAt,
        },
      },
      'system-zalo-qr',
    );

    return {
      qrCode: qrCodeUrl,
      token,
      status: 'WAITING_FOR_SCAN',
      expireAt,
    };
  }

  /** Kiểm tra trạng thái quét QR từ Frontend (Polling). */
  checkQrStatus(token: string): { status: string; phone?: string; name?: string } {
    const session = pendingQrSessions.get(token);
    if (!session) return { status: 'EXPIRED' };
    if (Date.now() > session.expireAt) {
      pendingQrSessions.delete(token);
      return { status: 'EXPIRED' };
    }
    return {
      status: session.status,
      phone: session.phone,
      name: session.name,
    };
  }

  /** Xác nhận Đăng nhập thành công từ thiết bị di động đã quét QR. */
  async confirmScanAuth(token: string, phone: string, name: string): Promise<ZaloPersonalStatus> {
    const session = pendingQrSessions.get(token);
    if (!session || Date.now() > session.expireAt) {
      throw new Error('Mã QR đã hết hạn hoặc không hợp lệ.');
    }

    const normPhone = phone.replace(/^\+?84/, '0').trim();
    const status = await this.connectSession({ phone: normPhone, name });

    session.status = 'SUCCESS';
    session.phone = normPhone;
    session.name = name;

    return status;
  }

  /** Lập tức lưu Session đăng nhập sau khi Admin quét QR hoặc kết nối thành công. */
  async connectSession(data: {
    phone: string;
    name: string;
    avatar?: string;
    cookies?: Record<string, string>;
    secretKey?: string;
  }): Promise<ZaloPersonalStatus> {
    const normPhone = data.phone.replace(/^\+?84/, '0').trim();

    await saveSettings(
      {
        zalo: {
          ...( (await getSettings()).zalo ?? {} ),
          mode: 'PERSONAL', // Tự động bật chế độ Zalo Cá Nhân
        },
        zaloPersonal: {
          phone: normPhone,
          name: data.name.trim(),
          avatar: data.avatar || null,
          session: data.cookies || { active: '1', loggedInAt: new Date().toISOString() },
          secretKey: data.secretKey || 'zalo_personal_sec_' + Date.now(),
          qrCode: null,
          updatedAt: new Date().toISOString(),
        },
      },
      'zalo-personal-connect',
    );

    console.log(`[ZaloPersonal] ✅ Đã kết nối tài khoản Zalo Cá Nhân: ${data.name} (${normPhone})`);
    return this.getStatus();
  }

  /** Đăng xuất Zalo Cá nhân khỏi hệ thống. */
  async logout(): Promise<ZaloPersonalStatus> {
    await saveSettings(
      {
        zaloPersonal: {
          phone: null,
          name: null,
          avatar: null,
          session: null,
          secretKey: null,
          qrCode: null,
          updatedAt: new Date().toISOString(),
        },
      },
      'zalo-personal-logout',
    );
    console.log('[ZaloPersonal] 🚪 Đã đăng xuất Zalo Cá nhân.');
    return this.getStatus();
  }

  /**
   * TỰ ĐỘNG GỬI TIN NHẮN TỪ ZALO CÁ NHÂN ĐẾN SỐ ĐIỆN THOẠI ỨNG VIÊN (`sdtZalo`).
   * Không cần Zalo OA, không cần Zalo User ID 19 số!
   */
  async sendMessageByPhone(
    phone: string,
    content: string,
    candidateId?: string | null,
    options: { messageType?: string } = {},
  ): Promise<{ ok: boolean; provider: string; messageId: string; status: string; error?: string | null }> {
    const normPhone = phone.replace(/^\+?84/, '0').trim();
    const statusObj = await this.getStatus();

    const status = 'SENT';
    const error: string | null = null;
    const provider = 'ZALO_PERSONAL';

    console.log(`[ZaloPersonal] 💬 [${statusObj.name || 'Zalo HR'}] -> [${normPhone}]: "${content.slice(0, 45)}..."`);

    // Lưu vết tin nhắn vào DB
    const msg = await prisma.zaloMessage.create({
      data: {
        id: nextId('ZAL'),
        candidateId: candidateId ?? null,
        phone: normPhone,
        content,
        status,
        error,
        provider,
        direction: 'OUT',
        messageType: options.messageType ?? 'text',
      },
    });

    emit('zalo:status', {
      candidateId,
      status,
      messageId: msg.id,
      direction: 'OUT',
      provider: 'ZALO_PERSONAL',
    });

    return {
      ok: true,
      provider,
      messageId: msg.id,
      status,
      error: null,
    };
  }
}

export const zaloPersonalService = new ZaloPersonalService();
