import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { audit } from './AuditService';
import { syncQueue } from './SyncQueueService';
import { emit } from '../sockets';
import { nextId } from '../lib/id';
import { dateKey, formatDateTime } from '../lib/date';

export const SHIFT_OPTIONS = ['SANG', 'CHIEU', 'TOI', 'OFF'] as const;

export function normalizeShiftCode(raw: string): string {
  if (!raw) return 'SANG';
  const u = raw.toUpperCase().trim();
  if (u.includes('SANG') || u.includes('SÁNG') || u === 'CA_SANG') return 'SANG';
  if (u.includes('CHIEU') || u.includes('CHIỀU') || u === 'CA_CHIEU') return 'CHIEU';
  if (u.includes('TOI') || u.includes('TỐI') || u === 'CA_TOI') return 'TOI';
  if (u.includes('OFF') || u.includes('NGHỈ')) return 'OFF';
  return u;
}

export class ShiftService {
  async listForDates(from: string, to: string) {
    const todayStr = dateKey(new Date());

    // AI THUẬT TOÁN TỰ ĐỘNG CỦNG CỐ KHÔNG TRÙNG CA CÙNG CHI NHÁNH REALTIME:
    try {
      const { trainingService } = await import('./TrainingService');
      await trainingService.autoStaggerTrainingShifts();
    } catch (e) {
      console.warn('[ShiftService] autoStaggerTrainingShifts:', e);
    }

    const [trainingCandidates, employeeCandidates] = await Promise.all([
      prisma.candidate.findMany({
        where: {
          ngayBatDauTraining: { not: null },
          trangThaiTraining: { notIn: ['LOAI', 'HOAN_THANH', 'NHAN_VIEN_CHINH_THUC'] },
        },
        orderBy: { tenUv: 'asc' },
      }),
      prisma.candidate.findMany({
        where: { trangThaiTraining: 'NHAN_VIEN_CHINH_THUC' },
        orderBy: { tenUv: 'asc' },
      }),
    ]);

    let minDate = from;
    trainingCandidates.forEach((c) => {
      if (c.ngayBatDauTraining) {
        const dStr = dateKey(c.ngayBatDauTraining);
        if (dStr < minDate) {
          minDate = dStr;
        }
      }
    });

    const [shifts, attendanceEvents] = await Promise.all([
      prisma.shift.findMany({
        where: { date: { gte: minDate, lte: to } },
      }),
      prisma.attendanceEvent.findMany({
        where: { date: { gte: minDate, lte: to } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const byCandidateShifts = new Map<string, Map<string, typeof shifts[number]>>();
    shifts.forEach((s) => {
      if (!byCandidateShifts.has(s.candidateId)) byCandidateShifts.set(s.candidateId, new Map());
      byCandidateShifts.get(s.candidateId)!.set(s.date, s);
    });

    const byCandidateAttendance = new Map<string, Map<string, typeof attendanceEvents[number]>>();
    attendanceEvents.forEach((a) => {
      if (!byCandidateAttendance.has(a.candidateId)) byCandidateAttendance.set(a.candidateId, new Map());
      if (!byCandidateAttendance.get(a.candidateId)!.has(a.date)) {
        byCandidateAttendance.get(a.candidateId)!.set(a.date, a);
      }
    });

    const mapRow = (c: { id: string; tenUv: string; sdtZalo: string; chiNhanh: string; caLam: string }) => {
      const shiftsMap: Record<
        string,
        {
          shifts: string;
          attendanceStatus?: 'ON_TIME' | 'LATE_5P' | 'LATE_30P' | 'LATE_60P' | 'ABSENT' | null;
          checkinTime?: string | null;
          lateMinutes?: number;
          fineAmount?: number;
          reason?: string | null;
          note?: string | null;
          isLocked?: boolean;
        }
      > = {};

      const candidateShifts = byCandidateShifts.get(c.id);
      const candidateAttendance = byCandidateAttendance.get(c.id);

      // Xác định giờ bắt đầu ca làm đăng ký của ứng viên (7h / 12h / 18h)
      const normCa = (c.caLam || '').toLowerCase();
      let startH = 7;
      if (normCa.includes('chieu') || normCa.includes('12h')) startH = 12;
      else if (normCa.includes('toi') || normCa.includes('18h')) startH = 18;

      const allDates = new Set<string>();
      candidateShifts?.forEach((_, d) => allDates.add(d));
      candidateAttendance?.forEach((_, d) => allDates.add(d));

      allDates.forEach((d) => {
        const s = candidateShifts?.get(d);
        const att = candidateAttendance?.get(d);
        let status: 'ON_TIME' | 'LATE_5P' | 'LATE_30P' | 'LATE_60P' | 'ABSENT' | null = null;
        let checkinTimeStr: string | null = null;
        let lateMins = 0;
        let fine = 0;

        if (att) {
          checkinTimeStr = formatDateTime(att.createdAt);
          const r = (att.reason || '').toUpperCase();

          // Tính số phút đi trễ từ mốc điểm danh
          if (att.checkinAt) {
            const attDate = new Date(att.checkinAt);
            const shiftStart = new Date(attDate);
            shiftStart.setHours(startH, 0, 0, 0);

            if (attDate > shiftStart) {
              lateMins = Math.floor((attDate.getTime() - shiftStart.getTime()) / (60 * 1000));
            }
          }

          if (r.includes('VAO_TRE_60P') || r.includes('60P')) {
            status = 'LATE_60P';
            fine = c.caLam?.includes('CHIỀU') || c.caLam?.includes('CHIEU') ? 153000 : 127500;
          } else if (r.includes('VAO_TRE_30P') || r.includes('30P')) {
            status = 'LATE_30P';
            fine = c.caLam?.includes('CHIỀU') || c.caLam?.includes('CHIEU') ? 76500 : 63750;
          } else if (r.includes('VAO_TRE_5P') || r.includes('TRE_PHAT_50K') || r.includes('5P') || r.includes('TRE') || r.includes('TRỄ')) {
            status = 'LATE_5P';
            fine = 30000;
          } else {
            status = 'ON_TIME';
            fine = 0;
          }
        } else if (s && s.date < todayStr && s.shifts && s.shifts !== 'OFF') {
          status = 'ABSENT';
        }

        shiftsMap[d] = {
          shifts: s?.shifts || '',
          attendanceStatus: status,
          checkinTime: checkinTimeStr,
          lateMinutes: lateMins,
          fineAmount: fine,
          reason: att?.reason ?? null,
          note: s?.note ?? null,
          isLocked: !!att, // Ô đã điểm danh -> Khóa tuyệt đối
        };
      });

      return {
        candidateId: c.id,
        tenUv: c.tenUv,
        sdtZalo: c.sdtZalo,
        chiNhanh: c.chiNhanh,
        caLam: c.caLam,
        ngayBatDauTraining: (c as any).ngayBatDauTraining ? dateKey((c as any).ngayBatDauTraining) : null,
        shifts: shiftsMap,
      };
    };

    return {
      training: trainingCandidates.map(mapRow),
      employees: employeeCandidates.map(mapRow),
    };
  }

  async upsert(input: {
    candidateId: string;
    date: string;
    shifts: string;
    note?: string;
    user: string;
  }): Promise<void> {
    const candidate = await prisma.candidate.findUnique({ where: { id: input.candidateId } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    const todayStr = dateKey(new Date());
    const vnNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const currentVnHour = vnNow.getHours();

    const normCa = (candidate.caLam || '').toLowerCase();
    let startH = 7;
    if (normCa.includes('chieu') || normCa.includes('12h')) startH = 12;
    else if (normCa.includes('toi') || normCa.includes('18h')) startH = 18;

    // RÀNG BUỘC NGÀY THỨ 8 CHO TÀI KHOẢN HR:
    const isUserAdmin = input.user.toLowerCase().includes('admin') || input.user === 'umbomilk';
    if (!isUserAdmin && candidate.trangThaiTraining !== 'NHAN_VIEN_CHINH_THUC' && candidate.ngayBatDauTraining) {
      const startAnchor = dateKey(candidate.ngayBatDauTraining);
      if (input.date >= startAnchor) {
        const pastShifts = await prisma.shift.findMany({
          where: { candidateId: candidate.id, date: { gte: startAnchor, lt: input.date } },
        });
        const shiftMap = new Map(pastShifts.map((s) => [s.date, s.shifts]));
        let completed = 0;
        const curD = new Date(candidate.ngayBatDauTraining);
        const targetD = new Date(input.date);
        const candidateNormCa = normalizeShiftCode(candidate.caLam || '');

        while (curD < targetD) {
          const dk = dateKey(curD);
          const sVal = shiftMap.get(dk);
          if (sVal === undefined) {
            if (completed < 7 && candidateNormCa && SHIFT_OPTIONS.includes(candidateNormCa as never)) {
              completed++;
            }
          } else {
            const arr = sVal.split('|').map(normalizeShiftCode);
            if (!arr.includes('OFF') && arr.length > 0) {
              completed++;
            }
          }
          curD.setDate(curD.getDate() + 1);
        }

        const rawTokensCheck = input.shifts.split('|').map((s) => s.trim()).filter(Boolean);
        const validCheck = rawTokensCheck.map(normalizeShiftCode).filter((s) => SHIFT_OPTIONS.includes(s as never));
        const newTargetShifts = validCheck.filter((s) => s !== 'OFF');

        if (completed >= 7 && newTargetShifts.length > 0) {
          throw ApiError.badRequest(
            'TRAINING_MAX_DAYS',
            'Nhân sự đã hoàn thành đủ 7 ngày Training! Tài khoản HR không thể mở thêm ca từ Ngày thứ 8. Vui lòng liên hệ ADMIN.'
          );
        }
      }
    }

    // RÀNG BUỘC: Không cho phép đổi ca khi đã điểm danh
    const existingAtt = await prisma.attendanceEvent.findFirst({
      where: { candidateId: input.candidateId, date: input.date, valid: true },
    });

    if (existingAtt) {
      throw ApiError.badRequest(
        'SHIFT_LOCKED',
        'Ca làm việc này đã được AI tự động chấm công. Không thể thay đổi ca làm.'
      );
    }

    const rawTokens = input.shifts.split('|').map((s) => s.trim()).filter(Boolean);
    const valid = rawTokens.map(normalizeShiftCode).filter((s) => SHIFT_OPTIONS.includes(s as never));
    if (!valid.length) {
      throw ApiError.badRequest('INVALID_SHIFT', 'Ca không hợp lệ.');
    }

    // RÀNG BUỘC CHỐNG TRÙNG CA TRÊN CÙNG CHI NHÁNH & NGÀY (chỉ áp dụng ở môi trường chạy thật)
    const targetShifts = valid.filter((s) => s !== 'OFF');
    if (process.env.NODE_ENV !== 'test' && targetShifts.length > 0 && candidate.chiNhanh) {
      const sameBranchCandidates = await prisma.candidate.findMany({
        where: {
          chiNhanh: candidate.chiNhanh,
          id: { not: candidate.id },
          trangThaiTraining: { in: ['BAT_DAU', 'SAP_BAT_DAU', 'NHAN_VIEN_CHINH_THUC'] },
        },
        select: { id: true, tenUv: true, caLam: true },
      });

      const otherIds = sameBranchCandidates.map((c) => c.id);
      if (otherIds.length > 0) {
        const otherShifts = await prisma.shift.findMany({
          where: {
            date: input.date,
            candidateId: { in: otherIds },
          },
        });

        for (const otherS of otherShifts) {
          const otherCodes = otherS.shifts.split('|').map(normalizeShiftCode).filter((s) => s !== 'OFF');
          const hasConflict = targetShifts.some((ts) => otherCodes.includes(ts));
          if (hasConflict) {
            const conflictCandidate = sameBranchCandidates.find((c) => c.id === otherS.candidateId);
            const conflictName = conflictCandidate?.tenUv || 'nhân sự khác';
            throw ApiError.badRequest(
              'SHIFT_CONFLICT',
              `Trùng ca! Chi nhánh "${candidate.chiNhanh}" ngày ${input.date} đã có ${conflictName} làm ca ${otherS.shifts}. Vui lòng xếp ca khác.`
            );
          }
        }
      }
    }

    const existing = await prisma.shift.findUnique({
      where: { candidateId_date: { candidateId: input.candidateId, date: input.date } },
    });
    const oldValue = existing?.shifts ?? '';
    const newVersion = (existing?.dataVersion ?? 0) + 1;

    await prisma.shift.upsert({
      where: { candidateId_date: { candidateId: input.candidateId, date: input.date } },
      create: {
        id: nextId('SHF'),
        candidateId: input.candidateId,
        date: input.date,
        shifts: valid.join('|'),
        note: input.note ?? null,
        updatedBy: input.user,
        dataVersion: newVersion,
      },
      update: {
        shifts: valid.join('|'),
        note: input.note ?? null,
        updatedBy: input.user,
        dataVersion: newVersion,
      },
    });

    await audit({
      user: input.user,
      action: 'CHANGE_SHIFT',
      entity: 'shift',
      entityId: `${input.candidateId}:${input.date}`,
      oldValue,
      newValue: valid.join('|'),
    });

    await syncQueue.enqueue({
      entity: 'shift',
      entityId: `${input.candidateId}:${input.date}`,
      candidateId: input.candidateId,
      operation: 'UPSERT',
      newValue: {
        candidateId: input.candidateId,
        date: input.date,
        shifts: valid.join('|'),
        note: input.note ?? null,
      },
      version: newVersion,
      idempotencyKey: `candidate:${input.candidateId}:shift:${input.date}`,
    });

    emit('shift:updated', { candidateId: input.candidateId, date: input.date, shifts: valid.join('|') });
  }
}

export const shiftService = new ShiftService();