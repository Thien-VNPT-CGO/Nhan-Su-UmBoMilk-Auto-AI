import { Router } from 'express';
import { nextId } from '../lib/id';
import { emit } from '../sockets';
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

// 1b. Đăng nhập Tự động 1-Click không cần gõ Key (Seamless Public Auto Login)
router.post('/public/employee/auto-login', async (req, res, next) => {
  try {
    const schema = z.object({
      candidateId: z.string().min(1, 'Thiếu Mã nhân viên hoặc SĐT'),
      deviceId: z.string().min(1, 'Thiếu Device ID'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Thông tin tự động đăng nhập không hợp lệ.');
    }
    const result = await employeeAuthService.autoLogin(parsed.data);
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

function normalizeShiftName(rawShift: string | null | undefined): string {
  if (!rawShift) return 'SÁNG (07:00 - 12:00)';
  const s = rawShift.toUpperCase().trim();
  if (s === 'SANG' || s === 'CA_SANG' || s.includes('SÁNG') || s.includes('SANG')) {
    return 'SÁNG (07:00 - 12:00)';
  }
  if (s === 'CHIEU' || s === 'CA_CHIEU' || s.includes('CHIỀU') || s.includes('CHIEU')) {
    return 'CHIỀU (12:00 - 18:00)';
  }
  if (s === 'HANCHINH' || s === 'HÀNH CHÍNH' || s === 'CA_HANCHINH' || s.includes('HÀNH CHÍNH')) {
    return 'SÁNG (07:00 - 12:00)';
  }
  if (s === 'TOI' || s === 'CA_TOI' || s.includes('TỐI') || s.includes('TOI')) {
    return 'TỐI (18:00 - 23:00)';
  }
  if (s === 'OFF' || s.includes('NGHỈ') || s.includes('OFF')) {
    return 'NGHỈ (OFF)';
  }
  return rawShift;
}

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

// 3b-2. Tra cứu ca làm việc chuẩn từ Web HR cho từng Nhân viên & Ngày cụ thể
router.get('/public/employee/shift-schedule', async (req, res, next) => {
  try {
    const candidateId = req.query.candidateId ? String(req.query.candidateId) : '';
    const date = req.query.date ? String(req.query.date) : '';

    if (!candidateId) {
      throw ApiError.badRequest('INVALID_INPUT', 'Thiếu Mã nhân viên');
    }

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true, tenUv: true, caLam: true, chiNhanh: true },
    });

    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy nhân viên');
    }

    let rawShift = candidate.caLam;
    let source = 'CANDIDATE_DEFAULT';

    if (date) {
      const shiftRecord = await prisma.shift.findUnique({
        where: {
          candidateId_date: {
            candidateId,
            date,
          },
        },
      });
      if (shiftRecord && shiftRecord.shifts) {
        rawShift = shiftRecord.shifts;
        source = 'WEB_HR_SCHEDULE';
      }
    }

    const formattedShift = normalizeShiftName(rawShift);

    res.json({
      success: true,
      data: {
        candidateId,
        candidateName: candidate.tenUv,
        date,
        rawShift,
        formattedShift,
        source,
      },
    });
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

import { shiftService, normalizeShiftCode } from '../services/ShiftService';

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

// 3e. Tra cứu yêu cầu trực thay ca chờ nhân viên xác nhận
router.get('/public/employee/replacements/:candidateId', async (req, res, next) => {
  try {
    const candidateId = req.params.candidateId;
    const list = await shiftService.listOffReplacements({ candidateId, status: 'PENDING_CONFIRM' });
    res.json({ success: true, data: list });
  } catch (e) {
    next(e);
  }
});

// 3f. Nhân viên bấm ĐỒNG Ý hoặc TỪ CHỐI đề xuất trực thay ca
router.post('/public/employee/replacements/respond', async (req, res, next) => {
  try {
    const schema = z.object({
      replacementId: z.string().min(1, 'Thiếu Mã đề xuất'),
      action: z.enum(['ACCEPT', 'REJECT']),
      reason: z.string().optional(),
      candidateId: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu phản hồi không hợp lệ.');
    }
    const updated = await shiftService.respondReplacement({
      replacementId: parsed.data.replacementId,
      action: parsed.data.action,
      reason: parsed.data.reason,
      user: parsed.data.candidateId || 'EMPLOYEE_SELF',
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

// 3g. Nhân viên gửi Phiếu Xin Nghỉ Phép (RÀNG BUỘC CỨNG: Bắt buộc gửi trước 48 GIỜ)
router.post('/public/employee/leave-request', async (req, res, next) => {
  try {
    const schema = z.object({
      candidateId: z.string().min(1, 'Thiếu Mã nhân viên'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày nghỉ không đúng định dạng YYYY-MM-DD'),
      reason: z.string().min(1, 'Vui lòng nhập lý do xin nghỉ phép'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Thông tin xin nghỉ phép không hợp lệ.');
    }

    const { candidateId, date, reason } = parsed.data;

    const cand = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!cand) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy thông tin nhân viên.');

    if (cand.trangThaiTraining === 'NHAN_VIEN_CHINH_THUC') {
      // Đối với Nhân viên chính thức: Đăng ký OFF tuần sau (Khung 12h T6 - 15h T7) & First-Come First-Served
      const offResult = await shiftService.registerEmployeeLeaveRequest({
        candidateId,
        date,
        caLam: cand.caLam,
      });

      res.json({
        success: true,
        message: '✅ Đăng ký OFF tuần sau thành công! Lịch OFF đã được hệ thống AI tự động ghi nhận và cập nhật Realtime vào bảng lịch.',
        data: offResult,
      });
      return;
    }

    // RÀNG BUỘC CỨNG 48H: Cho nhân viên đang trong giai đoạn Training
    const targetStart = new Date(`${date}T07:00:00+07:00`);
    const now = new Date();
    const diffHours = (targetStart.getTime() - now.getTime()) / (1000 * 3600);

    if (diffHours < 48) {
      throw ApiError.badRequest(
        'LEAVE_REQUEST_48H_VIOLATION',
        '❌ RÀNG BUỘC 48H: Phiếu xin nghỉ phép phải được gửi trước ít nhất 48 giờ (2 ngày) so với thời điểm ca làm việc bắt đầu!'
      );
    }

    const normCa = normalizeShiftCode(cand.caLam || '');
    const shiftCode = normCa && normCa !== 'OFF' ? normCa : 'SANG';

    const ticketId = nextId('LVR');

    // Tạo phiếu xin nghỉ phép ở trạng thái PENDING_HR_APPROVAL (Chờ HR/Manager duyệt)
    const ticket = await prisma.leaveRequestTicket.create({
      data: {
        id: ticketId,
        candidateId,
        candidateName: cand.tenUv,
        chiNhanh: cand.chiNhanh || 'Chưa phân công',
        date,
        shiftCode,
        reason: reason.trim(),
        status: 'PENDING_HR_APPROVAL',
      },
    });

    // Phát tín hiệu Realtime Socket báo cho HR / Manager
    emit('leave_request:created', { ticketId: ticket.id, candidateId, date, chiNhanh: cand.chiNhanh });
    emit('approval:updated', { type: 'LEAVE_REQUEST', id: ticket.id });

    res.json({
      success: true,
      message: '✅ Đã gửi phiếu xin nghỉ phép 48h thành công! Phiếu đã được chuyển tới HR/Quản lý duyệt. Khi HR/Quản lý phê duyệt, AI sẽ tự động gán lịch OFF và mở luồng bù ca.',
      data: ticket,
    });
  } catch (e) {
    next(e);
  }
});

// 3h. Lấy danh sách phiếu xin nghỉ phép của Nhân viên
router.get('/public/employee/leave-requests/:candidateId', async (req, res, next) => {
  try {
    const candidateId = req.params.candidateId;
    const tickets = await prisma.leaveRequestTicket.findMany({
      where: { candidateId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: tickets });
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
