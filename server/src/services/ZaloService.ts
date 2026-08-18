import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { env } from '../config/env';
import { getSettings } from './SettingsService';
import { emit } from '../sockets';
import { formatDate, TZ } from '../lib/date';
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

  /** Gửi tin nhắn Zalo OA thật (refresh token nếu hết hạn) và lưu lịch sử. */
  private async sendRaw(
    phone: string,
    content: string,
    candidateId: string | null,
    options: { direction?: string; messageType?: string } = {},
  ): Promise<{ ok: boolean; provider: string; messageId?: string; status: string; error?: string | null }> {
    const cfg = await this.getConfig();
    let accessToken = cfg.accessToken;
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
              recipient: { user_id: phone },
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
        candidateId,
        phone,
        content,
        status,
        error,
        provider,
        direction: options.direction ?? 'OUT',
        messageType: options.messageType ?? 'text',
      },
    });
    emit('zalo:status', { candidateId, status, messageId: msg.id, direction: options.direction ?? 'OUT' });
    return { ok: status === 'SENT', provider, messageId: msg.id, status };
  }

  /** Gửi tin text tùy ý (dùng cho auto-reply, thông báo thủ công...). */
  async sendText(phone: string, content: string, candidateId: string | null): Promise<{ ok: boolean; status: string }> {
    const r = await this.sendRaw(phone, content, candidateId);
    return { ok: r.ok, status: r.status };
  }

  async sendTrainingNotice(candidateId: string): Promise<{ ok: boolean; provider: string; messageId?: string }> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    if (!c.ngayBatDauTraining) throw new Error('Chưa có ngày bắt đầu Training');

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

    const r = await this.sendRaw(c.sdtZalo, content, c.id);
    return { ok: r.ok, provider: r.provider, messageId: r.messageId };
  }

  /** Gửi lời mời phỏng vấn (thời gian + link GG Meet) cho ứng viên vừa được HR chấm PASS. */
  async sendInterviewInvite(candidateId: string): Promise<{ ok: boolean; provider: string; messageId?: string }> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    if (!c.phongVanAt) throw new Error('Chưa có thời gian phỏng vấn');
    if (!c.ggMeetLink) throw new Error('Chưa có link GG Meet');

    const d = c.phongVanAt;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const time = `${get('day')}/${get('month')}/${get('year')} lúc ${get('hour')}:${get('minute')}`;

    const content = [
      '🐮 UMBO MILK – LỜI MỜI PHỎNG VẤN',
      '',
      `Chào ${c.tenUv} ❤️`,
      '',
      'Chúc mừng bạn đã vượt qua vòng hồ sơ ứng tuyển!',
      '',
      `Thời gian phỏng vấn: ${time}`,
      `Hình thức: Online qua Google Meet`,
      `Link phỏng vấn: ${c.ggMeetLink}`,
      '',
      `Chi nhánh: ${c.chiNhanh}`,
      '',
      'Vui lòng nhắn lại tin này: "có" để xác nhận tham dự nhé.',
    ].join('\n');

    const r = await this.sendRaw(c.sdtZalo, content, c.id);
    return { ok: r.ok, provider: r.provider, messageId: r.messageId };
  }

  /** Nhắc điểm danh trước giờ làm 30 phút (1 ca = 1 tin/ngày, đánh dấu trong nội dung để không gửi trùng). */
  async sendShiftReminder(
    candidate: { id: string; tenUv: string; sdtZalo: string; chiNhanh: string },
    date: string,
    shift: string,
    shiftStart: string,
  ): Promise<{ ok: boolean; status: string }> {
    const marker = `[NHAC:${date}:${shift}]`;
    const content = [
      marker,
      '🐮 UMBO MILK – NHẮC ĐIỂM DANH',
      '',
      `Chào ${candidate.tenUv} ❤️`,
      '',
      `Hôm nay (${date}) bạn có ca ${shift} lúc ${shiftStart} tại ${candidate.chiNhanh}.`,
      '',
      'Vui lòng nhắn: điểm danh',
      'đến OA UMBO MILK trong khung giờ cho phép.',
    ].join('\n');

    const existed = await prisma.zaloMessage.findFirst({
      where: { phone: candidate.sdtZalo, content: { contains: marker } },
    });
    if (existed) return { ok: true, status: 'SKIP_DUP' };

    const r = await this.sendRaw(candidate.sdtZalo, content, candidate.id);
    return { ok: r.ok, status: r.status };
  }

  /**
   * Webhook Zalo OA: xử lý tin nhắn 2 chiều.
   * - Text "điểm danh" → checkin (kèm GPS nếu có).
   * - Message location (GPS) → checkin theo vị trí (geofence).
   * - Tin nhắn khác → AI auto-reply (nếu bật), có bối cảnh hồ sơ ứng viên.
   */
  async webhook(payload: unknown): Promise<void> {
    const p = payload as {
      sender?: { phone?: string; user_id?: string; id?: string };
      message?: {
        text?: string;
        type?: string;
        location?: { lat?: number | string; long?: number | string };
      };
    };
    const phone = p.sender?.phone ?? String(p.sender?.user_id ?? p.sender?.id ?? '');
    if (!phone) return;
    const message = p.message ?? {};
    const text = String(message.text ?? '').trim();
    const upper = text.toUpperCase();
    const isLocation = message.type === 'location';
    let location: { lat: number; lng: number } | null = null;
    if (isLocation) {
      const lat = Number(message.location?.lat);
      const lng = Number(message.location?.long ?? message.location?.lat);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return; // location thiếu tọa độ hợp lệ
      }
      location = { lat, lng };
    }

    // Tìm ứng viên theo SĐT để gắn tin nhắn + gửi auto-reply có ngữ cảnh
    const candidate = await prisma.candidate.findFirst({ where: { sdtZalo: phone } });
    const candidateId = candidate?.id ?? null;

    // Lưu tin nhắn NHẬN vào lịch sử (direction = IN)
    const incoming = await prisma.zaloMessage.create({
      data: {
        id: nextId('ZAL'),
        candidateId,
        phone,
        content: isLocation && location
          ? `[VỊ TRÍ] ${location.lat}, ${location.lng}`
          : (text || '(tin nhắn rỗng)'),
        status: 'SENT',
        provider: 'ZALO_OA',
        direction: 'IN',
        messageType: isLocation ? 'location' : 'text',
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
      },
    });
    emit('zalo:incoming', {
      id: incoming.id,
      candidateId,
      phone,
      content: incoming.content,
      messageType: incoming.messageType,
    });

    // Lệnh điểm danh (text hoặc GPS) → checkin + phản hồi kết quả
    if (upper.includes('ĐIỂM DANH') || upper.includes('DIEM DANH') || isLocation) {
      const { attendanceService, checkinReasonText } = await import('./AttendanceService');
      const result = await attendanceService.checkin({
        phone,
        method: 'ZALO',
        location,
      });
      const reply = checkinReasonText(result.valid, result.reason, candidate?.tenUv ?? 'Bạn');
      await this.sendRaw(phone, reply, candidateId).catch(() => undefined);
      return;
    }

    // Tin nhắn thường → AI auto-reply
    if (!text) return;
    const settings = await getSettings();
    if (settings.zalo?.autoReply === false) return;
    try {
      const { chatWithAI } = await import('./ai/AIClient');
      const context = candidate
        ? `Ứng viên ${candidate.tenUv}, chi nhánh ${candidate.chiNhanh}, ca ${candidate.caLam}.`
        : 'Người lạ chưa có hồ sơ trong hệ thống.';
      const answer = await chatWithAI(
        `Bạn là trợ lý tuyển dụng của UMBO MILK (chuỗi trà sữa). Ngữ cảnh: ${context}.
Quy tắc: trả lời ngắn gọn, thân thiện bằng tiếng Việt, tối đa 3 câu. Không bịa thông tin về lương cụ thể — hướng dẫn liên hệ quản lý chi nhánh. Nếu câu hỏi ngoài phạm vi, từ chối khéo.`,
        text,
      );
      await this.sendRaw(phone, answer, candidateId).catch(() => undefined);
    } catch (e) {
      console.warn('[Zalo] AI auto-reply:', e instanceof Error ? e.message : String(e));
    }
  }
}

export const zaloService = new ZaloService();