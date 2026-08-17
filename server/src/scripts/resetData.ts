import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { getGoogleSheetService } from '../services/GoogleSheetService';
import { saveSettings } from '../services/SettingsService';

/**
 * RESET TOÀN BỘ DỮ LIỆU VỀ 0 (PHÁ HỦY - không thể hoàn tác):
 * - Web (DB): ứng viên, điểm, training, attendance, shifts, sync jobs, audit, zalo, webhook, conflicts...
 * - Google Sheet: xóa dữ liệu 3 tab LOC_HO_SO_PV / DIEM_UV / HO_SO_NV (giữ header dòng 1)
 * - Tombstone (deletedFormResponses): xóa sạch để import lại từ đầu
 * GIỮ NGUYÊN: tài khoản đăng nhập (User/Session) + cấu hình Settings (Google Sheets, Zalo, AI, quy tắc chấm điểm)
 *
 * Chạy:  npx tsx src/scripts/resetData.ts          (có xác nhận)
 *        npx tsx src/scripts/resetData.ts --yes    (không xác nhận)
 */
async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    console.log('⚠️  HÀNH ĐỘNG NÀY XÓA TOÀN BỘ DỮ LIỆU, KHÔNG THỂ HOÀN TÁC!');
    console.log('Thêm tham số --yes để chạy thật:  npx tsx src/scripts/resetData.ts --yes');
    return;
  }

  // 1) Web (DB) - theo thứ tự khóa ngoại
  const models = [
    'zaloMessage',
    'attendanceEvent',
    'shift',
    'syncJob',
    'conflict',
    'webhookEvent',
    'auditLog',
    'reconciliationRun',
    'idempotencyKey',
    'apiLog',
    'session',
    'candidate',
  ] as const;
  for (const m of models) {
    const count = await (prisma as unknown as Record<string, { deleteMany: () => Promise<{ count: number }> }>)[m].deleteMany();
    console.log(`[DB] Xóa ${m}: ${count.count}`);
  }

  // 2) Google Sheet - xóa dữ liệu 3 tab (giữ header)
  const sheet = getGoogleSheetService();
  await sheet.refreshConfig().catch(() => undefined);
  if (sheet.configured) {
    for (const name of ['locHoSo', 'diemUv', 'hoSoNv'] as const) {
      try {
        const title = sheet.sheetNames[name];
        const rows = await sheet.readRows(title);
        const dataRows = rows.length > 1 ? rows.slice(1).map((_, i) => i + 2) : [];
        if (dataRows.length > 0) {
          await sheet.clearRows(title, dataRows);
        }
        console.log(`[SHEET] ${title}: đã xóa ${dataRows.length} dòng dữ liệu (giữ header)`);
      } catch (e) {
        console.log(`[SHEET] ${name}: LỖI - ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    console.log('[SHEET] Google Sheets chưa được cấu hình - bỏ qua');
  }

  // 3) Tombstone: cho phép import lại toàn bộ phản hồi form
  await saveSettings({ deletedFormResponses: [] }, 'SYSTEM-RESET');
  console.log('[SETTINGS] Đã xóa tombstone (deletedFormResponses = [])');

  const users = await prisma.user.count();
  const settings = await prisma.systemSetting.count();
  const candidates = await prisma.candidate.count();
  console.log(`[DONE] Còn lại: user=${users}, systemSetting=${settings}, candidate=${candidates}`);
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });