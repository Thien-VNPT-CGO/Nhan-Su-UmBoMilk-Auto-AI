import { Router } from 'express';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { backupService } from '../services/BackupService';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    const data = await backupService.list();
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.post('/', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const rec = await backupService.createBackup('MANUAL', req.user!.username);
    res.json({ success: true, data: rec });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/download', async (req, res, next) => {
  try {
    const data = await backupService.download(String(req.params.id));
    if (!data) throw ApiError.notFound('BACKUP_NOT_FOUND', 'Không tìm thấy bản sao lưu.');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${data.fileName}"`);
    res.send(data.content);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/restore', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const data = await backupService.restore(String(req.params.id), req.user!.username);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;