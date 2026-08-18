import { getSettings } from './SettingsService';
import { prisma } from '../lib/prisma';
import {
  fetchFormResponses,
  mapFormResponseRow,
  parseFormTimestamp,
  findTimestampIndex,
} from './GoogleSheetService';
import { candidateService } from './CandidateService';
import { normalizePhone } from './CandidateService';
import { isApiError } from '../lib/errors';

export interface FormImportResult {
  enabled: boolean;
  imported: number;
  duplicates: number;
  invalid: number;
  lastError: string | null;
}

let lastRunAt: Date | null = null;
let lastError: string | null = null;
let fullScanDone = false;

export function getFormImportStatus(): { lastRunAt: Date | null; lastError: string | null } {
  return { lastRunAt, lastError };
}

/** Reset trạng thái import (gọi sau khi reset hệ thống để quét lại toàn bộ form). */
export function resetImportState(): void {
  fullScanDone = false;
  lastRunAt = null;
  lastError = null;
}

/** Dòng mới nhất mỗi chu kỳ (form xếp dòng mới trên đầu). Dòng cũ chỉ quét lại sau khi reset. */
const LIMIT_ROWS = 40;

/**
 * Đọc sheet phản hồi Google Form và tạo hồ sơ ứng viên cho các dòng mới.
 * Không cần Apps Script — chỉ cần share sheet phản hồi cho Service Account.
 */
export async function importFormResponses(): Promise<FormImportResult> {
  const result: FormImportResult = {
    enabled: true,
    imported: 0,
    duplicates: 0,
    invalid: 0,
    lastError: null,
  };
  try {
    const settings = await getSettings();
    const formId = String((settings.googleSheet as Record<string, unknown>).formResponsesId ?? '');
    if (!formId) {
      result.enabled = false;
      return result;
    }
    const { headers, rows } = await fetchFormResponses(fullScanDone ? LIMIT_ROWS : undefined);
    // Baseline: dòng cũ hơn mốc đã xử lý (max thoiGian trong DB) thì bỏ qua, chỉ xử lý dòng mới
    const baseline = fullScanDone
      ? (await prisma.candidate.aggregate({ _max: { thoiGian: true } }))._max.thoiGian
      : null;
    const tomb = Array.isArray((settings as Record<string, unknown>).deletedFormResponses)
      ? ((settings as Record<string, unknown>).deletedFormResponses as { sdt: string; thoiGian: string | null }[])
      : [];
    for (const row of rows) {
      const mapped = mapFormResponseRow(headers, row);
      if (!mapped) {
        result.invalid++;
        continue;
      }
      const sdt = normalizePhone(mapped.sdtZalo);
      if (!sdt) {
        result.invalid++;
        continue;
      }
      const timestampIdx = findTimestampIndex(headers);
      const thoiGian = parseFormTimestamp(
        timestampIdx >= 0 ? String(row[timestampIdx] ?? '') : undefined,
      );
      if (baseline && thoiGian && thoiGian.getTime() <= baseline.getTime()) {
        // Dòng cũ đã được xử lý từ trước → bỏ qua (giảm tải DB rất nhiều)
        continue;
      }
      const isDeleted = tomb.some((t) =>
        t.sdt === sdt &&
        (!t.thoiGian || !thoiGian || t.thoiGian === thoiGian.toISOString()),
      );
      if (isDeleted) {
        result.duplicates++;
        continue;
      }
      try {
        await candidateService.createFromForm({
          thoiGian: thoiGian?.toISOString(),
          tenUv: mapped.tenUv,
          gioiTinh: mapped.gioiTinh,
          namSinh: mapped.namSinh,
          trinhDo: mapped.trinhDo,
          queQuan: mapped.queQuan,
          sdtZalo: sdt,
          caLam: mapped.caLam,
          chiNhanh: mapped.chiNhanh,
          kinhNghiem: mapped.kinhNghiem,
          xuLy: mapped.xuLy,
          linkFb: mapped.linkFb,
          kenhBietTin: mapped.kenhBietTin,
          source: 'GOOGLE_FORM',
        });
        result.imported++;
      } catch (e) {
        if (isApiError(e) && e.code === 'DUPLICATE_CANDIDATE') {
          // SĐT đã có hồ sơ mới hơn → bỏ qua bản cũ
          result.duplicates++;
        } else {
          throw e;
        }
      }
    }
    lastRunAt = new Date();
    lastError = null;
    fullScanDone = true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    result.lastError = lastError;
    result.enabled = true;
  }
  return result;
}