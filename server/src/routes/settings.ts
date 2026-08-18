import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { getSettings, saveSettings } from '../services/SettingsService';
import { getAIProvider } from '../services/ai/AIClient';
import { getGoogleSheetService } from '../services/GoogleSheetService';
import { zaloService } from '../services/ZaloService';
import { audit } from '../services/AuditService';
import { Prisma } from '@prisma/client';
import { ApiError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { notificationService } from '../services/NotificationService';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    const settings = await getSettings();
    const sheet = getGoogleSheetService();
    const users = await prisma.user.findMany({
      select: { id: true, username: true, fullName: true, role: true, active: true, twoFactorEnabled: true, branchScope: true },
    });
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

/** Cập nhật tài khoản: vai trò, trạng thái, phạm vi chi nhánh (phân quyền theo chi nhánh). */
const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'HR', 'VIEWER']).optional(),
  active: z.boolean().optional(),
  branchScope: z.array(z.string()).nullable().optional(),
});

router.post('/users/:id', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const user = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'Không tìm thấy tài khoản.');
    if (user.username === req.user!.username && parsed.data.active === false) {
      throw ApiError.badRequest('INVALID_INPUT', 'Không thể vô hiệu hóa tài khoản đang đăng nhập.');
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: parsed.data.fullName,
        role: parsed.data.role,
        active: parsed.data.active,
        branchScope:
          parsed.data.branchScope === undefined
            ? undefined
            : parsed.data.branchScope === null
              ? Prisma.JsonNull
              : parsed.data.branchScope,
      },
    });
    await audit({
      user: req.user!.username,
      action: 'UPDATE_USER',
      entity: 'user',
      entityId: user.id,
      newValue: { role: updated.role, active: updated.active, branchScope: updated.branchScope },
    });
    res.json({
      success: true,
      data: {
        id: updated.id,
        username: updated.username,
        fullName: updated.fullName,
        role: updated.role,
        active: updated.active,
        twoFactorEnabled: updated.twoFactorEnabled,
        branchScope: updated.branchScope,
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
        // fullResync (N candidate x 3 sheet x nhiều API call) chạy NỀN để web không treo
        provision = { started: true, note: 'Đang tạo cấu trúc + đồng bộ dữ liệu trong nền.' };
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
          } catch (e) {
            console.warn('[settings] fullResync background:', e instanceof Error ? e.message : String(e));
          }
        })();
      }
    }

    res.json({ success: true, data: { settings, provision } });
  } catch (e) {
    next(e);
  }
});

let healthCache: { at: number; data: unknown } | null = null;

/** Xóa dữ liệu kết nối Zalo (OA id + token) — icon trên web tắt ngay sau khi gọi. */
router.post('/zalo/disconnect', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    await saveSettings(
      { zalo: { oaId: '', accessToken: '', refreshToken: '' } },
      req.user!.username,
    );
    await audit({
      user: req.user!.username,
      action: 'DISCONNECT_ZALO',
      entity: 'system',
      entityId: 'app_settings',
    });
    healthCache = null; // health check sẽ chạy lại ngay, icon Zalo tắt
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.get('/health', async (_req, res, next) => {
  try {
    if (healthCache && Date.now() - healthCache.at < 10_000) {
      res.json({ success: true, data: healthCache.data });
      return;
    }
    const sheet = getGoogleSheetService();
    const ai = await getAIProvider();
    const settings = await getSettings();
    const [dbOk, sheetOk, aiOk, zaloOk, queueAgeMs, lastSyncAt] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      sheet.ping().catch(() => false),
      ai.ping().catch(() => false),
      zaloService.ping().catch(() => false),
      // Monitoring: job đồng bộ mắc kẹt lâu nhất (PENDING/RETRY/PROCESSING)
      prisma.syncJob
        .findFirst({
          where: { status: { in: ['PENDING', 'RETRY', 'PROCESSING'] } },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        })
        .then((j) => (j ? Date.now() - j.createdAt.getTime() : 0))
        .catch(() => 0),
      prisma.syncJob
        .findFirst({ where: { status: 'SYNCED' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } })
        .then((j) => j?.updatedAt.toISOString() ?? null)
        .catch(() => null),
    ]);
    const data = {
      node: true,
      database: dbOk,
      googleSheet: sheetOk,
      ai: aiOk,
      zalo: zaloOk,
      demoMode: !sheet.configured,
      autoReply: settings.zalo.autoReply,
      queueAgeMs,
      lastSyncAt,
    };
    healthCache = { at: Date.now(), data };
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/** Gửi thử thông báo nội bộ + Telegram/Slack (kiểm tra cấu hình). */
router.post('/notify-test', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    await notificationService.notify({
      role: 'ADMIN',
      title: 'Thông báo kiểm tra',
      body: `Cấu hình thông báo hoạt động tốt (bởi ${req.user!.username}).`,
      type: 'SUCCESS',
    });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;