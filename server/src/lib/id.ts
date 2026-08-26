import { createHash, randomBytes } from 'crypto';
import { env } from '../config/env';
import { dateKey, TZ } from './date';

export function sha256(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function dataHash(payload: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(payload).sort()) sorted[k] = payload[k];
  return sha256(sorted);
}

export function randomId(prefix: string, len = 12): string {
  return `${prefix}${randomBytes(len).toString('hex').toUpperCase()}`;
}

/**
 * Sinh mã ứng viên theo cấu trúc chuẩn: UBM_DD/MM/YYYY_NV0001
 * - UBM: Tên thương hiệu Ụm Bò Milk
 * - DD/MM/YYYY: Ngày tháng năm đăng ký form
 * - NV0001: Chữ NV + 4 chữ số định danh tự động tăng / random
 */
export async function nextCandidateId(thoiGian?: Date | string): Promise<string> {
  const dateObj = thoiGian ? new Date(thoiGian) : new Date();
  const tzDate = new Date(dateObj.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayStr = pad(tzDate.getDate());
  const monthStr = pad(tzDate.getMonth() + 1);
  const yearStr = tzDate.getFullYear();

  const formattedDate = `${dayStr}/${monthStr}/${yearStr}`; // DD/MM/YYYY
  const prefix = `UBM_${formattedDate}_NV`;

  const { prisma } = await import('./prisma');

  const candidatesToday = await prisma.candidate.findMany({
    where: {
      id: {
        startsWith: prefix,
      },
    },
    select: { id: true },
  });

  let maxSeq = 0;
  for (const c of candidatesToday) {
    const m = c.id.match(/_NV(\d+)$/);
    if (m) {
      const num = parseInt(m[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const nextSeq = maxSeq + 1;
  const seqPadded = String(nextSeq).padStart(4, '0');
  return `${prefix}${seqPadded}`;
}

/**
 * Tự động chuyển đổi tất cả mã UV cũ (VD: UV-20260822-00010) sang định dạng mới: UBM_DD/MM/YYYY_NV0010
 */
export async function migrateAllCandidateIdsToUBMFormat() {
  const { prisma } = await import('./prisma');
  try {
    const candidates = await prisma.candidate.findMany();
    for (const c of candidates) {
      if (c.id.startsWith('UBM_')) continue;

      let dateStr = '';
      let nvSeq = '0001';

      const oldMatch = c.id.match(/^UV-(\d{4})(\d{2})(\d{2})-(\d+)$/);
      if (oldMatch) {
        const [, yyyy, mm, dd, seqStr] = oldMatch;
        dateStr = `${dd}/${mm}/${yyyy}`;
        nvSeq = String(parseInt(seqStr, 10)).padStart(4, '0');
      } else {
        const d = new Date(c.thoiGian);
        const tzDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const pad = (n: number) => String(n).padStart(2, '0');
        dateStr = `${pad(tzDate.getDate())}/${pad(tzDate.getMonth() + 1)}/${tzDate.getFullYear()}`;
        nvSeq = String(Math.floor(1000 + Math.random() * 9000)).padStart(4, '0');
      }

      let newId = `UBM_${dateStr}_NV${nvSeq}`;
      const oldId = c.id;

      if (newId === oldId) continue;

      // Đảm bảo newId không bị trùng lặp trong DB
      let attempt = 1;
      while (await prisma.candidate.findUnique({ where: { id: newId } })) {
        const nextNum = parseInt(nvSeq, 10) + attempt;
        newId = `UBM_${dateStr}_NV${String(nextNum).padStart(4, '0')}`;
        attempt++;
      }

      try {
        await prisma.$transaction(async (tx) => {
          // 1. Tạo bản sao Candidate với newId
          await tx.$executeRawUnsafe(`
            INSERT INTO "Candidate" ("id", "thoiGian", "tenUv", "gioiTinh", "namSinh", "trinhDo", "queQuan", "sdtZalo", "zaloUserId", "caLam", "chiNhanh", "kinhNghiem", "xuLy", "linkFb", "kenhBietTin", "aiScore", "tongDiem", "xepLoai", "aiRecommendation", "aiNote", "aiConfidence", "aiScoredAt", "hrDecision", "hrUser", "hrReason", "hrDecisionAt", "phongVanAt", "ggMeetLink", "calendarEventId", "interviewStatus", "ngayBatDauTraining", "trangThaiTraining", "soNgayDaTraining", "dataVersion", "dataHash", "updatedAt", "updatedBy", "source")
            SELECT $1, "thoiGian", "tenUv", "gioiTinh", "namSinh", "trinhDo", "queQuan", "sdtZalo", "zaloUserId", "caLam", "chiNhanh", "kinhNghiem", "xuLy", "linkFb", "kenhBietTin", "aiScore", "tongDiem", "xepLoai", "aiRecommendation", "aiNote", "aiConfidence", "aiScoredAt", "hrDecision", "hrUser", "hrReason", "hrDecisionAt", "phongVanAt", "ggMeetLink", "calendarEventId", "interviewStatus", "ngayBatDauTraining", "trangThaiTraining", "soNgayDaTraining", "dataVersion", "dataHash", "updatedAt", "updatedBy", "source"
            FROM "Candidate" WHERE "id" = $2;
          `, newId, oldId);

          // 2. Chuyển tham chiếu các bảng con sang newId
          await tx.$executeRawUnsafe(`UPDATE "Shift" SET "candidateId" = $1 WHERE "candidateId" = $2;`, newId, oldId);
          await tx.$executeRawUnsafe(`UPDATE "AttendanceEvent" SET "candidateId" = $1 WHERE "candidateId" = $2;`, newId, oldId);
          await tx.$executeRawUnsafe(`UPDATE "SyncJob" SET "candidateId" = $1 WHERE "candidateId" = $2;`, newId, oldId);
          await tx.$executeRawUnsafe(`UPDATE "SyncJob" SET "entityId" = $1 WHERE "entityId" = $2;`, newId, oldId);
          await tx.$executeRawUnsafe(`UPDATE "ZaloMessage" SET "candidateId" = $1 WHERE "candidateId" = $2;`, newId, oldId);
          await tx.$executeRawUnsafe(`UPDATE "Conflict" SET "entityId" = $1 WHERE "entityId" = $2;`, newId, oldId);
          await tx.$executeRawUnsafe(`UPDATE "QuizAttempt" SET "candidateId" = $1 WHERE "candidateId" = $2;`, newId, oldId);
          await tx.$executeRawUnsafe(`UPDATE "AuditLog" SET "entityId" = $1 WHERE "entityId" = $2;`, newId, oldId);

          // 3. Xóa Candidate oldId cũ
          await tx.$executeRawUnsafe(`DELETE FROM "Candidate" WHERE "id" = $1;`, oldId);
        });
        console.log(`[MigrateID] Đã chuyển đổi mã ứng viên: ${oldId} -> ${newId}`);
      } catch (e) {
        console.error(`[MigrateID Error] Không thể chuyển đổi ${oldId}:`, e);
      }
    }
  } catch (e) {
    console.error('[MigrateID Main Error]:', e);
  }
}

export function nextSyncJobId(): string {
  return nextId('SYNC');
}

let globalSeqCounter = 0;

export function nextId(prefix: string): string {
  globalSeqCounter = (globalSeqCounter + 1) % 1000000;
  const seqHex = globalSeqCounter.toString(36).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}${seqHex}`;
}

export function buildIdempotencyKey(parts: string[]): string {
  return parts.join(':');
}
