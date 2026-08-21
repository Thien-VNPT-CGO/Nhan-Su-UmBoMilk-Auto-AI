import { Router, Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireWrite, requireRole, AuthedRequest } from '../middleware/auth';
import { zaloService } from '../services/ZaloService';
import { zaloPersonalService } from '../services/ZaloPersonalService';
import { saveSettings } from '../services/SettingsService';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { ApiError } from '../lib/errors';
import { nextId } from '../lib/id';

const router = Router();

/** Redirect URI lấy từ request thật (domain Render) — phải khớp Callback URL đã khai báo trên developers.zalo.me. */
const redirectUriOf = (req: Request) => `${req.protocol}://${req.get('host')}/api/zalo/oauth-callback`;

router.get('/oauth-url', requireAuth, async (req, res, next) => {
  try {
    const result = await zaloService.getAuthUrl(redirectUriOf(req));
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

router.get('/oauth-callback', async (req, res) => {
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const oaIdFromQuery = String(req.query.oa_id ?? '');
  const result = await zaloService.exchangeCode(code, state, redirectUriOf(req));
  if (!result.ok) {
    res.redirect(`/settings?zalo_error=${encodeURIComponent(result.error ?? 'Kết nối Zalo thất bại.')}`);
    return;
  }
  await saveSettings(
    {
      zalo: {
        oaId: result.oaId || oaIdFromQuery || env.zaloOaId,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        lastRefreshAt: new Date().toISOString(),
      },
    },
    'zalo-oauth',
  );
  res.redirect('/settings?zalo_ok=1');
});

/** Kiểm tra access token Zalo còn hiệu lực (nút "Kiểm tra" trên trang Cài đặt). */
router.get('/ping', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ success: true, data: await zaloService.ping() });
  } catch (e) {
    next(e);
  }
});

/** Trạng thái chi tiết token + thời điểm refresh tiếp theo (dành cho admin debug). */
router.get('/token-status', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const { getSettings } = await import('../services/SettingsService');
    const settings = await getSettings();
    const z = settings.zalo ?? {};
    const lastRefreshAt = z.lastRefreshAt ? new Date(z.lastRefreshAt) : null;
    const REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20h
    const nextRefreshAt = lastRefreshAt ? new Date(lastRefreshAt.getTime() + REFRESH_INTERVAL_MS) : null;
    const minutesUntilRefresh = nextRefreshAt ? Math.round((nextRefreshAt.getTime() - Date.now()) / 60_000) : null;
    res.json({
      success: true,
      data: {
        hasAccessToken: !!z.accessToken,
        hasRefreshToken: !!z.refreshToken,
        oaId: z.oaId ?? null,
        lastRefreshAt: lastRefreshAt?.toISOString() ?? null,
        nextRefreshAt: nextRefreshAt?.toISOString() ?? null,
        minutesUntilAutoRefresh: minutesUntilRefresh,
        isRefreshDue: minutesUntilRefresh !== null ? minutesUntilRefresh <= 0 : true,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** Trigger refresh token thủ công ngay lập tức (không cần chờ timer 20h). Dành cho admin. */
router.post('/refresh-token', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const r = await zaloService.forceRefreshToken();
    if (!r.ok) {
      res.status(400).json({ success: false, error: r.error });
      return;
    }
    res.json({ success: true, data: { message: 'Token đã được gia hạn thủ công thành công.' } });
  } catch (e) {
    next(e);
  }
});

router.get('/messages', requireAuth, async (req, res, next) => {
  try {
    const messages = await prisma.zaloMessage.findMany({
      where: req.query.candidateId ? { candidateId: String(req.query.candidateId) } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { candidate: { select: { tenUv: true } } },
    });
    res.json({ success: true, data: messages });
  } catch (e) {
    next(e);
  }
});

const sendSchema = z.object({ candidateId: z.string().min(1) });

router.post('/send', requireAuth, requireWrite(), async (req, res, next) => {
  try {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const result = await zaloService.sendTrainingNotice(parsed.data.candidateId);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

const chatSchema = z.object({
  candidateId: z.string().min(1),
  content: z.string().min(1, 'Nội dung tin nhắn không được để trống.'),
});

/** Nhắn tin trực tiếp 2 chiều (Live Chat) với ứng viên qua Zalo OA. */
router.post('/chat', requireAuth, requireWrite(), async (req: AuthedRequest, res, next) => {

  try {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Nội dung tin nhắn không được để trống.');
    const { candidateId, content } = parsed.data;

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true, sdtZalo: true, tenUv: true },
    });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    const result = await zaloService.sendText(candidate.sdtZalo, content.trim(), candidate.id);
    if (!result.ok) {
      throw ApiError.badRequest(
        'SEND_FAILED',
        result.error ?? 'Gửi tin Zalo thất bại. Nhờ ứng viên nhắn 1 tin bất kỳ cho OA để kết nối Zalo User ID.',
      );
    }
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});


/** Bật/tắt AI auto-reply cho tin nhắn ứng viên gửi vào OA. */
const autoReplySchema = z.object({ enabled: z.boolean() });

router.post('/auto-reply', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = autoReplySchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    await saveSettings({ zalo: { autoReply: parsed.data.enabled } }, req.user!.username);
    res.json({ success: true, data: { autoReply: parsed.data.enabled } });
  } catch (e) {
    next(e);
  }
});

/** Webhook Zalo OA: Nhận tin nhắn & sự kiện từ Zalo Server. */
router.get('/webhook', (_req, res) => {
  // Hỗ trợ GET verify URL cho các dịch vụ kiểm tra Webhook
  res.status(200).send('OK');
});

router.post('/webhook', (req, res) => {
  // QUY TẮC BẮT BUỘC ZALO WEBHOOK:
  // Phản hồi HTTP 200 OK ngay lập tức (< 10ms) để không bị Zalo hủy kết nối (lỗi HTTP 408 Timeout).
  res.status(200).json({ success: true, message: 'OK' });

  // Đẩy toàn bộ công việc lưu log DB & xử lý Zalo User ID + AI reply ra ngầm (Async Background)
  const payload = req.body;
  void (async () => {
    try {
      if (payload && typeof payload === 'object') {
        await prisma.webhookEvent.create({
          data: { id: nextId('WEB'), source: 'ZALO', payload: payload as object },
        }).catch(() => undefined);
        await zaloService.webhook(payload);
      }
    } catch (e) {
      console.error('[ZaloWebhook] Lỗi xử lý ngầm:', e instanceof Error ? e.message : String(e));
    }
  })();
});

/** Endpoints quản lý Zalo Cá Nhân (Tự động gửi tin theo SĐT) */
router.get('/personal/status', requireAuth, async (_req, res, next) => {
  try {
    const status = await zaloPersonalService.getStatus();
    res.json({ success: true, data: status });
  } catch (e) {
    next(e);
  }
});

router.post('/personal/qr', requireAuth, requireWrite(), async (_req, res, next) => {
  try {
    const result = await zaloPersonalService.generateLoginQr();
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

router.post('/personal/connect', requireAuth, requireWrite(), async (req, res, next) => {
  try {
    const { phone, name, avatar } = req.body;
    if (!phone || !name) throw ApiError.badRequest('INVALID_INPUT', 'Thiếu SĐT hoặc tên tài khoản Zalo.');
    const status = await zaloPersonalService.connectSession({ phone, name, avatar });
    res.json({ success: true, data: status });
  } catch (e) {
    next(e);
  }
});

router.post('/personal/logout', requireAuth, requireWrite(), async (_req, res, next) => {
  try {
    const status = await zaloPersonalService.logout();
    res.json({ success: true, data: status });
  } catch (e) {
    next(e);
  }
});

export default router;