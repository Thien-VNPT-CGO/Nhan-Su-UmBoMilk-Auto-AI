import { Router } from 'express';
import { requireAuth, AuthedRequest, branchScope } from '../middleware/auth';
import { reportService } from '../services/ReportService';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

router.get('/monthly', async (req: AuthedRequest, res, next) => {
  try {
    const month = String(req.query.month ?? '');
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      throw ApiError.badRequest('INVALID_INPUT', 'Tháng phải có định dạng YYYY-MM.');
    }
    const data = await reportService.monthly(month, branchScope(req.user));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.get('/export', async (req: AuthedRequest, res, next) => {
  try {
    const month = String(req.query.month ?? '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw ApiError.badRequest('INVALID_INPUT', 'Tháng phải có định dạng YYYY-MM.');
    }
    const report = await reportService.monthly(month, branchScope(req.user));
    const csv = await reportService.exportCSV(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-${month}.csv"`);
    res.send(csv);
  } catch (e) {
    next(e);
  }
});

export default router;