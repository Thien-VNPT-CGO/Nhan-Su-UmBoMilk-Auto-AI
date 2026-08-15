import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { dashboardService } from '../services/DashboardService';
import { syncQueue } from '../services/SyncQueueService';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    const overview = await dashboardService.overview();
    const shifts = await dashboardService.shiftsSummary();
    const syncCounts = await syncQueue.counts();
    res.json({ success: true, data: { overview, shifts, syncCounts } });
  } catch (e) {
    next(e);
  }
});

export default router;