import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { emit } from '../sockets';

export class ConflictService {
  async createConflict(input: {
    entityId: string;
    field: string;
    webValue: string;
    sheetValue: string;
    webVersion: number;
    sheetVersion?: number;
  }): Promise<void> {
    const existing = await prisma.conflict.findFirst({
      where: { entityId: input.entityId, field: input.field, status: 'OPEN' },
    });
    if (existing) {
      await prisma.conflict.update({
        where: { id: existing.id },
        data: { webValue: input.webValue, sheetValue: input.sheetValue, webVersion: input.webVersion, sheetVersion: input.sheetVersion },
      });
    } else {
      await prisma.conflict.create({
        data: {
          id: nextId('CFL'),
          entity: 'candidate',
          entityId: input.entityId,
          field: input.field,
          webValue: input.webValue,
          sheetValue: input.sheetValue,
          webVersion: input.webVersion,
          sheetVersion: input.sheetVersion,
        },
      });
    }
    emit('sync:conflict', { entityId: input.entityId, field: input.field });
  }

  async listOpen(): Promise<unknown[]> {
    return prisma.conflict.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
  }

  async resolve(input: { conflictId: string; keep: 'WEB' | 'SHEET'; resolvedBy: string }): Promise<void> {
    const conflict = await prisma.conflict.findUnique({ where: { id: input.conflictId } });
    if (!conflict) throw new Error('Conflict không tồn tại');

    if (input.keep === 'SHEET') {
      // Admin chooses sheet value -> update web record, version stays aligned to sheet
      const candidate = await prisma.candidate.findUnique({ where: { id: conflict.entityId } });
      if (candidate && CANDIDATE_FIELDS.has(conflict.field)) {
        await prisma.candidate.update({
          where: { id: candidate.id },
          data: {
            [conflict.field]: conflict.sheetValue,
            dataVersion: conflict.sheetVersion ?? candidate.dataVersion,
            updatedBy: input.resolvedBy,
          },
        });
      }
      // field ngoài whitelist (vd GOOGLE_SHEET_EDIT): chỉ đóng conflict, dữ liệu Web giữ nguyên
    }
    // keep WEB -> nothing to write back, just close

    await prisma.conflict.update({
      where: { id: conflict.id },
      data: { status: input.keep === 'WEB' ? 'RESOLVED_WEB' : 'RESOLVED_SHEET', resolvedBy: input.resolvedBy, resolvedAt: new Date() },
    });
    emit('candidate:updated', { candidateId: conflict.entityId });
  }
}

const CANDIDATE_FIELDS = new Set([
  'tenUv', 'namSinh', 'trinhDo', 'queQuan', 'sdtZalo', 'caLam', 'chiNhanh',
  'kinhNghiem', 'xuLy', 'linkFb', 'htChuHo', 'sdtChuHo', 'moTaNha', 'ghiChu',
  'trangThaiTraining', 'ngayBatDauTraining', 'soNgayDaTraining', 'hoTroKhoKhan', 'ngayNhanViec',
]);

export const conflictService = new ConflictService();
