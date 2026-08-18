import { prisma } from '../lib/prisma';
import { dateKey, addDays } from '../lib/date';

export class DashboardService {
  async overview(branches: string[] | null = null) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const scope = branches?.length ? { chiNhanh: { in: branches } } : {};

    const [
      today,
      aiScoring,
      pendingDecision,
      passToday,
      failToday,
      interviewToday,
      training,
      doneTraining,
      needReview,
      funnel,
      candidate7d,
      trainingByBranch,
    ] = await Promise.all([
      prisma.candidate.count({ where: { thoiGian: { gte: todayStart, lte: todayEnd }, ...scope } }),
      prisma.candidate.count({ where: { aiScoredAt: { not: null }, tongDiem: null, ...scope } }),
      prisma.candidate.count({ where: { tongDiem: { not: null }, hrDecision: null, ...scope } }),
      prisma.candidate.count({ where: { hrDecision: 'PASS', hrDecisionAt: { gte: todayStart, lte: todayEnd }, ...scope } }),
      prisma.candidate.count({ where: { hrDecision: 'FAIL', hrDecisionAt: { gte: todayStart, lte: todayEnd }, ...scope } }),
      prisma.candidate.count({ where: { phongVanAt: { gte: todayStart, lte: todayEnd }, ...scope } }),
      prisma.candidate.count({ where: { trangThaiTraining: { in: ['SAP_BAT_DAU', 'BAT_DAU'] }, ...scope } }),
      prisma.candidate.count({ where: { trangThaiTraining: { in: ['HOAN_THANH', 'NHAN_VIEN_CHINH_THUC'] }, ...scope } }),
      prisma.candidate.count({ where: { hrDecision: 'REVIEW', ...scope } }),
      prisma.candidate.groupBy({ by: ['hrDecision'], where: scope, _count: { _all: true } }),
      this.candidatesLast7Days(scope),
      prisma.candidate.groupBy({ by: ['chiNhanh'], where: { trangThaiTraining: { not: null }, ...scope }, _count: { _all: true } }),
    ]);

    const funnelTotal = funnel.reduce((a, b) => a + b._count._all, 0);

    return {
      today,
      aiScoring,
      pendingDecision,
      passToday,
      failToday,
      interviewToday,
      training,
      doneTraining,
      needReview,
      funnel: funnelTotal
        ? funnel.map((f) => ({ stage: f.hrDecision ?? 'CHUA_XU_LY', count: f._count._all }))
        : [],
      candidate7d,
      trainingByBranch: trainingByBranch.map((b) => ({ branch: b.chiNhanh, count: b._count._all })),
    };
  }

  private async candidatesLast7Days(scope: Record<string, unknown>) {
    const out: { date: string; count: number }[] = [];
    // Chạy song song thay vì tuần tự 7 query nối tiếp (mỗi query ~vài trăm ms trên DB chậm)
    const counts = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(new Date(), -(6 - i));
        const start = new Date(d);
        start.setHours(0, 0, 0, 0);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        return prisma.candidate.count({ where: { thoiGian: { gte: start, lte: end }, ...scope } });
      }),
    );
    counts.forEach((count, i) => {
      out.push({ date: dateKey(addDays(new Date(), -(6 - i))), count });
    });
    return out;
  }

  async shiftsSummary() {
    const today = dateKey();
    const candidates = await prisma.candidate.findMany({
      where: { hrDecision: 'PASS', trangThaiTraining: { in: ['SAP_BAT_DAU', 'BAT_DAU'] } },
      select: { id: true },
    });
    const [shifts, attended] = await Promise.all([
      prisma.shift.findMany({ where: { date: today } }),
      prisma.attendanceEvent.findMany({ where: { date: today, valid: true } }),
    ]);
    const byCandidate = new Map<string, string[]>();
    shifts.forEach((s) => byCandidate.set(s.candidateId, s.shifts.split('|')));
    const total = candidates.length;
    let checked = 0;
    let needsAttention = 0;
    candidates.forEach((c) => {
      const list = byCandidate.get(c.id) ?? [];
      if (list.length && list.some((s) => attended.some((a) => a.candidateId === c.id && a.shift === s))) checked++;
      if (list.length && !list.some((s) => attended.some((a) => a.candidateId === c.id && a.shift === s))) needsAttention++;
    });
    const done = await prisma.candidate.count({ where: { trangThaiTraining: { in: ['HOAN_THANH', 'NHAN_VIEN_CHINH_THUC'] } } });
    return {
      total,
      checked,
      done,
      needsAttention,
      shifts: { SANG: '06:45 → 07:05', CHIEU: '11:45 → 12:05', TOI: '17:45 → 18:05' },
    };
  }
}

export const dashboardService = new DashboardService();