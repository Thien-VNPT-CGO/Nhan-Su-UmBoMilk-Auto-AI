import { prisma } from '../lib/prisma';
import { getGoogleSheetService } from '../services/GoogleSheetService';

/**
 * Dọn dữ liệu trùng lặp:
 * 1. Báo cáo nhóm trùng SĐT trong DB (web).
 * 2. Xóa các dòng MỒ CÔI trong 3 tab Google Sheet (CANDIDATE_ID không còn tồn tại trong DB -
 *    sinh ra do các lần import thay thế trước đây mà DELETE sync không xóa kịp).
 * 3. Xóa các dòng TRÙNG CANDIDATE_ID trong cùng 1 tab (dữ liệu bị double - giữ dòng mới nhất,
 *    xóa các dòng cũ hơn).
 *
 * Chạy:  npx tsx src/scripts/cleanupOrphanRows.ts
 * (cần DATABASE_URL + cấu hình Google Sheets trong Settings hoặc .env)
 */
async function main(): Promise<void> {
  const sheet = getGoogleSheetService();
  await sheet.refreshConfig().catch(() => undefined);
  if (!sheet.configured) {
    console.log('[CLEANUP] Google Sheets chưa được cấu hình - chỉ báo cáo DB.');
  }

  // 1) Thống kê trùng SĐT trong DB
  const groups = await prisma.candidate.groupBy({
    by: ['sdtZalo'],
    _count: { _all: true },
    having: { sdtZalo: { _count: { gt: 1 } } },
  });
  const dupCount = groups.reduce((n, g) => n + (g._count._all - 1), 0);
  console.log(`[CLEANUP] DB: ${groups.length} nhóm trùng SĐT, tổng ${dupCount} hồ sơ trùng (auto-dedup 5 phút sẽ tự dọn, giữ bản mới nhất).`);

  if (!sheet.configured) return;

  const ids = await prisma.candidate.findMany({ select: { id: true } });
  const idSet = new Set(ids.map((i) => i.id));
  // HO_SO_NV chỉ chứa ứng viên CÓ LỊCH TRAINING — các dòng khác phải bị xóa
  const trainingIds = await prisma.candidate.findMany({
    where: { ngayBatDauTraining: { not: null } },
    select: { id: true },
  });
  const trainingIdSet = new Set(trainingIds.map((i) => i.id));

  for (const name of ['locHoSo', 'diemUv', 'hoSoNv'] as const) {
    const title = sheet.sheetNames[name];
    try {
      const rows = await sheet.readRows(title);
      const headers = rows[0] ?? [];
      const idIdx = headers.indexOf('CANDIDATE_ID');
      if (idIdx < 0) {
        console.log(`  ${title}: không có cột CANDIDATE_ID - bỏ qua`);
        continue;
      }
      const orphans: number[] = [];
      const dups: number[] = [];
      const seen = new Set<string>();
      let total = 0;
      for (let i = 1; i < rows.length; i++) {
        const id = String(rows[i][idIdx] ?? '').trim();
        if (!id) continue;
        total++;
        if (!idSet.has(id)) {
          orphans.push(i + 1);
        } else if (seen.has(id)) {
          // Dòng TRÙNG CANDIDATE_ID: giữ dòng mới nhất (đọc từ dưới lên nên dòng đầu tiên gặp là cũ nhất)
          dups.push(i + 1);
        } else if (name === 'hoSoNv' && !trainingIdSet.has(id)) {
          // HO_SO_NV chỉ dành cho ứng viên CÓ LỊCH TRAINING
          orphans.push(i + 1);
        }
        seen.add(id);
      }
      console.log(`  ${title}: ${total} dòng dữ liệu, ${orphans.length} mồ côi, ${dups.length} dòng trùng CANDIDATE_ID`);
      const toRemove = [...orphans, ...dups];
      if (toRemove.length > 0) {
        await sheet.clearRows(title, toRemove);
        console.log(`  ${title}: đã xóa ${toRemove.length} dòng (mồ côi + trùng)`);
      }
    } catch (e) {
      console.log(`  ${title}: LỖI - ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });