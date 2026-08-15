import { createHash, randomBytes } from 'crypto';
import { env } from '../config/env';
import { dateKey, TZ } from './date';

export function sha256(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function dataHash(payload: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(payload).sort()) sorted[k] = payload[k];
  return sha256(sorted);
}

export function randomId(prefix: string, len = 12): string {
  return `${prefix}${randomBytes(len).toString('hex').toUpperCase()}`;
}

const usedToday = new Map<string, number>();

export async function nextCandidateId(): Promise<string> {
  const today = dateKey().replace(/-/g, ''); // yyyyMMdd
  const cur = usedToday.get(today);
  if (cur !== undefined) {
    const next = cur + 1;
    usedToday.set(today, next);
    return `UV-${today}-${String(next).padStart(5, '0')}`;
  }
  // after restart: recover last sequence from DB
  const { prisma } = await import('./prisma');
  const last = await prisma.candidate.findFirst({
    where: { id: { startsWith: `UV-${today}-` } },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  let seq = 0;
  if (last) {
    const m = last.id.match(/^UV-\d{8}-(\d+)$/);
    if (m) seq = Number(m[1]);
  }
  const next = seq + 1;
  usedToday.set(today, next);
  return `UV-${today}-${String(next).padStart(5, '0')}`;
}

export function nextSyncJobId(): string {
  return `SYNC-${String(Math.floor(Math.random() * 900000) + 100000)}`;
}

export function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function buildIdempotencyKey(parts: string[]): string {
  return parts.join(':');
}
