import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { emit } from '../sockets';
import { getSettings } from './SettingsService';

export type NotificationType = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

interface NotifyInput {
  /** null = broadcast (userId null) */
  userId?: string | null;
  /** lọc thêm khi userId null */
  role?: string | null;
  title: string;
  body: string;
  type?: NotificationType;
  link?: string;
}

/** Thông báo nội bộ (bell trên web) + tự động gửi ra Telegram/Slack nếu cấu hình. */
export class NotificationService {
  async notify(input: NotifyInput): Promise<unknown> {
    const notif = await prisma.notification.create({
      data: {
        id: nextId('NTF'),
        userId: input.userId ?? null,
        role: input.role ?? null,
        title: input.title,
        body: input.body,
        type: input.type ?? 'INFO',
        link: input.link ?? null,
      },
    });
    emit('notification:new', { id: notif.id, title: input.title, body: input.body, type: input.type ?? 'INFO' });
    void this.sendExternal(input.title, input.body).catch(() => undefined);
    return notif;
  }

  /** Lấy danh sách thông báo: của user + broadcast (userId null) khớp role. */
  async list(user: { id: string; role: string }, limit = 50, unreadOnly = false) {
    const where: Record<string, unknown> = {
      OR: [
        { userId: user.id },
        { userId: null, role: null },
        { userId: null, role: user.role },
      ],
    };
    if (unreadOnly) where.read = false;
    const [rows, total, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, read: false } }),
    ]);
    return { rows, total, unread };
  }

  async markRead(id: string, userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    await prisma.notification.updateMany({
      where: { userId: null, read: false },
      data: { read: true },
    });
  }

  /** Gửi cảnh báo ra ngoài (Telegram Bot / Slack webhook) — không throw để không phá luồng chính. */
  private async sendExternal(title: string, body: string): Promise<void> {
    const settings = await getSettings();
    const cfg = settings.notifications ?? {};
    const text = `🔔 ${title}\n${body}`;
    if (cfg.telegramBotToken && cfg.telegramChatId) {
      await fetch(`https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.telegramChatId, text }),
      });
    }
    if (cfg.slackWebhookUrl) {
      await fetch(cfg.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    }
  }
}

export const notificationService = new NotificationService();