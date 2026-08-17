import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { env } from '../config/env';
import { getSettings } from './SettingsService';
import { emit } from '../sockets';
import { formatDate } from '../lib/date';
import { createHmac, randomBytes } from 'crypto';

export class ZaloService {
  private pendingStates = new Map<string, number>();

  private async getConfig() {
    const settings = await getSettings();
    const zaloCfg = settings.zalo ?? {};
    return {
      oaId: zaloCfg.oaId || env.zaloOaId,
      accessToken: zaloCfg.accessToken || env.zaloAccessToken,
      refreshToken: zaloCfg.refreshToken || env.zaloRefreshToken,
    };
  }

  /** Tạo link OAuth để user duyệt quyền trên Zalo rồi tự động lưu token về. */
  async getAuthUrl(): Promise<{ url: string; state: string }> {
    if (!env.zaloAppId || !env.zaloAppSecret) {
      throw new Error('Thiếu ZALO_APP_ID / ZALO_APP_SECRET trong .env');
    }
    const state = randomBytes(16).toString('hex');
    this.pendingStates.set(state, Date.now() + 10 * 60 * 1000);
    const url = new URL('https://oauth.zaloapp.com/v4/oa/permission');
    url.searchParams.set('app_id', env.zaloAppId);
    url.searchParams.set('redirect_uri', env.zaloRedirectUri);
    url.searchParams.set('state', state);
    return { url: url.toString(), state };
  }

  /** Đổi authorization code lấy access/refresh token (chạy khi Zalo redirect về). */
  async exchangeCode(
    code: string,
    state: string,
  ): Promise<{ ok: boolean; accessToken?: string; refreshToken?: string; error?: string }> {
    const exp = this.pendingStates.get(state);
    this.pendingStates.delete(state);
    if (!exp || exp < Date.now()) {
      return { ok: false, error: 'State không hợp lệ hoặc đã hết hạn. Thử kết nối lại.' };
    }
    if (!env.zaloAppId || !env.zaloAppSecret) {
      return { ok: false, error: 'Thiếu ZALO_APP_ID / ZALO_APP_SECRET trong .env' };
    }
    try {
      const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
        method: 'POST',
        headers: { secret_key: env.zaloAppSecret },
        body: new URLSearchParams({
          app_id: env.zaloAppId,
          code,
          grant_type: 'authorization_code',
        }),
      });
      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        error?: number;
        error_description?: string;
      };
      if (!data.access_token) {
        return { ok: false, error: data.error_description ?? `Zalo lỗi: ${data.error}` };
      }
      return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Kiểm tra access token còn hiệu lực (dùng cho health check trên web). */
  async ping(): Promise<boolean> {
    const cfg = await this.getConfig();
    if (!cfg.accessToken || !cfg.oaId) return false;
    try {
      let url = 'https://graph.zalo.me/v2.0/me?fields=id,name';
      if (env.zaloAppSecret) {
        const proof = createHmac('sha256', env.zaloAppSecret).update(cfg.accessToken).digest('hex');
        url += `&appsecret_proof=${proof}`;
      }
      const res = await fetch(url, { headers: { access_token: cfg.accessToken } });
      const data = (await res.json()) as { error?: number; message?: string; id?: string };
      if (!res.ok) return false;
      if (data.error === 452) return false; // token bị thu hồi / hết hạn
      return data.error === 453 ? true : !!data.id; // 453: token hợp lệ, thiếu appsecret_proof
    } catch {
      return false;
    }
  }

  async sendTrainingNotice(candidateId: string): Promise<{ ok: boolean; provider: string; messageId?: string }> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    if (!c.ngayBatDauTraining) throw new Error('Chưa có ngày bắt đầu Training');

    const cfg = await this.getConfig();

    const content = [
      '🐮 UMBO MILK – THÔNG BÁO TRAINING',
      '',
      `Chào ${c.tenUv} ❤️`,
      '',
      'Ngày bắt đầu:',
      formatDate(c.ngayBatDauTraining),
      '',
      'Chi nhánh:',
      c.chiNhanh,
      '',
      'Ca:',
      c.caLam,
      '',
      'Vui lòng có mặt đúng giờ và thực hiện điểm danh theo hướng dẫn.',
    ].join('\n');

    const useRealApi = !env.demoMode && cfg.accessToken && cfg.oaId;
    let status = 'PENDING';
    let error: string | null = null;
    let messageId: string | undefined;
    let provider = 'MOCK';

    if (useRealApi) {
      provider = 'ZALO_OA';
      try {
        const res = await fetch('https://business.openapi.zalo.me/v3.0/message/official_account/text', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            access_token: cfg.accessToken,
          },
          body: JSON.stringify({
            recipient: { user_id: c.sdtZalo },
            message: { text: content },
          }),
        });
        const data = await res.json();
        if (data.error && data.error !== 0) {
          throw new Error(`Zalo API lỗi: ${data.error} ${data.message ?? ''}`);
        }
        messageId = data.data?.message_id;
        status = 'SENT';
      } catch (e) {
        status = 'FAILED';
        error = e instanceof Error ? e.message : String(e);
      }
    } else {
      status = 'SENT';
    }

    const msg = await prisma.zaloMessage.create({
      data: {
        id: nextId('ZAL'),
        candidateId: c.id,
        phone: c.sdtZalo,
        content,
        status,
        error,
        provider,
      },
    });

    emit('zalo:status', { candidateId: c.id, status, messageId: msg.id });
    return { ok: status === 'SENT', provider, messageId: msg.id };
  }

  async webhook(payload: unknown): Promise<void> {
    const p = payload as { sender?: { phone?: string; user_id?: string }; message?: { text?: string } };
    const text = (p.message?.text ?? '').trim().toUpperCase();
    const phone = p.sender?.phone ?? String(p.sender?.user_id ?? '');
    if (text.includes('ĐIỂM DANH') || text.includes('DIEM DANH')) {
      const { attendanceService } = await import('./AttendanceService');
      await attendanceService.checkin({ phone, method: 'ZALO' });
    }
  }
}

export const zaloService = new ZaloService();