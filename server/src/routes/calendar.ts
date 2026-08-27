import { Router, Request } from 'express';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { calendarService } from '../services/GoogleCalendarService';
import { saveSettings } from '../services/SettingsService';
import { audit } from '../services/AuditService';
import { ApiError } from '../lib/errors';

const router = Router();

/** Redirect URI lấy từ request thật (domain Render) — phải khớp chính xác với URI đã đăng ký trong Google Cloud Console. */
const redirectUriOf = (req: Request) => {
  const host = req.get('host') ?? 'localhost:3000';
  const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
  const protocol = isLocal ? req.protocol : 'https';
  return `${protocol}://${host}/api/calendar/oauth-callback`;
};

/** Bước 1 OAuth: trả URL Google để admin bấm duyệt quyền (state TTL 10 phút). */
router.get('/oauth-url', requireAuth, async (req, res, next) => {
  try {
    res.json({ success: true, data: await calendarService.getAuthUrl(redirectUriOf(req)) });
  } catch (e) {
    next(e);
  }
});

/** Bước 2+3 OAuth: đổi code → lưu refresh token vào settings → quay về trang Cài đặt. */
router.get('/oauth-callback', async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (!code) {
    res.redirect(`/settings?calendar_error=${encodeURIComponent(error ? `Google từ chối: ${error}` : 'Thiếu mã code từ Google.')}`);
    return;
  }
  const result = await calendarService.exchangeCode(code, state ?? '', redirectUriOf(req));
  if (!result.ok) {
    res.redirect(`/settings?calendar_error=${encodeURIComponent('Xác thực Google thất bại hoặc liên kết hết hạn. Hãy kiểm tra Client ID/Secret và thử lại.')}`);
    return;
  }
  res.redirect('/settings?calendar_ok=1');
});

/** Xóa kết nối Google Calendar (token) — icon/trạng thái trong Cài đặt tắt ngay. */
router.post('/disconnect', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    await calendarService.disconnect();
    await audit({
      user: req.user!.username,
      action: 'DISCONNECT_CALENDAR',
      entity: 'system',
      entityId: 'app_settings',
    });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/** Kiểm tra kết nối bằng cách tạo 1 sự kiện thử 10 phút (trả link Meet — bằng chứng OAuth hoạt động). */
router.post('/test', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const ev = await calendarService.createEvent({
      summary: 'Test UMBO MILK – kiểm tra kết nối',
      description: 'Sự kiện thử do admin tạo từ trang Cài đặt.',
      start: new Date(Date.now() + 60 * 60_000),
      durationMinutes: 10,
    });
    res.json({ success: true, data: ev });
  } catch (e) {
    next(e);
  }
});

export default router;
