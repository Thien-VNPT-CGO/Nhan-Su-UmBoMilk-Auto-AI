import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { emit } from '../sockets';
import { candidateService, normalizePhone } from './CandidateService';
import { audit } from './AuditService';

export interface IncomingPersonalMessagePayload {
  phone: string;
  content: string;
  senderName?: string;
  timestamp?: string;
}

export class ZaloPersonalListenerService {
  /**
   * Xử lý tin nhắn đến từ Zalo Cá Nhân HR (Tự động lưu log, khớp ứng viên & AI nhận diện xác nhận tham gia).
   */
  async handleIncomingPersonalMessage(payload: IncomingPersonalMessagePayload): Promise<{
    processed: boolean;
    candidateId?: string;
    candidateName?: string;
    action?: string;
    newStatus?: string;
    messageId?: string;
  }> {
    const rawPhone = payload.phone?.trim() ?? '';
    const content = payload.content?.trim() ?? '';
    if (!rawPhone || !content) {
      return { processed: false };
    }

    const normPhone = normalizePhone(rawPhone);

    // 1. Tìm ứng viên khớp SĐT trong DB
    const candidate = await prisma.candidate.findFirst({
      where: {
        OR: [
          { sdtZalo: normPhone },
          { sdtZalo: rawPhone },
          { sdtZalo: { contains: normPhone.slice(-8) } },
        ],
      },
      orderBy: { thoiGian: 'desc' },
    });

    const candidateId = candidate ? candidate.id : null;

    // 2. Lưu tin nhắn Zalo vào CSDL với direction = 'IN'
    const msg = await prisma.zaloMessage.create({
      data: {
        id: nextId('ZAL'),
        candidateId,
        phone: normPhone,
        content,
        status: 'RECEIVED',
        error: null,
        provider: 'ZALO_PERSONAL',
        direction: 'IN',
        messageType: 'text',
      },
    });

    // 3. Phát socket event realtime zalo:incoming
    emit('zalo:incoming', {
      candidateId,
      phone: normPhone,
      senderName: payload.senderName ?? candidate?.tenUv ?? 'Ứng viên Zalo',
      content,
      messageId: msg.id,
      createdAt: msg.createdAt,
    });

    if (!candidate) {
      return { processed: false, messageId: msg.id };
    }

    // 4. Cho AI tự động đọc hiểu & nhận diện phản hồi ứng viên
    const aiResult = await candidateService.processZaloAutoConfirmation(
      candidate.id,
      content,
      'ZALO_PERSONAL_AI_LISTENER',
    );

    if (aiResult.processed) {
      await audit({
        user: 'ZALO_PERSONAL_AI_LISTENER',
        action: `AI_AUTO_CONFIRM_${aiResult.action ?? 'SUCCESS'}`,
        entity: 'candidate',
        entityId: candidate.id,
        oldValue: candidate.trangThaiTraining,
        newValue: aiResult.newStatus,
        version: candidate.dataVersion + 1,
      });

      emit('zalo:ai_confirmed', {
        candidateId: candidate.id,
        candidateName: candidate.tenUv,
        action: aiResult.action,
        newStatus: aiResult.newStatus,
        content,
      });
    }

    return {
      processed: aiResult.processed,
      candidateId: candidate.id,
      candidateName: candidate.tenUv,
      action: aiResult.action,
      newStatus: aiResult.newStatus,
      messageId: msg.id,
    };
  }
}

export const zaloPersonalListenerService = new ZaloPersonalListenerService();
