import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { nextId } from '../lib/id';
import { emit } from '../sockets';
import { zaloPersonalService } from './ZaloPersonalService';
import { audit } from './AuditService';

export interface CreateOutputTestInput {
  candidateId: string;
  testDate: string;   // YYYY-MM-DD
  fromTime: string;   // HH:mm
  toTime: string;     // HH:mm
  meetLink: string;
  content: string;
  user: string;
}

export class OutputTestService {
  async createTicket(input: CreateOutputTestInput) {
    const candidate = await prisma.candidate.findUnique({ where: { id: input.candidateId } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    // 1. Kiểm tra Ràng buộc khóa 1h30m (90 phút) giữa các phiếu
    const lastTicket = await prisma.outputTestTicket.findFirst({
      where: { candidateId: input.candidateId },
      orderBy: { createdAt: 'desc' },
    });

    if (lastTicket) {
      const diffMs = Date.now() - new Date(lastTicket.createdAt).getTime();
      const diffMinutes = diffMs / (1000 * 60);
      if (diffMinutes < 90) {
        const remainingMins = Math.ceil(90 - diffMinutes);
        throw ApiError.badRequest(
          'TICKET_COOLDOWN_ACTIVE',
          `Mỗi phiếu yêu cầu đặt lịch Test đầu ra phải cách nhau ít nhất 1 tiếng 30 phút. Vui lòng chờ thêm ${remainingMins} phút nữa!`
        );
      }
    }

    const previousTicketsCount = await prisma.outputTestTicket.count({ where: { candidateId: input.candidateId } });
    const attemptNumber = previousTicketsCount >= 1 ? 2 : 1;

    const ticketId = nextId('TST');
    const ticket = await prisma.outputTestTicket.create({
      data: {
        id: ticketId,
        candidateId: candidate.id,
        candidateName: candidate.tenUv,
        chiNhanh: candidate.chiNhanh || 'Chưa chọn',
        testDate: input.testDate,
        fromTime: input.fromTime,
        toTime: input.toTime,
        meetLink: input.meetLink.trim(),
        content: input.content.trim(),
        attemptNumber,
        status: 'PENDING_AI_APPROVAL',
      },
    });

    await audit({
      user: input.user,
      action: 'CREATE_OUTPUT_TEST_TICKET',
      entity: 'output_test_ticket',
      entityId: ticket.id,
      newValue: JSON.stringify(ticket),
    });

    // Phát Socket Realtime báo tạo phiếu thành công
    emit('output_test:created', { ticketId: ticket.id, candidateId: candidate.id });
    emit('training:updated', { candidateId: candidate.id });

    // 2. AI TỰ ĐỘNG PHÊ DUYỆT TRONG 15-30 GIÂY PHÁT SOCKET REALTIME 1:1
    const delayMs = Math.floor(Math.random() * 15000) + 15000; // 15s - 30s
    setTimeout(async () => {
      try {
        const approvedTicket = await prisma.outputTestTicket.update({
          where: { id: ticket.id },
          data: {
            status: 'APPROVED',
            approvedAt: new Date(),
          },
        });

        const newTrainingStatus = attemptNumber === 1 ? 'TEST_DAU_RA_LAN_1' : 'TEST_DAU_RA_LAN_2';
        await prisma.candidate.update({
          where: { id: candidate.id },
          data: {
            trangThaiTraining: newTrainingStatus,
            updatedBy: 'AI-SYSTEM',
          },
        });

        // Bắn Socket Realtime 1:1 tới tất cả client connected
        emit('output_test:approved', { ticketId: approvedTicket.id, candidateId: candidate.id, status: newTrainingStatus });
        emit('training:updated', { candidateId: candidate.id });
        emit('candidate:updated', { candidateId: candidate.id });

        // Gửi tin nhắn Zalo thông báo lịch phỏng vấn Test đầu ra
        if (candidate.sdtZalo) {
          void zaloPersonalService.sendMessageByPhone(
            candidate.sdtZalo,
            `🐮 [UMBO MILK] – THÔNG BÁO LỊCH TEST ĐẦU RA (LẦN ${attemptNumber}) 📋\n\nChào ${candidate.tenUv},\nAI đã duyệt lịch Test Đầu Ra của bạn:\n• Ngày: ${input.testDate}\n• Giờ: ${input.fromTime} - ${input.toTime}\n• Link Google Meet: ${input.meetLink}\n• Nội dung: ${input.content}\n\nVui lòng có mặt đúng giờ!`
          ).catch(() => null);
        }
      } catch (e) {
        console.error('[OutputTestService] AI Auto approval error:', e);
      }
    }, delayMs);

    return ticket;
  }

  async listTickets(candidateId?: string) {
    const where: any = {};
    if (candidateId) where.candidateId = candidateId;
    return prisma.outputTestTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

export const outputTestService = new OutputTestService();
