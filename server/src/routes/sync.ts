import { Router } from 'express';
import { requireAuth, requireWrite, requireRole, AuthedRequest } from '../middleware/auth';
import { syncQueue } from '../services/SyncQueueService';
import { reconciliationService } from '../services/ReconciliationService';
import { getGoogleSheetService } from '../services/GoogleSheetService';
import { importFormResponses, getFormImportStatus } from '../services/FormImportService';
import { audit } from '../services/AuditService';
import { ApiError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { emitSyncNotice } from '../sockets';

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

router.post('/reconcile', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    // Chạy nền: reconciliation quét cả sheet + nhiều ứng viên, không được chặn request web
    void reconciliationService.run().catch((e) =>
      console.warn('[sync/reconcile] background:', e instanceof Error ? e.message : String(e)),
    );
    res.json({ success: true, data: { started: true } });
  } catch (e) {
    next(e);
  }
});

/**
 * Liên kết Google Sheet thật: tự động tạo các sheet (tab) + cột chuẩn,
 * sau đó đồng bộ toàn bộ dữ liệu hiện có xuống. Demo mode → enqueue full resync.
 */
router.post('/form-import', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    // Chạy nền (import có thể xử lý hàng chục dòng, mỗi dòng nhiều write DB):
    // trả về ngay, client theo dõi qua socket 'candidate:new' / trang Sync Center.
    void importFormResponses()
      .then((result) => {
        if (result.imported > 0 || result.lastError) {
          void audit({
            user: req.user!.username,
            action: 'FORM_IMPORT',
            entity: 'system',
            entityId: 'google_form',
            newValue: { ...result, ...getFormImportStatus() } as unknown as Record<string, unknown>,
          }).catch(() => undefined);
        }
      })
      .catch((e) =>
        console.warn('[sync/form-import] background:', e instanceof Error ? e.message : String(e)),
      );
    const status = getFormImportStatus();
    res.json({ success: true, data: { started: true, ...status } });
  } catch (e) {
    next(e);
  }
});

router.post('/provision', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const sheet = getGoogleSheetService();
    await sheet.refreshConfig();

    if (!sheet.configured || req.body?.spreadsheetId === 'DEMO') {
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

    // Google Sheet thật: tạo cấu trúc + fullResync có thể mất nhiều phút
    // (N candidate x 3 sheet x nhiều API call) → chạy nền, web không bị treo.
    void (async () => {
      try {
        const { created, columnsAdded } = await sheet.ensureSheets();
        const { candidates } = await sheet.fullResync();
        await audit({
          user: req.user!.username,
          action: 'PROVISION_SHEET',
          entity: 'system',
          entityId: sheet.sheetNames.locHoSo,
          newValue: { created, columnsAdded, candidates },
        });
        emitSyncNotice('provision', { done: true, created, columnsAdded, candidates });
      } catch (e) {
        console.warn('[sync/provision] background:', e instanceof Error ? e.message : String(e));
        emitSyncNotice('provision', { done: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    res.json({ success: true, data: { started: true, demo: false } });
  } catch (e) {
    next(e);
  }
});

export default router;