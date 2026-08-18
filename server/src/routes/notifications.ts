import { Router } from 'express';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { notificationService } from '../services/NotificationService';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const limit = Math.min(100, Number(req.query.limit) || 50);
    const unreadOnly = req.query.unreadOnly === 'true';
    const data = await notificationService.list(req.user!, limit, unreadOnly);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/read', async (req: AuthedRequest, res, next) => {
  try {
    await notificationService.markRead(String(req.params.id), req.user!.id);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/read-all', async (req: AuthedRequest, res, next) => {
  try {
    await notificationService.markAllRead(req.user!.id);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;