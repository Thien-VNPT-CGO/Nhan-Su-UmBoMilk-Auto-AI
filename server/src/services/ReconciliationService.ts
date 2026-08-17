import { prisma } from '../lib/prisma';
import { getGoogleSheetService, candidateDataHash, LOC_HO_SO_COLS } from './GoogleSheetService';
import { nextId } from '../lib/id';
import { env } from '../config/env';

const COMPARE_FIELDS: (keyof CandidateBusiness)[] = [
  'tenUv', 'namSinh', 'trinhDo', 'queQuan', 'sdtZalo', 'caLam', 'chiNhanh', 'kinhNghiem', 'xuLy', 'linkFb',
];

interface CandidateBusiness {
  tenUv: string;
  namSinh: string;
  trinhDo: string;
  queQuan: string;
  sdtZalo: string;
  caLam: string;
  chiNhanh: string;
  kinhNghiem: string;
  xuLy: string;
  linkFb: string;
}

export class ReconciliationService {
  private timer: NodeJS.Timeout | null = null;

  start(intervalMs = 5 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.run(), intervalMs);
    void this.run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    const sheet = getGoogleSheetService();
    if (!sheet.configured) return;

    const runId = nextId('REC');
    const run = await prisma.reconciliationRun.create({
      data: { id: runId, status: 'RUNNING' },
    });

    let checked = 0;
    let mismatches = 0;
    let repaired = 0;
    let conflicts = 0;

    try {
      const rows = await sheet.readRows(env.sheetNameLocHoSo);
      const header = rows[0] ?? [];
      const col = (name: string) => header.indexOf(name);
      const idCol = col('CANDIDATE_ID');
      const hashCol = col('DATA_HASH');
      const versionCol = col('DATA_VERSION');

      // Nạp TẤT CẢ ứng viên 1 lần (thay vì 1 query/dòng) - giảm hàng trăm truy vấn DB mỗi chu kỳ
      const all = await prisma.candidate.findMany({
        select: {
          id: true,
          tenUv: true, gioiTinh: true, namSinh: true, trinhDo: true, queQuan: true,
          sdtZalo: true, caLam: true, chiNhanh: true, kinhNghiem: true, xuLy: true, linkFb: true,
          hrDecision: true, tongDiem: true, aiRecommendation: true,
          dataVersion: true, ngayBatDauTraining: true, trangThaiTraining: true,
        },
      });
      const byId = new Map(all.map((c) => [c.id, c]));

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[idCol]) continue;
        checked++;
        const candidateId = row[idCol].trim();
        const candidate = byId.get(candidateId);
        if (!candidate) {
          // row exists in sheet but not in web -> cannot repair blindly; flag
          mismatches++;
          continue;
        }
        const sheetHash = hashCol !== -1 ? (row[hashCol] ?? '').trim() : '';
        const localHash = candidateDataHash(candidate as never);

        if (sheetHash && sheetHash === localHash) continue;

        // Mismatch detected
        mismatches++;
        const full = await prisma.candidate.findUnique({ where: { id: candidateId } });
        if (!full) continue;
        if (!sheetHash) {
          // web created but sheet row stale -> repair by writing web data
          await sheet.syncCandidate(full);
          repaired++;
        } else {
          // both have data but differ -> compare field-by-field
          const sheetVersion = versionCol !== -1 ? Number(row[versionCol]) || 0 : 0;
          if (sheetVersion >= full.dataVersion) {
            // sheet is newer -> likely admin edited sheet; conflict for admin, no silent overwrite
            conflicts++;
            await prisma.conflict.create({
              data: {
                id: nextId('CFL'),
                entity: 'candidate',
                entityId: candidateId,
                field: 'DATA_MISMATCH',
                webValue: localHash,
                sheetValue: sheetHash,
                webVersion: full.dataVersion,
                sheetVersion,
                status: 'OPEN',
              },
            }).catch(() => undefined);
          } else {
            // web is newer -> repair sheet from web
            await sheet.syncCandidate(full);
            repaired++;
          }
        }
      }

      await prisma.reconciliationRun.update({
        where: { id: runId },
        data: { status: 'DONE', finishedAt: new Date(), checked, mismatches, repaired, conflicts },
      });
    } catch (err) {
      await prisma.reconciliationRun.update({
        where: { id: runId },
        data: { status: 'ERROR', finishedAt: new Date(), details: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  async latest(): Promise<unknown[]> {
    return prisma.reconciliationRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 });
  }
}

export const reconciliationService = new ReconciliationService();
