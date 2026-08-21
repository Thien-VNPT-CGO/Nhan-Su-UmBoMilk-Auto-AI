import { prisma } from '../lib/prisma';
import { syncQueue } from '../services/SyncQueueService';
import { getGoogleSheetService } from '../services/GoogleSheetService';
import { importFormResponses } from '../services/FormImportService';
import { dedupService } from '../services/DedupService';
import { candidateScoringService } from '../services/CandidateScoringService';
import { getSettings } from '../services/SettingsService';
import { zaloService } from '../services/ZaloService';
import { notificationService } from '../services/NotificationService';
import { emit, emitSyncSuccess } from '../sockets';
import { nextId } from '../lib/id';
import { dateKey } from '../lib/date';
import { TRAINING_STATUS } from '../lib/constants';

const ENDED_TRAINING_STATUSES = [
  TRAINING_STATUS.HOAN_THANH,
  TRAINING_STATUS.KHONG_DU_NGAY,
  TRAINING_STATUS.LOAI,
  TRAINING_STATUS.NHAN_VIEN_CHINH_THUC,
];

/** Giữ bảng SyncJob gọn: job hoàn tất >7 ngày, job lỗi >30 ngày, job mắc kẹt >1 ngày bị xóa.
 *  Trước đây bảng phình vô hạn -> counts()/list()/_count subquery ngày càng chậm -> web ì. */
const SYNCED_KEEP_DAYS = 7;
const FAILED_KEEP_DAYS = 30;
const STALE_JOB_AGE_MS = 24 * 60 * 60 * 1000;

export class SyncWorker {
  private running = false;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private formTimer: NodeJS.Timeout | null = null;
  private dedupTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private provisioned = false;
  private importingForm = false;
  private runningDedup = false;
  private scoring = false;
  private scoreTimer: NodeJS.Timeout | null = null;
  private noticeTimer: NodeJS.Timeout | null = null;
  private runningNotices = false;
  private interviewTimer: NodeJS.Timeout | null = null;
  private runningInterviews = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private draining = false;
  private alertTimer: NodeJS.Timeout | null = null;
  private runningAlert = false;
  private lastQueueAlertAt = 0;
  private zaloTokenTimer: NodeJS.Timeout | null = null;
  private zaloUserIdTimer: NodeJS.Timeout | null = null;
  private pruneReferralTimer: NodeJS.Timeout | null = null;
  private runningZaloRefresh = false;
  private runningZaloUserId = false;
  private runningPruneReferral = false;

  constructor(intervalMs = 3000) {
    this.intervalMs = intervalMs;
  }

  /** Đánh thức worker ngay khi có job mới (giảm poll DB khi rảnh, job vẫn xử lý tức thì). */
  wake(): void {
    if (!this.running) return;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.draining) return;
    this.draining = true;
    setTimeout(() => {
      this.draining = false;
      void this.tick();
    }, 50);
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
    this.dedupTimer = setInterval(() => {
      void this.tickAutoDedup();
    }, 5 * 60_000);
    this.scoreTimer = setInterval(() => {
      void this.tickAutoScore();
    }, 60_000);
    this.noticeTimer = setInterval(() => {
      void this.tickTrainingNotices();
    }, 60_000);
    this.interviewTimer = setInterval(() => {
      void this.tickInterviewReminders();
    }, 60_000);
    this.pruneTimer = setInterval(() => {
      void this.tickPrune();
    }, 60 * 60_000);
    this.alertTimer = setInterval(() => {
      void this.tickQueueAlert();
    }, 5 * 60_000);
    this.zaloTokenTimer = setInterval(() => {
      void this.tickZaloTokenRefresh();
    }, 60_000);
    this.zaloUserIdTimer = setInterval(() => {
      void this.tickAutoZaloUserId();
    }, 2 * 60_000);
    this.pruneReferralTimer = setInterval(() => {
      void this.tickPruneReferralRejected();
    }, 15 * 60_000);
    void this.tick();
    void this.tickFormImport();
    void this.tickAutoDedup();
    void this.tickAutoScore();
    void this.tickTrainingNotices();
    void this.tickInterviewReminders();
    void this.tickPrune();
    void this.tickQueueAlert();
    void this.tickZaloTokenRefresh();
    void this.tickAutoZaloUserId();
    void this.tickPruneReferralRejected();
    console.log('[SyncWorker] started');
  }


  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.formTimer) clearInterval(this.formTimer);
    this.formTimer = null;
    if (this.dedupTimer) clearInterval(this.dedupTimer);
    this.dedupTimer = null;
    if (this.scoreTimer) clearInterval(this.scoreTimer);
    this.scoreTimer = null;
    if (this.noticeTimer) clearInterval(this.noticeTimer);
    this.noticeTimer = null;
    if (this.interviewTimer) clearInterval(this.interviewTimer);
    this.interviewTimer = null;
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    if (this.alertTimer) clearInterval(this.alertTimer);
    this.alertTimer = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }



  /**
   * Gia hạn token Zalo OA trước khi hết hạn (mỗi 25 ngày) — refresh token xoay vòng
   * nên kết nối Zalo duy trì "vĩnh viễn" mà không cần admin kết nối lại tay.
   */
  private async tickZaloTokenRefresh(): Promise<void> {
    if (!this.running || this.runningZaloRefresh) return;
    this.runningZaloRefresh = true;
    try {
      await zaloService.ensureTokenFresh();
    } catch (e) {
      console.warn('[SyncWorker] zalo token:', e instanceof Error ? e.message : String(e));
    } finally {
      this.runningZaloRefresh = false;
    }
  }

  private async tickAutoZaloUserId(): Promise<void> {
    if (!this.running || this.runningZaloUserId) return;
    this.runningZaloUserId = true;
    try {
      const missingCount = await prisma.candidate.count({ where: { zaloUserId: null } });
      if (missingCount > 0) {
        await zaloService.syncOaUsersAndMatchCandidates();
      }
    } catch (e) {
      console.warn('[SyncWorker] auto zaloUserId:', e instanceof Error ? e.message : String(e));
    } finally {
      this.runningZaloUserId = false;
    }
  }

  /** Tự động xóa các hồ sơ bị LOẠI do thuộc kênh giới thiệu sau 24 giờ. */
  private async tickPruneReferralRejected(): Promise<void> {
    if (!this.running || this.runningPruneReferral) return;
    this.runningPruneReferral = true;
    try {
      const hours24Ago = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const candidates = await prisma.candidate.findMany({
        where: {
          OR: [
            { aiRecommendation: 'FAIL' },
            { xepLoai: null, tongDiem: { not: null } },
          ],
          thoiGian: { lt: hours24Ago },
        },
        select: { id: true, tenUv: true, sdtZalo: true, thoiGian: true, kenhBietTin: true },
      });

      const referralKeywords = ['gioi thieu', 'ban be', 'nguoi quen'];
      const toDelete = candidates.filter((c) => {
        if (!c.kenhBietTin) return false;
        const norm = c.kenhBietTin.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
        return referralKeywords.some((k) => norm.includes(k));
      });

      for (const cand of toDelete) {
        try {
          const cleared = await getGoogleSheetService().clearFormResponseRows(cand.sdtZalo, cand.thoiGian);
          if (cleared > 0) {
            console.log(`[SyncWorker] auto prune referral: cleared ${cleared} dòng Google Sheet cho ${cand.id}`);
          }
        } catch (e) {
          console.warn(`[SyncWorker] auto prune clear Sheet ${cand.id}:`, e instanceof Error ? e.message : String(e));
        }

        await prisma.candidate.delete({ where: { id: cand.id } });
        console.log(`[SyncWorker] 🗑️ Tự động xóa ứng viên LOẠI (Giới thiệu) >24h: ${cand.id} (${cand.tenUv})`);
        emit('candidate:deleted', { candidateId: cand.id });
      }
    } catch (e) {
      console.warn('[SyncWorker] tickPruneReferralRejected:', e instanceof Error ? e.message : String(e));
    } finally {
      this.runningPruneReferral = false;
    }
  }



  /**
   * Monitoring: nếu job đồng bộ mắc kẹt quá X phút (settings.notifications.queueAlertMinutes)
   * → thông báo nội bộ + Telegram/Slack. Cảnh báo lặp tối đa 1 lần/30 phút để không spam.
   */
  private async tickQueueAlert(): Promise<void> {
    if (!this.running || this.runningAlert) return;
    this.runningAlert = true;
    try {
      const settings = await getSettings();
      const minutes = settings.notifications?.queueAlertMinutes ?? 15;
      const oldest = await prisma.syncJob.findFirst({
        where: { status: { in: ['PENDING', 'RETRY', 'PROCESSING'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true },
      });
      if (!oldest) return;
      const ageMs = Date.now() - oldest.createdAt.getTime();
      if (ageMs < minutes * 60_000) return;
      if (Date.now() - this.lastQueueAlertAt < 30 * 60_000) return;
      this.lastQueueAlertAt = Date.now();
      const stuckCount = await prisma.syncJob.count({
        where: { status: { in: ['PENDING', 'RETRY', 'PROCESSING'] } },
      });
      await notificationService.notify({
        role: 'ADMIN',
        title: 'Cảnh báo: đồng bộ bị nghẽn',
        body: `Job ${oldest.id} mắc kẹt ${Math.round(ageMs / 60000)} phút. Tổng ${stuckCount} job đang chờ. Kiểm tra Google Sheets quota/token.`,
        type: 'WARNING',
        link: '/sync',
      });
      console.warn(`[SyncWorker] queue alert: ${oldest.id} stuck ${Math.round(ageMs / 60000)} phút`);
    } catch (e) {
      console.warn('[SyncWorker] queue alert:', e instanceof Error ? e.message : String(e));
    } finally {
      this.runningAlert = false;
    }
  }

  /** Dọn bảng SyncJob cũ định kỳ (1h/lần) - giữ truy vấn nhanh, DB gọn. */
  private async tickPrune(): Promise<void> {
    try {
      const syncedCutoff = new Date(Date.now() - SYNCED_KEEP_DAYS * 24 * 60 * 60 * 1000);
      const failedCutoff = new Date(Date.now() - FAILED_KEEP_DAYS * 24 * 60 * 60 * 1000);
      const staleCutoff = new Date(Date.now() - STALE_JOB_AGE_MS);
      const r = await prisma.syncJob.deleteMany({
        where: {
          OR: [
            { status: 'SYNCED', createdAt: { lt: syncedCutoff } },
            { status: { in: ['RETRY', 'FAILED', 'CONFLICT'] }, createdAt: { lt: failedCutoff } },
            { status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: staleCutoff } },
          ],
        },
      });
      if (r.count > 0) console.log(`[SyncWorker] prune: đã xóa ${r.count} job cũ`);
    } catch (e) {
      console.warn('[SyncWorker] prune:', e instanceof Error ? e.message : String(e));
    }
  }

  /** AI tự chấm điểm hồ sơ vừa đăng ký: chạy mỗi 60s, tối đa 10 hồ sơ/lượt. */
  private async tickAutoScore(): Promise<void> {
    if (!this.running || this.scoring) return;
    this.scoring = true;
    try {
      const settings = await getSettings();
      const autoScoring = (settings as Record<string, unknown>).autoScoring as
        | { enabled?: boolean }
        | undefined;
      if (autoScoring?.enabled === false) return;
      const pending = await prisma.candidate.findMany({
        where: { aiScoredAt: null, aiRecommendation: null },
        orderBy: [{ thoiGian: 'asc' }, { id: 'asc' }],
        take: 10,
      });
      for (const c of pending) {
        await candidateScoringService.scoreCandidate(c, 'SYSTEM-AI');
        console.log(`[SyncWorker] auto score: ${c.id} (${c.tenUv}) = ${c.tongDiem ?? ''}đ`);
      }
      if (pending.length > 0) {
        console.log(`[SyncWorker] auto score: đã chấm ${pending.length} hồ sơ chưa có điểm`);
      }
    } catch (e) {
      console.warn('[SyncWorker] auto score:', e instanceof Error ? e.message : String(e));
    } finally {
      this.scoring = false;
    }
  }

  /** AI tự dọn dữ liệu trùng SĐT: giữ bản mới nhất, xóa các bản trùng + đồng bộ về Google Sheet. */
  private async tickAutoDedup(): Promise<void> {
    if (!this.running || this.runningDedup) return;
    this.runningDedup = true;
    try {
      const settings = await getSettings();
      const autoDedup = (settings as Record<string, unknown>).autoDedup as
        | { enabled?: boolean }
        | undefined;
      if (autoDedup?.enabled === false) return;
      const result = await dedupService.removeDuplicates('SYSTEM-AUTO');
      if (result.removed > 0) {
        console.log(`[SyncWorker] auto dedup: đã loại ${result.removed} bản trùng (${result.groups} nhóm)`);
        emit('dedup:auto', result);
      }
    } catch (e) {
      console.warn('[SyncWorker] auto dedup:', e instanceof Error ? e.message : String(e));
    } finally {
      this.runningDedup = false;
    }
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

  /** Tự động hóa điểm danh: trước giờ làm 30 phút nhắc qua Zalo; hết khung giờ chưa điểm danh → đánh VẮNG. */
  private async tickTrainingNotices(): Promise<void> {
    if (!this.running || this.runningNotices) return;
    this.runningNotices = true;
    try {
      const settings = await getSettings();
      if (!settings.zalo?.accessToken) return; // chưa kết nối Zalo thì không gửi
      const today = dateKey(new Date());
      const now = Date.now();

      const candidates = await prisma.candidate.findMany({
        where: {
          hrDecision: 'PASS',
          ngayBatDauTraining: { not: null },
          trangThaiTraining: { notIn: ENDED_TRAINING_STATUSES },
          sdtZalo: { not: '' },
        },
      });

      for (const c of candidates) {
        const shiftRow = await prisma.shift.findUnique({
          where: { candidateId_date: { candidateId: c.id, date: today } },
        });
        if (!shiftRow) continue;
        const shifts = shiftRow.shifts.split('|').filter((s) => s && s !== 'OFF');
        for (const shift of shifts) {
          const cfg =
            settings.attendance.shifts[shift as keyof typeof settings.attendance.shifts];
          if (!cfg) continue;
          // Giờ bắt đầu ca tính theo múi giờ VN (+07:00) cho đúng kể cả khi server chạy UTC
          const start = new Date(`${today}T${cfg.start}:00+07:00`).getTime();
          if (Number.isNaN(start)) continue;

          // 1) Nhắc điểm danh: 30 phút trước giờ làm (gửi 1 lần/ca/ngày, chống trùng bằng marker)
          if (now >= start - 30 * 60_000 && now < start) {
            const r = await zaloService.sendShiftReminder(
              { id: c.id, tenUv: c.tenUv, sdtZalo: c.sdtZalo, chiNhanh: c.chiNhanh },
              today,
              shift,
              cfg.start,
            );
            if (r.ok) console.log(`[SyncWorker] nhắc điểm danh: ${c.tenUv} ca ${shift}`);
          }

          // 2) Đánh VẮNG: hết khung giờ cho phép mà chưa có lần điểm danh hợp lệ
          const windowEnd = start + (cfg.windowMinutesAfter ?? 0) * 60_000;
          if (now >= windowEnd) {
            const existing = await prisma.attendanceEvent.findUnique({
              where: { candidateId_date_shift: { candidateId: c.id, date: today, shift } },
            });
            if (!existing) {
              await prisma.attendanceEvent.create({
                data: {
                  id: nextId('ATT'),
                  candidateId: c.id,
                  date: today,
                  shift,
                  checkinAt: new Date(),
                  method: 'SYSTEM',
                  valid: false,
                  reason: 'VANG',
                },
              });
              console.log(`[SyncWorker] đánh VẮNG: ${c.tenUv} ca ${shift} ${today}`);
              emit('attendance:checked', { candidateId: c.id, date: today, shift, valid: false });
            }
          }
        }
      }
    } catch (e) {
      console.warn('[SyncWorker] training notices:', e instanceof Error ? e.message : String(e));
    } finally {
      this.runningNotices = false;
    }
  }

  /** Nhắc phỏng vấn qua Zalo: X tiếng trước giờ PV (settings.interview.remindHoursBefore, mặc định 2). */
  private async tickInterviewReminders(): Promise<void> {
    if (!this.running || this.runningInterviews) return;
    this.runningInterviews = true;
    try {
      const settings = await getSettings();
      if (!settings.zalo?.accessToken) return; // chưa kết nối Zalo thì không gửi
      const interview = settings.interview ?? {};
      if (interview.autoRemind === false) return;
      const hours = interview.remindHoursBefore ?? 2;
      const now = Date.now();
      const windowStart = now - 3 * 60_000;
      const windowEnd = now + 3 * 60_000;

      const candidates = await prisma.candidate.findMany({
        where: {
          hrDecision: 'PASS',
          phongVanAt: { not: null },
          interviewStatus: null, // đã xử lý sau PV thì không nhắc nữa
          sdtZalo: { not: '' },
        },
      });

      for (const c of candidates) {
        if (!c.phongVanAt) continue;
        const remindAt = c.phongVanAt.getTime() - hours * 60 * 60 * 1000;
        if (remindAt < windowStart || remindAt > windowEnd) continue;
        const r = await zaloService.sendInterviewReminder(c.id, hours);
        if (r.ok && r.status !== 'SKIP_DUP') {
          console.log(`[SyncWorker] nhắc phỏng vấn: ${c.tenUv} lúc ${c.phongVanAt.toISOString()}`);
        }
      }
    } catch (e) {
      console.warn('[SyncWorker] interview reminders:', e instanceof Error ? e.message : String(e));
    } finally {
      this.runningInterviews = false;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      const claimed = await syncQueue.claimNext();
      if (!claimed) {
        // Rảnh -> poll chậm 5s thay vì 1s (giảm ~5x query DB khi không có việc).
        // Có job mới sẽ được wake() đánh thức ngay lập tức.
        this.idleTimer = setTimeout(() => {
          this.idleTimer = null;
          void this.tick();
        }, 5000);
        return;
      }
      void this.provisionIfNeeded();
      // Xử lý TUẦN TỰ (await) — 2 job cùng lúc sẽ gây append trùng dòng vào Google Sheet
      await this.process(claimed.jobId);
      // Nghỉ nhịp 250ms giữa các job để DB/web không bị nghẽn khi xả hàng loạt job
      setTimeout(() => void this.tick(), 250);
    } catch (e) {
      console.warn('[SyncWorker] tick lỗi:', e instanceof Error ? e.message : String(e));
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        void this.tick();
      }, 5000);
    }
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
    try {
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
      emitSyncSuccess({ jobId, demo: true });
      return;
    }

    try {
      const candidate = job.candidateId
        ? await prisma.candidate.findUnique({ where: { id: job.candidateId } })
        : null;

      if (job.operation !== 'DELETE' && !candidate) {
        await prisma.syncJob.update({
          where: { id: job.id },
          data: { status: 'SYNCED', lastError: 'Bỏ qua: ứng viên đã bị xóa', nextAttemptAt: null },
        });
        emitSyncSuccess({ jobId, skipped: true });
        return;
      }

      switch (job.entity) {
        case 'candidate': {
          if (job.operation === 'DELETE') {
            await sheet.deleteCandidateRows(job.entityId);
            await prisma.syncJob.update({
              where: { id: job.id },
              data: { status: 'SYNCED', lastError: null, nextAttemptAt: null },
            });
            emitSyncSuccess({ jobId });
            return;
          }
          if (!candidate) throw new Error(`Candidate ${job.entityId} không tồn tại`);
          if (job.operation === 'CREATE' || job.operation === 'UPSERT' || job.operation === 'UPDATE') {
            await sheet.syncCandidate(candidate);
            await sheet.syncScore(candidate);
            // HO_SO_NV chỉ ghi khi ứng viên ĐÃ CÓ LỊCH TRAINING (tránh gọi API thừa)
            if (candidate.ngayBatDauTraining) await sheet.syncTraining(candidate);
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

      // Bỏ qua verify đọc lại sheet: append/update của Google API đã trả lỗi nếu thất bại,
      // và upsert luôn đảm bảo dòng tồn tại. Verify cũ làm tăng GẤP ĐÔI số API call mỗi job.
      await syncQueue.markSynced(jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isRetryable =
        /timeout|429|500|network|ECONNREFUSED|ETIMEDOUT|rate limit|quota|temporar/i.test(message);
      try {
        if (isRetryable) {
          await syncQueue.markRetry(jobId, message);
        } else {
          await syncQueue.markFailed(jobId, message);
        }
      } catch (e2) {
        console.warn('[SyncWorker] không cập nhật được trạng thái job:', e2 instanceof Error ? e2.message : String(e2));
      }
    }
    } catch (err) {
      console.warn('[SyncWorker] process lỗi nghiêm trọng:', err instanceof Error ? err.message : String(err));
    }
  }
}

export const syncWorker = new SyncWorker();