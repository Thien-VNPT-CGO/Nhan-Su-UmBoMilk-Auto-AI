import { google, sheets_v4 } from 'googleapis';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { getSettings } from './SettingsService';
import { formatDateTime, formatDate, dateKey } from '../lib/date';
import { dataHash } from '../lib/id';
import { normalizePhone } from './CandidateService';
import type { Candidate } from '@prisma/client';

export const LOC_HO_SO_COLS = [
  'CANDIDATE_ID', 'THOI_GIAN', 'TEN_UV', 'GIOI_TINH', 'NAM_SINH', 'TRINH_DO', 'QUE_QUAN',
  'SDT_ZALO', 'CA_LAM', 'CHI_NHANH', 'KINH_NGHIEM', 'XU_LY', 'LINK_FB', 'KENH_BIET_TIN',
  'KET_QUA_PV', 'DATA_VERSION', 'UPDATED_AT', 'UPDATED_BY', 'SYNC_STATUS', 'DATA_HASH',
];

export const DIEM_UV_COLS = [
  'CANDIDATE_ID', 'D_HO_TEN', 'D_NAM_SINH', 'D_QUE_QUAN', 'D_SDT', 'D_TRINH_DO',
  'D_KINH_NGHIEM', 'D_XU_LY', 'D_LINK_FB', 'D_KENH_BIET_TIN',
  'P_HO_TEN', 'P_NAM_SINH', 'P_QUE_QUAN', 'P_SDT', 'P_TRINH_DO', 'P_KINH_NGHIEM',
  'P_XU_LY', 'P_LINK_FB', 'P_KENH_BIET_TIN',
  'TONG_DIEM', 'XEP_LOAI', 'AI_RECOMMENDATION', 'AI_NOTE', 'AI_CONFIDENCE', 'DATA_VERSION', 'UPDATED_AT',
];

export const HO_SO_NV_COLS = [
  'CANDIDATE_ID', 'THOI_GIAN', 'TEN_UV', 'NAM_SINH', 'TRINH_DO', 'QUE_QUAN', 'SDT_ZALO',
  'CA_LAM', 'CHI_NHANH', 'KENH_BIET_TIN', 'NGAY_BAT_DAU_TRAINING',
  'TRAINING_DAY_1', 'TRAINING_DAY_2', 'TRAINING_DAY_3', 'TRAINING_DAY_4',
  'TRAINING_DAY_5', 'TRAINING_DAY_6', 'TRAINING_DAY_7',
  'SO_NGAY_DA_TRAINING', 'TRANG_THAI_TRAINING', 'UPDATED_AT', 'UPDATED_BY', 'DATA_VERSION', 'SYNC_STATUS',
];

export interface SheetConfig {
  spreadsheetId: string;
  email: string;
  key: string;
  formResponsesId: string;
  locHoSo: string;
  diemUv: string;
  hoSoNv: string;
}

export interface ProvisionResult {
  created: string[];
  columnsAdded: Record<string, string[]>;
}

const SHEET_DEFS = [
  { name: 'locHoSo', cols: LOC_HO_SO_COLS },
  { name: 'diemUv', cols: DIEM_UV_COLS },
  { name: 'hoSoNv', cols: HO_SO_NV_COLS },
] as const;

export class GoogleSheetService {
  private sheets: sheets_v4.Sheets | null = null;
  private colCache = new Map<string, Record<string, number>>();
  private rowCache = new Map<string, Map<string, number>>();
  private ready = false;
  private cfg: SheetConfig | null = null;

  constructor() {
    this.init();
  }

  private loadCfgFromEnv(): SheetConfig {
    return {
      spreadsheetId: env.googleSheetId,
      email: env.googleServiceAccountEmail,
      key: env.googlePrivateKey,
      formResponsesId: '',
      locHoSo: env.sheetNameLocHoSo,
      diemUv: env.sheetNameDiemUv,
      hoSoNv: env.sheetNameHoSoNv,
    };
  }

  private init(): void {
    const cfg = this.loadCfgFromEnv();
    this.cfg = cfg;
    this.applyCfg(cfg);
  }

  private applyCfg(cfg: SheetConfig): void {
    this.cfg = cfg;
    this.colCache.clear();
    this.rowCache.clear();
    this.ready = false;
    this.sheets = null;
    if (!cfg.spreadsheetId || !cfg.email || !cfg.key) return;
    try {
      const auth = new google.auth.JWT({
        email: cfg.email,
        key: cfg.key.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      this.sheets = google.sheets({ version: 'v4', auth });
      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  /** Load config from DB settings (fallback .env). Gọi lại sau khi lưu cài đặt Web. */
  async refreshConfig(): Promise<void> {
    let cfg = this.loadCfgFromEnv();
    try {
      const s = await getSettings();
      const g = (s.googleSheet ?? {}) as Record<string, unknown>;
      const sheets = (g.sheets ?? {}) as Record<string, unknown>;
      cfg = {
        spreadsheetId: String(g.spreadsheetId || cfg.spreadsheetId),
        email: String(g.serviceAccountEmail || cfg.email),
        key: String(g.privateKey || cfg.key),
        formResponsesId: String(g.formResponsesId || cfg.formResponsesId),
        locHoSo: String(sheets.locHoSo || cfg.locHoSo),
        diemUv: String(sheets.diemUv || cfg.diemUv),
        hoSoNv: String(sheets.hoSoNv || cfg.hoSoNv),
      };
    } catch {
      // giữ cấu hình .env
    }
    this.applyCfg(cfg);
  }

  get configured(): boolean {
    return this.ready && !!this.cfg?.spreadsheetId;
  }

  get sheetNames(): { locHoSo: string; diemUv: string; hoSoNv: string } {
    return {
      locHoSo: this.cfg?.locHoSo ?? env.sheetNameLocHoSo,
      diemUv: this.cfg?.diemUv ?? env.sheetNameDiemUv,
      hoSoNv: this.cfg?.hoSoNv ?? env.sheetNameHoSoNv,
    };
  }

  get formResponsesId(): string {
    return this.cfg?.formResponsesId ?? '';
  }

  /** Lấy danh sách tab của spreadsheet khác (sheet phản hồi form). */
  async fetchSpreadsheetMeta(spreadsheetId: string): Promise<{
    tabs: { title: string; rowCount: number; lastCol: string }[];
  }> {
    const meta = await this.sheets!.spreadsheets.get({ spreadsheetId });
    const tabs = (meta.data.sheets ?? []).map((sh) => {
      const props = sh.properties ?? {};
      const cols = props.gridProperties?.columnCount ?? 26;
      return {
        title: String(props.title ?? ''),
        rowCount: props.gridProperties?.rowCount ?? 1000,
        lastCol: this.colLetter(cols),
      };
    });
    return { tabs };
  }

  /** Đọc giá trị một vùng của spreadsheet khác. */
  async fetchValues(spreadsheetId: string, range: string): Promise<string[][] | null> {
    const res = await this.sheets!.spreadsheets.values.get({ spreadsheetId, range });
    return (res.data.values as string[][] | null) ?? null;
  }

  /** Xóa hẳn dòng ứng viên ở cả 3 sheet theo CANDIDATE_ID (không để lại dòng trống). */
  async deleteCandidateRows(candidateId: string): Promise<void> {
    if (!this.configured) return;
    for (const title of [this.sheetNames.locHoSo, this.sheetNames.diemUv, this.sheetNames.hoSoNv]) {
      try {
        const res = await this.sheets!.spreadsheets.values.get({
          spreadsheetId: this.id,
          range: `${title}!A:A`,
        });
        const col = (res.data.values ?? []).map((r) => String(r[0] ?? '').trim());
        const idx = col.findIndex((v, i) => i > 0 && v === candidateId);
        if (idx <= 0) continue;
        // Xóa HẲN dòng (deleteDimension) để không còn dòng trống lưu lại trong sheet
        await this.sheets!.spreadsheets.batchUpdate({
          spreadsheetId: this.id,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: { sheetId: await this.sheetIdByTitle(title), dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 },
                },
              },
            ],
          },
        });
      } catch {
        // bỏ qua tab lỗi, vẫn xóa tiếp tab khác
      }
    }
  }

  private async sheetIdByTitle(title: string): Promise<number> {
    const meta = await this.sheets!.spreadsheets.get({ spreadsheetId: this.id });
    const sh = (meta.data.sheets ?? []).find((s) => String(s.properties?.title ?? '') === title);
    if (!sh?.properties?.sheetId) throw new Error(`Không tìm thấy tab ${title}`);
    return sh.properties.sheetId;
  }

  /** Xóa HẲN các dòng theo số thứ tự thật trong sheet (bắt đầu từ 1) - không để lại dòng trống. */
  async clearRows(sheetName: string, rowNumbers: number[]): Promise<void> {
    if (!this.configured || rowNumbers.length === 0) return;
    const sorted = [...new Set(rowNumbers)].sort((a, b) => b - a);
    const sheetId = await this.sheetIdByTitle(sheetName);
    for (let i = 0; i < sorted.length; i += 100) {
      const requests = sorted.slice(i, i + 100).map((r) => ({
        deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: r - 1, endIndex: r } },
      }));
      await this.sheets!.spreadsheets.batchUpdate({
        spreadsheetId: this.id,
        requestBody: { requests },
      });
    }
  }

  private colLetter(n: number): string {
    let s = '';
    while (n > 0) {
      n -= 1;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s || 'A';
  }

  private get id(): string {
    if (!this.configured) throw new Error('Google Sheets chưa được cấu hình');
    return this.cfg!.spreadsheetId;
  }

  /**
   * Tự động tạo các sheet (tab) còn thiếu và các cột (header) theo chuẩn hệ thống.
   * Gọi khi liên kết Google Sheet thật hoặc khi bấm "Tạo cấu trúc".
   */
  async ensureSheets(): Promise<ProvisionResult> {
    if (!this.configured) throw new Error('Google Sheets chưa được cấu hình');
    const meta = await this.sheets!.spreadsheets.get({ spreadsheetId: this.id });
    const titles = new Set<string>(
      (meta.data.sheets ?? []).map((sh) => String(sh.properties?.title ?? '')),
    );
    const created: string[] = [];
    const addRequests: object[] = [];
    for (const def of SHEET_DEFS) {
      const title = this.sheetNames[def.name];
      if (!titles.has(title)) {
        addRequests.push({ addSheet: { properties: { title } } });
        created.push(title);
      }
    }
    if (addRequests.length > 0) {
      await this.batchUpdate(addRequests);
    }
    const columnsAdded: Record<string, string[]> = {};
    for (const def of SHEET_DEFS) {
      const title = this.sheetNames[def.name];
      const res = await this.sheets!.spreadsheets.values.get({
        spreadsheetId: this.id,
        range: `${title}!A1:1`,
      });
      const headers = (res.data.values?.[0] ?? []).map((h) => String(h).trim());
      const missing = def.cols.filter((c) => !headers.includes(c));
      if (missing.length === 0) continue;
      if (headers.length === 0) {
        await this.sheets!.spreadsheets.values.update({
          spreadsheetId: this.id,
          range: `${title}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [def.cols as string[]] },
        });
      } else {
        const startCol = String.fromCharCode(65 + headers.length);
        await this.sheets!.spreadsheets.values.update({
          spreadsheetId: this.id,
          range: `${title}!${startCol}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [missing] },
        });
      }
      columnsAdded[title] = missing;
    }
    this.colCache.clear();
    this.rowCache.clear();
    return { created, columnsAdded };
  }

  /**
   * Đồng bộ toàn bộ dữ liệu hiện có xuống Google Sheets (mỗi candidate → 3 sheet).
   * Cần gọi ensureSheets() trước để đảm bảo cấu trúc.
   */
  async fullResync(): Promise<{ candidates: number }> {
    if (!this.configured) throw new Error('Google Sheets chưa được cấu hình');
    const candidates = await prisma.candidate.findMany({ orderBy: { id: 'asc' } });
    for (const c of candidates) {
      await this.syncCandidate(c);
      await this.syncScore(c);
      await this.syncTraining(c);
    }
    return { candidates: candidates.length };
  }

  async ping(): Promise<boolean> {
    if (!this.configured) return false;
    try {
      await this.sheets!.spreadsheets.get({ spreadsheetId: this.id });
      return true;
    } catch {
      return false;
    }
  }

  private async ensureColMap(sheetName: string): Promise<Record<string, number>> {
    if (this.colCache.has(sheetName)) return this.colCache.get(sheetName)!;
    if (!this.configured) throw new Error('Google Sheets chưa được cấu hình');
    const res = await this.sheets!.spreadsheets.values.get({
      spreadsheetId: this.id,
      range: `${sheetName}!A1:Z1`,
    });
    const headers = res.data.values?.[0] ?? [];
    const map: Record<string, number> = {};
    headers.forEach((h, i) => {
      map[String(h).trim()] = i;
    });
    this.colCache.set(sheetName, map);
    return map;
  }

  /** Tự thêm cột còn thiếu vào cuối sheet (nâng cấp phiên bản: cột mới KENH_BIET_TIN... không cần chạy provision thủ công). */
  private async ensureHeaders(sheetName: string, cols: string[]): Promise<void> {
    if (!this.configured) return;
    const colMap = await this.ensureColMap(sheetName);
    const missing = cols.filter((c) => colMap[c] === undefined);
    if (missing.length === 0) return;
    const sheetId = await this.sheetIdByTitle(sheetName);
    await this.sheets!.spreadsheets.batchUpdate({
      spreadsheetId: this.id,
      requestBody: {
        requests: [
          {
            appendCells: {
              sheetId,
              rows: [{ values: missing.map((c) => ({ userEnteredValue: { stringValue: c } })) }],
              fields: 'userEnteredValue',
            },
          },
        ],
      },
    });
    this.colCache.delete(sheetName);
    console.log(`[Sheets] đã thêm cột mới vào ${sheetName}: ${missing.join(', ')}`);
  }

  async findByCandidateId(sheetName: string, candidateId: string): Promise<{ rowIndex: number; row: string[] } | null> {
    const colMap = await this.ensureColMap(sheetName);
    const idCol = colMap['CANDIDATE_ID'];
    if (idCol === undefined) throw new Error(`Sheet ${sheetName} thiếu cột CANDIDATE_ID`);
    const res = await this.sheets!.spreadsheets.values.get({
      spreadsheetId: this.id,
      range: `${sheetName}!A2:Z`,
    });
    const rows = res.data.values ?? [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if ((row[idCol] ?? '').trim() === candidateId) {
        return { rowIndex: i + 2, row };
      }
    }
    return null;
  }

  async readRows(sheetName: string): Promise<string[][]> {
    const res = await this.sheets!.spreadsheets.values.get({
      spreadsheetId: this.id,
      range: `${sheetName}!A1:Z`,
    });
    return res.data.values ?? [];
  }

  /** Xóa (clear) các dòng phản hồi form khớp SĐT (+ thời gian nếu có) để không bị import lại. */
  async clearFormResponseRows(phone: string, thoiGian?: Date | null): Promise<number> {
    const formId = this.formResponsesId;
    if (!formId || !this.configured) return 0;
    const meta = await this.fetchSpreadsheetMeta(formId);
    const tab = meta.tabs[0];
    if (!tab) return 0;
    const res = await this.fetchValues(formId, `${tab.title}!A1:${tab.lastCol}${tab.rowCount}`);
    const values = res ?? [];
    if (values.length <= 1) return 0;
    const headers = (values[0] ?? []).map((h) => String(h ?? '').trim());
    let tsIdx = -1;
    let sdtIdx = -1;
    headers.forEach((h, i) => {
      const f = mapHeaderToField(h);
      if (f === 'sdtZalo' && sdtIdx < 0) sdtIdx = i;
    });
    tsIdx = findTimestampIndex(headers);
    if (sdtIdx < 0) return 0;
    const target = normalizePhone(phone);
    const rowsToClear: number[] = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i] ?? [];
      const cellPhone = normalizePhone(String(row[sdtIdx] ?? '').trim());
      if (!cellPhone || cellPhone !== target) continue;
      if (thoiGian) {
        const ts = parseFormTimestamp(tsIdx >= 0 ? String(row[tsIdx] ?? '') : undefined);
        if (!ts || Math.abs(ts.getTime() - thoiGian.getTime()) > 1000) continue;
      }
      rowsToClear.push(i + 1);
    }
    for (const rowIndex of rowsToClear) {
      const range = `${tab.title}!A${rowIndex}:${tab.lastCol}${rowIndex}`;
      await this.sheets!.spreadsheets.values.clear({ spreadsheetId: formId, range });
    }
    return rowsToClear.length;
  }

  async appendRow(sheetName: string, values: (string | number)[]): Promise<void> {
    if (!this.configured) throw new Error('Google Sheets chưa được cấu hình');
    await this.sheets!.spreadsheets.values.append({
      spreadsheetId: this.id,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [values.map((v) => String(v))] },
    });
  }

  async updateRow(sheetName: string, rowIndex: number, values: (string | number)[]): Promise<void> {
    if (!this.configured) throw new Error('Google Sheets chưa được cấu hình');
    const colMap = await this.ensureColMap(sheetName);
    const lastCol = Object.values(colMap).length;
    await this.sheets!.spreadsheets.values.update({
      spreadsheetId: this.id,
      range: `${sheetName}!A${rowIndex}:${String.fromCharCode(64 + lastCol)}${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [values.map((v) => String(v))] },
    });
  }

  async batchUpdate(requests: object[]): Promise<void> {
    if (!this.configured) throw new Error('Google Sheets chưa được cấu hình');
    await this.sheets!.spreadsheets.batchUpdate({
      spreadsheetId: this.id,
      requestBody: { requests: requests as never[] },
    });
  }

  async verifyRow(sheetName: string, candidateId: string, expectedHash: string): Promise<boolean> {
    const found = await this.findByCandidateId(sheetName, candidateId);
    if (!found) return false;
    const colMap = await this.ensureColMap(sheetName);
    const hashCol = colMap['DATA_HASH'];
    const hash = hashCol !== undefined ? (found.row[hashCol] ?? '').trim() : '';
    return hash === expectedHash;
  }

  // ================= SYNC CANDIDATE -> LOC_HO_SO_PV =================
  async syncCandidate(c: Candidate): Promise<void> {
    await this.ensureHeaders(this.sheetNames.locHoSo, LOC_HO_SO_COLS);
    const score = (c.aiScore as Record<string, unknown> | null) ?? {};
    const row: (string | number)[] = LOC_HO_SO_COLS.map((col) => {
      switch (col) {
        case 'CANDIDATE_ID': return c.id;
        case 'THOI_GIAN': return formatDateTime(c.thoiGian);
        case 'TEN_UV': return c.tenUv;
        case 'GIOI_TINH': return c.gioiTinh ?? '';
        case 'NAM_SINH': return c.namSinh;
        case 'TRINH_DO': return c.trinhDo;
        case 'QUE_QUAN': return c.queQuan;
        case 'SDT_ZALO': return c.sdtZalo;
        case 'CA_LAM': return c.caLam;
        case 'CHI_NHANH': return c.chiNhanh;
        case 'KINH_NGHIEM': return c.kinhNghiem;
        case 'XU_LY': return c.xuLy;
        case 'LINK_FB': return c.linkFb;
        case 'KENH_BIET_TIN': return c.kenhBietTin ?? '';
        case 'KET_QUA_PV': return c.hrDecision ?? (c.aiRecommendation ?? '');
        case 'DATA_VERSION': return c.dataVersion;
        case 'UPDATED_AT': return formatDateTime(c.updatedAt);
        case 'UPDATED_BY': return c.updatedBy ?? '';
        case 'SYNC_STATUS': return 'SYNCED';
        case 'DATA_HASH': return c.dataHash ?? '';
        default: return '';
      }
    });
    await this.upsert(this.sheetNames.locHoSo, row, c.id, true);
  }

  // ================= SYNC SCORE -> DIEM_UV =================
  async syncScore(c: Candidate): Promise<void> {
    await this.ensureHeaders(this.sheetNames.diemUv, DIEM_UV_COLS);
    const s = (c.aiScore as Record<string, unknown> | null) ?? {};
    const g = (k: string) => String(s[k] ?? '');
    const row: (string | number)[] = DIEM_UV_COLS.map((col) => {
      switch (col) {
        case 'CANDIDATE_ID': return c.id;
        case 'D_HO_TEN': return c.tenUv;
        case 'D_NAM_SINH': return c.namSinh;
        case 'D_QUE_QUAN': return c.queQuan;
        case 'D_SDT': return c.sdtZalo;
        case 'D_TRINH_DO': return c.trinhDo;
        case 'D_KINH_NGHIEM': return c.kinhNghiem;
        case 'D_XU_LY': return c.xuLy;
        case 'D_LINK_FB': return c.linkFb;
        case 'D_KENH_BIET_TIN': return c.kenhBietTin ?? '';
        case 'P_HO_TEN': return g('p_hoTen');
        case 'P_NAM_SINH': return g('p_namSinh');
        case 'P_QUE_QUAN': return g('p_queQuan');
        case 'P_SDT': return g('p_sdt');
        case 'P_TRINH_DO': return g('p_trinhDo');
        case 'P_KINH_NGHIEM': return g('p_kinhNghiem');
        case 'P_XU_LY': return g('p_xuLy');
        case 'P_LINK_FB': return g('p_linkFb');
        case 'P_KENH_BIET_TIN': return g('p_kenhBietTin');
        case 'TONG_DIEM': return c.tongDiem ?? '';
        case 'XEP_LOAI': return c.xepLoai ?? '';
        case 'AI_RECOMMENDATION': return c.aiRecommendation ?? '';
        case 'AI_NOTE': return c.aiNote ?? '';
        case 'AI_CONFIDENCE': return c.aiConfidence ?? '';
        case 'DATA_VERSION': return c.dataVersion;
        case 'UPDATED_AT': return formatDateTime(c.updatedAt);
        default: return '';
      }
    });
    await this.upsert(this.sheetNames.diemUv, row, c.id, true);
  }

  // ================= SYNC TRAINING -> HO_SO_NHAN_VIEN_UNG_TUYEN =================
  // QUY TẮC: chỉ ứng viên ĐÃ CÓ LỊCH TRAINING (HR đặt ngày bắt đầu) mới nằm trong sheet này.
  // Chưa có lịch → xóa dòng cũ nếu còn (không bao giờ tạo dòng).
  async syncTraining(c: Candidate): Promise<void> {
    await this.ensureHeaders(this.sheetNames.hoSoNv, HO_SO_NV_COLS);
    if (!c.ngayBatDauTraining) {
      try {
        const found = await this.findByCandidateId(this.sheetNames.hoSoNv, c.id);
        if (found) await this.clearRows(this.sheetNames.hoSoNv, [found.rowIndex]);
      } catch {
        // tab lỗi → bỏ qua
      }
      return;
    }
    const attended = await prisma.attendanceEvent.findMany({
      where: { candidateId: c.id, valid: true },
      orderBy: { date: 'asc' },
    });
    const trainingDays = new Set<string>();
    attended.forEach((a) => trainingDays.add(a.date));
    const days = trainingDayKeys(c.ngayBatDauTraining);
    const row: (string | number)[] = HO_SO_NV_COLS.map((col) => {
      switch (col) {
        case 'CANDIDATE_ID': return c.id;
        case 'THOI_GIAN': return formatDateTime(c.thoiGian);
        case 'TEN_UV': return c.tenUv;
        case 'NAM_SINH': return c.namSinh;
        case 'TRINH_DO': return c.trinhDo;
        case 'QUE_QUAN': return c.queQuan;
        case 'SDT_ZALO': return c.sdtZalo;
        case 'CA_LAM': return c.caLam;
        case 'CHI_NHANH': return c.chiNhanh;
        case 'KENH_BIET_TIN': return c.kenhBietTin ?? '';
        case 'NGAY_BAT_DAU_TRAINING': return c.ngayBatDauTraining ? formatDate(c.ngayBatDauTraining) : '';
        case 'TRAINING_DAY_1':
        case 'TRAINING_DAY_2':
        case 'TRAINING_DAY_3':
        case 'TRAINING_DAY_4':
        case 'TRAINING_DAY_5':
        case 'TRAINING_DAY_6':
        case 'TRAINING_DAY_7': {
          const idx = Number(col.split('_')[2]) - 1;
          const day = days[idx];
          return day && trainingDays.has(day) ? '✅' : '';
        }
        case 'SO_NGAY_DA_TRAINING': return trainingDays.size;
        case 'TRANG_THAI_TRAINING': return c.trangThaiTraining ?? '';
        case 'UPDATED_AT': return formatDateTime(c.updatedAt);
        case 'UPDATED_BY': return c.updatedBy ?? '';
        case 'DATA_VERSION': return c.dataVersion;
        case 'SYNC_STATUS': return 'SYNCED';
        default: return '';
      }
    });
    await this.upsert(this.sheetNames.hoSoNv, row, c.id, true);
  }

  async syncAttendance(c: Candidate): Promise<void> {
    // attendance synced as part of training record (tick markers + soNgayDaTraining)
    await this.syncTraining(c);
  }

  /** Hàng đợi tuần tự theo (sheet, candidateId): 2 luồng cùng sync 1 ứng viên sẽ không bao giờ append 2 dòng. */
  private upsertQueues = new Map<string, Promise<unknown>>();

  private async upsert(sheetName: string, row: (string | number)[], candidateId: string, createIfMissing: boolean): Promise<void> {
    const key = `${sheetName}\u0000${candidateId}`;
    const prev = this.upsertQueues.get(key) ?? Promise.resolve();
    const run = prev
      .catch(() => undefined)
      .then(async () => {
        const found = await this.findByCandidateId(sheetName, candidateId);
        if (found) {
          await this.updateRow(sheetName, found.rowIndex, row);
        } else if (createIfMissing) {
          await this.appendRow(sheetName, row);
        }
      });
    this.upsertQueues.set(key, run);
    try {
      await run;
    } finally {
      if (this.upsertQueues.get(key) === run) this.upsertQueues.delete(key);
    }
  }
}

function trainingDayKeys(start: Date | null): string[] {
  const days: string[] = [];
  if (!start) return days;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(dateKey(d));
  }
  return days;
}

let _service: GoogleSheetService | null = null;
export function getGoogleSheetService(): GoogleSheetService {
  if (!_service) _service = new GoogleSheetService();
  return _service;
}

/** Đọc dữ liệu sheet phản hồi của Google Form (không cần Apps Script). limit > 0: chỉ đọc N dòng đầu (dòng mới nhất nằm trên). */
export async function fetchFormResponses(limit?: number): Promise<{ headers: string[]; rows: string[][] }> {
  const sheet = getGoogleSheetService();
  if (!sheet.configured) throw new Error('Google Sheets chưa được cấu hình');
  const formId = sheet.formResponsesId;
  if (!formId) throw new Error('Chưa cấu hình Form Responses Sheet ID');

  const meta = await sheet.fetchSpreadsheetMeta(formId);
  const tab = meta.tabs[0];
  if (!tab) throw new Error('Spreadsheet phản hồi không có sheet nào');
  const maxRow = limit && limit > 0 ? Math.min(limit + 1, tab.rowCount) : tab.rowCount;
  const res = await sheet.fetchValues(formId, `${tab.title}!A1:${tab.lastCol}${maxRow}`);
  const values = res ?? [];
  if (values.length === 0) return { headers: [], rows: [] };
  const headers = (values[0] ?? []).map((h) => String(h ?? '').trim());
  const rows = values.slice(1).filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''));
  return { headers, rows };
}

export function candidateDataHash(c: Candidate): string {
  const payload: Record<string, unknown> = {
    id: c.id,
    tenUv: c.tenUv,
    gioiTinh: c.gioiTinh ?? '',
    namSinh: c.namSinh,
    trinhDo: c.trinhDo,
    queQuan: c.queQuan,
    sdtZalo: c.sdtZalo,
    caLam: c.caLam,
    chiNhanh: c.chiNhanh,
    kinhNghiem: c.kinhNghiem,
    xuLy: c.xuLy,
    linkFb: c.linkFb,
    kenhBietTin: c.kenhBietTin ?? '',
    hrDecision: c.hrDecision,
    tongDiem: c.tongDiem,
    aiRecommendation: c.aiRecommendation,
    dataVersion: c.dataVersion,
    ngayBatDauTraining: c.ngayBatDauTraining ? formatDate(c.ngayBatDauTraining) : '',
    trangThaiTraining: c.trangThaiTraining,
  };
  return dataHash(payload);
}

export interface FormResponseRow {
  thoiGian?: string;
  tenUv: string;
  gioiTinh: string;
  namSinh: string;
  trinhDo: string;
  queQuan: string;
  sdtZalo: string;
  caLam: string;
  chiNhanh: string;
  kinhNghiem: string;
  xuLy: string;
  linkFb: string;
  kenhBietTin: string;
}

const FORM_HEADER_ALIASES: Record<string, string[]> = {
  tenUv: ['ten ban la', 'ten', 'ho va ten', 'ho ten'],
  gioiTinh: ['gioi tinh', 'gioi tinh cua ban'],
  namSinh: ['nam sinh', 'nam sinh cua ban'],
  trinhDo: ['trinh do hoc van', 'trinh do'],
  queQuan: ['que quan', 'que quan theo cccd'],
  sdtZalo: ['so dien thoai', 'so dien thoai cua ban', 'sdt', 'zalo'],
  caLam: ['em co the lam ca nao', 'ca lam', 'ca lam viec'],
  chiNhanh: ['chi nhanh', 'chi nhanh em muon ung tuyen'],
  kinhNghiem: ['kinh nghiem', 'kinh nghiem lam viec'],
  xuLy: ['xu ly', 'huong xu ly', 'cong viec dot xuat'],
  linkFb: ['link facebook', 'facebook', 'fb'],
  kenhBietTin: ['biet tin ung tuyen qua hinh thuc', 'biet tin ung tuyen', 'kenh biet tin', 'hinh thuc ung tuyen'],
};

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[\(\)\[\]{}?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapHeaderToField(header: string): string | null {
  const n = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(FORM_HEADER_ALIASES)) {
    if (aliases.some((a) => n.includes(a))) return field;
  }
  return null;
}

/** Tìm cột thời gian phản hồi của Google Form (Tiếng Anh: "Timestamp", Tiếng Việt: "Thời điểm ghi lại phản hồi"). */
export function findTimestampIndex(headers: string[]): number {
  return headers.findIndex((h) => {
    const n = normalizeHeader(h);
    return (
      n.includes('timestamp') ||
      n.includes('thoi diem') ||
      n.includes('thoi gian') ||
      n === 'ngay' ||
      n.includes('ngay ghi')
    );
  });
}

/** Map 1 dòng dữ liệu sheet phản hồi form -> payload tạo hồ sơ. */
export function mapFormResponseRow(headers: string[], row: unknown[]): FormResponseRow | null {
  const mapped: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    const field = mapHeaderToField(headers[i] ?? '');
    if (!field) continue;
    const raw = row[i] ?? '';
    const v = String(raw).trim();
    if (v && mapped[field] === undefined) mapped[field] = v;
  }
  if (!mapped.tenUv || !mapped.sdtZalo) return null;
  return {
    tenUv: mapped.tenUv,
    gioiTinh: mapped.gioiTinh ?? '',
    namSinh: mapped.namSinh ?? '',
    trinhDo: mapped.trinhDo ?? '',
    queQuan: mapped.queQuan ?? '',
    sdtZalo: mapped.sdtZalo,
    caLam: mapped.caLam ?? '',
    chiNhanh: mapped.chiNhanh ?? '',
    kinhNghiem: mapped.kinhNghiem ?? '',
    xuLy: mapped.xuLy ?? '',
    linkFb: mapped.linkFb ?? '',
    kenhBietTin: mapped.kenhBietTin ?? '',
  };
}

/** Parse thời gian phản hồi dạng "15/08/2026 11:20:33" (locale VN) hoặc ISO với múi giờ chuẩn GMT+7. */
export function parseFormTimestamp(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const trimmed = String(v).trim();
  if (!trimmed) return undefined;

  // 1. Parse DD/MM/YYYY HH:mm:ss hoặc DD/MM/YYYY (Google Form Việt Nam)
  const vnMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (vnMatch) {
    const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = vnMatch;
    const day = Number(dd);
    const month = Number(mm);
    const year = Number(yyyy);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const isoStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(ss).padStart(2, '0')}+07:00`;
      const d = new Date(isoStr);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  // 2. Parse YYYY-MM-DD HH:mm:ss hoặc YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (isoMatch) {
    const [, yyyy, mm, dd, hh = '0', mi = '0', ss = '0'] = isoMatch;
    const isoStr = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+07:00`;
    const d = new Date(isoStr);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // 3. Fallback tiêu chuẩn
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) return d;

  return undefined;
}
