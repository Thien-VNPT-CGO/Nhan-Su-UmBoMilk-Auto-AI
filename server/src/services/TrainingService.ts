import { prisma } from '../lib/prisma';
import { dateKey, addDays } from '../lib/date';
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

    const days = new Set(c.attendanceEvents.map((a) => a.date));
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
      }
    }
  }

  async list() {
    const rows = await prisma.candidate.findMany({
      where: { trangThaiTraining: { not: TRAINING_STATUS.NHAN_VIEN_CHINH_THUC } },
      include: {
        attendanceEvents: { where: { valid: true }, select: { date: true } },
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
        soNgayDaTraining: new Set(c.attendanceEvents.map((a) => a.date)).size,
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
      data: { trangThaiTraining: TRAINING_STATUS.NHAN_VIEN_CHINH_THUC, dataVersion: newVersion, updatedBy: user },
    });
    await audit({
      user,
      action: 'CONFIRM_EMPLOYEE',
      entity: 'candidate',
      entityId: candidateId,
      oldValue: c.trangThaiTraining,
      newValue: TRAINING_STATUS.NHAN_VIEN_CHINH_THUC,
      version: newVersion,
    });
    await syncQueue.enqueue({
      entity: 'candidate',
      entityId: candidateId,
      operation: 'UPDATE',
      field: 'TRANG_THAI_TRAINING',
      oldValue: c.trangThaiTraining,
      newValue: TRAINING_STATUS.NHAN_VIEN_CHINH_THUC,
      version: newVersion,
      idempotencyKey: `candidate:${candidateId}:employee:v${newVersion}`,
    });
    emit('training:updated', { candidateId });
  }

  async setStartDate(candidateId: string, ngayBatDau: Date, user: string): Promise<void> {
    const c = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!c) throw new Error('Không tìm thấy ứng viên');
    await prisma.candidate.update({
      where: { id: candidateId },
      data: { ngayBatDauTraining: ngayBatDau, trangThaiTraining: TRAINING_STATUS.SAP_BAT_DAU, updatedBy: user },
    });
    await this.refreshTrainingStatus(candidateId);
  }

  /** Tự cập nhật trạng thái training hàng loạt: 2 query tổng thay vì N+1 query/candidate.
   *  Chạy mỗi 5 phút (trước là mỗi 60s, mỗi lần N query DB -> web ì khi có nhiều nhân sự). */
  async refreshAll(): Promise<number> {
    const candidates = await prisma.candidate.findMany({
      where: {
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
      select: { candidateId: true, date: true },
    });
    const daysByCandidate = new Map<string, Set<string>>();
    for (const a of attended) {
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