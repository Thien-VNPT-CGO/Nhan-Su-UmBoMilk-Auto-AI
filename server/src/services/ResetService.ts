import { prisma } from '../lib/prisma';
import { getGoogleSheetService } from './GoogleSheetService';
import { saveSettings } from './SettingsService';

export interface ResetResult {
  db: Record<string, number>;
  sheets: Record<string, number>;
}

const DATA_MODELS = [
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

/**
 * RESET HỆ THỐNG VỀ TRẠNG THÁI BAN ĐẦU (PHÁ HỦY - không thể hoàn tác):
 * - Web (DB): ứng viên, điểm, training, attendance, ca trực, sync, audit, zalo, webhook, conflicts...
 * - Google Sheet: xóa dữ liệu 3 tab (giữ header)
 * - Tombstone: xóa sạch để form import lại từ đầu
 * GIỮ NGUYÊN: tài khoản đăng nhập + cấu hình Settings.
 */
export class ResetService {
  async resetSystem(user: string): Promise<ResetResult> {
    const db: Record<string, number> = {};
    for (const m of DATA_MODELS) {
      const count = await (prisma as unknown as Record<string, { deleteMany: () => Promise<{ count: number }> }>)[m].deleteMany();
      db[m] = count.count;
    }

    const sheets: Record<string, number> = {};
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
          sheets[title] = dataRows.length;
        } catch (e) {
          sheets[String(name)] = -1;
          console.warn(`[RESET] ${String(name)}:`, e instanceof Error ? e.message : String(e));
        }
      }
    }

    await saveSettings({ deletedFormResponses: [] }, user);
    console.log(`[RESET] ${user} đã reset hệ thống: db=${JSON.stringify(db)} sheets=${JSON.stringify(sheets)}`);
    return { db, sheets };
  }
}

export const resetService = new ResetService();