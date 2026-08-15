import { prisma } from '../lib/prisma';
import { DEFAULT_SETTINGS } from '../lib/constants';
import { dataHash } from '../lib/id';

export type Settings = typeof DEFAULT_SETTINGS;

export function mergeSettings(raw: unknown): Settings {
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof Settings)[]) {
    if (r[key] !== undefined && typeof r[key] === 'object' && r[key] !== null) {
      (base as Record<string, unknown>)[key] = { ...(base[key] as object), ...(r[key] as object) };
    } else if (r[key] !== undefined) {
      (base as Record<string, unknown>)[key] = r[key];
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