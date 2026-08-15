import { prisma } from '../lib/prisma';
import { DEFAULT_SETTINGS } from '../lib/constants';
import { dataHash } from '../lib/id';

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

export async function getSettings(): Promise<Settings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'app_settings' } });
  if (!row) return DEFAULT_SETTINGS;
  return mergeSettings(row.value);
}

export async function saveSettings(patch: Record<string, unknown>, updatedBy: string): Promise<Settings> {
  const current = await getSettings();
  const merged = mergeSettings({ ...current, ...patch });
  await prisma.systemSetting.upsert({
    where: { key: 'app_settings' },
    create: { key: 'app_settings', value: merged as object, updatedBy },
    update: { value: merged as object, updatedBy },
  });
  return merged;
}

export async function getSettingsHash(): Promise<string> {
  const s = await getSettings();
  return dataHash(s as unknown as Record<string, unknown>);
}