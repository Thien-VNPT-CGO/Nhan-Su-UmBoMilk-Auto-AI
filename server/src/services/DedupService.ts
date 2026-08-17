import { prisma } from '../lib/prisma';
import { syncQueue } from './SyncQueueService';
import { audit } from './AuditService';
import { getGoogleSheetService } from './GoogleSheetService';
import { getSettings, saveSettings } from './SettingsService';
import { normalizePhone } from './CandidateService';

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
async function deleteCandidateWithCleanup(id: string, user: string): Promise<void> {
  const candidate = await prisma.candidate.findUnique({ where: { id } });
  if (!candidate) return;
  try {
    const cleared = await getGoogleSheetService().clearFormResponseRows(candidate.sdtZalo, candidate.thoiGian);
    if (cleared > 0) console.log(`[DEDUP] Đã xóa ${cleared} dòng phản hồi form của ${candidate.id}`);
  } catch (e) {
    console.warn('[DEDUP] clearFormResponseRows:', e instanceof Error ? e.message : String(e));
  }
  try {
    const settings = await getSettings();
    const tomb = Array.isArray((settings as Record<string, unknown>).deletedFormResponses)
      ? ((settings as Record<string, unknown>).deletedFormResponses as { sdt: string; thoiGian: string | null }[])
      : [];
    const entry = { sdt: normalizePhone(candidate.sdtZalo), thoiGian: candidate.thoiGian?.toISOString() ?? null };
    if (!tomb.some((t) => t.sdt === entry.sdt && t.thoiGian === entry.thoiGian)) {
      tomb.unshift(entry);
      await saveSettings({ deletedFormResponses: tomb.slice(0, 500) }, user);
    }
  } catch (e) {
    console.warn('[DEDUP] tombstone:', e instanceof Error ? e.message : String(e));
  }
  await syncQueue.enqueue({
    entity: 'candidate',
    entityId: id,
    operation: 'DELETE',
    version: candidate.dataVersion + 1,
    idempotencyKey: `candidate:${id}:delete:v1`,
  });
  await prisma.candidate.delete({ where: { id } });
  await audit({
    user,
    action: 'DELETE_CANDIDATE_DUP',
    entity: 'candidate',
    entityId: id,
    oldValue: { tenUv: candidate.tenUv, sdtZalo: candidate.sdtZalo },
    version: candidate.dataVersion,
  });
}

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
