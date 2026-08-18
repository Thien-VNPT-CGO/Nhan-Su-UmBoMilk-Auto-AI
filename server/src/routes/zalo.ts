import { Router, Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireWrite, requireRole, AuthedRequest } from '../middleware/auth';
import { zaloService } from '../services/ZaloService';
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

router.post('/send', requireWrite(), async (req, res, next) => {
  try {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const result = await zaloService.sendTrainingNotice(parsed.data.candidateId);
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

router.post('/webhook', async (req, res, next) => {
  try {
    const secret = req.headers['x-webhook-secret'] ?? req.query.secret;
    const body = req.body as Record<string, unknown> | undefined;
    const looksLikeZalo =
      !!body &&
      (typeof body.event_name === 'string' ||
        (body.sender !== undefined && body.message !== undefined));
    if (secret !== env.webhookSecret && !looksLikeZalo) {
      throw ApiError.unauthorized('Webhook secret không hợp lệ.');
    }
    await prisma.webhookEvent.create({
      data: { id: nextId('WEB'), source: 'ZALO', payload: req.body as object },
    });
    await zaloService.webhook(req.body);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;