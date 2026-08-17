import { Router } from 'express';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { resetService } from '../services/ResetService';
import { ApiError } from '../lib/errors';

const router = Router();

router.use(requireAuth);

/** Reset toàn bộ hệ thống về trạng thái ban đầu (chỉ ADMIN, phải xác nhận "RESET"). */
router.post('/reset', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const confirm = String((req.body as Record<string, unknown>)?.confirm ?? '').trim();
    if (confirm !== 'RESET') {
      throw ApiError.badRequest('CONFIRM_REQUIRED', 'Phải gõ đúng "RESET" để xác nhận thao tác phá hủy dữ liệu.');
    }
    const result = await resetService.resetSystem(req.user!.username);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

export default router;