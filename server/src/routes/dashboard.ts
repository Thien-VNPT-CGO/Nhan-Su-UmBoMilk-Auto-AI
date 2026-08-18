import { Router } from 'express';
import { requireAuth, AuthedRequest, branchScope } from '../middleware/auth';
import { dashboardService } from '../services/DashboardService';
import { syncQueue } from '../services/SyncQueueService';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const overview = await dashboardService.overview(branchScope(req.user));
    const shifts = await dashboardService.shiftsSummary();
    const syncCounts = await syncQueue.counts();
    res.json({ success: true, data: { overview, shifts, syncCounts } });
  } catch (e) {
    next(e);
  }
});

export default router;