import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { shiftService } from '../services/ShiftService';
import { ApiError } from '../lib/errors';
import { normalizeDateKey } from '../lib/date';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const from = normalizeDateKey(String(req.query.from ?? ''));
    const to = normalizeDateKey(String(req.query.to ?? ''));
    if (!from || !to) throw ApiError.badRequest('INVALID_RANGE', 'Thiếu khoảng ngày.');
    const data = await shiftService.listForDates(from, to);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

const upsertSchema = z.object({
  date: z.string().min(1),
  shifts: z.array(z.enum(['SANG', 'CHIEU', 'TOI', 'OFF'])).min(1),
  note: z.string().optional(),
});

// CHỈ TÀI KHOẢN ADMIN MỚI CÓ QUYỀN THAY ĐỔI CA LÀM VIỆC CỦA ỨNG VIÊN
router.put('/:candidateId/:date', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = upsertSchema.safeParse({ ...req.body, date: req.params.date });
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu ca không hợp lệ.');
    await shiftService.upsert({
      candidateId: req.params.candidateId,
      date: normalizeDateKey(parsed.data.date),
      shifts: parsed.data.shifts.join('|'),
      note: parsed.data.note,
      user: req.user!.username,
    });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;