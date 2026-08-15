import { Router } from 'express';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { listAudit } from '../services/AuditService';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const result = await listAudit({
      entityId: String(req.query.entityId ?? ''),
      action: String(req.query.action ?? ''),
      user: String(req.query.user ?? ''),
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

export default router;