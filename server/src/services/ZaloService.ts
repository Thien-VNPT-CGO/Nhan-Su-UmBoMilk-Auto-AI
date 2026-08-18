import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { env } from '../config/env';
import { getSettings } from './SettingsService';
import { emit } from '../sockets';
import { formatDate, TZ } from '../lib/date';
import { createHmac, createHash, randomBytes } from 'crypto';

/** Định dạng giờ phỏng vấn "dd/MM/yyyy lúc HH:mm" theo múi giờ hệ thống. */
function formatInterviewTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} lúc ${get('hour')}:${get('minute')}`;
}

interface ZaloMessageResponse {
  error?: number;
  message?: string;
  data?: { message_id?: string };
}
export class ZaloService {
  private pendingStates = new Map<string, { exp: number; codeVerifier: string }>();

  private async getConfig() {
    const settings = await getSettings();
    const zaloCfg = settings.zalo ?? {};
    return {
      oaId: zaloCfg.oaId || env.zaloOaId,
      accessToken: zaloCfg.accessToken || env.zaloAccessToken,
      refreshToken: zaloCfg.refreshToken || env.zaloRefreshToken,
    };
  }

  /** Tạo link OAuth để user duyệt quyền trên Zalo rồi tự động lưu token về.
   *  redirectUri lấy từ request thật (domain Render) + PKCE (Zalo yêu cầu code_challenge từ 2024). */
  async getAuthUrl(redirectUri: string): Promise<{ url: string; state: string }> {
    if (!env.zaloAppId || !env.zaloAppSecret) {
      throw new Error('Thiếu ZALO_APP_ID / ZALO_APP_SECRET trong .env (khai báo trên Render → Settings → Environment).');
    }
    const state = randomBytes(16).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    this.pendingStates.set(state, { exp: Date.now() + 10 * 60 * 1000, codeVerifier });
    const url = new URL('https://oauth.zaloapp.com/v4/oa/permission');
    url.searchParams.set('app_id', env.zaloAppId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString(), state };
  }

  /** Đổi authorization code lấy access/refresh token (chạy khi Zalo redirect về). */
  async exchangeCode(
    code: string,
    state: string,
    redirectUri: string,
  ): Promise<{ ok: boolean; accessToken?: string; refreshToken?: string; oaId?: string; error?: string }> {
    const pending = this.pendingStates.get(state);
    this.pendingStates.delete(state);
    if (!pending || pending.exp < Date.now()) {
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
          code_verifier: pending.codeVerifier,
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

  /** Kiểm tra access token còn hiệu lực (dùng cho health check trên web) + lý do để hiển thị rõ cho admin. */
  async ping(): Promise<{ ok: boolean; reason: string }> {
    const cfg = await this.getConfig();
    if (!cfg.accessToken) return { ok: false, reason: 'NO_TOKEN' };
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
        if (!res.ok) return { ok: false, reason: `API_ERROR_${res.status}` };
        // Token hết hạn/không hợp lệ → thử refresh 1 lần (cần ZALO_APP_ID/SECRET + refresh token lưu từ OAuth)
        if (data.error === 452 || data.error === -201 || data.error === -216) {
          if (attempt === 0) {
            const fresh = await this.refreshAccessToken();
            if (!fresh) return { ok: false, reason: 'EXPIRED_REFRESH_FAILED' };
            token = fresh.accessToken;
            continue;
          }
          return { ok: false, reason: 'EXPIRED_REFRESH_FAILED' };
        }
        // 453: token hợp lệ nhưng app bật chế độ appsecret_proof mà server không có secret
        if (data.error === 453) return { ok: true, reason: 'VALID_NO_PROOF' };
        return data.id
          ? { ok: true, reason: 'VALID' }
          : { ok: false, reason: `INVALID (${data.error ?? ''} ${data.message ?? ''})`.trim() };
      } catch {
        return { ok: false, reason: 'API_ERROR' };
      }
    }
    return { ok: false, reason: 'API_ERROR' };
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

  /** Tra cứu appuser_id (mã định danh người dùng trong app) của ứng viên theo SĐT hoặc user_id đã biết. */
  private async resolveUserId(accessToken: string, uid: string): Promise<string | null> {
    try {
      const res = await fetch(`https://openapi.zalo.me/v2.0/oa/getprofile?uid=${encodeURIComponent(uid)}`, {
        headers: { access_token: accessToken },
      });
      const data = (await res.json()) as { error?: number; data?: { user_id?: string; id?: string } };
      if (data.error && data.error !== 0) return null;
      return String(data.data?.user_id ?? data.data?.id ?? '').trim() || null;
    } catch {
      return null;
    }
  }

  /** Gửi tin nhắn Zalo OA thật (refresh token nếu hết hạn) và lưu lịch sử.
   *  recipient.user_id phải là appuser_id (mã 19 số) — tra cứu/lưu tự động qua zaloUserId của ứng viên. */
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

      // Bước 0: xác định appuser_id của người nhận (bắt buộc theo API Zalo, không phải SĐT)
      let userId = '';
      let candidate: { id: string; zaloUserId: string | null } | null = null;
      if (candidateId) {
        candidate = await prisma.candidate.findUnique({
          where: { id: candidateId },
          select: { id: true, zaloUserId: true },
        });
        userId = candidate?.zaloUserId ?? '';
      }
      if (!userId) {
        const resolved = await this.resolveUserId(accessToken, phone);
        if (!resolved) {
          status = 'FAILED';
          error =
            'Chưa có Zalo User ID của ứng viên. Hãy nhờ ứng viên nhắn 1 tin bất kỳ cho OA (để hệ thống tự lưu mã) rồi gửi lại, hoặc mở hồ sơ ứng viên để nhập mã.';
        } else {
          userId = resolved;
          if (candidate) {
            await prisma.candidate
              .update({ where: { id: candidate.id }, data: { zaloUserId: userId } })
              .catch(() => undefined);
          }
        }
      }

      if (userId) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            let res = await fetch('https://openapi.zalo.me/v2.0/oa/message', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                access_token: accessToken,
              },
              body: JSON.stringify({
                recipient: { user_id: userId },
                message: { text: content },
              }),
            });
            let data: ZaloMessageResponse | null = null;
            try {
              data = (await res.json()) as ZaloMessageResponse;
            } catch {
              // endpoint v2.0 không phản hồi JSON → thử endpoint v3.0 cũ (message là chuỗi, cần oa_id trong path)
              data = null;
              if (!cfg.oaId) throw new Error(`Zalo API không phản hồi (HTTP ${res.status}) và thiếu OA ID để fallback.`);
              const fb = await fetch(`https://openapi.zalo.me/v3.0/message/officialaccount/${cfg.oaId}/text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', access_token: accessToken },
                body: JSON.stringify({ recipient: { user_id: userId }, message: content }),
              });
              try {
                data = (await fb.json()) as ZaloMessageResponse;
              } catch {
                throw new Error(`Zalo API không phản hồi (HTTP ${fb.status}).`);
              }
            }
            if (data?.error && data.error !== 0) {
              // Token hết hạn/không hợp lệ (452, -201, -216): refresh 1 lần rồi gửi lại
              const tokenDead = data.error === 452 || data.error === -201 || data.error === -216;
              if (tokenDead && attempt === 0) {
                const fresh = await this.refreshAccessToken();
                if (!fresh) throw new Error(`Zalo API lỗi: ${data.error} ${data.message ?? ''} (refresh thất bại)`);
                accessToken = fresh.accessToken;
                continue;
              }
              throw new Error(`Zalo API lỗi: ${data.error} ${data.message ?? ''}`);
            }
            messageId = data?.data?.message_id;
            status = 'SENT';
            break;
          } catch (e) {
            status = 'FAILED';
            error = e instanceof Error ? e.message : String(e);
            break;
          }
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

    const content = [
      '🐮 UMBO MILK – LỜI MỜI PHỎNG VẤN',
      '',
      `Chào ${c.tenUv} ❤️`,
      '',
      'Chúc mừng bạn đã vượt qua vòng hồ sơ ứng tuyển!',
      '',
      `Thời gian phỏng vấn: ${formatInterviewTime(c.phongVanAt)}`,
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

  /** Nhắc phỏng vấn trước giờ PV (1 lần/lịch hẹn, chống trùng bằng marker trong nội dung). */
  async sendInterviewReminder(candidateId: string, remindHours: number): Promise<{ ok: boolean; status: string }> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    if (!c.phongVanAt || !c.ggMeetLink) throw new Error('Chưa có lịch phỏng vấn');

    const marker = `[NHACPV:${c.phongVanAt.toISOString()}]`;
    const content = [
      marker,
      '🐮 UMBO MILK – NHẮC PHỎNG VẤN',
      '',
      `Chào ${c.tenUv} ❤️`,
      '',
      `Chỉ còn ${remindHours} tiếng nữa là đến buổi phỏng vấn của bạn!`,
      '',
      `Thời gian phỏng vấn: ${formatInterviewTime(c.phongVanAt)}`,
      `Link phỏng vấn: ${c.ggMeetLink}`,
      '',
      'Hãy vào đúng giờ nhé. Chúc bạn may mắn!',
    ].join('\n');

    const existed = await prisma.zaloMessage.findFirst({
      where: { phone: c.sdtZalo, content: { contains: marker } },
    });
    if (existed) return { ok: true, status: 'SKIP_DUP' };

    const r = await this.sendRaw(c.sdtZalo, content, c.id);
    return { ok: r.ok, status: r.status };
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
    const zaloUserId = String(p.sender?.user_id ?? p.sender?.id ?? '').trim();
    const phoneRaw = String(p.sender?.phone ?? '').trim();

    // Tìm ứng viên: ưu tiên theo SĐT, nếu không có SĐT thì theo Zalo User ID; lưu lại user_id để gửi tin sau
    let candidate = phoneRaw ? await prisma.candidate.findFirst({ where: { sdtZalo: phoneRaw } }) : null;
    if (!candidate && zaloUserId) {
      candidate = await prisma.candidate.findFirst({ where: { zaloUserId } });
    }
    if (candidate && zaloUserId && candidate.zaloUserId !== zaloUserId) {
      await prisma.candidate.update({ where: { id: candidate.id }, data: { zaloUserId } });
    }
    const phone = phoneRaw || zaloUserId;
    if (!phone) return;
    const candidateId = candidate?.id ?? null;

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
        phone: phoneRaw || candidate?.sdtZalo || zaloUserId,
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