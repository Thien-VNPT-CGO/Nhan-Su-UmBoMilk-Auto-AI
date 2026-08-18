import { prisma } from '../lib/prisma';
import { DEFAULT_SETTINGS } from '../lib/constants';
import { dataHash } from '../lib/id';
import { env } from '../config/env';

export type Settings = typeof DEFAULT_SETTINGS;

export function mergeSettings(raw: unknown): Settings {
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof Settings)[]) {
    const v = r[key];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      (base as Record<string, unknown>)[key] = v;
    } else if (typeof v === 'object') {
      const keys = Object.keys(v);
      const arrLike = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
      if (arrLike) {
        (base as Record<string, unknown>)[key] = Object.values(v as object);
      } else {
        (base as Record<string, unknown>)[key] = { ...(base[key] as object), ...(v as object) };
      }
    } else {
      (base as Record<string, unknown>)[key] = v;
    }
  }
  return base;
}

// getSettings() được gọi rất thường xuyên (mỗi worker tick, mỗi lần chấm điểm, mỗi route).
// Trước đây mỗi lần gọi là 1 query DB -> tải DB tăng vọt khi hệ thống xử lý hàng loạt.
// Cache 3s + invalidate khi lưu settings mới giúp giảm ~99% số query này.
const SETTINGS_TTL_MS = 3000;
let settingsCache: { at: number; value: Settings } | null = null;

async function loadSettings(): Promise<Settings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'app_settings' } });
  const base = row
    ? mergeSettings(row.value)
    : (JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings);
  // Fallback env -> settings (Zalo): .env có giá trị thì dùng khi DB chưa lưu
  if (env.zaloOaId) base.zalo.oaId = env.zaloOaId;
  if (env.zaloAccessToken) base.zalo.accessToken = env.zaloAccessToken;
  if (env.zaloRefreshToken) base.zalo.refreshToken = env.zaloRefreshToken;
  return base;
}

export function invalidateSettingsCache(): void {
  settingsCache = null;
}

export async function getSettings(): Promise<Settings> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.value;
  }
  const value = await loadSettings();
  settingsCache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(patch: Record<string, unknown>, updatedBy: string): Promise<Settings> {
  const current = await getSettings();
  const merged = mergeSettings({ ...current, ...patch });
  await prisma.systemSetting.upsert({
    where: { key: 'app_settings' },
    create: { key: 'app_settings', value: merged as object, updatedBy },
    update: { value: merged as object, updatedBy },
  });
  invalidateSettingsCache();
  return merged;
}

export async function getSettingsHash(): Promise<string> {
  const s = await getSettings();
  return dataHash(s as unknown as Record<string, unknown>);
}