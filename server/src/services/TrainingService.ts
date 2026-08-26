import { prisma } from '../lib/prisma';
import { dateKey, addDays } from '../lib/date';
import { nextId } from '../lib/id';
import { audit } from './AuditService';
import { syncQueue } from './SyncQueueService';
import { emit } from '../sockets';
import { TRAINING_STATUS, TRAINING_DAYS_REQUIRED, TRAINING_DEADLINE_DAYS } from '../lib/constants';

export class TrainingService {
  async refreshTrainingStatus(candidateId: string): Promise<void> {
    const c = await prisma.candidate.findUnique({
      where: { id: candidateId },
      include: { attendanceEvents: { where: { valid: true } } },
    });
    if (!c) return;

    const completedEvents = c.attendanceEvents.filter(
      (a) => a.checkoutAt != null || a.reason?.includes('CHECK_OUT') || a.method === 'MANUAL' || a.method === 'SYSTEM'
    );
    const days = new Set(completedEvents.map((a) => a.date));
    const soNgay = days.size;
    const today = dateKey();

    let status = c.trangThaiTraining;
    if (c.ngayBatDauTraining) {
      const startKey = dateKey(c.ngayBatDauTraining);
      const deadlineKey = dateKey(addDays(c.ngayBatDauTraining, TRAINING_DEADLINE_DAYS));
      if (soNgay >= TRAINING_DAYS_REQUIRED) {
        status = TRAINING_STATUS.HOAN_THANH;
      } else if (today >= startKey && today < deadlineKey) {
        status = TRAINING_STATUS.BAT_DAU;
      } else if (today < startKey) {
        status = TRAINING_STATUS.SAP_BAT_DAU;
      } else if (today >= deadlineKey) {
        status = TRAINING_STATUS.KHONG_DU_NGAY;
      }
    } else if (!status) {
      status = TRAINING_STATUS.CHUA_THAM_GIA;
    }
    if (c.trangThaiTraining === TRAINING_STATUS.LOAI) status = TRAINING_STATUS.LOAI;
    if (c.trangThaiTraining === TRAINING_STATUS.NHAN_VIEN_CHINH_THUC) status = TRAINING_STATUS.NHAN_VIEN_CHINH_THUC;

    if (status !== c.trangThaiTraining || soNgay !== c.soNgayDaTraining) {
      await prisma.candidate.update({
        where: { id: candidateId },
        data: { trangThaiTraining: status, soNgayDaTraining: soNgay },
      });

      // RÀNG BUỘC REALTIME: Tự động XÓA TÀI KHOẢN WEB APP nếu quá 12 ngày thử việc mà chưa đủ 7 ca (KHONG_DU_NGAY) hoặc bị LOẠI
      if (status === TRAINING_STATUS.KHONG_DU_NGAY || status === TRAINING_STATUS.LOAI) {
        await prisma.user.deleteMany({
          where: {
            OR: [
              { username: c.sdtZalo },
              { username: c.id },
            ],
          },
        }).catch((e) => console.warn('[TrainingService] delete user error:', e));
      }

      // Đồng bộ trạng thái/ngày đã training xuống HO_SO_NV (chỉ khi có lịch training)
      if (c.ngayBatDauTraining) {
        await syncQueue.enqueue({
          entity: 'training',
          entityId: candidateId,
          operation: 'UPSERT',
          version: c.dataVersion,
          idempotencyKey: `candidate:${candidateId}:training-status:v${c.dataVersion}:${status}`,
        });
        emit('training:updated', { candidateId });
        emit('candidate:updated', { candidateId });
        emit('shift:updated', { candidateId });
      }
    }
  }

  async autoPassCompletedInterviews(): Promise<number> {
    const now = new Date();
    const unclosed = await prisma.candidate.findMany({
      where: {
        phongVanAt: { not: null },
        hrDecision: null,
        trangThaiTraining: { not: TRAINING_STATUS.NHAN_VIEN_CHINH_THUC },
      },
    });

    let count = 0;
    for (const c of unclosed) {
      if (!c.phongVanAt) continue;
      const pvEndTime = new Date(c.phongVanAt).getTime() + 30 * 60 * 1000;
      if (now.getTime() >= pvEndTime) {
        const newVersion = c.dataVersion + 1;
        await prisma.candidate.update({
          where: { id: c.id },
          data: {
            hrDecision: 'PASS_PV',
            hrReason: 'AI tự động chốt HOÀN THÀNH PV khi kết thúc giờ phỏng vấn',
            interviewStatus: 'QUA_PV',
            dataVersion: newVersion,
            updatedBy: 'AI-SYSTEM',
          },
        });
        await audit({
          user: 'AI-SYSTEM',
          action: 'AUTO_PASS_INTERVIEW',
          entity: 'candidate',
          entityId: c.id,
          oldValue: c.hrDecision ?? 'CHUA_CHOT',
          newValue: 'PASS_PV',
          version: newVersion,
        });
        emit('candidate:decision', { candidateId: c.id, hrDecision: 'PASS_PV' });
        emit('training:updated', { candidateId: c.id });
        count++;
      }
    }
    return count;
  }

  async list() {
    await this.autoPassCompletedInterviews();
    const rows = await prisma.candidate.findMany({
      where: { trangThaiTraining: { not: TRAINING_STATUS.NHAN_VIEN_CHINH_THUC } },
      include: {
        attendanceEvents: { where: { valid: true }, select: { date: true, checkoutAt: true, reason: true, method: true } },
      },
      orderBy: [{ ngayBatDauTraining: 'asc' }, { thoiGian: 'desc' }],
    });
    const now = new Date();
    return rows.map((c) => {
      const isFutureInterview = c.phongVanAt && new Date(c.phongVanAt) > now;
      const isRealGraded = c.hrDecision === 'PASS_PV' || c.hrDecision === 'PASS_HS' || c.hrDecision === 'FAIL';
      const effectiveHrDecision = isRealGraded ? c.hrDecision : null;
      const effectiveInterviewStatus = (isFutureInterview && c.hrDecision !== 'PASS_HS') ? 'CHUA_PV' : c.interviewStatus;
      return {
        id: c.id,
        tenUv: c.tenUv,
        chiNhanh: c.chiNhanh,
        caLam: c.caLam,
        sdtZalo: c.sdtZalo,
        kinhNghiem: c.kinhNghiem,
        ngayBatDauTraining: c.ngayBatDauTraining,
        trangThaiTraining: c.trangThaiTraining,
        soNgayDaTraining: new Set(
          c.attendanceEvents
            .filter((a) => a.checkoutAt != null || a.reason?.includes('CHECK_OUT') || a.method === 'MANUAL' || a.method === 'SYSTEM')
            .map((a) => a.date)
        ).size,
        phongVanAt: c.phongVanAt,
        ggMeetLink: c.ggMeetLink,
        interviewStatus: effectiveInterviewStatus,
        hrDecision: effectiveHrDecision,
        hrReason: c.hrReason,
        dataVersion: c.dataVersion,
        ngayHomNay: dateKey(),
      };
    });
  }

  async confirmAsEmployee(candidateId: string, user: string): Promise<void> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    if (c.hrDecision !== 'PASS') throw new Error('Ứng viên chưa được duyệt PASS');

    const newVersion = c.dataVersion + 1;
    await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        trangThaiTraining: TRAINING_STATUS.NHAN_VIEN_CHINH_THUC,
        dataVersion: newVersion,
        updatedBy: user,
      },
    });

    await audit({
      user,
      action: 'CONFIRM_AS_EMPLOYEE',
      entity: 'candidate',
      entityId: candidateId,
      oldValue: c.trangThaiTraining ?? 'KHAC',
      newValue: TRAINING_STATUS.NHAN_VIEN_CHINH_THUC,
      version: newVersion,
    });

    await syncQueue.enqueue({
      entity: 'training',
      entityId: candidateId,
      operation: 'UPSERT',
      field: 'CONFIRM_EMPLOYEE',
      newValue: { trangThaiTraining: TRAINING_STATUS.NHAN_VIEN_CHINH_THUC },
      version: newVersion,
      idempotencyKey: `candidate:${candidateId}:confirm-employee:v${newVersion}`,
    });

    emit('candidate:decision', { candidateId, hrDecision: c.hrDecision });
    emit('training:updated', { candidateId });
  }

  async setStartDate(candidateId: string, ngayBatDau: Date, user: string): Promise<void> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');

    await prisma.candidate.update({
      where: { id: candidateId },
      data: { ngayBatDauTraining: ngayBatDau, trangThaiTraining: TRAINING_STATUS.SAP_BAT_DAU, updatedBy: user },
    });

    // AI THUẬT TOÁN TỰ ĐỘNG PHÂN BỔ 7 NGÀY TRAINING KHÔNG TRÙNG CA CÙNG CHI NHÁNH CÙNG NGÀY:
    if (c.chiNhanh) {
      const normCa = (c.caLam || '').toLowerCase();
      let shiftCode = 'SANG';
      if (normCa.includes('chieu') || normCa.includes('12h')) shiftCode = 'CHIEU';
      else if (normCa.includes('toi') || normCa.includes('18h')) shiftCode = 'TOI';

      const sameBranchCandidates = await prisma.candidate.findMany({
        where: {
          chiNhanh: c.chiNhanh,
          id: { not: c.id },
          trangThaiTraining: { notIn: ['LOAI', 'NHAN_VIEN_CHINH_THUC'] },
        },
        select: { id: true, caLam: true },
      });

      const otherIds = sameBranchCandidates.map((x) => x.id);
      let otherShiftsMap = new Map<string, Set<string>>();
      if (otherIds.length > 0) {
        const otherShifts = await prisma.shift.findMany({
          where: { candidateId: { in: otherIds } },
        });
        otherShifts.forEach((s) => {
          if (!otherShiftsMap.has(s.date)) otherShiftsMap.set(s.date, new Set());
          const arr = s.shifts.split('|').map((x) => x.trim().toUpperCase());
          arr.forEach((code) => {
            if (code !== 'OFF') otherShiftsMap.get(s.date)!.add(code);
          });
        });
      }

      let assignedDays = 0;
      let curr = new Date(ngayBatDau);
      const maxAttempts = 30;
      let attempts = 0;

      while (assignedDays < 7 && attempts < maxAttempts) {
        attempts++;
        const dStr = dateKey(curr);
        const activeShiftsOnDate = otherShiftsMap.get(dStr);
        const hasCollision = activeShiftsOnDate?.has(shiftCode);

        if (hasCollision) {
          // Trùng ca tại chi nhánh trên cùng ngày -> AI tự động phân bổ OFF
          await prisma.shift.upsert({
            where: { candidateId_date: { candidateId: c.id, date: dStr } },
            create: { id: nextId('SFT'), candidateId: c.id, date: dStr, shifts: 'OFF' },
            update: { shifts: 'OFF' },
          });
        } else {
          // Không trùng ca -> AI phân bổ ca làm chính thức & Tăng đếm ngày
          await prisma.shift.upsert({
            where: { candidateId_date: { candidateId: c.id, date: dStr } },
            create: { id: nextId('SFT'), candidateId: c.id, date: dStr, shifts: shiftCode },
            update: { shifts: shiftCode },
          });
          assignedDays++;
        }
        curr.setDate(curr.getDate() + 1);
      }
    }

    await this.refreshTrainingStatus(candidateId);
  }

  /**
   * AI Thuật toán Tự Động Phân Bổ & Sắp Lịch Xoay Vòng Xen Kẽ Chống Trùng Ca (Round-Robin Staggering Engine)
   * Tự động bù ca cho nhân sự khác khi HR chỉnh OFF, đảm bảo mỗi nhân sự Training luôn có ĐỦ 7 NGÀY ĐI LÀM.
   */
  async autoStaggerTrainingShifts(): Promise<void> {
    const candidates = await prisma.candidate.findMany({
      where: {
        ngayBatDauTraining: { not: null },
        trangThaiTraining: { notIn: ['LOAI', 'NHAN_VIEN_CHINH_THUC'] },
      },
      orderBy: { ngayBatDauTraining: 'asc' },
    });

    if (candidates.length === 0) return;

    // Fetch existing manual shifts (e.g. note or manual edits)
    const candidateIds = candidates.map((c) => c.id);
    const existingShifts = await prisma.shift.findMany({
      where: { candidateId: { in: candidateIds } },
    });

    const shiftMap = new Map<string, Map<string, typeof existingShifts[number]>>();
    existingShifts.forEach((s) => {
      if (!shiftMap.has(s.candidateId)) shiftMap.set(s.candidateId, new Map());
      shiftMap.get(s.candidateId)!.set(s.date, s);
    });

    // Group candidates by branch
    const byBranch = new Map<string, typeof candidates>();
    candidates.forEach((c) => {
      const bKey = c.chiNhanh?.trim() || 'DEFAULT';
      if (!byBranch.has(bKey)) byBranch.set(bKey, []);
      byBranch.get(bKey)!.push(c);
    });

    for (const [, candList] of byBranch.entries()) {
      // Group candidates by shiftCode (e.g. SANG, CHIEU, TOI)
      const byShift = new Map<string, typeof candidates>();
      candList.forEach((c) => {
        const normCa = (c.caLam || '').toLowerCase();
        let code = 'SANG';
        if (normCa.includes('chieu') || normCa.includes('12h')) code = 'CHIEU';
        else if (normCa.includes('toi') || normCa.includes('18h')) code = 'TOI';
        if (!byShift.has(code)) byShift.set(code, []);
        byShift.get(code)!.push(c);
      });

      for (const [shiftCode, shiftGroup] of byShift.entries()) {
        if (shiftGroup.length === 0) continue;

        // If only 1 candidate in this branch & shift -> schedule 7 consecutive working days from ngayBatDauTraining
        if (shiftGroup.length === 1) {
          const c = shiftGroup[0];
          if (!c.ngayBatDauTraining) continue;

          let assignedDays = 0;
          let curr = new Date(c.ngayBatDauTraining);
          let attempts = 0;

          while (assignedDays < 7 && attempts < 30) {
            attempts++;
            const dStr = dateKey(curr);
            const userShift = shiftMap.get(c.id)?.get(dStr);

            if (userShift) {
              if (userShift.shifts !== 'OFF') {
                assignedDays++;
              }
            } else {
              await prisma.shift.create({
                data: { id: nextId('SFT'), candidateId: c.id, date: dStr, shifts: shiftCode },
              }).catch(() => undefined);
              assignedDays++;
            }
            curr.setDate(curr.getDate() + 1);
          }
          continue;
        }

        // If 2 or more candidates share the SAME branch & SAME shift -> DATE-BY-DATE ROUND-ROBIN ALTERNATING STAGGERING!
        const cState = shiftGroup.map((c) => ({
          candidate: c,
          assignedDays: 0,
          startKey: dateKey(c.ngayBatDauTraining!),
          startDate: new Date(c.ngayBatDauTraining!),
        }));

        let minStart = new Date(cState[0].startDate);
        cState.forEach((cs) => {
          if (cs.startDate < minStart) minStart = new Date(cs.startDate);
        });

        let curr = new Date(minStart);
        let attempts = 0;

        while (cState.some((cs) => cs.assignedDays < 7) && attempts < 60) {
          attempts++;
          const dStr = dateKey(curr);

          const activeCandidates = cState.filter(
            (cs) => dStr >= cs.startKey && cs.assignedDays < 7
          );

          if (activeCandidates.length === 0) {
            curr.setDate(curr.getDate() + 1);
            continue;
          }

          // Sort active candidates by fewest assignedDays so far (round-robin priority)
          activeCandidates.sort((a, b) => a.assignedDays - b.assignedDays);
          const workingCS = activeCandidates[0];

          for (const cs of cState) {
            if (dStr < cs.startKey) continue;

            const userShift = shiftMap.get(cs.candidate.id)?.get(dStr);

            if (userShift) {
              // PRESERVE EXISTING SHIFT (HR edits or previously generated shift)
              if (userShift.shifts !== 'OFF') {
                cs.assignedDays++;
              }
              continue;
            }

            if (cs.candidate.id === workingCS.candidate.id) {
              await prisma.shift.create({
                data: { id: nextId('SFT'), candidateId: cs.candidate.id, date: dStr, shifts: shiftCode },
              }).catch(() => undefined);
              cs.assignedDays++;
            } else if (cs.assignedDays < 7) {
              await prisma.shift.create({
                data: { id: nextId('SFT'), candidateId: cs.candidate.id, date: dStr, shifts: 'OFF' },
              }).catch(() => undefined);
            }
          }
          curr.setDate(curr.getDate() + 1);
        }
      }
    }

    await this.autoAllocateOfficialEmployeeShifts();
  }

  /**
   * AI Thuật toán Tự Động Phân Bổ Ca Cho Nhân Viên Chính Thức (3-4 ca/tuần, xoay vòng xen kẽ chống trùng ca).
   */
  async autoAllocateOfficialEmployeeShifts(startDateInput?: Date, daysAhead = 14): Promise<void> {
    const employees = await prisma.candidate.findMany({
      where: { trangThaiTraining: 'NHAN_VIEN_CHINH_THUC' },
      orderBy: { tenUv: 'asc' },
    });

    if (employees.length === 0) return;

    const empIds = employees.map((e) => e.id);
    const existingShifts = await prisma.shift.findMany({
      where: { candidateId: { in: empIds } },
    });

    const shiftMap = new Map<string, Map<string, typeof existingShifts[number]>>();
    existingShifts.forEach((s) => {
      if (!shiftMap.has(s.candidateId)) shiftMap.set(s.candidateId, new Map());
      shiftMap.get(s.candidateId)!.set(s.date, s);
    });

    const baseDate = startDateInput ? new Date(startDateInput) : new Date();

    // Phân nhóm nhân viên theo Chi nhánh
    const byBranch = new Map<string, typeof employees>();
    employees.forEach((e) => {
      const bKey = e.chiNhanh?.trim() || 'DEFAULT';
      if (!byBranch.has(bKey)) byBranch.set(bKey, []);
      byBranch.get(bKey)!.push(e);
    });

    for (const [, branchEmps] of byBranch.entries()) {
      // Phân nhóm nhân viên theo ca làm ưu tiên (SÁNG, CHIỀU, TỐI)
      const byShift = new Map<string, typeof employees>();
      branchEmps.forEach((e) => {
        const normCa = (e.caLam || '').toLowerCase();
        let code = 'SANG';
        if (normCa.includes('chieu') || normCa.includes('12h')) code = 'CHIEU';
        else if (normCa.includes('toi') || normCa.includes('18h')) code = 'TOI';
        if (!byShift.has(code)) byShift.set(code, []);
        byShift.get(code)!.push(e);
      });

      for (const [shiftCode, shiftGroup] of byShift.entries()) {
        if (shiftGroup.length === 0) continue;

        // Phân bổ 3-4 ca làm việc mỗi tuần với offset xoay vòng xen kẽ (1 ngày ON - 1 ngày OFF)
        for (let i = 0; i < shiftGroup.length; i++) {
          const emp = shiftGroup[i];
          let curr = new Date(baseDate);
          for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
            const dStr = dateKey(curr);
            const userShift = shiftMap.get(emp.id)?.get(dStr);

            if (!userShift) {
              const isWorkingDay = (dayOffset + i) % 2 === 0;
              const assignedShift = isWorkingDay ? shiftCode : 'OFF';

              await prisma.shift.create({
                data: { id: nextId('SFT'), candidateId: emp.id, date: dStr, shifts: assignedShift },
              }).catch(() => undefined);
            }
            curr.setDate(curr.getDate() + 1);
          }
        }
      }
    }
  }

  /**
   * Quét và cập nhật trạng thái training cho tất cả nhân sự.
   * Dùng 2 batch query thay vì N queries.
   */
  async refreshAll(): Promise<number> {
    const candidates = await prisma.candidate.findMany({
      where: {
        hrDecision: 'PASS',
        ngayBatDauTraining: { not: null },
        trangThaiTraining: { notIn: [TRAINING_STATUS.LOAI, TRAINING_STATUS.NHAN_VIEN_CHINH_THUC] },
      },
      select: {
        id: true,
        ngayBatDauTraining: true,
        trangThaiTraining: true,
        soNgayDaTraining: true,
        dataVersion: true,
      },
    });
    if (candidates.length === 0) return 0;

    const attended = await prisma.attendanceEvent.findMany({
      where: { candidateId: { in: candidates.map((c) => c.id) }, valid: true },
      select: { candidateId: true, date: true, checkoutAt: true, reason: true, method: true },
    });
    const daysByCandidate = new Map<string, Set<string>>();
    for (const a of attended) {
      if (a.checkoutAt == null && !a.reason?.includes('CHECK_OUT') && a.method !== 'MANUAL' && a.method !== 'SYSTEM') {
        continue; // Chỉ tính những ca/ngày đã hoàn thành cả Check-in và Check-out
      }
      let set = daysByCandidate.get(a.candidateId);
      if (!set) {
        set = new Set();
        daysByCandidate.set(a.candidateId, set);
      }
      set.add(a.date);
    }

    const today = dateKey();
    let changed = 0;
    for (const c of candidates) {
      if (!c.ngayBatDauTraining) continue;
      const soNgay = daysByCandidate.get(c.id)?.size ?? 0;
      const startKey = dateKey(c.ngayBatDauTraining);
      const deadlineKey = dateKey(addDays(c.ngayBatDauTraining, TRAINING_DEADLINE_DAYS));
      let status = c.trangThaiTraining;
      if (soNgay >= TRAINING_DAYS_REQUIRED) {
        status = TRAINING_STATUS.HOAN_THANH;
      } else if (today >= startKey && today < deadlineKey) {
        status = TRAINING_STATUS.BAT_DAU;
      } else if (today < startKey) {
        status = TRAINING_STATUS.SAP_BAT_DAU;
      } else if (today >= deadlineKey) {
        status = TRAINING_STATUS.KHONG_DU_NGAY;
      }
      if (status === c.trangThaiTraining && soNgay === c.soNgayDaTraining) continue;

      await prisma.candidate.update({
        where: { id: c.id },
        data: { trangThaiTraining: status, soNgayDaTraining: soNgay },
      });
      await syncQueue.enqueue({
        entity: 'training',
        entityId: c.id,
        operation: 'UPSERT',
        version: c.dataVersion,
        idempotencyKey: `candidate:${c.id}:training-status:v${c.dataVersion}:${status}`,
      });
      emit('training:updated', { candidateId: c.id });
      changed++;
    }
    return changed;
  }
}

export const trainingService = new TrainingService();