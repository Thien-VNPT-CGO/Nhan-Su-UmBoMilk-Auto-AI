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

router.post('/auto-schedule', requireWrite(), async (_req, res, next) => {
  try {
    await trainingService.autoStaggerTrainingShifts();
    const { emit } = await import('../sockets');
    emit('shift:updated', {});
    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
});

router.post('/:id(*)/employee', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    await trainingService.confirmAsEmployee(req.params.id, req.user!.username);
    res.json({ success: true, data: { confirmed: true } });
  } catch (e) {
    next(e);
  }
});

router.post('/:id(*)/zalo-notify', requireWrite(), async (req, res, next) => {
  try {
    const result = await zaloService.sendTrainingNotice(req.params.id);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

router.post('/:id(*)/interview-notify', requireWrite(), async (req, res, next) => {
  try {
    const result = await zaloService.sendInterviewInvite(req.params.id);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id(*)', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const id = req.params.id;
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

// POST /api/training/output-test (Tạo phiếu Yêu cầu Test đầu ra - Khóa 1h30m, AI tự duyệt 15-30s)
router.post('/output-test', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const { outputTestService } = await import('../services/OutputTestService');
    const ticket = await outputTestService.createTicket({
      candidateId: req.body.candidateId,
      testDate: req.body.testDate,
      fromTime: req.body.fromTime,
      toTime: req.body.toTime,
      meetLink: req.body.meetLink,
      content: req.body.content,
      user: req.user!.username,
    });
    res.json({ success: true, message: '✅ Đã gửi phiếu yêu cầu Test đầu ra thành công! AI đang tự động duyệt (15-30 giây).', data: ticket });
  } catch (e) {
    next(e);
  }
});

// GET /api/training/output-test (Xem danh sách phiếu Test đầu ra)
router.get('/output-test', async (req, res, next) => {
  try {
    const { outputTestService } = await import('../services/OutputTestService');
    const list = await outputTestService.listTickets(req.query.candidateId as string);
    res.json({ success: true, data: list });
  } catch (e) {
    next(e);
  }
});

// POST /api/training/evaluate (Bảng đánh giá nhân viên cửa hàng & Chấm điểm Output Test)
router.post('/evaluate', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const { evaluationService } = await import('../services/EvaluationService');
    const evaluation = await evaluationService.submitEvaluation({
      candidateId: req.body.candidateId,
      testTicketId: req.body.testTicketId,
      scoreKnowledge: Number(req.body.scoreKnowledge || 0),
      scoreOperation: Number(req.body.scoreOperation || 0),
      lowScoreQuestions: Array.isArray(req.body.lowScoreQuestions) ? req.body.lowScoreQuestions : [],
      evaluatorNotes: req.body.evaluatorNotes,
      user: req.user!.username,
    });
    res.json({ success: true, message: '✅ Đã hoàn tất đánh giá và chấm điểm nhân viên!', data: evaluation });
  } catch (e) {
    next(e);
  }
});

// GET /api/training/evaluations (Xem danh sách Đánh giá cửa hàng)
router.get('/evaluations', async (req, res, next) => {
  try {
    const { evaluationService } = await import('../services/EvaluationService');
    const list = await evaluationService.listEvaluations(req.query.candidateId as string);
    res.json({ success: true, data: list });
  } catch (e) {
    next(e);
  }
});

// POST /api/training/:id(*)/vip-simulate-7days (Chức năng VIP Admin: Tích đủ 7 ngày training ngay lập tức để test dữ liệu)
router.post('/:id(*)/vip-simulate-7days', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      throw ApiError.forbidden('Chức năng VIP Test chỉ dành cho tài khoản Admin!');
    }
    const { prisma } = await import('../lib/prisma');
    const { emit } = await import('../sockets');
    const { nextId } = await import('../lib/id');
    const { audit } = await import('../services/AuditService');

    const candidateId = req.params.id;
    const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    const startDate = candidate.ngayBatDauTraining ? new Date(candidate.ngayBatDauTraining) : new Date();

    // Tạo 7 sự kiện điểm danh hợp lệ cho 7 ngày làm việc
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const shift = (candidate.caLam || 'SÁNG').toLowerCase().includes('chieu') ? 'CHIEU' : (candidate.caLam || 'SÁNG').toLowerCase().includes('toi') ? 'TOI' : 'SANG';

      await prisma.attendanceEvent.upsert({
        where: {
          candidateId_date_shift: {
            candidateId,
            date: dateStr,
            shift,
          },
        },
        create: {
          id: nextId('ATT'),
          candidateId,
          date: dateStr,
          shift,
          checkinAt: d,
          checkoutAt: new Date(d.getTime() + 5 * 3600 * 1000),
          eventType: 'COMPLETED',
          method: 'SYSTEM',
          valid: true,
          trainingDay: i + 1,
        },
        update: {
          valid: true,
          trainingDay: i + 1,
        },
      });
    }

    const updated = await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        soNgayDaTraining: 7,
        trangThaiTraining: 'HOAN_THANH_7_NGAY',
        updatedBy: req.user.username,
      },
    });

    await audit({
      user: req.user.username,
      action: 'ADMIN_VIP_TEST_SIMULATE_7_DAYS',
      entity: 'candidate',
      entityId: candidateId,
      newValue: { soNgayDaTraining: 7, trangThaiTraining: 'HOAN_THANH_7_NGAY' },
    });

    emit('training:updated', { candidateId });
    emit('candidate:updated', { candidateId });
    emit('attendance:updated', { candidateId });
    emit('shift:updated', { candidateId });

    res.json({
      success: true,
      message: `⚡ VIP Admin Test: Đã điểm danh đủ 7 ngày training cho nhân sự "${updated.tenUv}" thành công! Lịch đã được khóa và mở quyền Tạo Phiếu Test Đầu Ra.`,
      data: updated,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/training/:id(*)/vip-add-1day (Chức năng VIP Admin: Tích điểm danh +1 ngày)
router.post('/:id(*)/vip-add-1day', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    if (req.user?.role !== 'ADMIN') {
      throw ApiError.forbidden('Chức năng VIP Test chỉ dành cho tài khoản Admin!');
    }
    const { prisma } = await import('../lib/prisma');
    const { emit } = await import('../sockets');
    const { nextId } = await import('../lib/id');

    const candidateId = req.params.id;
    const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    const newDays = Math.min(7, candidate.soNgayDaTraining + 1);
    const newStatus = newDays >= 7 ? 'HOAN_THANH_7_NGAY' : (candidate.trangThaiTraining || 'BAT_DAU');

    const d = new Date();
    const dateStr = d.toISOString().split('T')[0];
    const shift = (candidate.caLam || 'SÁNG').toLowerCase().includes('chieu') ? 'CHIEU' : (candidate.caLam || 'SÁNG').toLowerCase().includes('toi') ? 'TOI' : 'SANG';

    await prisma.attendanceEvent.create({
      data: {
        id: nextId('ATT'),
        candidateId,
        date: dateStr,
        shift,
        checkinAt: d,
        checkoutAt: new Date(d.getTime() + 5 * 3600 * 1000),
        eventType: 'COMPLETED',
        method: 'SYSTEM',
        valid: true,
        trainingDay: newDays,
      },
    }).catch(() => null);

    const updated = await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        soNgayDaTraining: newDays,
        trangThaiTraining: newStatus,
        updatedBy: req.user.username,
      },
    });

    emit('training:updated', { candidateId });
    emit('candidate:updated', { candidateId });
    emit('attendance:updated', { candidateId });

    res.json({
      success: true,
      message: `⚡ VIP Admin Test: Đã tích +1 ca điểm danh cho "${updated.tenUv}" (Hiện tại: ${newDays}/7 ca).`,
      data: updated,
    });
  } catch (e) {
    next(e);
  }
});

export default router;