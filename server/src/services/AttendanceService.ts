import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { audit } from './AuditService';
import { syncQueue } from './SyncQueueService';
import { emit } from '../sockets';
import { nextId } from '../lib/id';
import { dateKey, TZ } from '../lib/date';
import { getSettings } from './SettingsService';
import { TRAINING_DAYS_REQUIRED } from '../lib/constants';
import { trainingService } from './TrainingService';

export class AttendanceService {
  async checkin(input: {
    candidateId?: string;
    phone?: string;
    shift?: string;
    method: string;
    user?: string;
    checkinAt?: Date;
  }): Promise<{ valid: boolean; reason: string; event: unknown }> {
    const at = input.checkinAt ?? new Date();
    const date = dateKey(at);
    const shift = input.shift ?? inferShift(at);

    let candidate = null;
    if (input.candidateId) {
      candidate = await prisma.candidate.findUnique({ where: { id: input.candidateId } });
    } else if (input.phone) {
      candidate = await prisma.candidate.findFirst({ where: { sdtZalo: input.phone } });
    }
    if (!candidate) {
      return { valid: false, reason: 'KHONG_TIM_THAY_UNG_VIEN', event: null };
    }

    const reasons: string[] = [];
    let valid = true;

    // 1. Candidate đang Training
    if (candidate.hrDecision !== 'PASS') {
      valid = false;
      reasons.push('KHONG_TRONG_TRAINING');
    }

    // 2. Candidate có lịch hôm đó
    const schedule = await prisma.shift.findUnique({
      where: { candidateId_date: { candidateId: candidate.id, date } },
    });
    const scheduledShifts = schedule ? schedule.shifts.split('|').filter(Boolean) : [];
    if (!scheduledShifts.includes(shift)) {
      valid = false;
      reasons.push('KHONG_CO_LICH_CA_NAY');
    }

    // 3. Đúng khung giờ
    const settings = await getSettings();
    const shiftCfg = settings.attendance.shifts[shift as keyof typeof settings.attendance.shifts];
    if (shiftCfg) {
      const [sh, sm] = shiftCfg.start.split(':').map(Number);
      const [eh, em] = shiftCfg.end.split(':').map(Number);
      const start = new Date(at);
      start.setHours(sh, sm, 0, 0);
      start.setMinutes(start.getMinutes() - (shiftCfg.windowMinutesBefore ?? 0));
      const end = new Date(at);
      end.setHours(eh, em, 0, 0);
      end.setMinutes(end.getMinutes() + (shiftCfg.windowMinutesAfter ?? 0));
      if (at < start || at > end) {
        valid = false;
        reasons.push('SAI_KHUNG_GIO');
      }
    }

    let trainingDay: number | null = null;
    if (valid && candidate.ngayBatDauTraining) {
      const start = dateKey(candidate.ngayBatDauTraining);
      const dayNum = Math.floor(
        (Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) -
          Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)))) /
          (24 * 60 * 60 * 1000),
      );
      if (dayNum >= 0 && dayNum < TRAINING_DAYS_REQUIRED) trainingDay = dayNum + 1;
    }

    // 4. Chưa điểm danh trùng (chỉ event hợp lệ mới chiếm slot)
    const existing = await prisma.attendanceEvent.findUnique({
      where: { candidateId_date_shift: { candidateId: candidate.id, date, shift } },
    });
    if (existing) {
      if (existing.valid) {
        return { valid: false, reason: 'DIEM_DANH_TRUNG', event: existing };
      }
      // lần trước checkin sai giờ -> ghi đè để thử lại đúng giờ
      const updated = await prisma.attendanceEvent.update({
        where: { id: existing.id },
        data: { checkinAt: at, valid, reason: reasons.join('|') || null, trainingDay },
      });
      if (valid) {
        await syncQueue.enqueue({
          entity: 'attendance',
          entityId: candidate.id,
          operation: 'UPDATE',
          field: 'ATTENDANCE',
          newValue: { date, shift, valid: true },
          version: 1,
          idempotencyKey: `candidate:${candidate.id}:attendance:${date}:${shift}`,
        });
        await trainingService.refreshTrainingStatus(candidate.id);
        emit('attendance:checked', { candidateId: candidate.id, date, shift, valid: true });
      }
      return { valid, reason: reasons.join('|') || 'VALID', event: updated };
    }

    const event = await prisma.attendanceEvent.create({
      data: {
        id: nextId('ATT'),
        candidateId: candidate.id,
        date,
        shift,
        checkinAt: at,
        method: input.method,
        valid,
        reason: reasons.join('|') || null,
        trainingDay,
      },
    });

    await audit({
      user: input.user ?? 'SYSTEM',
      action: 'CHECKIN',
      entity: 'attendance',
      entityId: event.id,
      newValue: { candidateId: candidate.id, date, shift, valid },
      ip: null,
    });

    if (valid) {
      await syncQueue.enqueue({
        entity: 'attendance',
        entityId: candidate.id,
        operation: 'UPDATE',
        field: 'ATTENDANCE',
        newValue: { date, shift, valid: true },
        version: 1,
        idempotencyKey: `candidate:${candidate.id}:attendance:${date}:${shift}`,
      });
      await trainingService.refreshTrainingStatus(candidate.id);
      emit('attendance:checked', { candidateId: candidate.id, date, shift, valid: true });
    }

    return { valid, reason: reasons.join('|') || 'VALID', event };
  }

  async list(filter: { date?: string; candidateId?: string; validOnly?: boolean }) {
    const where: Record<string, unknown> = {};
    if (filter.date) where.date = filter.date;
    if (filter.candidateId) where.candidateId = filter.candidateId;
    if (filter.validOnly !== undefined) where.valid = filter.validOnly;
    return prisma.attendanceEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { candidate: { select: { tenUv: true, sdtZalo: true } } },
    });
  }
}

function inferShift(at: Date): string {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(at),
  );
  if (h >= 6 && h < 11) return 'SANG';
  if (h >= 11 && h < 16) return 'CHIEU';
  if (h >= 16 && h < 23) return 'TOI';
  return 'SANG';
}

export const attendanceService = new AttendanceService();