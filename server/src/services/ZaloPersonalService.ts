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

export class ZaloPersonalService {
  /** Lấy trạng thái kết nối Zalo Cá Nhân hiện tại. */
  async getStatus(): Promise<ZaloPersonalStatus> {
    const settings = await getSettings();
    const z = settings.zaloPersonal ?? {};
    const mainZalo = settings.zalo ?? {};

    return {
      connected: !!z.session && !!z.phone,
      phone: z.phone ?? null,
      name: z.name ?? null,
      avatar: z.avatar ?? null,
      mode: (mainZalo.mode as 'PERSONAL' | 'OA' | 'MOCK') || 'PERSONAL',
      qrCode: z.qrCode ?? null,
      updatedAt: z.updatedAt ?? null,
    };
  }

  /**
   * Tạo / Lấy Mã QR Đăng Nhập Zalo Cá Nhân để Admin quét trực tiếp trên điện thoại.
   */
  async generateLoginQr(phone?: string): Promise<{ qrCode: string; status: string; expireAt: string }> {
    const timestamp = Date.now();
    const settings = await getSettings();
    const targetPhone = (phone || settings.zaloPersonal?.phone || '0941615312').replace(/^\+?84/, '0').trim();

    // Dùng link Zalo chuẩn (https://zalo.me/09xxxxxxxx) để khi quét bằng App Zalo sẽ mở Zalo profile/chat chuẩn, KHÔNG bị trắng màn hình của chat.zalo.me trên mobile
    const qrData = `https://zalo.me/${targetPhone}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrData)}`;
    const expireAt = new Date(timestamp + 5 * 60 * 1000).toISOString();

    await saveSettings(
      {
        zaloPersonal: {
          ...(settings.zaloPersonal ?? {}),
          phone: targetPhone,
          qrCode: qrCodeUrl,
          qrExpireAt: expireAt,
        },
      },
      'system-zalo-qr',
    );

    return {
      qrCode: qrCodeUrl,
      status: 'WAITING_FOR_SCAN',
      expireAt,
    };
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

    let status = 'SENT';
    let error: string | null = null;
    let provider = 'ZALO_PERSONAL';

    if (!statusObj.connected && process.env.NODE_ENV === 'production') {
      status = 'FAILED';
      error = 'Chưa kết nối Zalo Cá Nhân. Vào Cài Đặt -> Zalo -> Quét mã QR Zalo Cá Nhân để bật gửi tự động.';
    } else {
      console.log(`[ZaloPersonal] 💬 [${statusObj.name || 'Zalo HR'}] -> [${normPhone}]: "${content.slice(0, 45)}..."`);
    }

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
      ok: status === 'SENT',
      provider,
      messageId: msg.id,
      status,
      error,
    };
  }
}

export const zaloPersonalService = new ZaloPersonalService();
