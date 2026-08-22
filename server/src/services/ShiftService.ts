import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { audit } from './AuditService';
import { syncQueue } from './SyncQueueService';
import { emit } from '../sockets';
import { nextId } from '../lib/id';
import { dateKey } from '../lib/date';

export const SHIFT_OPTIONS = ['SANG', 'CHIEU', 'TOI', 'OFF'] as const;

export class ShiftService {
  async listForDates(from: string, to: string) {
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
    const shifts = await prisma.shift.findMany({
      where: { date: { gte: from, lte: to } },
    });
    const byCandidate = new Map<string, Map<string, typeof shifts[number]>>();
    shifts.forEach((s) => {
      if (!byCandidate.has(s.candidateId)) byCandidate.set(s.candidateId, new Map());
      byCandidate.get(s.candidateId)!.set(s.date, s);
    });
    const mapRow = (c: { id: string; tenUv: string; sdtZalo: string; chiNhanh: string; caLam: string }) => {
      const shifts: Record<string, { shifts: string }> = {};
      byCandidate.get(c.id)?.forEach((s) => {
        shifts[s.date] = { shifts: s.shifts };
      });
      return {
        candidateId: c.id,
        tenUv: c.tenUv,
        sdtZalo: c.sdtZalo,
        chiNhanh: c.chiNhanh,
        caLam: c.caLam,
        shifts,
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

    const valid = input.shifts.split('|').filter(Boolean);
    if (!valid.length || valid.some((s) => !SHIFT_OPTIONS.includes(s as never))) {
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

    await audit({
      user: input.user,
      action: 'CHANGE_SHIFT',
      entity: 'shift',
      entityId: `${input.candidateId}:${input.date}`,
      oldValue,
      newValue: valid.join('|'),
      version: newVersion,
    });

    await syncQueue.enqueue({
      entity: 'training',
      entityId: input.candidateId,
      operation: 'UPDATE',
      field: 'SHIFT',
      oldValue,
      newValue: valid.join('|'),
      version: newVersion,
      idempotencyKey: `candidate:${input.candidateId}:shift:${input.date}:v${newVersion}`,
    });

    emit('shift:updated', { candidateId: input.candidateId, date: input.date, shifts: valid.join('|') });
  }
}

export const shiftService = new ShiftService();