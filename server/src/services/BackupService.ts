import { google } from 'googleapis';
import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { env } from '../config/env';
import { getSettings } from './SettingsService';
import { notificationService } from './NotificationService';

interface BackupDump {
  createdAt: string;
  appVersion: string;
  tables: Record<string, unknown[]>;
}

type RestoreModel =
  | 'candidate'
  | 'shift'
  | 'attendanceEvent'
  | 'zaloMessage'
  | 'course'
  | 'lesson'
  | 'quizQuestion'
  | 'quizAttempt';

/** Sao lưu JSON toàn bộ dữ liệu + tải lên Google Drive (nếu có service account). */
export class BackupService {
  async createBackup(kind: 'MANUAL' | 'AUTO', trigger: string): Promise<unknown> {
    try {
      const dump = await this.collect();
      const note = JSON.stringify(dump);
      const summary = Object.fromEntries(
        Object.entries(dump.tables).map(([t, rows]) => [t, (rows as unknown[]).length]),
      );

      let driveId: string | null = null;
      try {
        driveId = await this.uploadToDrive(`umbo-milk-backup-${dump.createdAt}.json`, note);
      } catch (e) {
        console.warn('[Backup] upload Drive:', e instanceof Error ? e.message : String(e));
      }

      const rec = await prisma.backupRecord.create({
        data: {
          id: nextId('BAK'),
          kind,
          status: 'OK',
          sizeBytes: Buffer.byteLength(note, 'utf8'),
          summary,
          note,
          driveId,
        },
      });
      return rec;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.backupRecord
        .create({
          data: {
            id: nextId('BAK'),
            kind,
            status: 'FAILED',
            sizeBytes: 0,
            summary: {},
            error: message.slice(0, 500),
          },
        })
        .catch(() => undefined);
      await notificationService
        .notify({
          role: 'ADMIN',
          title: 'Sao lưu thất bại',
          body: message.slice(0, 300),
          type: 'ERROR',
        })
        .catch(() => undefined);
      console.warn('[Backup] createBackup:', message);
      return null;
    }
  }

  async list(limit = 50) {
    const [rows, total] = await Promise.all([
      prisma.backupRecord.findMany({ orderBy: { createdAt: 'desc' }, take: limit }),
      prisma.backupRecord.count(),
    ]);
    return { rows, total };
  }

  async download(id: string): Promise<{ fileName: string; content: string } | null> {
    const rec = await prisma.backupRecord.findUnique({ where: { id } });
    if (!rec || !rec.note) return null;
    return { fileName: `umbo-milk-backup-${rec.createdAt.toISOString().slice(0, 10)}.json`, content: rec.note };
  }

  /**
   * Khôi phục dữ liệu từ bản backup (KHÔNG đụng user/settings để không mất quyền quản trị).
   * Chạy trong transaction; nếu lỗi giữa chừng sẽ rollback toàn bộ.
   */
  async restore(id: string, trigger: string): Promise<{ restored: number }> {
    const rec = await prisma.backupRecord.findUnique({ where: { id } });
    if (!rec || !rec.note) throw new Error('Không tìm thấy bản sao lưu.');

    let dump: BackupDump;
    try {
      dump = JSON.parse(rec.note) as BackupDump;
    } catch {
      throw new Error('Bản sao lưu bị hỏng (JSON không hợp lệ).');
    }

    const restored = await prisma.$transaction(async (tx) => {
      let count = 0;
      const mappings: [RestoreModel, keyof BackupDump['tables']][] = [
        ['candidate', 'candidate'],
        ['shift', 'shift'],
        ['attendanceEvent', 'attendanceEvent'],
        ['zaloMessage', 'zaloMessage'],
        ['course', 'course'],
        ['lesson', 'lesson'],
        ['quizQuestion', 'quizQuestion'],
        ['quizAttempt', 'quizAttempt'],
      ];
      const t = tx as unknown as Record<
        RestoreModel,
        { deleteMany: (a: object) => Promise<unknown>; createMany: (a: { data: unknown[] }) => Promise<unknown> }
      >;
      for (const [model, table] of mappings) {
        const rows = dump.tables[table] ?? [];
        await t[model].deleteMany({});
        if (rows.length > 0) {
          await t[model].createMany({ data: rows });
          count += rows.length;
        }
      }
      return count;
    });

    await prisma.backupRecord.update({ where: { id: rec.id }, data: { status: 'RESTORED' } });
    await notificationService.notify({
      role: 'ADMIN',
      title: 'Khôi phục dữ liệu',
      body: `Đã khôi phục ${restored} dòng dữ liệu từ bản sao lưu ${rec.id} (bởi ${trigger}).`,
      type: 'SUCCESS',
    });
    return { restored };
  }

  private async collect(): Promise<BackupDump> {
    const [candidate, shift, attendanceEvent, zaloMessage, course, lesson, quizQuestion, quizAttempt, notification, systemSetting, user] =
      await Promise.all([
        prisma.candidate.findMany().catch(() => []),
        prisma.shift.findMany().catch(() => []),
        prisma.attendanceEvent.findMany().catch(() => []),
        prisma.zaloMessage.findMany().catch(() => []),
        prisma.course.findMany().catch(() => []),
        prisma.lesson.findMany().catch(() => []),
        prisma.quizQuestion.findMany().catch(() => []),
        prisma.quizAttempt.findMany().catch(() => []),
        prisma.notification.findMany().catch(() => []),
        prisma.systemSetting.findMany().catch(() => []),
        prisma.user.findMany({ select: { id: true, username: true, password: true, fullName: true, role: true, active: true, twoFactorEnabled: true, createdAt: true, updatedAt: true } }).catch(() => []),
      ]);
    return {
      createdAt: new Date().toISOString(),
      appVersion: '1.1.0',
      tables: {
        candidate,
        shift,
        attendanceEvent,
        zaloMessage,
        course,
        lesson,
        quizQuestion,
        quizAttempt,
        notification,
        systemSetting,
        user,
      },
    };
  }

  private async uploadToDrive(fileName: string, content: string): Promise<string | null> {
    const settings = await getSettings();
    const email = settings.googleSheet?.serviceAccountEmail;
    const key = settings.googleSheet?.privateKey;
    if (!email || !key) return null;
    const auth = new google.auth.JWT({
      email,
      key: key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const fileMeta: { name: string; parents?: string[] } = { name: fileName };
    const folderId = env.backupDriveFolder || (settings as any).googleSheet?.driveFolderId || (settings as any).googleDriveFolderId;
    if (folderId) fileMeta.parents = [folderId];
    try {
      const res = await drive.files.create({
        requestBody: fileMeta,
        media: { mimeType: 'application/json', body: content },
        fields: 'id',
      });
      return res.data.id ?? null;
    } catch (e) {
      const errStr = e instanceof Error ? e.message : String(e);
      if (errStr.includes('storage quota') || errStr.includes('Service Accounts do not have storage quota')) {
        console.warn('[Backup] upload Drive: Service Account cần Folder ID chia sẻ (Shared Folder) để lưu file backup. Đã lưu backup an toàn trong CSDL.');
      } else {
        console.warn('[Backup] upload Drive:', errStr);
      }
      return null;
    }
  }
}

export const backupService = new BackupService();