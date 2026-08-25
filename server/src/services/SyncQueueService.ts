import { prisma } from '../lib/prisma';
import { nextSyncJobId, buildIdempotencyKey } from '../lib/id';
import { emitSync, emitSyncSuccess } from '../sockets';

export interface EnqueueInput {
  entity: string;
  entityId: string;
  operation: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  version: number;
  idempotencyKey?: string;
  candidateId?: string;
}

export const RETRY_BACKOFF_SECONDS = [2, 5, 15, 30, 60, 120, 300, 600];
export const MAX_RETRIES = 8;

export class SyncQueueService {
  // Wake worker ngay khi có job mới (thay vì chờ chu kỳ poll) - do app.ts gán để tránh import vòng.
  private wakeCallback: (() => void) | null = null;

  setWakeCallback(fn: (() => void) | null): void {
    this.wakeCallback = fn;
  }

  private wake(): void {
    try {
      this.wakeCallback?.();
    } catch {
      // bỏ qua nếu worker chưa sẵn sàng
    }
  }

  async enqueue(input: EnqueueInput): Promise<{ jobId: string; deduped: boolean }> {
    const key =
      input.idempotencyKey ??
      buildIdempotencyKey([input.entity, input.entityId, input.operation, `v${input.version}`, input.field ?? '']);

    const existing = await prisma.syncJob.findUnique({ where: { idempotencyKey: key } });
    if (existing && existing.status !== 'FAILED') {
      return { jobId: existing.id, deduped: true };
    }

    let targetCandidateId: string | null = input.candidateId ?? null;
    if (!targetCandidateId) {
      if (input.entity === 'candidate') {
        targetCandidateId = input.entityId;
      } else if (input.entityId.includes(':')) {
        targetCandidateId = input.entityId.split(':')[0];
      } else if (input.entity === 'shift' || input.entity === 'attendance') {
        targetCandidateId = input.entityId;
      }
    }

    if (targetCandidateId) {
      const candidateExists = await prisma.candidate.findUnique({
        where: { id: targetCandidateId },
        select: { id: true },
      });
      if (!candidateExists) {
        targetCandidateId = null;
      }
    }

    try {
      const job = await prisma.syncJob.create({
        data: {
          id: nextSyncJobId(),
          entity: input.entity,
          entityId: input.entityId,
          operation: input.operation,
          field: input.field ?? null,
          oldValue: input.oldValue !== undefined ? JSON.stringify(input.oldValue) : null,
          newValue: input.newValue !== undefined ? JSON.stringify(input.newValue) : null,
          version: input.version,
          status: 'PENDING',
          idempotencyKey: key,
          candidateId: targetCandidateId,
        },
      });

      emitSync({ type: 'enqueued', jobId: job.id, status: 'PENDING' });
      this.wake();
      return { jobId: job.id, deduped: false };
    } catch (e: any) {
      const found = await prisma.syncJob.findUnique({ where: { idempotencyKey: key } });
      if (found) return { jobId: found.id, deduped: true };
      throw e;
    }
  }

  async claimNext(): Promise<{ jobId: string } | null> {
    const now = new Date();
    const job = await prisma.syncJob.findFirst({
      where: {
        status: { in: ['PENDING', 'RETRY'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!job) return null;
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING' },
    });
    return { jobId: job.id };
  }

  async markSynced(jobId: string, syncJobRef?: string): Promise<void> {
    const job = await prisma.syncJob.update({
      where: { id: jobId },
      data: { status: 'SYNCED', lastError: null, nextAttemptAt: null },
    });
    emitSync({ type: 'success', jobId, status: 'SYNCED' });
    if (job.candidateId) {
      const { emit } = await import('../sockets');
      emit('candidate:sync', { candidateId: job.candidateId, jobId, syncJobRef });
      emitSyncSuccess({ jobId, candidateId: job.candidateId });
    }
  }

  async markRetry(jobId: string, error: string): Promise<void> {
    const job = await prisma.syncJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const retryCount = job.retryCount + 1;
    const backoff = RETRY_BACKOFF_SECONDS[Math.min(retryCount - 1, RETRY_BACKOFF_SECONDS.length - 1)];
    const status = retryCount >= MAX_RETRIES ? 'FAILED' : 'RETRY';
    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status,
        retryCount,
        lastError: error.slice(0, 1000),
        nextAttemptAt: status === 'RETRY' ? new Date(Date.now() + backoff * 1000) : null,
      },
    });
    emitSync({ type: status === 'RETRY' ? 'retry' : 'failed', jobId, status, retryCount });
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await prisma.syncJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', lastError: error.slice(0, 1000) },
    });
    emitSync({ type: 'failed', jobId, status: 'FAILED' });
  }

  async markConflict(jobId: string, error: string): Promise<void> {
    await prisma.syncJob.update({
      where: { id: jobId },
      data: { status: 'CONFLICT', lastError: error.slice(0, 1000) },
    });
    emitSync({ type: 'conflict', jobId, status: 'CONFLICT' });
  }

  async retryNow(jobId: string): Promise<void> {
    await prisma.syncJob.update({
      where: { id: jobId },
      data: { status: 'PENDING', retryCount: 0, nextAttemptAt: new Date() },
    });
    emitSync({ type: 'retry-now', jobId });
  }

  async counts(): Promise<Record<string, number>> {
    const groups = await prisma.syncJob.groupBy({ by: ['status'], _count: { _all: true } });
    const c: Record<string, number> = {
      PENDING: 0, PROCESSING: 0, SYNCED: 0, RETRY: 0, FAILED: 0, CONFLICT: 0, TOTAL: 0,
    };
    groups.forEach((g) => {
      c[g.status] = g._count._all;
      c.TOTAL += g._count._all;
    });
    return c;
  }

  async list(filter: { status?: string; limit?: number; offset?: number }): Promise<{ rows: unknown[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    const [rows, total] = await Promise.all([
      prisma.syncJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter.limit ?? 100,
        skip: filter.offset ?? 0,
      }),
      prisma.syncJob.count({ where }),
    ]);
    return { rows, total };
  }
}

export const syncQueue = new SyncQueueService();