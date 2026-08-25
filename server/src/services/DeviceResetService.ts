import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { nextId } from '../lib/id';
import { audit } from './AuditService';
import { emit } from '../sockets';

export class DeviceResetService {
  /** Tạo Phiếu Yêu cầu Reset Thiết Bị (TH1: NV tự gửi trên máy cũ | TH2: QL tạo hộ khi mất máy) */
  async createTicket(input: {
    candidateId: string;
    reason: string;
    creatorType: 'EMPLOYEE_SELF' | 'STORE_MANAGER_FOR_EMP';
    createdBy: string;
  }) {
    const candidate = await prisma.candidate.findUnique({ where: { id: input.candidateId } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy thông tin nhân sự.');

    // Kiểm tra nếu đang có phiếu PENDING
    const existing = await prisma.deviceResetTicket.findFirst({
      where: {
        candidateId: input.candidateId,
        status: { in: ['PENDING_MANAGER', 'PENDING_IT'] },
      },
    });
    if (existing) {
      throw ApiError.badRequest('TICKET_EXISTS', 'Nhân sự này đã có 1 phiếu yêu cầu Reset thiết bị đang chờ xử lý.');
    }

    const initialStatus = input.creatorType === 'STORE_MANAGER_FOR_EMP' ? 'PENDING_IT' : 'PENDING_MANAGER';
    const managerUser = input.creatorType === 'STORE_MANAGER_FOR_EMP' ? input.createdBy : null;
    const managerApprovedAt = input.creatorType === 'STORE_MANAGER_FOR_EMP' ? new Date() : null;

    const ticket = await prisma.deviceResetTicket.create({
      data: {
        id: nextId('RST'),
        candidateId: input.candidateId,
        creatorType: input.creatorType,
        createdBy: input.createdBy,
        reason: input.reason.trim(),
        status: initialStatus,
        managerUser,
        managerApprovedAt,
      },
    });

    await audit({
      user: input.createdBy,
      action: 'CREATE_DEVICE_RESET_TICKET',
      entity: 'device_reset_ticket',
      entityId: ticket.id,
      newValue: { candidateId: input.candidateId, creatorType: input.creatorType, status: initialStatus },
    });

    emit('device_reset:requested', {
      ticketId: ticket.id,
      candidateId: input.candidateId,
      creatorType: input.creatorType,
      status: initialStatus,
    });

    return ticket;
  }

  /** Quản lý Cửa hàng duyệt xác nhận thực tế tại chi nhánh (TH1) */
  async managerApprove(ticketId: string, user: string) {
    const ticket = await prisma.deviceResetTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw ApiError.notFound('TICKET_NOT_FOUND', 'Không tìm thấy phiếu yêu cầu reset.');
    if (ticket.status !== 'PENDING_MANAGER') {
      throw ApiError.badRequest('INVALID_STATUS', 'Phiếu này không ở trạng thái chờ Quản lý duyệt.');
    }

    const updated = await prisma.deviceResetTicket.update({
      where: { id: ticketId },
      data: {
        status: 'PENDING_IT',
        managerUser: user,
        managerApprovedAt: new Date(),
      },
    });

    await audit({
      user,
      action: 'MANAGER_APPROVE_DEVICE_RESET',
      entity: 'device_reset_ticket',
      entityId: ticketId,
      newValue: { status: 'PENDING_IT', managerUser: user },
    });

    emit('device_reset:verified', { ticketId, candidateId: ticket.candidateId, status: 'PENDING_IT' });
    return updated;
  }

  /** IT Admin (admin) duyệt mở thiết bị mới & TỰ ĐỘNG LOGOUT MÁY CỦ REALTIME */
  async itAdminApprove(ticketId: string, user: string) {
    const ticket = await prisma.deviceResetTicket.findUnique({
      where: { id: ticketId },
      include: { candidate: true },
    });
    if (!ticket) throw ApiError.notFound('TICKET_NOT_FOUND', 'Không tìm thấy phiếu yêu cầu reset.');
    if (ticket.status !== 'PENDING_IT') {
      throw ApiError.badRequest('INVALID_STATUS', 'Phiếu này chưa được Quản lý xác nhận hoặc đã xử lý rồi.');
    }

    // 1. Cập nhật trạng thái phiếu -> APPROVED
    const updatedTicket = await prisma.deviceResetTicket.update({
      where: { id: ticketId },
      data: {
        status: 'APPROVED',
        itUser: user,
        itApprovedAt: new Date(),
      },
    });

    // 2. GỠ BỎ DEVICE ID CŨ & ĐẶT LẠI TRẠNG THÁI KEY LÀ ACTIVE (READY FOR NEW DEVICE)
    await prisma.employeeKey.updateMany({
      where: { candidateId: ticket.candidateId, status: 'ACTIVE' },
      data: {
        deviceId: null,
      },
    });

    await audit({
      user,
      action: 'IT_ADMIN_APPROVE_DEVICE_RESET',
      entity: 'device_reset_ticket',
      entityId: ticketId,
      newValue: { candidateId: ticket.candidateId, status: 'APPROVED', itUser: user },
    });

    // 3. REALTIME SOCKET.IO FORCE LOGOUT ĐIỆN THOẠI CỦ LẬP TỨC (0ms TRỄ)
    emit('device_key:force_logout', {
      candidateId: ticket.candidateId,
      reason: 'Key kích hoạt thiết bị của bạn đã được IT Reset thành công. Phiên làm việc trên máy này đã hết hạn.',
    });

    emit('device_reset:approved', {
      ticketId,
      candidateId: ticket.candidateId,
      status: 'APPROVED',
    });

    // 4. GỬI TIN NHẮN ZALO THÔNG BÁO CHO NHÂN VIÊN
    if (ticket.candidate?.sdtZalo) {
      const zaloContent = [
        '🐮 [UMBO MILK] – YÊU CẦU RESET THIẾT BỊ ĐÃ ĐƯỢC DUYỆT ✅',
        '',
        `Chào ${ticket.candidate.tenUv} ❤️`,
        'Yêu cầu cấp phép đổi thiết bị mới của bạn đã được IT Admin phê duyệt.',
        '',
        '👉 Bạn có thể sử dụng Mã NV & Key kích hoạt để đăng nhập trên điện thoại mới ngay bây giờ!',
      ].join('\n');

      await prisma.zaloMessage.create({
        data: {
          id: nextId('ZALO'),
          candidateId: ticket.candidateId,
          phone: ticket.candidate.sdtZalo,
          content: zaloContent,
          status: 'SENT',
        },
      });
    }

    return updatedTicket;
  }

  /** Từ chối phiếu Reset Thiết bị */
  async rejectTicket(ticketId: string, user: string, rejectReason: string) {
    const ticket = await prisma.deviceResetTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw ApiError.notFound('TICKET_NOT_FOUND', 'Không tìm thấy phiếu yêu cầu reset.');

    const updated = await prisma.deviceResetTicket.update({
      where: { id: ticketId },
      data: {
        status: 'REJECTED',
        rejectReason: rejectReason.trim(),
        itUser: user,
        itApprovedAt: new Date(),
      },
    });

    await audit({
      user,
      action: 'REJECT_DEVICE_RESET_TICKET',
      entity: 'device_reset_ticket',
      entityId: ticketId,
      newValue: { status: 'REJECTED', rejectReason },
    });

    emit('device_reset:rejected', { ticketId, candidateId: ticket.candidateId, rejectReason });
    return updated;
  }

  /** Danh sách phiếu yêu cầu Reset thiết bị */
  async listTickets(filter?: { status?: string; candidateId?: string }) {
    const where: Record<string, unknown> = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.candidateId) where.candidateId = filter.candidateId;

    return prisma.deviceResetTicket.findMany({
      where,
      include: {
        candidate: { select: { tenUv: true, sdtZalo: true, chiNhanh: true, caLam: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}

export const deviceResetService = new DeviceResetService();
