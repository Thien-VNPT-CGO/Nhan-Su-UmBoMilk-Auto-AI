import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { audit } from '../services/AuditService';
import { emit } from '../sockets';
import { TRAINING_STATUS } from '../lib/constants';

const router = Router();

router.get('/candidates/:id/interview-info', async (req, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        tenUv: true,
        chiNhanh: true,
        caLam: true,
        phongVanAt: true,
        ggMeetLink: true,
        trangThaiTraining: true,
        hrDecision: true,
      },
    });

    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy thông tin phỏng vấn của ứng viên.');
    }

    res.json({ success: true, data: candidate });
  } catch (e) {
    next(e);
  }
});

const confirmSchema = z.object({
  action: z.enum(['ACCEPT', 'REJECT']),
  reason: z.string().optional(),
});

router.post('/candidates/:id/confirm-interview', async (req, res, next) => {
  try {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu xác nhận không hợp lệ.');
    }

    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    }

    const { action, reason } = parsed.data;
    const newVersion = candidate.dataVersion + 1;
    const targetStatus = action === 'ACCEPT' ? TRAINING_STATUS.SAP_BAT_DAU : TRAINING_STATUS.LOAI;

    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        trangThaiTraining: targetStatus,
        dataVersion: newVersion,
        updatedBy: 'CANDIDATE_1CLICK_CONFIRM',
      },
    });

    await audit({
      user: 'CANDIDATE_PUBLIC_PAGE',
      action: action === 'ACCEPT' ? 'CANDIDATE_CONFIRMED_INTERVIEW_ACCEPT' : 'CANDIDATE_CONFIRMED_INTERVIEW_REJECT',
      entity: 'candidate',
      entityId: candidate.id,
      oldValue: candidate.trangThaiTraining,
      newValue: targetStatus,
      version: newVersion,
    });

    emit('training:updated', { candidateId: candidate.id });
    emit('candidate:decision', { candidateId: candidate.id, decision: candidate.hrDecision, user: 'CANDIDATE_1CLICK' });
    emit('zalo:ai_confirmed', {
      candidateId: candidate.id,
      candidateName: candidate.tenUv,
      action: action === 'ACCEPT' ? 'CONFIRMED_ACCEPT' : 'CONFIRMED_REJECT',
      newStatus: targetStatus,
    });

    res.json({
      success: true,
      data: {
        candidateId: candidate.id,
        candidateName: candidate.tenUv,
        status: targetStatus,
        message: action === 'ACCEPT' ? 'Xác nhận tham gia phỏng vấn thành công!' : 'Đã ghi nhận phản hồi từ chối.',
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
