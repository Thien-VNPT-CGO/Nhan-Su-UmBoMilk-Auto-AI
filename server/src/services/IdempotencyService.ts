import { prisma } from '../lib/prisma';
import { addDays } from '../lib/date';

export class IdempotencyService {
  async has(key: string): Promise<boolean> {
    const row = await prisma.idempotencyKey.findUnique({ where: { key } });
    if (!row) return false;
    if (row.expiresAt < new Date()) {
      await prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
      return false;
    }
    return true;
  }

  async get(key: string): Promise<unknown | null> {
    const row = await prisma.idempotencyKey.findUnique({ where: { key } });
    if (!row) return null;
    if (row.expiresAt < new Date()) {
      await prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
      return null;
    }
    try {
      return row.response ? JSON.parse(row.response) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, response: unknown, ttlDays = 30): Promise<void> {
    await prisma.idempotencyKey.upsert({
      where: { key },
      create: { key, response: JSON.stringify(response ?? null), expiresAt: addDays(new Date(), ttlDays) },
      update: { response: JSON.stringify(response ?? null), expiresAt: addDays(new Date(), ttlDays) },
    });
  }
}

export const idempotencyService = new IdempotencyService();
