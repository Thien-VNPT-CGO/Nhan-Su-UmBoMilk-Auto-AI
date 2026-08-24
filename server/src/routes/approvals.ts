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

export default router;
