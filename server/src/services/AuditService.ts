import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';

export interface AuditEntry {
  user: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  version?: number | null;
  ip?: string | null;
  syncJobId?: string | null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        id: nextId('AUD'),
        user: entry.user,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        oldValue: entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
        newValue: entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
        version: entry.version ?? null,
        time: new Date(),
        ip: entry.ip ?? null,
        syncJobId: entry.syncJobId ?? null,
      },
    });
  } catch {
    // audit must never break business flow
  }
}

export async function listAudit(filter: {
  entityId?: string;
  action?: string;
  user?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};
  if (filter.entityId) where.entityId = filter.entityId;
  if (filter.action) where.action = filter.action;
  if (filter.user) where.user = filter.user;
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { time: 'desc' },
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total };
}