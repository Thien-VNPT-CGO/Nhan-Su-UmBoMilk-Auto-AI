import { google, sheets_v4 } from 'googleapis';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { getSettings } from './SettingsService';
import { formatDateTime, formatDate, dateKey } from '../lib/date';
import { dataHash } from '../lib/id';
import type { Candidate } from '@prisma/client';

export const LOC_HO_SO_COLS = [
  'CANDIDATE_ID', 'THOI_GIAN', 'TEN_UV', 'NAM_SINH', 'TRINH_DO', 'QUE_QUAN',
  'SDT_ZALO', 'CA_LAM', 'CHI_NHANH', 'KINH_NGHIEM', 'XU_LY', 'LINK_FB',
  'KET_QUA_PV', 'DATA_VERSION', 'UPDATED_AT', 'UPDATED_BY', 'SYNC_STATUS', 'DATA_HASH',
];

export const DIEM_UV_COLS = [
  'CANDIDATE_ID', 'D_HO_TEN', 'D_NAM_SINH', 'D_QUE_QUAN', 'D_SDT', 'D_TRINH_DO',
  'D_KINH_NGHIEM', 'D_XU_LY', 'D_LINK_FB',
  'P_HO_TEN', 'P_NAM_SINH', 'P_QUE_QUAN', 'P_SDT', 'P_TRINH_DO', 'P_KINH_NGHIEM',
  'P_XU_LY', 'P_LINK_FB',
  'TONG_DIEM', 'AI_RECOMMENDATION', 'AI_NOTE', 'AI_CONFIDENCE', 'DATA_VERSION', 'UPDATED_AT',
];

export const HO_SO_NV_COLS = [
  'CANDIDATE_ID', 'THOI_GIAN', 'TEN_UV', 'NAM_SINH', 'TRINH_DO', 'QUE_QUAN', 'SDT_ZALO',
  'CA_LAM', 'CHI_NHANH', 'NGAY_BAT_DAU_TRAINING',
  'TRAINING_DAY_1', 'TRAINING_DAY_2', 'TRAINING_DAY_3', 'TRAINING_DAY_4',
  'TRAINING_DAY_5', 'TRAINING_DAY_6', 'TRAINING_DAY_7',
  'SO_NGAY_DA_TRAINING', 'TRANG_THAI_TRAINING', 'UPDATED_AT', 'UPDATED_BY', 'DATA_VERSION', 'SYNC_STATUS',
];

export interface SheetConfig {
  spreadsheetId: string;
  email: string;
  key: string;
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
      if (c.hrDecision === 'PASS' || c.ngayBatDauTraining) {
        await this.syncTraining(c);
      }
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
    const score = (c.aiScore as Record<string, unknown> | null) ?? {};
    const row: (string | number)[] = LOC_HO_SO_COLS.map((col) => {
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
        case 'KINH_NGHIEM': return c.kinhNghiem;
        case 'XU_LY': return c.xuLy;
        case 'LINK_FB': return c.linkFb;
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
        case 'P_HO_TEN': return g('p_hoTen');
        case 'P_NAM_SINH': return g('p_namSinh');
        case 'P_QUE_QUAN': return g('p_queQuan');
        case 'P_SDT': return g('p_sdt');
        case 'P_TRINH_DO': return g('p_trinhDo');
        case 'P_KINH_NGHIEM': return g('p_kinhNghiem');
        case 'P_XU_LY': return g('p_xuLy');
        case 'P_LINK_FB': return g('p_linkFb');
        case 'TONG_DIEM': return c.tongDiem ?? '';
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
  async syncTraining(c: Candidate): Promise<void> {
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

  private async upsert(sheetName: string, row: (string | number)[], candidateId: string, createIfMissing: boolean): Promise<void> {
    const found = await this.findByCandidateId(sheetName, candidateId);
    if (found) {
      await this.updateRow(sheetName, found.rowIndex, row);
    } else if (createIfMissing) {
      await this.appendRow(sheetName, row);
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

export function candidateDataHash(c: Candidate): string {
  const payload: Record<string, unknown> = {
    id: c.id,
    tenUv: c.tenUv,
    namSinh: c.namSinh,
    trinhDo: c.trinhDo,
    queQuan: c.queQuan,
    sdtZalo: c.sdtZalo,
    caLam: c.caLam,
    chiNhanh: c.chiNhanh,
    kinhNghiem: c.kinhNghiem,
    xuLy: c.xuLy,
    linkFb: c.linkFb,
    hrDecision: c.hrDecision,
    tongDiem: c.tongDiem,
    aiRecommendation: c.aiRecommendation,
    dataVersion: c.dataVersion,
    ngayBatDauTraining: c.ngayBatDauTraining ? formatDate(c.ngayBatDauTraining) : '',
    trangThaiTraining: c.trangThaiTraining,
  };
  return dataHash(payload);
}
