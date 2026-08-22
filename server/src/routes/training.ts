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

    const rawDate = body.ngayBatDau ?? body.ngayBatDauTraining;
    if (rawDate !== undefined && rawDate !== null && String(rawDate).trim() !== '') {
      const dateVal = new Date(String(rawDate));
      if (!isNaN(dateVal.getTime())) {
        await candidateService.startTraining(id, req.user!.username, dateVal);
      }
    }

    if (body.trangThaiTraining !== undefined) {
      const statuses = ['CHUA_THAM_GIA', 'SAP_BAT_DAU', 'BAT_DAU', 'HOAN_THANH', 'KHONG_DU_NGAY', 'LOAI', 'NHAN_VIEN_CHINH_THUC'];
      if (!statuses.includes(String(body.trangThaiTraining))) {
        throw ApiError.badRequest('INVALID_STATUS', 'Trạng thái không hợp lệ.');
      }
      await candidateService.setTrainingStatus(id, req.user!.username, String(body.trangThaiTraining));
    }

    if (body.caLam !== undefined || body.chiNhanh !== undefined) {
      const dataToUpdate: { caLam?: string; chiNhanh?: string } = {};
      if (body.caLam !== undefined) dataToUpdate.caLam = String(body.caLam).trim();
      if (body.chiNhanh !== undefined) dataToUpdate.chiNhanh = String(body.chiNhanh).trim();
      if (Object.keys(dataToUpdate).length > 0) {
        const { prisma } = await import('../lib/prisma');
        const { emit } = await import('../sockets');
        await prisma.candidate.update({
          where: { id },
          data: dataToUpdate,
        });
        emit('training:updated', { id });
        emit('candidate:update', { id });
      }
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