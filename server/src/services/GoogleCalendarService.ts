import { env } from '../config/env';
import { getSettings, saveSettings } from './SettingsService';
import { randomBytes } from 'crypto';

const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

interface CalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}

/** Google Calendar: OAuth 3 bước giống Zalo + tự tạo sự kiện có link Google Meet.
 *  Token lưu trong settings.googleCalendar (không cần tạo file credentials trên server). */
export class GoogleCalendarService {
  private pendingStates = new Map<string, number>();
  private tokenCache: { token: string; expiresAt: number } | null = null;

  private async getConfig(): Promise<CalendarConfig> {
    const settings = await getSettings();
    const gc = settings.googleCalendar ?? {};
    return {
      clientId: gc.clientId || env.googleClientId,
      clientSecret: gc.clientSecret || env.googleClientSecret,
      refreshToken: gc.refreshToken || '',
      calendarId: gc.calendarId || env.googleCalendarId || 'primary',
    };
  }

  /** Bước 1: tạo URL OAuth để admin duyệt quyền trên Google rồi tự lưu token. */
  async getAuthUrl(): Promise<{ url: string; state: string }> {
    const cfg = await this.getConfig();
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error('Thiếu GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET trong .env hoặc Cài đặt');
    }
    const state = randomBytes(16).toString('hex');
    this.pendingStates.set(state, Date.now());
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: env.googleRedirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, state };
  }

  /** Bước 2+3: đổi code lấy refresh token + lưu vào settings (chạy 1 lần duy nhất). */
  async exchangeCode(code: string, state: string): Promise<{ ok: boolean; refreshToken?: string }> {
    const cfg = await this.getConfig();
    const issuedAt = this.pendingStates.get(state);
    this.pendingStates.delete(state);
    if (!issuedAt || Date.now() - issuedAt > 10 * 60_000) {
      return { ok: false };
    }
    const body = new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: env.googleRedirectUri,
      grant_type: 'authorization_code',
    });
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = (await r.json()) as { refresh_token?: string; access_token?: string; expires_in?: number; error?: string };
    if (!r.ok || (!data.refresh_token && !data.access_token)) {
      console.warn('[Calendar] exchangeCode:', data.error ?? r.status);
      return { ok: false };
    }
    if (data.refresh_token) {
      await saveSettings(
        { googleCalendar: { enabled: true, refreshToken: data.refresh_token, clientId: cfg.clientId, clientSecret: cfg.clientSecret } },
        'calendar-oauth',
      );
    }
    this.tokenCache = { token: data.access_token ?? '', expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return { ok: true, refreshToken: data.refresh_token };
  }

  /** Lấy access token: ưu tiên cache, hết hạn thì refresh (refresh token không hết hạn). */
  private async getAccessToken(): Promise<string> {
    const cfg = await this.getConfig();
    if (this.tokenCache && this.tokenCache.token && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }
    if (!cfg.refreshToken) throw new Error('Chưa kết nối Google Calendar (thiếu refresh token).');
    const body = new URLSearchParams({
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    });
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = (await r.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!r.ok || !data.access_token) {
      throw new Error(`Refresh token lỗi: ${data.error ?? r.status}. Kết nối lại Google Calendar.`);
    }
    this.tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return data.access_token;
  }

  async ping(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  /** Tạo sự kiện phỏng vấn trên Google Calendar → trả link Google Meet tự tạo. */
  async createEvent(input: {
    summary: string;
    description: string;
    start: Date;
    durationMinutes: number;
  }): Promise<{ id: string; hangoutLink: string }> {
    const cfg = await this.getConfig();
    const token = await this.getAccessToken();
    const end = new Date(input.start.getTime() + input.durationMinutes * 60_000);
    const body = {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISOString(), timeZone: env.timezone },
      end: { dateTime: end.toISOString(), timeZone: env.timezone },
      conferenceData: {
        createRequest: {
          requestId: `umbomilk-${Date.now()}-${randomBytes(4).toString('hex')}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events?conferenceDataVersion=1`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as { id?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] }; error?: { message: string } };
    if (!r.ok || !data.id) {
      throw new Error(`Tạo sự kiện Calendar lỗi: ${data.error?.message ?? r.status}`);
    }
    const hangoutLink = data.hangoutLink ?? data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
    if (!hangoutLink) throw new Error('Google đã tạo sự kiện nhưng không trả link Meet.');
    return { id: data.id, hangoutLink };
  }

  /** Xóa kết nối: làm trống token (calendarId giữ lại để dễ kết nối lại). */
  async disconnect(): Promise<void> {
    await saveSettings(
      { googleCalendar: { enabled: false, refreshToken: '', clientId: '', clientSecret: '', calendarId: '' } },
      'calendar-disconnect',
    );
    this.tokenCache = null;
  }
}

export const calendarService = new GoogleCalendarService();
