import dotenv from 'dotenv';

dotenv.config();

function int(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return ['1', 'true', 'TRUE', 'yes'].includes(v);
}

export const env = {
  port: int(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',
  redisUrl: process.env.REDIS_URL ?? '',
  timezone: process.env.TIMEZONE ?? 'Asia/Ho_Chi_Minh',
  demoMode: bool(process.env.DEMO_MODE, true),
  sessionSecret: process.env.SESSION_SECRET ?? 'insecure-dev-secret',
  sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 7),
  webhookSecret: process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret',

  googleSheetId: process.env.GOOGLE_SHEET_ID ?? '',
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
  googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY ?? '',
  sheetNameLocHoSo: process.env.SHEET_NAME_LOC_HO_SO ?? 'LOC_HO_SO_PV',
  sheetNameDiemUv: process.env.SHEET_NAME_DIEM_UV ?? 'DIEM_UV',
  sheetNameHoSoNv: process.env.SHEET_NAME_HO_SO_NV ?? 'HO_SO_NHAN_VIEN_UNG_TUYEN',

  aiProvider: process.env.AI_PROVIDER ?? 'mock',
  aiBaseUrl: process.env.AI_BASE_URL ?? '',
  aiApiKey: process.env.AI_API_KEY ?? '',
  aiModel: process.env.AI_MODEL ?? 'gpt-4o-mini',

  zaloOaId: process.env.ZALO_OA_ID ?? '',
  zaloAccessToken: process.env.ZALO_ACCESS_TOKEN ?? '',
  zaloRefreshToken: process.env.ZALO_REFRESH_TOKEN ?? '',
  zaloAppId: process.env.ZALO_APP_ID ?? '',
  zaloAppSecret: process.env.ZALO_APP_SECRET ?? '',
  zaloRedirectUri: process.env.ZALO_REDIRECT_URI ?? 'http://localhost:3000/api/zalo/oauth-callback',

  // ===== Nâng cấp v1.1: Monitoring + Backup =====
  sentryDsn: process.env.SENTRY_DSN ?? '',
  backupAutoDays: int(process.env.BACKUP_AUTO_DAYS, 7),
  backupDriveFolder: process.env.BACKUP_DRIVE_FOLDER ?? '',
};

export const isProd = env.nodeEnv === 'production';
export const isDemo = env.demoMode || !env.googleSheetId;
