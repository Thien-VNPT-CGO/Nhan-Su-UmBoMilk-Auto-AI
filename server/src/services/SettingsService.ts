import { prisma } from '../lib/prisma';
import { DEFAULT_SETTINGS } from '../lib/constants';
import { dataHash } from '../lib/id';
import { env } from '../config/env';

export type Settings = typeof DEFAULT_SETTINGS;

/** Merge đệ quy: giá trị đã lưu (DB) giữ nguyên, chỉ điền thiếu key từ default (không lấn sâu vào mảng). */
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (pv === undefined || pv === null) continue;
    const bv = out[key];
    if (Array.isArray(pv)) {
      out[key] = pv;
      continue;
    }
    if (typeof pv === 'object') {
      const keys = Object.keys(pv);
      // Object dạng { "0":..., "1":... } (lưu từ SQLite cũ) -> chuyển về mảng
      if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
        out[key] = Object.values(pv as object);
      } else if (typeof bv === 'object' && bv !== null && !Array.isArray(bv)) {
        out[key] = deepMerge(bv as Record<string, unknown>, pv as Record<string, unknown>);
      } else {
        out[key] = pv;
      }
      continue;
    }
    out[key] = pv;
  }
  return out;
}

export function mergeSettings(raw: unknown): Settings {
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
  if (!raw || typeof raw !== 'object') return base;
  return deepMerge(base as unknown as Record<string, unknown>, raw as Record<string, unknown>) as Settings;
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
  // BUG FIX: Env chỉ là FALLBACK khi DB chưa có giá trị — KHÔNG phải override!
  // Trước đây: if (env.zaloAccessToken) base.zalo.accessToken = env.zaloAccessToken
  //   → env LUÔN thắng DB → token mới lưu qua UI bị token cũ trong .env ghi đè ngay lập tức
  // Đúng: chỉ dùng env khi DB đang empty (lần đầu setup, chưa qua OAuth)
  if (env.zaloOaId && !base.zalo.oaId) base.zalo.oaId = env.zaloOaId;
  if (env.zaloAccessToken && !base.zalo.accessToken) base.zalo.accessToken = env.zaloAccessToken;
  if (env.zaloRefreshToken && !base.zalo.refreshToken) base.zalo.refreshToken = env.zaloRefreshToken;
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
  // FIX BUG 5: Dùng deepMerge thay vì shallow spread để tránh overwrite nested fields
  // { ...current, ...patch } chỉ merge top-level → khi patch = { zalo: { accessToken: 'x' } }
  // toàn bộ current.zalo (autoReply, lastRefreshAt, ...) bị XÓA bởi object { accessToken: 'x' }
  const merged = mergeSettings(
    deepMerge(current as unknown as Record<string, unknown>, patch)
  );
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