import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireWrite, AuthedRequest } from '../middleware/auth';
import { shiftService } from '../services/ShiftService';
import { ApiError } from '../lib/errors';
import { normalizeDateKey } from '../lib/date';
import { prisma } from '../lib/prisma';

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

// PUT /api/shifts/:candidateId/:date (Hỗ trợ candidateId chứa dấu / như UBM_24/08/2026_NV0001)
router.put('/*', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const fullPath = (req.params[0] || '').replace(/^\/+/, '');
    const lastSlashIdx = fullPath.lastIndexOf('/');
    if (lastSlashIdx === -1) throw ApiError.badRequest('INVALID_INPUT', 'Đường dẫn ca không hợp lệ.');

    const candidateId = fullPath.slice(0, lastSlashIdx);
    const dateParam = fullPath.slice(lastSlashIdx + 1);

    const parsed = upsertSchema.safeParse({ ...req.body, date: dateParam });
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu ca không hợp lệ.');

    const userRole = req.user?.role || 'HR';
    const chosenShifts = parsed.data.shifts;

    if (userRole === 'VIEWER') {
      throw ApiError.forbidden('Tài khoản Viewer chỉ có quyền xem dữ liệu, không có quyền thay đổi ca làm.');
    }

    // Kiểm tra quy định phân quyền nếu là HR
    if (userRole !== 'ADMIN') {
      const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
      const normCa = (candidate?.caLam || '').toLowerCase();
      let originalShiftKey = 'SANG';
      if (normCa.includes('chieu') || normCa.includes('12h')) originalShiftKey = 'CHIEU';
      else if (normCa.includes('toi') || normCa.includes('18h')) originalShiftKey = 'TOI';

      const isOnlyOffOrOriginal = chosenShifts.every((s) => s === 'OFF' || s === originalShiftKey);
      if (!isOnlyOffOrOriginal) {
        throw ApiError.forbidden('Tài khoản HR chỉ được phép cập nhật Nghỉ OFF hoặc ca Gốc cho ứng viên.');
      }
    }

    await shiftService.upsert({
      candidateId,
      date: normalizeDateKey(parsed.data.date),
      shifts: chosenShifts.join('|'),
      note: parsed.data.note,
      user: req.user!.username,
    });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/auto-stagger', requireWrite(), async (_req: AuthedRequest, res, next) => {
  try {
    const { trainingService } = await import('../services/TrainingService');
    await trainingService.autoStaggerTrainingShifts();
    res.json({ success: true, message: 'Đã phân bổ ca AI tự động thành công.' });
  } catch (e) {
    next(e);
  }
});

// POST /api/shifts/auto-schedule-monthly (AI Tự động xếp lịch hàng tháng cho Nhân viên chính thức >= 12 ngày)
router.post('/auto-schedule-monthly', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      month: z.number().int().min(1).max(12),
      year: z.number().int().min(2025).max(2030),
      minDaysPerEmp: z.number().int().min(1).max(31).optional().default(12),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Thông tin tháng/năm không hợp lệ.');

    const result = await shiftService.autoScheduleMonthly({
      month: parsed.data.month,
      year: parsed.data.year,
      minDaysPerEmp: parsed.data.minDaysPerEmp,
      user: req.user!.username,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

// GET /api/shifts/replacements (Danh sách đề xuất trực thay ca)
router.get('/replacements', async (req: AuthedRequest, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const branch = req.query.branch ? String(req.query.branch) : undefined;
    const candidateId = req.query.candidateId ? String(req.query.candidateId) : undefined;

    const list = await shiftService.listOffReplacements({ status, branch, candidateId });
    res.json({ success: true, data: list });
  } catch (e) {
    next(e);
  }
});

// POST /api/shifts/replacements/respond (Phản hồi Xác Nhận hoặc Từ Chối đề xuất trực thay ca)
router.post('/replacements/respond', async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      replacementId: z.string().min(1),
      action: z.enum(['ACCEPT', 'REJECT']),
      reason: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu phản hồi không hợp lệ.');

    const updated = await shiftService.respondReplacement({
      replacementId: parsed.data.replacementId,
      action: parsed.data.action,
      reason: parsed.data.reason,
      user: req.user!.username,
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

export default router;