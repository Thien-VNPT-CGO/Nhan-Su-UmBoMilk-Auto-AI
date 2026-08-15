import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireWrite, AuthedRequest } from '../middleware/auth';
import { attendanceService } from '../services/AttendanceService';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const data = await attendanceService.list({
      date: String(req.query.date ?? ''),
      candidateId: String(req.query.candidateId ?? ''),
      validOnly: req.query.validOnly !== undefined ? req.query.validOnly === 'true' : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

const checkinSchema = z.object({
  candidateId: z.string().optional(),
  phone: z.string().optional(),
  shift: z.enum(['SANG', 'CHIEU', 'TOI']).optional(),
  checkinAt: z.string().optional(),
});

router.post('/checkin', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = checkinSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    if (!parsed.data.candidateId && !parsed.data.phone) {
      throw ApiError.badRequest('INVALID_INPUT', 'Cần candidateId hoặc phone.');
    }
    const result = await attendanceService.checkin({
      candidateId: parsed.data.candidateId,
      phone: parsed.data.phone,
      shift: parsed.data.shift,
      method: 'MANUAL',
      user: req.user!.username,
      checkinAt: parsed.data.checkinAt ? new Date(parsed.data.checkinAt) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

export default router;