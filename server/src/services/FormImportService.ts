import { getSettings } from './SettingsService';
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

export function getFormImportStatus(): { lastRunAt: Date | null; lastError: string | null } {
  return { lastRunAt, lastError };
}

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
    const { headers, rows } = await fetchFormResponses();
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
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    result.lastError = lastError;
    result.enabled = true;
  }
  return result;
}