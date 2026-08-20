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

  /** Tính appsecret_proof = HMAC-SHA256(access_token, app_secret) — bắt buộc khi app bật chế độ bảo mật
   *  trên developers.zalo.me (Cài đặt ứng dụng → Bảo mật → "Yêu cầu appsecret_proof"). */
  private oaProofHeaders(token: string): Record<string, string> {
    const headers: Record<string, string> = { access_token: token };
    if (env.zaloAppSecret) {
      const proof = createHmac('sha256', env.zaloAppSecret).update(token).digest('hex');
      headers['appsecret_proof'] = proof;
    }
    return headers;
  }

  /** Tạo link OAuth để user duyệt quyền trên Zalo rồi tự động lưu token về.
   *  redirectUri lấy từ request thật (domain Render) + PKCE (Zalo yêu cầu code_challenge từ 2024).
   *  FIX BUG 1: Dọn state hết hạn trước khi thêm mới để tránh memory leak và tránh nhầm state cũ. */
  async getAuthUrl(redirectUri: string): Promise<{ url: string; state: string }> {
    if (!env.zaloAppId || !env.zaloAppSecret) {
      throw new Error('Thiếu ZALO_APP_ID / ZALO_APP_SECRET trong .env (khai báo trên Render → Settings → Environment).');
    }
    // Dọn state hết hạn để tránh memory leak khi gọi nhiều lần
    const now = Date.now();
    for (const [key, val] of this.pendingStates.entries()) {
      if (val.exp < now) this.pendingStates.delete(key);
    }
    const state = randomBytes(16).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    // TTL 15 phút thay vì 10 để có đủ thời gian user duyệt quyền trên mobile
    this.pendingStates.set(state, { exp: now + 15 * 60 * 1000, codeVerifier });
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
      // FIX BUG 2: Thêm redirect_uri vào body — Zalo v4 bắt buộc phải khớp với URL đăng ký
      const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
        method: 'POST',
        headers: { secret_key: env.zaloAppSecret },
        body: new URLSearchParams({
          app_id: env.zaloAppId,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: pending.codeVerifier,
        }),
      });
      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        error?: number;
        error_description?: string;
        message?: string;
      };
      if (!data.access_token) {
        const errMsg = data.error_description ?? data.message ?? `Zalo lỗi: ${data.error ?? 'không rõ'}`;
        console.error('[Zalo] exchangeCode thất bại:', data);
        return { ok: false, error: errMsg };
      }
      // FIX BUG 3: Lấy OA ID từ đúng endpoint OA API (openapi), không phải User Graph (graph)
      // graph.zalo.me/v2.0/me trả về user ID của người dùng cá nhân, KHÔNG phải OA ID
      let oaId: string | undefined;
      try {
        const oaRes = await fetch('https://openapi.zalo.me/v2.0/oa/getoa', {
          headers: this.oaProofHeaders(data.access_token),
        });
        const oaData = (await oaRes.json()) as { error?: number; data?: { oa_id?: string; name?: string } };
        if (!oaData.error && oaData.data?.oa_id) {
          oaId = String(oaData.data.oa_id);
          console.log('[Zalo] Lấy OA ID thành công:', oaId, oaData.data.name);
        }
      } catch {
        // bỏ qua - oaId sẽ lấy từ query/env nếu có
      }
      return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token, oaId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Kiểm tra access token còn hiệu lực (dùng cho health check trên web) + lý do để hiển thị rõ cho admin.
   *  Dùng đúng endpoint OA API (openapi.zalo.me/v2.0/oa/getoa) + kèm appsecret_proof nếu app bật bảo mật. */
  async ping(): Promise<{ ok: boolean; reason: string }> {
    const cfg = await this.getConfig();
    if (!cfg.accessToken) return { ok: false, reason: 'NO_TOKEN' };
    let token = cfg.accessToken;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch('https://openapi.zalo.me/v2.0/oa/getoa', {
          headers: this.oaProofHeaders(token),
        });
        const data = (await res.json()) as { error?: number; message?: string; data?: { oa_id?: string; name?: string } };
        if (!res.ok) return { ok: false, reason: `API_ERROR_${res.status}` };
        // Token hết hạn/không hợp lệ (452/-204/-201/-216) → thử refresh 1 lần
        if (data.error === 452 || data.error === -204 || data.error === -201 || data.error === -216) {
          if (attempt === 0) {
            const fresh = await this.refreshAccessToken();
            if (!fresh.ok || !fresh.accessToken) {
              return { ok: false, reason: `EXPIRED_REFRESH_FAILED: ${fresh.error ?? 'không rõ lý do'}` };
            }
            token = fresh.accessToken;
            continue;
          }
          return { ok: false, reason: 'EXPIRED_REFRESH_FAILED' };
        }
        if (data.error && data.error !== 0) {
          return { ok: false, reason: `INVALID (${data.error} ${data.message ?? ''})`.trim() };
        }
        return data.data?.oa_id
          ? { ok: true, reason: 'VALID' }
          : { ok: false, reason: `INVALID (${data.error ?? ''} ${data.message ?? ''})`.trim() };
      } catch {
        return { ok: false, reason: 'API_ERROR' };
      }
    }
    return { ok: false, reason: 'API_ERROR' };
  }

  /** Tự động đổi refresh token lấy access token mới khi token hết hạn (lưu lại settings).
   *  Refresh token Zalo chỉ dùng được 1 lần → chống gọi song song (2 luồng cùng refresh sẽ hủy nhau). */
  private refreshInFlight: Promise<{ ok: boolean; accessToken?: string; refreshToken?: string; error?: string }> | null = null;

  private async refreshAccessToken(): Promise<{ ok: boolean; accessToken?: string; refreshToken?: string; error?: string }> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.doRefresh();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async doRefresh(): Promise<{ ok: boolean; accessToken?: string; refreshToken?: string; error?: string }> {
    const cfg = await this.getConfig();
    if (!cfg.refreshToken) {
      return { ok: false, error: 'NO_REFRESH_TOKEN: chưa có refresh token — phải bấm "Kết nối Zalo OA" để cấp mới' };
    }
    if (!env.zaloAppId || !env.zaloAppSecret) {
      return { ok: false, error: 'MISSING_ENV: thiếu ZALO_APP_ID / ZALO_APP_SECRET trên Render (đổi xong phải bấm Deploy lại)' };
    }
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
      const data = (await res.json()) as { access_token?: string; refresh_token?: string; error?: number; message?: string };
      if (!data.access_token || !data.refresh_token) {
        console.warn('[Zalo] refresh thất bại:', data.error, data.message);
        const err = data.error;
        const hint =
          err === -14014 || err === -135
            ? 'refresh token đã hết hạn hoặc đã dùng — bắt buộc bấm "Kết nối Zalo OA" để cấp refresh token mới'
            : err === -14005
              ? 'mã ủy quyền không hợp lệ — kết nối lại'
              : err === 201 || err === -201
                ? 'thiếu tham số app_id / secret_key — kiểm tra ZALO_APP_ID / ZALO_APP_SECRET trên Render'
                : 'không rõ';
        return { ok: false, error: `Zalo lỗi ${data.error ?? res.status} (${hint}${data.message ? ' — ' + data.message : ''})` };
      }
      const { saveSettings } = await import('./SettingsService');
      await saveSettings(
        {
          zalo: {
            oaId: cfg.oaId,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            lastRefreshAt: new Date().toISOString(),
          },
        },
        'zalo-auto-refresh',
      );
      return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token };
    } catch (e) {
      return { ok: false, error: `API_ERROR: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * Tự động gia hạn access token + rotate refresh token.
   * Được gọi từ timer mỗi giờ trong startSystem().
   *
   * Chiến lược:
   *  - Access token Zalo OA sống 25 giờ → refresh chủ động sau 20h (dư 5h buffer).
   *  - Mỗi lần refresh Zalo cấp ĐỒNG THỜI access_token mới + refresh_token mới (rotate tự động).
   *  - Refresh token sống 90 ngày nhưng single-use → khi refresh mỗi 20h, refresh_token luôn được
   *    gia hạn liên tục → kết nối "vĩnh viễn" không cần bấm OAuth lại.
   *  - Phòng thủ 2 lớp: timer chủ động (20h) + reactive khi gửi tin thất bại (452/-216).
   */
  async ensureTokenFresh(): Promise<{ refreshed: boolean; reason?: string }> {
    const settings = await getSettings();
    const zaloCfg = settings.zalo ?? {};

    // Không có access token → chưa kết nối, bỏ qua
    if (!zaloCfg.accessToken) {
      return { refreshed: false, reason: 'NO_ACCESS_TOKEN' };
    }

    // Không có refresh token → không thể tự refresh, cần user bấm OAuth lại
    if (!zaloCfg.refreshToken) {
      console.warn('[Zalo] ensureTokenFresh: Không có refresh token — cần bấm "Kết nối Zalo OA" để cấp mới.');
      return { refreshed: false, reason: 'NO_REFRESH_TOKEN' };
    }

    // Kiểm tra lần refresh gần nhất: nếu < 20h thì chưa cần refresh
    const last = zaloCfg.lastRefreshAt ? new Date(zaloCfg.lastRefreshAt).getTime() : 0;
    const REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 giờ (access token sống 25h)
    if (last && Date.now() - last < REFRESH_INTERVAL_MS) {
      const nextIn = Math.round((last + REFRESH_INTERVAL_MS - Date.now()) / 60_000);
      return { refreshed: false, reason: `TOKEN_STILL_FRESH (refresh sau ~${nextIn} phút)` };
    }

    // Thực hiện refresh
    console.log('[Zalo] Auto-refresh token (đã >20h kể từ lần refresh cuối)...');
    const r = await this.refreshAccessToken();
    if (r.ok) {
      console.log('[Zalo] ✅ Token tự động gia hạn thành công — access_token + refresh_token đã rotate.');
      return { refreshed: true };
    }
    console.warn('[Zalo] ⚠️ Token tự động gia hạn thất bại:', r.error);
    return { refreshed: false, reason: r.error };
  }

  /** Gia hạn token ngay lập tức theo yêu cầu thủ công (bỏ qua kiểm tra 20h). */
  async forceRefreshToken(): Promise<{ ok: boolean; error?: string }> {
    return this.refreshAccessToken();
  }

  /** Tra cứu appuser_id (mã định danh người dùng trong app) của ứng viên theo SĐT hoặc user_id đã biết. */
  private async resolveUserId(accessToken: string, uid: string): Promise<string | null> {
    try {
      const res = await fetch(`https://openapi.zalo.me/v2.0/oa/getprofile?uid=${encodeURIComponent(uid)}`, {
        headers: this.oaProofHeaders(accessToken),
      });
      const data = (await res.json()) as { error?: number; data?: { user_id?: string; id?: string } };
      if (data.error && data.error !== 0) return null;
      return String(data.data?.user_id ?? data.data?.id ?? '').trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Tự động tra cứu Zalo User ID theo SĐT ứng viên ngay khi ứng viên điền Form đăng ký
   * và lưu mã Zalo User ID vào hồ sơ database của ứng viên.
   */
  async tryResolveAndSaveUserId(candidateId: string, phone: string): Promise<string | null> {
    try {
      const cfg = await this.getConfig();
      if (!cfg.accessToken) return null;
      const userId = await this.resolveUserId(cfg.accessToken, phone);
      if (userId) {
        await prisma.candidate.update({
          where: { id: candidateId },
          data: { zaloUserId: userId },
        }).catch(() => undefined);
        console.log(`[ZaloService] ✅ Tự động lấy Zalo User ID (${userId}) cho ứng viên ${candidateId} (${phone}) từ Form đăng ký.`);
        return userId;
      }
    } catch (e) {
      console.warn(`[ZaloService] Chưa tra cứu được Zalo User ID cho SĐT ${phone}:`, e instanceof Error ? e.message : String(e));
    }
    return null;
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
              const tokenDead = data.error === 452 || data.error === -204 || data.error === -201 || data.error === -216;
              if (tokenDead && attempt === 0) {
                const fresh = await this.refreshAccessToken();
                if (!fresh.ok || !fresh.accessToken) {
                  throw new Error(`Zalo API lỗi: ${data.error} ${data.message ?? ''} (refresh thất bại: ${fresh.error ?? ''})`);
                }
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
      user_id_by_app?: string;
      follower?: { id?: string };
      sender?: { phone?: string; user_id?: string; id?: string };
      message?: {
        text?: string;
        type?: string;
        location?: { lat?: number | string; long?: number | string };
      };
    };
    const zaloUserId = String(p.sender?.user_id ?? p.sender?.id ?? p.user_id_by_app ?? p.follower?.id ?? '').trim();
    let phoneRaw = String(p.sender?.phone ?? '').trim();

    const message = p.message ?? {};
    const text = String(message.text ?? '').trim();

    // 1. Tự động trích xuất SĐT từ nội dung tin nhắn nếu ứng viên gửi SĐT ("0333137633" hoặc "SĐT em là 0333...")
    if (!phoneRaw && text) {
      const matchPhone = text.match(/(?:84|0)[35789]\d{8}\b/);
      if (matchPhone) {
        phoneRaw = matchPhone[0].replace(/^84/, '0');
      }
    }

    // 2. Tra cứu Zalo Profile (SĐT chia sẻ & Tên Zalo) từ Zalo API bằng zaloUserId
    let profilePhone = '';
    let profileName = '';
    if (zaloUserId) {
      try {
        const cfg = await this.getConfig();
        if (cfg.accessToken) {
          const profileRes = await fetch(`https://openapi.zalo.me/v2.0/oa/getprofile?uid=${encodeURIComponent(zaloUserId)}`, {
            headers: this.oaProofHeaders(cfg.accessToken),
          });
          const profileData = (await profileRes.json()) as {
            error?: number;
            data?: {
              display_name?: string;
              shared_info?: { phone?: string | number };
            };
          };
          if (profileData.data) {
            profileName = String(profileData.data.display_name ?? '').trim();
            const rawP = String(profileData.data.shared_info?.phone ?? '').trim();
            if (rawP) {
              profilePhone = rawP.replace(/^\+?84/, '0');
            }
          }
        }
      } catch {
        // bỏ qua lỗi profile
      }
    }

    // 3. Thuật toán ghép nối ứng viên đa tầng (Multi-tier Matching Algorithm)
    const sdtSearch = phoneRaw || profilePhone;
    let candidate = sdtSearch ? await prisma.candidate.findFirst({ where: { sdtZalo: sdtSearch } }) : null;
    if (!candidate && zaloUserId) {
      candidate = await prisma.candidate.findFirst({ where: { zaloUserId } });
    }
    // Nếu vẫn chưa tìm thấy theo SĐT / User ID, ghép theo Họ Tên Zalo với hồ sơ chưa có ID
    if (!candidate && profileName) {
      candidate = await prisma.candidate.findFirst({
        where: {
          zaloUserId: null,
          tenUv: { contains: profileName, mode: 'insensitive' },
        },
        orderBy: { thoiGian: 'desc' },
      });
    }
    // Nếu vẫn chưa tìm thấy và trong 24h qua chỉ có 1 ứng viên vừa nộp form chưa có ID
    if (!candidate && zaloUserId) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentPending = await prisma.candidate.findMany({
        where: { zaloUserId: null, thoiGian: { gte: oneDayAgo } },
        orderBy: { thoiGian: 'desc' },
        take: 2,
      });
      if (recentPending.length === 1) {
        candidate = recentPending[0];
      }
    }

    // 4. Cập nhật Zalo User ID vào database & thông báo real-time qua Socket cho Web UI
    if (candidate && zaloUserId && candidate.zaloUserId !== zaloUserId) {
      await prisma.candidate.update({ where: { id: candidate.id }, data: { zaloUserId } });
      console.log(`[ZaloWebhook] 🎉 TỰ ĐỘNG GHÉP THÀNH CÔNG: Đã gắn Zalo User ID (${zaloUserId}) cho ứng viên: ${candidate.tenUv} (${candidate.sdtZalo})`);
      emit('candidate:new', { candidateId: candidate.id });
    }

    const phone = sdtSearch || candidate?.sdtZalo || zaloUserId;
    if (!phone) return;
    const candidateId = candidate?.id ?? null;

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