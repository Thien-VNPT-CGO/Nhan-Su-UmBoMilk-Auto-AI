import { prisma } from '../lib/prisma';
import { syncQueue } from '../services/SyncQueueService';
import { getGoogleSheetService } from '../services/GoogleSheetService';
import { importFormResponses } from '../services/FormImportService';
import { emit } from '../sockets';

export class SyncWorker {
  private running = false;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private formTimer: NodeJS.Timeout | null = null;
  private provisioned = false;
  private importingForm = false;

  constructor(intervalMs = 3000) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.formTimer = setInterval(() => {
      void this.tickFormImport();
    }, 60_000);
    void this.tick();
    void this.tickFormImport();
    console.log('[SyncWorker] started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.formTimer) clearInterval(this.formTimer);
    this.formTimer = null;
  }

  /** Tự nhập ứng viên mới từ sheet phản hồi Google Form (không cần Apps Script). */
  private async tickFormImport(): Promise<void> {
    if (!this.running || this.importingForm) return;
    this.importingForm = true;
    try {
      const result = await importFormResponses();
      if (result.enabled && result.lastError) {
        console.warn('[SyncWorker] form import:', result.lastError);
      } else if (result.imported > 0) {
        console.log(`[SyncWorker] form import: +${result.imported} mới, ${result.duplicates} trùng`);
      }
    } catch (e) {
      console.warn('[SyncWorker] form import:', e instanceof Error ? e.message : String(e));
    } finally {
      this.importingForm = false;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const claimed = await syncQueue.claimNext();
    if (!claimed) return;
    void this.provisionIfNeeded();
    void this.process(claimed.jobId);
    // process more jobs in the same tick (small batches)
    setTimeout(() => void this.tick(), 50);
  }

  /** Tự tạo sheet + cột chuẩn 1 lần khi bắt đầu đồng bộ với Google Sheet thật. */
  private async provisionIfNeeded(): Promise<void> {
    if (this.provisioned) return;
    const sheet = getGoogleSheetService();
    if (!sheet.configured) return;
    this.provisioned = true;
    try {
      await sheet.ensureSheets();
      console.log('[SyncWorker] Google Sheets structure ensured');
    } catch (e) {
      this.provisioned = false;
      console.warn('[SyncWorker] ensureSheets:', e instanceof Error ? e.message : String(e));
    }
  }

  private async process(jobId: string): Promise<void> {
    const job = await prisma.syncJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const sheet = getGoogleSheetService();

    if (!sheet.configured) {
      // DEMO MODE: mark SYNCED but flagged as demo - data is preserved in DB,
      // real sync happens automatically when credentials are configured.
      await prisma.syncJob.update({
        where: { id: job.id },
        data: { status: 'SYNCED', lastError: null, nextAttemptAt: null },
      });
      emit('sync:success', { jobId, demo: true });
      return;
    }

    try {
      const candidate = job.candidateId
        ? await prisma.candidate.findUnique({ where: { id: job.candidateId } })
        : null;

      switch (job.entity) {
        case 'candidate': {
          if (job.operation === 'DELETE') {
            await sheet.deleteCandidateRows(job.entityId);
            await prisma.syncJob.update({
              where: { id: job.id },
              data: { status: 'SYNCED', lastError: null, nextAttemptAt: null },
            });
            emit('sync:success', { jobId });
            return;
          }
          if (!candidate) throw new Error(`Candidate ${job.entityId} không tồn tại`);
          if (job.operation === 'CREATE' || job.operation === 'UPSERT' || job.operation === 'UPDATE') {
            await sheet.syncCandidate(candidate);
            await sheet.syncScore(candidate);
            if (candidate.hrDecision === 'PASS' || candidate.ngayBatDauTraining) {
              await sheet.syncTraining(candidate);
            }
          }
          break;
        }
        case 'score': {
          if (!candidate) throw new Error(`Candidate ${job.entityId} không tồn tại`);
          await sheet.syncScore(candidate);
          break;
        }
        case 'training': {
          if (!candidate) throw new Error(`Candidate ${job.entityId} không tồn tại`);
          await sheet.syncTraining(candidate);
          break;
        }
        case 'attendance': {
          if (!candidate) throw new Error(`Candidate ${job.entityId} không tồn tại`);
          await sheet.syncAttendance(candidate);
          break;
        }
        case 'decision': {
          if (!candidate) throw new Error(`Candidate ${job.entityId} không tồn tại`);
          await sheet.syncCandidate(candidate);
          break;
        }
        case 'conflict-resolve': {
          await sheet.syncCandidate(candidate ?? (await prisma.candidate.findUnique({ where: { id: job.entityId } }))!);
          break;
        }
        default:
          throw new Error(`Entity không hỗ trợ: ${job.entity}`);
      }

      // VERIFY
      const hashColOk = await this.verify(job, candidate);
      if (!hashColOk) {
        await syncQueue.markRetry(jobId, 'Verify thất bại: DATA_HASH không khớp');
        return;
      }
      await syncQueue.markSynced(jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isRetryable =
        /timeout|429|500|network|ECONNREFUSED|ETIMEDOUT|rate limit|quota|temporar/i.test(message);
      if (isRetryable) {
        await syncQueue.markRetry(jobId, message);
      } else {
        await syncQueue.markFailed(jobId, message);
      }
    }
  }

  private async verify(job: { candidateId: string | null }, candidate: unknown): Promise<boolean> {
    if (!job.candidateId || !candidate) return true;
    const sheet = getGoogleSheetService();
    try {
      const found = await sheet.findByCandidateId(
        sheet.sheetNames.locHoSo,
        job.candidateId,
      );
      return found !== null;
    } catch {
      return false;
    }
  }
}

export const syncWorker = new SyncWorker();