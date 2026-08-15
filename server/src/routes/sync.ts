import { Router } from 'express';
import { requireAuth, requireWrite, requireRole, AuthedRequest } from '../middleware/auth';
import { syncQueue } from '../services/SyncQueueService';
import { reconciliationService } from '../services/ReconciliationService';
import { getGoogleSheetService } from '../services/GoogleSheetService';
import { audit } from '../services/AuditService';
import { ApiError } from '../lib/errors';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const counts = await syncQueue.counts();
    const list = await syncQueue.list({
      status: String(req.query.status ?? ''),
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0,
    });
    res.json({ success: true, data: { counts, ...list } });
  } catch (e) {
    next(e);
  }
});

router.post('/retry/:jobId', requireWrite(), async (req, res, next) => {
  try {
    const job = await prisma.syncJob.findUnique({ where: { id: req.params.jobId } });
    if (!job) throw ApiError.notFound('SYNC_JOB_NOT_FOUND', 'Không tìm thấy job.');
    await syncQueue.retryNow(job.id);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/retry-all', requireWrite(), async (req, res, next) => {
  try {
    const jobs = await prisma.syncJob.findMany({ where: { status: { in: ['FAILED', 'CONFLICT'] } } });
    for (const j of jobs) await syncQueue.retryNow(j.id);
    res.json({ success: true, data: { retried: jobs.length } });
  } catch (e) {
    next(e);
  }
});

router.post('/reconcile', requireWrite(), async (req: AuthedRequest, _res, next) => {
  try {
    await reconciliationService.run();
    next();
  } catch (e) {
    next(e);
  }
});

/**
 * Liên kết Google Sheet thật: tự động tạo các sheet (tab) + cột chuẩn,
 * sau đó đồng bộ toàn bộ dữ liệu hiện có xuống. Demo mode → enqueue full resync.
 */
router.post('/provision', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const sheet = getGoogleSheetService();
    await sheet.refreshConfig();

    if (!sheet.configured) {
      const candidates = await prisma.candidate.findMany({ orderBy: { id: 'asc' } });
      let enqueued = 0;
      for (const c of candidates) {
        const r = await syncQueue.enqueue({
          entity: 'candidate',
          entityId: c.id,
          operation: 'UPDATE',
          version: c.dataVersion,
          idempotencyKey: `fullresync-${c.id}-v${c.dataVersion}`,
        });
        if (!r.deduped) enqueued++;
      }
      await audit({
        user: req.user!.username,
        action: 'PROVISION_SHEET',
        entity: 'system',
        entityId: 'google_sheet',
        newValue: { demo: true, candidates: candidates.length, enqueued },
      });
      res.json({
        success: true,
        data: { demo: true, created: [], columnsAdded: {}, candidates: candidates.length, enqueued },
      });
      return;
    }

    const { created, columnsAdded } = await sheet.ensureSheets();
    const { candidates } = await sheet.fullResync();
    await audit({
      user: req.user!.username,
      action: 'PROVISION_SHEET',
      entity: 'system',
      entityId: sheet.sheetNames.locHoSo,
      newValue: { created, columnsAdded, candidates },
    });
    res.json({ success: true, data: { demo: false, created, columnsAdded, candidates } });
  } catch (e) {
    next(e);
  }
});

export default router;