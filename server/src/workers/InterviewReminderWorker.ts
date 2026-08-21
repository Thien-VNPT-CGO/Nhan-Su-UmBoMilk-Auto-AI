import { prisma } from '../lib/prisma';
import { emit } from '../sockets';
import { formatDateTime } from '../lib/date';

const remindedCandidateIds = new Set<string>();

export class InterviewReminderWorker {
  private timer: NodeJS.Timeout | null = null;

  start() {
    if (this.timer) return;
    // Chạy ngầm 1 phút / 1 lần
    this.timer = setInterval(() => void this.checkReminders(), 60 * 1000);
    void this.checkReminders();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkReminders() {
    try {
      const now = new Date();
      const in15Mins = new Date(now.getTime() + 15 * 60 * 1000);

      // Tìm các ứng viên có lịch phỏng vấn diễn ra trong vòng 15 phút tới
      const candidates = await prisma.candidate.findMany({
        where: {
          phongVanAt: {
            gte: now,
            lte: in15Mins,
          },
          hrDecision: 'PASS',
        },
      });

      for (const c of candidates) {
        const remindKey = `${c.id}_${c.phongVanAt?.toISOString()}`;
        if (remindedCandidateIds.has(remindKey)) continue;

        remindedCandidateIds.add(remindKey);

        const timeStr = c.phongVanAt ? formatDateTime(c.phongVanAt) : 'Sắp diễn ra';

        // Phát Socket thông báo cho HR trên Web / Desktop Push Notification
        emit('interview:remind_hr', {
          candidateId: c.id,
          candidateName: c.tenUv,
          timeStr,
          ggMeetLink: c.ggMeetLink || 'https://meet.google.com',
        });
      }
    } catch {
      /* ignore worker errors */
    }
  }
}

export const interviewReminderWorker = new InterviewReminderWorker();
