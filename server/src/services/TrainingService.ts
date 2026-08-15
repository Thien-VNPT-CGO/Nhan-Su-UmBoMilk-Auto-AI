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
    }
  }

  async list() {
    const rows = await prisma.candidate.findMany({
      where: { hrDecision: 'PASS', trangThaiTraining: { not: TRAINING_STATUS.NHAN_VIEN_CHINH_THUC } },
      include: {
        attendanceEvents: { where: { valid: true }, select: { date: true } },
      },
      orderBy: [{ ngayBatDauTraining: 'asc' }, { thoiGian: 'desc' }],
    });
    return rows.map((c) => ({
      id: c.id,
      tenUv: c.tenUv,
      chiNhanh: c.chiNhanh,
      caLam: c.caLam,
      sdtZalo: c.sdtZalo,
      ngayBatDauTraining: c.ngayBatDauTraining,
      trangThaiTraining: c.trangThaiTraining,
      soNgayDaTraining: new Set(c.attendanceEvents.map((a) => a.date)).size,
      dataVersion: c.dataVersion,
      ngayHomNay: dateKey(),
    }));
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

  async refreshAll(): Promise<number> {
    const candidates = await prisma.candidate.findMany({
      where: { ngayBatDauTraining: { not: null } },
      select: { id: true },
    });
    for (const c of candidates) {
      await this.refreshTrainingStatus(c.id);
    }
    return candidates.length;
  }
}

export const trainingService = new TrainingService();