import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { conflictService } from '../services/ConflictService';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    res.json({ success: true, data: await conflictService.listOpen() });
  } catch (e) {
    next(e);
  }
});

const resolveSchema = z.object({
  keep: z.enum(['WEB', 'SHEET']),
});

router.post('/:id/resolve', requireRole('ADMIN', 'HR'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    await conflictService.resolve({
      conflictId: req.params.id,
      keep: parsed.data.keep,
      resolvedBy: req.user!.username,
    });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;