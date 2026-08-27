import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { approvalService } from '../services/ApprovalService';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

// GET /api/approvals (Lấy danh sách đơn hoán đổi ca)
router.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const status = String(req.query.status || 'ALL');
    const branch = req.query.branch ? String(req.query.branch) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;

    const data = await approvalService.listRequests({ status, branch, search });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

const createSchema = z.object({
  candidateIdA: z.string().min(1),
  dateA: z.string().min(1),
  caLamA: z.string().min(1),
  candidateIdB: z.string().min(1),
  dateB: z.string().min(1),
  caLamB: z.string().min(1),
  reason: z.string().min(1),
  swapType: z.string().optional(),
});

// POST /api/approvals (Tạo đơn xin đổi ca mới)
router.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Thông tin đơn xin đổi ca không hợp lệ.');

    const created = await approvalService.createRequest(parsed.data);
    res.json({ success: true, data: created });
  } catch (e) {
    next(e);
  }
});

// POST /api/approvals/:id/approve (Quản lý / Admin bấm duyệt đơn)
router.post('/:id/approve', async (req: AuthedRequest, res, next) => {
  try {
    const userRole = req.user?.role || 'HR';
    if (userRole === 'VIEWER') {
      throw ApiError.forbidden('Tài khoản Viewer không có quyền duyệt đơn hoán đổi ca.');
    }

    const updated = await approvalService.approveRequest(req.params.id, req.user!.username);
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

// POST /api/approvals/:id/reject (Quản lý / Admin bấm từ chối đơn)
router.post('/:id/reject', async (req: AuthedRequest, res, next) => {
  try {
    const userRole = req.user?.role || 'HR';
    if (userRole === 'VIEWER') {
      throw ApiError.forbidden('Tài khoản Viewer không có quyền từ chối đơn hoán đổi ca.');
    }

    const { rejectReason } = req.body || {};
    const updated = await approvalService.rejectRequest(req.params.id, req.user!.username, String(rejectReason || ''));
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

// ==================== PHIẾU XIN NGHỈ PHÉP (48H) ====================

import { prisma } from '../lib/prisma';
import { shiftService } from '../services/ShiftService';
import { emit } from '../sockets';

// GET /api/approvals/leave-tickets (Danh sách phiếu xin nghỉ phép cho HR/Manager)
router.get('/leave-tickets', async (req: AuthedRequest, res, next) => {
  try {
    const status = String(req.query.status || 'ALL');
    const branch = req.query.branch ? String(req.query.branch) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;

    const where: any = {};
    if (status !== 'ALL') {
      where.status = status;
    }
    if (branch) {
      where.chiNhanh = branch;
    }
    if (search) {
      const q = search.toLowerCase();
      where.OR = [
        { candidateName: { contains: q, mode: 'insensitive' } },
        { candidateId: { contains: q, mode: 'insensitive' } },
      ];
    }

    const tickets = await prisma.leaveRequestTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ success: true, data: tickets });
  } catch (e) {
    next(e);
  }
});

// POST /api/approvals/leave-tickets/:id/approve (HR / Manager Duyệt Phiếu Nghỉ Phép -> AI Gán OFF & Bù Ca)
router.post('/leave-tickets/:id/approve', async (req: AuthedRequest, res, next) => {
  try {
    const userRole = req.user?.role || 'HR';
    if (userRole === 'VIEWER') {
      throw ApiError.forbidden('Tài khoản Viewer không có quyền duyệt phiếu xin nghỉ phép.');
    }

    const ticketId = req.params.id;
    const ticket = await prisma.leaveRequestTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw ApiError.notFound('TICKET_NOT_FOUND', 'Không tìm thấy phiếu xin nghỉ phép.');
    if (ticket.status === 'APPROVED') throw ApiError.badRequest('ALREADY_APPROVED', 'Phiếu này đã được duyệt trước đó.');

    const hrUser = req.user!.username;

    // 1. Cập nhật trạng thái phiếu sang APPROVED
    const updatedTicket = await prisma.leaveRequestTicket.update({
      where: { id: ticketId },
      data: {
        status: 'APPROVED',
        hrUser,
        approvedAt: new Date(),
      },
    });

    // 2. AI THỰC HIỆN GÁN CA NGHỈ NGHỈ PHÉP (OFF) CHO NHÂN VIÊN
    await shiftService.upsert({
      candidateId: ticket.candidateId,
      date: ticket.date,
      shifts: 'OFF',
      note: `HR_APPROVED_LEAVE_48H: ${ticket.reason}`,
      user: hrUser,
    });

    // 3. AI TỰ ĐỘNG MỞ LUỒNG BÙ CA ĐA TẦNG CHO ĐỒNG NGHIỆP
    const proposal = await shiftService.createOffReplacementProposal({
      candidateIdA: ticket.candidateId,
      date: ticket.date,
      shiftCode: ticket.shiftCode,
    });

    // 4. Phát tín hiệu Realtime Sockets
    emit('leave_request:approved', { ticketId, candidateId: ticket.candidateId, date: ticket.date });
    emit('shift:updated', { candidateId: ticket.candidateId, date: ticket.date, shift: 'OFF' });
    if (proposal) {
      emit('shift_replacement:updated', { replacementId: proposal.id });
    }

    res.json({
      success: true,
      message: '✅ Duyệt phiếu thành công! AI đã gán lịch nghỉ OFF và mở luồng đề xuất bù ca cho nhân viên.',
      data: { ticket: updatedTicket, proposal },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/approvals/leave-tickets/:id/reject (HR / Manager Từ Chối Phiếu Nghỉ Phép)
router.post('/leave-tickets/:id/reject', async (req: AuthedRequest, res, next) => {
  try {
    const userRole = req.user?.role || 'HR';
    if (userRole === 'VIEWER') {
      throw ApiError.forbidden('Tài khoản Viewer không có quyền từ chối phiếu xin nghỉ phép.');
    }

    const ticketId = req.params.id;
    const { hrReason } = req.body || {};
    const ticket = await prisma.leaveRequestTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw ApiError.notFound('TICKET_NOT_FOUND', 'Không tìm thấy phiếu xin nghỉ phép.');
    if (ticket.status === 'REJECTED') throw ApiError.badRequest('ALREADY_REJECTED', 'Phiếu này đã bị từ chối trước đó.');

    const hrUser = req.user!.username;

    const updatedTicket = await prisma.leaveRequestTicket.update({
      where: { id: ticketId },
      data: {
        status: 'REJECTED',
        hrUser,
        hrReason: hrReason ? String(hrReason) : 'HR/Manager từ chối phiếu nghỉ phép.',
      },
    });

    emit('leave_request:rejected', { ticketId, candidateId: ticket.candidateId });

    res.json({
      success: true,
      message: '❌ Đã từ chối phiếu xin nghỉ phép.',
      data: updatedTicket,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
