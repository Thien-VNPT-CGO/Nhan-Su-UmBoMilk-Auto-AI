import { prisma } from '../lib/prisma';
import { deleteCandidateWithCleanup } from './CandidateService';

export interface DuplicateRow {
  id: string;
  tenUv: string;
  thoiGian: string;
  sdtZalo: string;
  chiNhanh: string;
}

export interface DuplicateGroup {
  sdtZalo: string;
  count: number;
  keep: DuplicateRow;
  remove: DuplicateRow[];
}

export interface DedupResult {
  groups: number;
  removed: number;
}

/** Tìm các nhóm ứng viên trùng số điện thoại (giữ bản đăng ký mới nhất). */
async function findDuplicateGroups(): Promise<DuplicateGroup[]> {
  const groups = await prisma.candidate.groupBy({
    by: ['sdtZalo'],
    _count: { _all: true },
    having: { sdtZalo: { _count: { gt: 1 } } },
  });
  if (groups.length === 0) return [];
  const rows = await prisma.candidate.findMany({
    where: { sdtZalo: { in: groups.map((g) => g.sdtZalo) } },
    orderBy: [{ thoiGian: 'desc' }, { id: 'desc' }],
  });
  const byPhone = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byPhone.get(r.sdtZalo) ?? [];
    arr.push(r);
    byPhone.set(r.sdtZalo, arr);
  }
  const result: DuplicateGroup[] = [];
  for (const g of groups) {
    const arr = byPhone.get(g.sdtZalo) ?? [];
    if (arr.length < 2) continue;
    const [keep, ...remove] = arr;
    result.push({
      sdtZalo: keep.sdtZalo,
      count: arr.length,
      keep: {
        id: keep.id,
        tenUv: keep.tenUv,
        thoiGian: keep.thoiGian.toISOString(),
        sdtZalo: keep.sdtZalo,
        chiNhanh: keep.chiNhanh,
      },
      remove: remove.map((r) => ({
        id: r.id,
        tenUv: r.tenUv,
        thoiGian: r.thoiGian.toISOString(),
        sdtZalo: r.sdtZalo,
        chiNhanh: r.chiNhanh,
      })),
    });
  }
  return result;
}

/** Xóa 1 ứng viên kèm đầy đủ dọn dẹp: dòng phản hồi form, tombstone, DELETE sync về Google Sheet. */
export class DedupService {
  async findDuplicates(): Promise<DuplicateGroup[]> {
    return findDuplicateGroups();
  }

  /** Giữ bản mới nhất theo từng SĐT, xóa các bản trùng còn lại và đồng bộ xóa về Google Sheet (cả 3 tab). */
  async removeDuplicates(user: string): Promise<DedupResult> {
    const groups = await findDuplicateGroups();
    let removed = 0;
    for (const g of groups) {
      for (const r of g.remove) {
        await deleteCandidateWithCleanup(r.id, user);
        removed++;
      }
    }
    return { groups: groups.length, removed };
  }
}

export const dedupService = new DedupService();
