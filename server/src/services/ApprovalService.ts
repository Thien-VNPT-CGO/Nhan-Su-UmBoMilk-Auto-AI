import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { nextId } from '../lib/id';
import { shiftService } from './ShiftService';
import { zaloPersonalService } from './ZaloPersonalService';
import { audit } from './AuditService';

export interface CreateSwapInput {
  candidateIdA: string;
  dateA: string;
  caLamA: string;
  candidateIdB: string;
  dateB: string;
  caLamB: string;
  reason: string;
  swapType?: string;
}

export class ApprovalService {
  async listRequests(params: { status?: string; branch?: string; search?: string }) {
    const where: any = {};
    if (params.status && params.status !== 'ALL') {
      where.status = params.status;
    }
    if (params.branch) {
      where.OR = [{ chiNhanhA: params.branch }, { chiNhanhB: params.branch }];
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      where.AND = [
        {
          OR: [
            { candidateNameA: { contains: q, mode: 'insensitive' } },
            { candidateNameB: { contains: q, mode: 'insensitive' } },
            { sdtA: { contains: q } },
            { sdtB: { contains: q } },
          ],
        },
      ];
    }

    return prisma.shiftSwapRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createRequest(input: CreateSwapInput) {
    const candA = await prisma.candidate.findUnique({ where: { id: input.candidateIdA } });
    if (!candA) throw ApiError.notFound('CANDIDATE_A_NOT_FOUND', 'Không tìm thấy ứng viên A.');

    const candB = await prisma.candidate.findUnique({ where: { id: input.candidateIdB } });
    if (!candB) throw ApiError.notFound('CANDIDATE_B_NOT_FOUND', 'Không tìm thấy ứng viên B.');

    const reqId = nextId('SWAP');

    const created = await prisma.shiftSwapRequest.create({
      data: {
        id: reqId,
        candidateIdA: candA.id,
        candidateNameA: candA.tenUv,
        sdtA: candA.sdtZalo,
        chiNhanhA: candA.chiNhanh || 'Chưa chọn',
        caLamA: input.caLamA,
        dateA: input.dateA,

        candidateIdB: candB.id,
        candidateNameB: candB.tenUv,
        sdtB: candB.sdtZalo,
        chiNhanhB: candB.chiNhanh || 'Chưa chọn',
        caLamB: input.caLamB,
        dateB: input.dateB,

        swapType: input.swapType || 'SWAP_2_WAY',
        reason: input.reason,
        status: 'PENDING_MANAGER', // Tạo đơn trực tiếp sang trạng thái chờ Quản lý duyệt
      },
    });

    return created;
  }

  async approveRequest(requestId: string, managerUsername: string) {
    const req = await prisma.shiftSwapRequest.findUnique({ where: { id: requestId } });
    if (!req) throw ApiError.notFound('REQUEST_NOT_FOUND', 'Không tìm thấy đơn hoán đổi ca.');
    if (req.status === 'APPROVED') throw ApiError.badRequest('ALREADY_APPROVED', 'Đơn này đã được duyệt rồi.');

    // 1. Swap ca làm việc của 2 nhân sự trên hệ thống
    // Đổi ca cho NV A vào ngày dateA sang caLamB
    await shiftService.upsert({
      candidateId: req.candidateIdA,
      date: req.dateA,
      shifts: req.caLamB,
      user: managerUsername,
      note: `Đổi ca theo đơn ${req.id} với ${req.candidateNameB}`,
    });

    // Đổi ca cho NV B vào ngày dateB sang caLamA
    await shiftService.upsert({
      candidateId: req.candidateIdB,
      date: req.dateB,
      shifts: req.caLamA,
      user: managerUsername,
      note: `Đổi ca theo đơn ${req.id} với ${req.candidateNameA}`,
    });

    // 2. Cập nhật trạng thái đơn sang APPROVED
    const updated = await prisma.shiftSwapRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        approvedBy: managerUsername,
        approvedAt: new Date(),
      },
    });

    // 3. Ghi log audit
    await audit({
      user: managerUsername,
      action: 'APPROVE_SHIFT_SWAP',
      entity: 'ShiftSwapRequest',
      entityId: requestId,
      newValue: JSON.stringify({ status: 'APPROVED', approvedBy: managerUsername }),
    });

    // 4. Tự động gửi tin nhắn Zalo thông báo tới cả NV A và NV B
    const msgA = `🐮 [UMBO MILK] – THÔNG BÁO PHÊ DUYỆT ĐỔI CA ✅\n\nChào ${req.candidateNameA} ❤️\nĐơn hoán đổi ca ngày ${req.dateA} (${req.caLamA}) của bạn với ${req.candidateNameB} (${req.caLamB}) đã được QUẢN LÝ PHÊ DUYỆT thành công.\n\nLịch làm mới đã được tự động cập nhật trên hệ thống! ✨`;
    const msgB = `🐮 [UMBO MILK] – THÔNG BÁO PHÊ DUYỆT ĐỔI CA ✅\n\nChào ${req.candidateNameB} ❤️\nĐơn hoán đổi ca ngày ${req.dateB} (${req.caLamB}) của bạn với ${req.candidateNameA} (${req.caLamA}) đã được QUẢN LÝ PHÊ DUYỆT thành công.\n\nLịch làm mới đã được tự động cập nhật trên hệ thống! ✨`;

    void zaloPersonalService.sendMessageByPhone(req.sdtA, msgA).catch(() => null);
    void zaloPersonalService.sendMessageByPhone(req.sdtB, msgB).catch(() => null);

    return updated;
  }

  async rejectRequest(requestId: string, managerUsername: string, rejectReason: string) {
    const req = await prisma.shiftSwapRequest.findUnique({ where: { id: requestId } });
    if (!req) throw ApiError.notFound('REQUEST_NOT_FOUND', 'Không tìm thấy đơn hoán đổi ca.');
    if (req.status === 'REJECTED') throw ApiError.badRequest('ALREADY_REJECTED', 'Đơn này đã bị từ chối rồi.');

    const updated = await prisma.shiftSwapRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        rejectReason: rejectReason || 'Quản lý từ chối đơn đổi ca.',
        approvedBy: managerUsername,
        approvedAt: new Date(),
      },
    });

    await audit({
      user: managerUsername,
      action: 'REJECT_SHIFT_SWAP',
      entity: 'ShiftSwapRequest',
      entityId: requestId,
      newValue: JSON.stringify({ status: 'REJECTED', rejectReason }),
    });

    // Thông báo Zalo lý do từ chối cho NV A
    const msgA = `🐮 [UMBO MILK] – THÔNG BÁO TỪ CHỐI ĐỔI CA ❌\n\nChào ${req.candidateNameA},\nYêu cầu đổi ca ngày ${req.dateA} của bạn không được Quản lý phê duyệt.\nLý do: ${rejectReason || 'Không phù hợp nhân sự ca làm'}.`;
    void zaloPersonalService.sendMessageByPhone(req.sdtA, msgA).catch(() => null);

    return updated;
  }
}

export const approvalService = new ApprovalService();
