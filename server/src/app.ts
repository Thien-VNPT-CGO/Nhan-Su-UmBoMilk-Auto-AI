import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { initSocket } from './sockets';
import { syncWorker } from './workers/SyncWorker';
import { reconciliationService } from './services/ReconciliationService';
import { trainingService } from './services/TrainingService';
import { apiLog, errorHandler, notFoundHandler, requestId } from './middleware/errors';

import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import candidateRoutes from './routes/candidates';
import trainingRoutes from './routes/training';
import shiftRoutes from './routes/shifts';
import attendanceRoutes from './routes/attendance';
import zaloRoutes from './routes/zalo';
import syncRoutes from './routes/sync';
import auditRoutes from './routes/audit';
import settingsRoutes from './routes/settings';
import conflictRoutes from './routes/conflicts';
import adminRoutes from './routes/admin';
import webhookRoutes from './routes/webhooks';

export function createApp() {
  const app = express();
  const server = http.createServer(app);

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(requestId);
  app.use(apiLog);

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        time: new Date().toISOString(),
        timezone: env.timezone,
        demoMode: env.demoMode,
      },
    });
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'RATE_LIMITED', message: 'Quá nhiều lần thử đăng nhập. Thử lại sau 15 phút.' },
  });
  const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/dashboard', apiLimiter, dashboardRoutes);
  app.use('/api/candidates', apiLimiter, candidateRoutes);
  app.use('/api/training', apiLimiter, trainingRoutes);
  app.use('/api/shifts', apiLimiter, shiftRoutes);
  app.use('/api/attendance', apiLimiter, attendanceRoutes);
  app.use('/api/zalo', apiLimiter, zaloRoutes);
  app.use('/api/sync', apiLimiter, syncRoutes);
  app.use('/api/audit', apiLimiter, auditRoutes);
  app.use('/api/settings', apiLimiter, settingsRoutes);
  app.use('/api/conflicts', apiLimiter, conflictRoutes);
  app.use('/api/admin', apiLimiter, adminRoutes);
  app.use('/api/webhooks', webhookRoutes);

  // ===== Serve frontend (client/dist) - 1 URL duy nhất cho production =====
  const distCandidates = [
    path.resolve(__dirname, '../../client/dist'),
    path.resolve(process.cwd(), 'client/dist'),
  ];
  const clientDist = distCandidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (clientDist) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
    console.log(`[UMBO MILK] Serving web UI from ${clientDist}`);
  } else {
    console.warn(`[UMBO MILK] Không tìm thấy client/dist (đã thử: ${distCandidates.join(', ')}) - chỉ chạy API. Chạy "npm run build" ở gốc repo để build cả web.`);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, server };
}

export async function startSystem(server: http.Server) {
  // Mỗi bước chạy độc lập: 1 bước lỗi KHÔNG được phép giết các bước khác
  // (nếu không worker nền sẽ không bao giờ khởi động → auto-score/auto-dedup/import chết âm thầm)
  const { prisma } = await import('./lib/prisma');
  try {
    await ensureSeedUsers(prisma);
  } catch (e) {
    console.warn('[startSystem] ensureSeedUsers:', e instanceof Error ? e.message : String(e));
  }
  const { getGoogleSheetService } = await import('./services/GoogleSheetService');
  try {
    await getGoogleSheetService().refreshConfig();
  } catch (e) {
    console.warn('[startSystem] refreshConfig:', e instanceof Error ? e.message : String(e));
  }
  try {
    await backfillXepLoai();
  } catch (e) {
    console.warn('[startSystem] backfillXepLoai:', e instanceof Error ? e.message : String(e));
  }
  initSocket(server);
  syncWorker.start();
  reconciliationService.start(15 * 60 * 1000);
  trainingRefreshTimer = setInterval(() => void trainingService.refreshAll().catch(() => undefined), 60 * 1000);
}

/** Gán xepLoai cho các hồ sơ đã chấm điểm từ trước (khi chưa có cột xepLoai) — idempotent, chạy 1 lần khi boot. */
async function backfillXepLoai() {
  const { prisma } = await import('./lib/prisma');
  const { classifyXepLoai } = await import('./services/CandidateScoringService');
  const rows = await prisma.candidate.findMany({
    where: { xepLoai: null, tongDiem: { not: null } },
    select: { id: true, tongDiem: true },
  });
  let fixed = 0;
  for (const r of rows) {
    const xepLoai = classifyXepLoai(r.tongDiem ?? 0);
    if (xepLoai) {
      await prisma.candidate.update({ where: { id: r.id }, data: { xepLoai } });
      fixed++;
    }
  }
  if (fixed > 0) console.log(`[startSystem] Đã xếp loại lại ${fixed} hồ sơ cũ (Xuất sắc/Giỏi/Đạt)`);
}

/** Tự tạo tài khoản mặc định khi DB trống (idempotent - an toàn cho deploy tự động). */
async function ensureSeedUsers(prisma: typeof import('./lib/prisma').prisma) {
  const count = await prisma.user.count();
  if (count > 0) return;
  const bcrypt = (await import('bcryptjs')).default;
  await prisma.user.createMany({
    data: [
      { username: 'admin', password: await bcrypt.hash('admin123', 10), fullName: 'Quản trị viên', role: 'ADMIN' },
      { username: 'hr_umbomilk', password: await bcrypt.hash('hr123456', 10), fullName: 'HR UMBO Milk', role: 'HR' },
      { username: 'viewer', password: await bcrypt.hash('view1234', 10), fullName: 'Người xem', role: 'VIEWER' },
    ],
  });
  console.log('[startSystem] Đã tạo 3 tài khoản mặc định (DB trống)');
}

let trainingRefreshTimer: NodeJS.Timeout | null = null;

export async function shutdownSystem() {
  syncWorker.stop();
  reconciliationService.stop();
  if (trainingRefreshTimer) clearInterval(trainingRefreshTimer);
  const { prisma } = await import('./lib/prisma');
  await prisma.$disconnect();
}