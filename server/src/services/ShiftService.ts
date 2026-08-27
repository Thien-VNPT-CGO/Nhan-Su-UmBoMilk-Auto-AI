import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { audit } from './AuditService';
import { syncQueue } from './SyncQueueService';
import { emit } from '../sockets';
import { nextId } from '../lib/id';
import { dateKey, formatDateTime } from '../lib/date';
import { zaloPersonalService } from './ZaloPersonalService';

export const SHIFT_OPTIONS = ['SANG', 'CHIEU', 'TOI', 'OFF'] as const;

export function normalizeShiftCode(raw: string): string {
  if (!raw) return 'SANG';
  const str = String(raw).trim().toLowerCase();
  const norm = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

  if (norm.includes('sang') || norm.includes('7h')) return 'SANG';
  if (norm.includes('toi') || norm.includes('17h') || norm.includes('18h') || norm.includes('dem') || norm.includes('night')) return 'TOI';
  if (norm.includes('chieu') || norm.includes('12h30') || norm.includes('13h') || norm.includes('trua')) return 'CHIEU';
  if (norm.includes('off') || norm.includes('nghi')) return 'OFF';
  return 'SANG';
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

    if (candidate.trangThaiTraining === 'KHONG_DU_NGAY') {
      throw ApiError.badRequest(
        'TRAINING_EXPIRED_LOCKED',
        'Lịch làm việc đã bị KHÓA TỰ ĐỘNG do nhân sự vượt quá 12 ngày thử việc mà không hoàn thành đủ 7 ngày điểm danh! HR không thể thao tác.'
      );
    }

    const todayStr = dateKey(new Date());

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

    // TỰ ĐỘNG BÙ CA XOAY VÒNG CHỐNG TRÙNG REALTIME CHO TẤT CẢ NHÂN VIÊN (TRAINING & CHÍNH THỨC):
    if (candidate.chiNhanh) {
      const validTarget = valid[0] || 'OFF';
      const normCandCa = normalizeShiftCode(candidate.caLam || '');
      const isOfficial = candidate.trangThaiTraining === 'NHAN_VIEN_CHINH_THUC';

      if (validTarget === 'OFF') {
        // TẠO ĐỀ XUẤT BÙ CA ĐA TẦNG (Chính thức bù cho Chính thức, Training bù cho Training)
        void this.createOffReplacementProposal({
          candidateIdA: candidate.id,
          date: input.date,
          shiftCode: normCandCa !== 'OFF' ? normCandCa : 'SANG',
        }).catch((e) => console.error('[ShiftService] createOffReplacementProposal error:', e));
      }
    }

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

  // TÍNH NĂNG 1: TỰ ĐỘNG XẾP LỊCH HÀNG THÁNG CHO NHÂN VIÊN CHÍNH THỨC (RÀNG BUỘC TUYỆT ĐỐI THEO CHI NHÁNH & CA LÀM ĐĂNG KÝ, >= 12 NGÀY/THÁNG)
  async autoScheduleMonthly(params: { month: number; year: number; minDaysPerEmp?: number; user: string }) {
    const { month, year, minDaysPerEmp = 12, user } = params;
    const daysInMonth = new Date(year, month, 0).getDate();
    const padMonth = String(month).padStart(2, '0');

    const from = `${year}-${padMonth}-01`;
    const to = `${year}-${padMonth}-${String(daysInMonth).padStart(2, '0')}`;

    const officialCandidates = await prisma.candidate.findMany({
      where: { trangThaiTraining: 'NHAN_VIEN_CHINH_THUC' },
      orderBy: { tenUv: 'asc' },
    });

    if (!officialCandidates.length) {
      return { success: false, message: 'Không có nhân viên chính thức nào để xếp lịch.' };
    }

    // 1. Nhóm nhân viên theo CHI NHÁNH
    const byBranch = new Map<string, typeof officialCandidates>();
    officialCandidates.forEach((c) => {
      const br = c.chiNhanh?.trim() || 'KHAC';
      if (!byBranch.has(br)) byBranch.set(br, []);
      byBranch.get(br)!.push(c);
    });

    const allDates: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      allDates.push(`${year}-${padMonth}-${String(d).padStart(2, '0')}`);
    }

    let totalAssigned = 0;

    for (const [, candList] of byBranch.entries()) {
      // 2. Nhóm nhân viên trong cùng chi nhánh theo CA LÀM VIỆC ĐĂNG KÝ (SANG / CHIEU / TOI)
      const byShiftPref = new Map<string, typeof candList>();
      candList.forEach((cand) => {
        const normCode = normalizeShiftCode(cand.caLam || '');
        const prefCode = (normCode && normCode !== 'OFF' && SHIFT_OPTIONS.includes(normCode as never)) ? normCode : 'SANG';
        if (!byShiftPref.has(prefCode)) byShiftPref.set(prefCode, []);
        byShiftPref.get(prefCode)!.push(cand);
      });

      // Với từng nhóm ca làm trong chi nhánh (VD: nhóm Ca SÁNG tại CN3, nhóm Ca CHIỀU tại CN3...)
      for (const [prefShiftCode, empGroup] of byShiftPref.entries()) {
        const groupCount = empGroup.length;
        if (!groupCount) continue;

        // Tính số lượng nhân sự trực mỗi ngày cho nhóm ca này
        // VD: Với 2 nhân viên ca SÁNG (Vy và Ngọc), numSlotsPerDay = 1 -> Ngày 1 Vy đi làm Ngọc nghỉ, Ngày 2 Ngọc đi làm Vy nghỉ
        const numSlotsPerDay = Math.max(1, Math.ceil((groupCount * minDaysPerEmp) / daysInMonth));

        for (let dayIdx = 0; dayIdx < daysInMonth; dayIdx++) {
          const dStr = allDates[dayIdx];

          for (let empIdx = 0; empIdx < groupCount; empIdx++) {
            const cand = empGroup[empIdx];

            // Công thức xoay vòng đan xen chuẩn:
            // Đảm bảo trong cùng 1 ngày, các nhân viên cùng nhóm ca ở chi nhánh KHÔNG bị xếp trùng ca với nhau
            const slotPos = ((empIdx - dayIdx) % groupCount + groupCount) % groupCount;
            const isWorking = slotPos < numSlotsPerDay;
            const shiftVal = isWorking ? prefShiftCode : 'OFF';

            await prisma.shift.upsert({
              where: { candidateId_date: { candidateId: cand.id, date: dStr } },
              create: {
                id: nextId('SHF'),
                candidateId: cand.id,
                date: dStr,
                shifts: shiftVal,
                note: 'AI_MONTHLY_SCHEDULED',
                updatedBy: user,
              },
              update: {
                shifts: shiftVal,
                note: 'AI_MONTHLY_SCHEDULED',
                updatedBy: user,
              },
            });
            totalAssigned++;
          }
        }
      }
    }

    await audit({
      user,
      action: 'AUTO_SCHEDULE_MONTHLY',
      entity: 'shift',
      entityId: `${year}-${padMonth}`,
      newValue: JSON.stringify({ month, year, minDaysPerEmp, totalAssigned }),
    });

    emit('shift:updated', { date: from, month, year });
    return { success: true, count: officialCandidates.length, totalAssigned, month, year };
  }

  // TÍNH NĂNG 2: PHƯƠNG ÁN 1 - QUY TRÌNH XÁC NHẬN 2 BƯỚC ĐA TẦNG VÀ AI FALLBACK POOL
  async createOffReplacementProposal(params: { candidateIdA: string; date: string; shiftCode: string }) {
    const { candidateIdA, date, shiftCode } = params;
    const candA = await prisma.candidate.findUnique({ where: { id: candidateIdA } });
    if (!candA || !candA.chiNhanh) return null;

    const isOfficialA = candA.trangThaiTraining === 'NHAN_VIEN_CHINH_THUC';

    // RÀNG BUỘC PHÂN TÁCH LỊCH TUYỆT ĐỐI:
    // - Nhân viên Training CHỈ tìm người bù ca từ nhóm Nhân viên Training
    // - Nhân viên Chính thức CHỈ tìm người bù ca từ nhóm Nhân viên Chính thức
    const allActiveCandidates = await prisma.candidate.findMany({
      where: {
        id: { not: candA.id },
        trangThaiTraining: isOfficialA
          ? 'NHAN_VIEN_CHINH_THUC'
          : { in: ['BAT_DAU', 'SAP_BAT_DAU', 'CHUA_THAM_GIA'], notIn: ['NHAN_VIEN_CHINH_THUC', 'HOAN_THANH', 'LOAI', 'KHONG_DU_NGAY'] },
      },
    });

    if (!allActiveCandidates.length) return null;

    const shiftsOnDate = await prisma.shift.findMany({
      where: {
        candidateId: { in: allActiveCandidates.map((c) => c.id) },
        date,
      },
    });

    const shiftMap = new Map(shiftsOnDate.map((s) => [s.candidateId, s.shifts]));

    // Lọc các nhân viên RẢNH (OFF hoặc chưa có lịch) ngày hôm đó
    const availablePool = allActiveCandidates.filter((c) => {
      const s = shiftMap.get(c.id);
      return !s || s === 'OFF';
    });

    if (!availablePool.length) {
      const repId = nextId('REP');
      const record = await prisma.shiftOffReplacement.create({
        data: {
          id: repId,
          candidateIdA: candA.id,
          candidateNameA: candA.tenUv,
          chiNhanh: candA.chiNhanh,
          date,
          shiftCode,
          status: 'EXHAUSTED',
          fallbackPool: [],
          rejectedEmpIds: [],
        },
      });

      const notiBody = `⚠️ [CẢNH BÁO CHI NHÁNH ${candA.chiNhanh}] Ca ${shiftCode} ngày ${date} của NV ${candA.tenUv} không có nhân sự rảnh thay thế. HR cần can thiệp!`;
      const noti = await prisma.notification.create({
        data: {
          id: nextId('NOT'),
          role: 'HR',
          title: `🚨 THIẾU NHÂN SỰ BÙ CA - CN ${candA.chiNhanh}`,
          body: notiBody,
          type: 'ERROR',
        },
      });

      emit('notification:created', noti);
      emit('shift_replacement:updated', record);
      return record;
    }

    // ƯU TIÊN ĐA TẦNG:
    // Tầng 1: Cùng chi nhánh + Cùng ca làm
    // Tầng 2: Cùng chi nhánh + Khác ca làm
    // Tầng 3: Khác chi nhánh + Cùng ca làm
    // Tầng 4: Khác chi nhánh + Khác ca làm
    const normShiftCodeA = normalizeShiftCode(shiftCode);
    const sortedPool = [...availablePool].sort((a, b) => {
      const isSameBranchA = a.chiNhanh?.trim() === candA.chiNhanh?.trim() ? 1 : 0;
      const isSameBranchB = b.chiNhanh?.trim() === candA.chiNhanh?.trim() ? 1 : 0;

      const isSameShiftA = normalizeShiftCode(a.caLam || '') === normShiftCodeA ? 1 : 0;
      const isSameShiftB = normalizeShiftCode(b.caLam || '') === normShiftCodeA ? 1 : 0;

      const scoreA = isSameBranchA * 10 + isSameShiftA * 5;
      const scoreB = isSameBranchB * 10 + isSameShiftB * 5;

      return scoreB - scoreA;
    });

    const empB = sortedPool[0];
    const fallbackList = sortedPool.slice(1).map((c) => c.id);

    const repId = nextId('REP');
    const record = await prisma.shiftOffReplacement.create({
      data: {
        id: repId,
        candidateIdA: candA.id,
        candidateNameA: candA.tenUv,
        chiNhanh: candA.chiNhanh,
        date,
        shiftCode,
        replacementId: empB.id,
        replacementName: empB.tenUv,
        sdtB: empB.sdtZalo,
        fallbackPool: fallbackList,
        rejectedEmpIds: [],
        status: 'PENDING_CONFIRM',
        expiresAt: new Date(Date.now() + 4 * 3600 * 1000),
      },
    });

    const notiBody = `🐮 [ĐỀ XUẤT TRỰC THAY CA] Bạn được đề xuất trực thay NV ${candA.tenUv} ca ${shiftCode} ngày ${date} tại CN ${candA.chiNhanh}. Vui lòng bấm Xác Nhận hoặc Từ Chối.`;
    const noti = await prisma.notification.create({
      data: {
        id: nextId('NOT'),
        userId: empB.id,
        title: `⚡ YÊU CẦU TRỰC THAY CA - CN ${candA.chiNhanh}`,
        body: notiBody,
        type: 'INFO',
      },
    });

    emit('notification:created', noti);
    emit('shift_replacement:updated', record);

    if (empB.sdtZalo) {
      void zaloPersonalService.sendMessageByPhone(
        empB.sdtZalo,
        `🐮 [UMBO MILK] – YÊU CẦU XÁC NHẬN TRỰC THAY CA 📱\n\nChào ${empB.tenUv},\nBạn được AI tự động đề xuất trực thay NV ${candA.tenUv} ca ${shiftCode} ngày ${date} tại Chi nhánh ${candA.chiNhanh}.\nVui lòng đăng nhập Web App để ĐỒNG Ý hoặc TỪ CHỐI.`
      ).catch(() => null);
    }

    return record;
  }

  // PHẢN HỒI YÊU CẦU TRỰC THAY CA (ĐỒNG Ý HẶC TỪ CHỐI -> REALTIME EXPIRATION THÔNG BÁO HẾT HẠN TỚI CÁC NHÂN VIÊN KHÁC)
  async respondReplacement(params: { replacementId: string; action: 'ACCEPT' | 'REJECT'; reason?: string; user: string }) {
    const { replacementId, action, reason, user } = params;
    const record = await prisma.shiftOffReplacement.findUnique({ where: { id: replacementId } });
    if (!record) throw ApiError.notFound('REPLACEMENT_NOT_FOUND', 'Không tìm thấy yêu cầu trực thay ca.');

    if (record.status !== 'PENDING_CONFIRM') {
      throw ApiError.badRequest('INVALID_STATUS', `Đơn này hiện ở trạng thái ${record.status}, không thể thao tác.`);
    }

    if (action === 'ACCEPT') {
      const updated = await prisma.shiftOffReplacement.update({
        where: { id: replacementId },
        data: { status: 'ACCEPTED' },
      });

      if (record.replacementId) {
        await this.upsert({
          candidateId: record.replacementId,
          date: record.date,
          shifts: record.shiftCode,
          note: `AI_REPLACEMENT_ACCEPTED (Thay NV ${record.candidateNameA})`,
          user,
        });
      }

      emit('shift_replacement:updated', updated);
      // BẮN SOCKET REALTIME THÔNG BÁO HẾT HẠN CA TRỰC TỚI CÁC NHÂN VIÊN KHÁC 1-CLICK FIRST-COME FIRST-SERVED:
      emit('shift_replacement:expired', {
        replacementId: record.id,
        acceptedByName: record.replacementName || 'Đồng nghiệp',
        shiftCode: record.shiftCode,
        date: record.date,
        chiNhanh: record.chiNhanh,
      });

      const candA = await prisma.candidate.findUnique({ where: { id: record.candidateIdA } });
      if (candA?.sdtZalo) {
        void zaloPersonalService.sendMessageByPhone(
          candA.sdtZalo,
          `🐮 [UMBO MILK] – THÔNG BÁO CA THAY THẾ ✅\n\nNV ${record.replacementName} đã XÁC NHẬN trực thay ca ${record.shiftCode} ngày ${record.date} cho bạn tại CN ${record.chiNhanh}.`
        ).catch(() => null);
      }

      return updated;
    } else {
      const rejectedEmpIds = (record.rejectedEmpIds as string[]) || [];
      if (record.replacementId) rejectedEmpIds.push(record.replacementId);

      const fallbackPool = (record.fallbackPool as string[]) || [];

      if (!fallbackPool.length) {
        const updated = await prisma.shiftOffReplacement.update({
          where: { id: replacementId },
          data: {
            status: 'EXHAUSTED',
            rejectedEmpIds,
            rejectReason: reason || 'Nhân viên từ chối nhận ca.',
          },
        });

        const notiBody = `⚠️ [CẢNH BÁO CHI NHÁNH ${record.chiNhanh}] Ca ${record.shiftCode} ngày ${record.date} của NV ${record.candidateNameA} ĐÃ BỊ TẤT CẢ NV KHẢ DỤNG TỪ CHỐI (${record.replacementName} từ chối). Cần HR can thiệp!`;
        const noti = await prisma.notification.create({
          data: {
            id: nextId('NOT'),
            role: 'HR',
            title: `🚨 TẤT CẢ NV TỪ CHỐI BÙ CA - CN ${record.chiNhanh}`,
            body: notiBody,
            type: 'ERROR',
          },
        });

        emit('notification:created', noti);
        emit('shift_replacement:updated', updated);
        return updated;
      }

      const nextEmpId = fallbackPool[0];
      const nextFallbackPool = fallbackPool.slice(1);
      const empC = await prisma.candidate.findUnique({ where: { id: nextEmpId } });

      const updated = await prisma.shiftOffReplacement.update({
        where: { id: replacementId },
        data: {
          replacementId: nextEmpId,
          replacementName: empC?.tenUv || 'Nhân viên C',
          sdtB: empC?.sdtZalo || null,
          fallbackPool: nextFallbackPool,
          rejectedEmpIds,
          status: 'PENDING_CONFIRM',
          expiresAt: new Date(Date.now() + 4 * 3600 * 1000),
        },
      });

      if (empC) {
        const notiBody = `🐮 [ĐỀ XUẤT TRỰC THAY CA] Bạn được đề xuất trực thay NV ${record.candidateNameA} ca ${record.shiftCode} ngày ${record.date} tại CN ${record.chiNhanh}. Vui lòng bấm Xác Nhận hoặc Từ Chối.`;
        const noti = await prisma.notification.create({
          data: {
            id: nextId('NOT'),
            userId: empC.id,
            title: `⚡ YÊU CẦU TRỰC THAY CA - CN ${record.chiNhanh}`,
            body: notiBody,
            type: 'INFO',
          },
        });
        emit('notification:created', noti);

        if (empC.sdtZalo) {
          void zaloPersonalService.sendMessageByPhone(
            empC.sdtZalo,
            `🐮 [UMBO MILK] – YÊU CẦU XÁC NHẬN TRỰC THAY CA 📱\n\nChào ${empC.tenUv},\nBạn được AI tự động đề xuất trực thay NV ${record.candidateNameA} ca ${record.shiftCode} ngày ${record.date} tại Chi nhánh ${record.chiNhanh}.\nVui lòng đăng nhập Web App để ĐỒNG Ý hoặc TỪ CHỐI.`
          ).catch(() => null);
        }
      }

      emit('shift_replacement:updated', updated);
      return updated;
    }
  }

  // TRA CỨU DANH SÁCH YÊU CẦU TRỰC THAY CA FOR HR DASHBOARD / EMPLOYEE
  async listOffReplacements(params: { status?: string; branch?: string; candidateId?: string }) {
    const where: any = {};
    if (params.status && params.status !== 'ALL') where.status = params.status;
    if (params.branch) where.chiNhanh = params.branch;
    if (params.candidateId) {
      where.OR = [{ candidateIdA: params.candidateId }, { replacementId: params.candidateId }];
    }

    return prisma.shiftOffReplacement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

export const shiftService = new ShiftService();