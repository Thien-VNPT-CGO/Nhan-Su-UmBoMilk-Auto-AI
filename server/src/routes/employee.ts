import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { employeeAuthService } from '../services/EmployeeAuthService';
import { deviceResetService } from '../services/DeviceResetService';
import { approvalService } from '../services/ApprovalService';
import { payrollAIService } from '../services/PayrollAIService';
import { zaloService } from '../services/ZaloService';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  candidateId: z.string().min(1, 'Thiếu Mã nhân viên'),
  key: z.string().min(1, 'Thiếu Key kích hoạt'),
  deviceId: z.string().min(1, 'Thiếu thông tin nhận diện thiết bị'),
});

// 1. Đăng nhập & Kích hoạt thiết bị 1 lần duy nhất (Public Endpoint cho Web App Nhân Viên)
router.post('/public/employee/activate-login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Thông tin đăng nhập/kích hoạt không hợp lệ.');
    }
    const result = await employeeAuthService.activateAndLogin(parsed.data);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

// 2. Lấy Bảng Lương & Phụ cấp AI Realtime cho Nhân viên
router.get('/public/employee/payroll-ai/:candidateId', async (req, res, next) => {
  try {
    const candidateId = decodeURIComponent(req.params.candidateId);
    const payroll = await payrollAIService.calculateRealtimePayroll(candidateId);
    if (!payroll) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy thông tin nhân sự.');
    }
    res.json({ success: true, data: payroll });
  } catch (e) {
    next(e);
  }
});

// 2b. Kiểm tra hợp lệ phiên làm việc & thiết bị gán cứng (Heartbeat / Focus / Realtime check)
router.post('/public/employee/session-check', async (req, res, next) => {
  try {
    const schema = z.object({
      candidateId: z.string().min(1),
      deviceId: z.string().min(1),
    });
    const parsed = schema.parse(req.body);
    const check = await employeeAuthService.validateDevice(parsed.candidateId, parsed.deviceId);
    res.json({ success: true, data: check });
  } catch (e) {
    next(e);
  }
});

// 3. Nhân viên tự tạo Phiếu Yêu cầu Reset Thiết bị (TH1: Thực hiện từ Máy cũ)
router.post('/public/employee/device-reset-request', async (req, res, next) => {
  try {
    const schema = z.object({
      candidateId: z.string().min(1, 'Thiếu Mã nhân viên'),
      reason: z.string().min(1, 'Vui lòng nhập lý do đổi thiết bị'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Thông tin gửi phiếu không hợp lệ.');
    }
    const ticket = await deviceResetService.createTicket({
      candidateId: parsed.data.candidateId,
      reason: parsed.data.reason,
      creatorType: 'EMPLOYEE_SELF',
      createdBy: parsed.data.candidateId,
    });
    res.json({ success: true, data: ticket });
  } catch (e) {
    next(e);
  }
});

// 3b. Lấy danh sách đồng nghiệp để chọn đổi ca
router.get('/public/employee/colleagues', async (req, res, next) => {
  try {
    const list = await prisma.candidate.findMany({
      select: { id: true, tenUv: true, sdtZalo: true, chiNhanh: true, caLam: true },
      orderBy: { tenUv: 'asc' },
      take: 300,
    });
    res.json({ success: true, data: list });
  } catch (e) {
    next(e);
  }
});

// 3c. Nhân viên gửi đơn Tạo Yêu Cầu Đổi Ca Làm
router.post('/public/employee/shift-swap-request', async (req, res, next) => {
  try {
    const schema = z.object({
      candidateIdA: z.string().min(1, 'Thiếu Mã NV người gửi'),
      caLamA: z.string().min(1, 'Chọn ca làm của bạn'),
      dateA: z.string().min(1, 'Chọn ngày làm của bạn'),
      candidateIdB: z.string().min(1, 'Chọn đồng nghiệp muốn đổi ca'),
      caLamB: z.string().min(1, 'Chọn ca làm của đồng nghiệp'),
      dateB: z.string().min(1, 'Chọn ngày làm của đồng nghiệp'),
      reason: z.string().min(1, 'Nhập lý do đổi ca'),
    });
    const parsed = schema.parse(req.body);
    const created = await approvalService.createRequest({
      candidateIdA: parsed.candidateIdA,
      caLamA: parsed.caLamA,
      dateA: parsed.dateA,
      candidateIdB: parsed.candidateIdB,
      caLamB: parsed.caLamB,
      dateB: parsed.dateB,
      reason: parsed.reason,
      swapType: 'SWAP_2_WAY',
    });
    res.json({ success: true, data: created });
  } catch (e) {
    next(e);
  }
});

// 3d. Lịch sử đơn đổi ca của nhân viên
router.get('/public/employee/shift-swap-history/:candidateId', async (req, res, next) => {
  try {
    const candidateId = req.params.candidateId;
    const history = await prisma.shiftSwapRequest.findMany({
      where: {
        OR: [
          { candidateIdA: candidateId },
          { candidateIdB: candidateId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: history });
  } catch (e) {
    next(e);
  }
});

// 4. Admin cấp Key kích hoạt cho Nhân viên (Training hoặc Chính thức)
router.post('/admin/employee/generate-key', requireAuth, requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      candidateId: z.string().min(1, 'Thiếu Mã nhân viên'),
      type: z.enum(['TRAINING', 'OFFICIAL']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Thông tin cấp key không hợp lệ.');
    }
    const keyRecord = await employeeAuthService.generateKey({
      candidateId: parsed.data.candidateId,
      type: parsed.data.type,
      user: req.user?.username || 'ADMIN',
    });
    res.json({ success: true, data: keyRecord });
  } catch (e) {
    next(e);
  }
});

// 5. Quản lý cửa hàng tạo phiếu Reset thiết bị hộ Nhân viên (TH2: Khi bị mất/hỏng máy cũ)
router.post('/approvals/device-reset/create-for-employee', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      candidateId: z.string().min(1, 'Thiếu Mã nhân viên'),
      reason: z.string().min(1, 'Vui lòng nhập lý do báo đổi máy cho nhân viên'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Thông tin tạo phiếu không hợp lệ.');
    }
    const ticket = await deviceResetService.createTicket({
      candidateId: parsed.data.candidateId,
      reason: parsed.data.reason,
      creatorType: 'STORE_MANAGER_FOR_EMP',
      createdBy: req.user?.username || 'MANAGER',
    });
    res.json({ success: true, data: ticket });
  } catch (e) {
    next(e);
  }
});

// 6. Danh sách Phiếu Yêu cầu Reset Thiết Bị (Cho Quản lý & IT Admin)
router.get('/approvals/device-reset/tickets', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const candidateId = req.query.candidateId ? String(req.query.candidateId) : undefined;
    const tickets = await deviceResetService.listTickets({ status, candidateId });
    res.json({ success: true, data: tickets });
  } catch (e) {
    next(e);
  }
});

// 7. Quản lý cửa hàng duyệt phiếu xác nhận thực tế tại chi nhánh (TH1)
router.post('/approvals/device-reset/:id/manager-approve', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: AuthedRequest, res, next) => {
  try {
    const ticketId = req.params.id;
    const updated = await deviceResetService.managerApprove(ticketId, req.user?.username || 'MANAGER');
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

// 8. IT Admin (admin) bấm DUYỆT RESET THIẾT BỊ -> Gỡ DeviceId + Socket.io Đá LOGOUT máy cũ Realtime!
router.post('/approvals/device-reset/:id/it-approve', requireAuth, requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const ticketId = req.params.id;
    const updated = await deviceResetService.itAdminApprove(ticketId, req.user?.username || 'ADMIN');
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

// 9. Từ chối phiếu Reset thiết bị
router.post('/approvals/device-reset/:id/reject', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: AuthedRequest, res, next) => {
  try {
    const ticketId = req.params.id;
    const schema = z.object({ reason: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    const updated = await deviceResetService.rejectTicket(
      ticketId,
      req.user?.username || 'USER',
      parsed.success && parsed.data.reason ? parsed.data.reason : 'Không chấp nhận lý do đổi máy.'
    );
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

// 10. Tự động / Thủ công gửi Tin nhắn Zalo chứa Link Web App + Mã NV + Key kích hoạt cho Nhân viên
router.post('/approvals/send-portal-zalo', requireAuth, requireRole('ADMIN', 'MANAGER', 'HR'), async (req: AuthedRequest, res, next) => {
  try {
    const schema = z.object({
      candidateId: z.string().min(1, 'Thiếu Mã nhân viên'),
      key: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const result = await zaloService.sendEmployeePortalAccess(parsed.data.candidateId, parsed.data.key);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

export default router;
