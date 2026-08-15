import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { env } from '../config/env';
import { getSettings } from './SettingsService';
import { emit } from '../sockets';
import { formatDate } from '../lib/date';

export class ZaloService {
  async sendTrainingNotice(candidateId: string): Promise<{ ok: boolean; provider: string; messageId?: string }> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    if (!c.ngayBatDauTraining) throw new Error('Chưa có ngày bắt đầu Training');

    const settings = await getSettings();
    const zaloCfg = settings.zalo ?? {};

    const content = [
      '🐮 UMBO MILK – THÔNG BÁO TRAINING',
      '',
      `Chào ${c.tenUv} ❤️`,
      '',
      'Ngày bắt đầu:',
      formatDate(c.ngayBatDauTraining),
      '',
      'Chi nhánh:',
      c.chiNhanh,
      '',
      'Ca:',
      c.caLam,
      '',
      'Vui lòng có mặt đúng giờ và thực hiện điểm danh theo hướng dẫn.',
    ].join('\n');

    const useRealApi = !env.demoMode && zaloCfg.accessToken && zaloCfg.oaId;
    let status = 'PENDING';
    let error: string | null = null;
    let messageId: string | undefined;
    let provider = 'MOCK';

    if (useRealApi) {
      provider = 'ZALO_OA';
      try {
        const res = await fetch('https://business.openapi.zalo.me/v3.0/message/official_account/text', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            access_token: zaloCfg.accessToken,
          },
          body: JSON.stringify({
            recipient: { user_id: c.sdtZalo },
            message: { text: content },
          }),
        });
        const data = await res.json();
        if (data.error && data.error !== 0) {
          throw new Error(`Zalo API lỗi: ${data.error} ${data.message ?? ''}`);
        }
        messageId = data.data?.message_id;
        status = 'SENT';
      } catch (e) {
        status = 'FAILED';
        error = e instanceof Error ? e.message : String(e);
      }
    } else {
      status = 'SENT';
    }

    const msg = await prisma.zaloMessage.create({
      data: {
        id: nextId('ZAL'),
        candidateId: c.id,
        phone: c.sdtZalo,
        content,
        status,
        error,
        provider,
      },
    });

    emit('zalo:status', { candidateId: c.id, status, messageId: msg.id });
    return { ok: status === 'SENT', provider, messageId: msg.id };
  }

  async webhook(payload: unknown): Promise<void> {
    const p = payload as { sender?: { phone?: string; user_id?: string }; message?: { text?: string } };
    const text = (p.message?.text ?? '').trim().toUpperCase();
    const phone = p.sender?.phone ?? String(p.sender?.user_id ?? '');
    if (text.includes('ĐIỂM DANH') || text.includes('DIEM DANH')) {
      const { attendanceService } = await import('./AttendanceService');
      await attendanceService.checkin({ phone, method: 'ZALO' });
    }
  }
}

export const zaloService = new ZaloService();