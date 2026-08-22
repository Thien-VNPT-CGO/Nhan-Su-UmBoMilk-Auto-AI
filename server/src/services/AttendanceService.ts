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
    location?: { lat: number; lng: number } | null;
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

    // 3b. Geofence: checkin qua Zalo kèm GPS phải nằm trong bán kính chi nhánh
    const branchCfg = (settings.branches ?? []).find((b) => b.name === candidate.chiNhanh);
    if (
      settings.attendance.geofenceEnabled &&
      input.location?.lat != null &&
      input.location.lng != null
    ) {
      if (!branchCfg || branchCfg.radiusMeters <= 0) {
        valid = false;
        reasons.push('CHUA_CAP_NHAT_TOA_DO_CHI_NHANH');
      } else {
        const distance = haversineMeters(
          input.location.lat,
          input.location.lng,
          branchCfg.lat,
          branchCfg.lng,
        );
        if (distance > branchCfg.radiusMeters) {
          valid = false;
          reasons.push('SAI_VI_TRI');
        }
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
        data: {
          checkinAt: at,
          valid,
          reason: reasons.join('|') || null,
          trainingDay,
          lat: input.location?.lat ?? null,
          lng: input.location?.lng ?? null,
        },
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
        lat: input.location?.lat ?? null,
        lng: input.location?.lng ?? null,
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

/** Khoảng cách Haversine giữa 2 điểm GPS (mét). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Giải thích lý do không hợp lệ thành tin nhắn tiếng Việt cho ứng viên qua Zalo. */
export function checkinReasonText(valid: boolean, reason: string, tenUv: string): string {
  if (valid) {
    return [
      '🎉 [UMBO MILK] – ĐIỂM DANH THÀNH CÔNG ✅',
      '',
      `Chào ${tenUv} ❤️`,
      'Hệ thống đã ghi nhận thông tin điểm danh của bạn.',
      '',
      'Chúc bạn một ngày làm việc vui vẻ và hiệu quả cùng UMBO MILK! 🥤✨',
    ].join('\n');
  }

  const map: Record<string, string> = {
    KHONG_TIM_THAY_UNG_VIEN: 'Hệ thống chưa tìm thấy số điện thoại của bạn trong danh sách. Vui lòng liên hệ Quản lý chi nhánh.',
    KHONG_TRONG_TRAINING: 'Hồ sơ của bạn chưa ở trong danh sách đào tạo.',
    KHONG_CO_LICH_CA_NAY: 'Hôm nay bạn không có lịch phân ca trong hệ thống. Vui lòng kiểm tra lại với Quản lý.',
    SAI_KHUNG_GIO: 'Điểm danh ngoài khung giờ cho phép (SÁNG: 06:45–07:05, CHIỀU: 11:45–12:05, TỐI: 17:45–18:05).',
    DIEM_DANH_TRUNG: 'Bạn đã hoàn thành điểm danh cho ca này rồi nhé. Không cần điểm danh lại.',
    SAI_VI_TRI: 'Vị trí hiện tại của bạn nằm ngoài bán kính cho phép của chi nhánh. Vui lòng đến đúng chi nhánh và gửi lại vị trí GPS.',
    CHUA_CAP_NHAT_TOA_DO_CHI_NHANH: 'Chi nhánh hiện chưa được thiết lập tọa độ GPS. Vui lòng liên hệ Quản lý chi nhánh.',
    VANG: 'Ca làm này đã quá giờ điểm danh cho phép.',
  };
  const first = reason.split('|')[0];
  return [
    '❌ [UMBO MILK] – ĐIỂM DANH KHÔNG THÀNH CÔNG',
    '',
    `Chào ${tenUv} ❤️`,
    `Lý do: ${map[first] ?? 'Thông tin điểm danh chưa hợp lệ.'}`,
    '',
    'Vui lòng kiểm tra lại hoặc liên hệ Quản lý chi nhánh để được trợ giúp nhé! ✨',
  ].join('\n');
}


export const attendanceService = new AttendanceService();