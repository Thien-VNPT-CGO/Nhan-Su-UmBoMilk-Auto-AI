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
  ): Promise<{ ok: boolean; accessToken?: string; refreshToken?: string; oaId?: string; error?: string }> {
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
      // Zalo redirect KHÔNG trả oa_id → tự lấy OA id từ graph /me để icon sáng + gửi tin thật
      let oaId: string | undefined;
      try {
        const me = await fetch('https://graph.zalo.me/v2.0/me?fields=id,name', {
          headers: { access_token: data.access_token },
        });
        const meData = (await me.json()) as { id?: string; name?: string; error?: number };
        if (meData.id) oaId = String(meData.id);
      } catch {
        // bỏ qua - oaId sẽ lấy từ query/env nếu có
      }
      return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token, oaId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Kiểm tra access token còn hiệu lực (dùng cho health check trên web). */
  async ping(): Promise<boolean> {
    const cfg = await this.getConfig();
    if (!cfg.accessToken) return false;
    let token = cfg.accessToken;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let url = 'https://graph.zalo.me/v2.0/me?fields=id,name';
        if (env.zaloAppSecret) {
          const proof = createHmac('sha256', env.zaloAppSecret).update(token).digest('hex');
          url += `&appsecret_proof=${proof}`;
        }
        const res = await fetch(url, { headers: { access_token: token } });
        const data = (await res.json()) as { error?: number; message?: string; id?: string };
        if (!res.ok) return false;
        if (data.error === 452) {
          // Token hết hạn: thử refresh 1 lần rồi kiểm tra lại
          if (attempt === 0) {
            const fresh = await this.refreshAccessToken();
            if (!fresh) return false;
            token = fresh.accessToken;
            continue;
          }
          return false;
        }
        return data.error === 453 ? true : !!data.id; // 453: token hợp lệ, thiếu appsecret_proof
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Tự động đổi refresh token lấy access token mới khi token hết hạn (lưu lại settings). */
  private async refreshAccessToken(): Promise<{ accessToken: string; refreshToken: string } | null> {
    const cfg = await this.getConfig();
    if (!cfg.refreshToken || !env.zaloAppId || !env.zaloAppSecret) return null;
    try {
      const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
        method: 'POST',
        headers: { secret_key: env.zaloAppSecret },
        body: new URLSearchParams({
          app_id: env.zaloAppId,
          grant_type: 'refresh_token',
          refresh_token: cfg.refreshToken,
        }),
      });
      const data = (await res.json()) as { access_token?: string; refresh_token?: string; error?: number };
      if (!data.access_token || !data.refresh_token) return null;
      const { saveSettings } = await import('./SettingsService');
      await saveSettings(
        {
          zalo: {
            oaId: cfg.oaId,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
          },
        },
        'zalo-auto-refresh',
      );
      return { accessToken: data.access_token, refreshToken: data.refresh_token };
    } catch {
      return null;
    }
  }

  async sendTrainingNotice(candidateId: string): Promise<{ ok: boolean; provider: string; messageId?: string }> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    if (!c.ngayBatDauTraining) throw new Error('Chưa có ngày bắt đầu Training');

    const cfg = await this.getConfig();
    let accessToken = cfg.accessToken;

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

    const useRealApi = !env.demoMode && accessToken;
    let status = 'PENDING';
    let error: string | null = null;
    let messageId: string | undefined;
    let provider = 'MOCK';

    if (useRealApi) {
      provider = 'ZALO_OA';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch('https://business.openapi.zalo.me/v3.0/message/official_account/text', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              access_token: accessToken,
            },
            body: JSON.stringify({
              recipient: { user_id: c.sdtZalo },
              message: { text: content },
            }),
          });
          const data = (await res.json()) as {
            error?: number;
            message?: string;
            data?: { message_id?: string };
          };
          if (data.error && data.error !== 0) {
            // Token hết hạn (452): refresh 1 lần rồi gửi lại
            if (data.error === 452 && attempt === 0) {
              const fresh = await this.refreshAccessToken();
              if (!fresh) throw new Error(`Zalo API lỗi: ${data.error} ${data.message ?? ''} (refresh thất bại)`);
              accessToken = fresh.accessToken;
              continue;
            }
            throw new Error(`Zalo API lỗi: ${data.error} ${data.message ?? ''}`);
          }
          messageId = data.data?.message_id;
          status = 'SENT';
          break;
        } catch (e) {
          status = 'FAILED';
          error = e instanceof Error ? e.message : String(e);
          break;
        }
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