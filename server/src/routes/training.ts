import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireWrite, AuthedRequest } from '../middleware/auth';
import { trainingService } from '../services/TrainingService';
import { candidateService } from '../services/CandidateService';
import { zaloService } from '../services/ZaloService';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    res.json({ success: true, data: await trainingService.list() });
  } catch (e) {
    next(e);
  }
});

const startSchema = z.object({ ngayBatDau: z.string().min(1) });

router.patch('/:id', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;

    if (body.ngayBatDau !== undefined) {
      const parsed = startSchema.safeParse(body);
      if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
      await candidateService.startTraining(id, req.user!.username, new Date(parsed.data.ngayBatDau));
    }

    if (body.trangThaiTraining !== undefined) {
      const statuses = ['CHUA_THAM_GIA', 'SAP_BAT_DAU', 'BAT_DAU', 'HOAN_THANH', 'KHONG_DU_NGAY', 'LOAI', 'NHAN_VIEN_CHINH_THUC'];
      if (!statuses.includes(String(body.trangThaiTraining))) {
        throw ApiError.badRequest('INVALID_STATUS', 'Trạng thái không hợp lệ.');
      }
      await candidateService.setTrainingStatus(id, req.user!.username, String(body.trangThaiTraining));
    }

    if (body.caLam !== undefined || body.chiNhanh !== undefined) {
      const patch: Record<string, string> = {};
      const labels: Record<string, string> = {};
      if (body.caLam !== undefined) { patch.caLam = String(body.caLam); labels.caLam = 'CA_LAM'; }
      if (body.chiNhanh !== undefined) { patch.chiNhanh = String(body.chiNhanh); labels.chiNhanh = 'CHI_NHANH'; }
      await candidateService.updateFields(id, req.user!.username, Number(body.version ?? 0) || 0, patch as never, labels);
    }

    const updated = await candidateService.getById(id);
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

const notifySchema = z.object({});

router.post('/:id/employee', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    await trainingService.confirmAsEmployee(req.params.id, req.user!.username);
    res.json({ success: true, data: { confirmed: true } });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/zalo-notify', requireWrite(), async (req, res, next) => {
  try {
    const result = await zaloService.sendTrainingNotice(req.params.id);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/interview-notify', requireWrite(), async (req, res, next) => {
  try {
    const result = await zaloService.sendInterviewInvite(req.params.id);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

export default router;