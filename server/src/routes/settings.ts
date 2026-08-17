import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { getSettings, saveSettings } from '../services/SettingsService';
import { getAIProvider } from '../services/ai/AIClient';
import { getGoogleSheetService } from '../services/GoogleSheetService';
import { zaloService } from '../services/ZaloService';
import { audit } from '../services/AuditService';
import { ApiError } from '../lib/errors';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    const settings = await getSettings();
    const sheet = getGoogleSheetService();
    const users = await prisma.user.findMany({ select: { id: true, username: true, fullName: true, role: true, active: true } });
    const conflicts = await prisma.conflict.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
    res.json({
      success: true,
      data: {
        settings,
        googleSheetConfigured: sheet.configured,
        demoMode: !sheet.configured,
        users,
        conflicts,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.put('/', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = z.record(z.unknown()).safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const before = await getSettings();
    const settings = await saveSettings(parsed.data as never, req.user!.username);
    await audit({
      user: req.user!.username,
      action: 'UPDATE_SETTINGS',
      entity: 'system',
      entityId: 'app_settings',
      newValue: Object.keys(parsed.data),
    });

    // Liên kết Google Sheet thật: refresh config + tự tạo sheet/cột + đồng bộ toàn bộ
    let provision: Record<string, unknown> | null = null;
    const sheet = getGoogleSheetService();
    await sheet.refreshConfig();
    const googleChanged =
      JSON.stringify((before.googleSheet ?? {})) !== JSON.stringify((settings.googleSheet ?? {}));
    if (googleChanged) {
      if (!sheet.configured) {
        provision = { demo: true, note: 'Chưa cấu hình Service Account — hệ thống vẫn chạy DEMO MODE.' };
      } else {
        try {
          const { created, columnsAdded } = await sheet.ensureSheets();
          const { candidates } = await sheet.fullResync();
          provision = { demo: false, created, columnsAdded, candidates };
        } catch (e) {
          provision = {
            demo: false,
            error: e instanceof Error ? e.message : String(e),
            note: 'Cấu hình đã lưu nhưng chưa truy cập được spreadsheet — kiểm tra ID / quyền Service Account.',
          };
        }
      }
    }

    res.json({ success: true, data: { settings, provision } });
  } catch (e) {
    next(e);
  }
});

let healthCache: { at: number; data: unknown } | null = null;

router.get('/health', async (_req, res, next) => {
  try {
    if (healthCache && Date.now() - healthCache.at < 10_000) {
      res.json({ success: true, data: healthCache.data });
      return;
    }
    const sheet = getGoogleSheetService();
    const ai = await getAIProvider();
    const [dbOk, sheetOk, aiOk, zaloOk] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      sheet.ping().catch(() => false),
      ai.ping().catch(() => false),
      zaloService.ping().catch(() => false),
    ]);
    const data = {
      node: true,
      database: dbOk,
      googleSheet: sheetOk,
      ai: aiOk,
      zalo: zaloOk,
      demoMode: !sheet.configured,
    };
    healthCache = { at: Date.now(), data };
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;