import { prisma } from '../lib/prisma';

export interface MonthlyReport {
  month: string;
  candidates: {
    totalNew: number;
    scored: number;
    pendingDecision: number;
    pass: number;
    fail: number;
    review: number;
    byBranch: { branch: string; count: number }[];
  };
  training: {
    inTraining: number;
    completed: number;
    notEnoughDays: number;
    loai: number;
    employees: number;
    startedThisMonth: number;
  };
  attendance: {
    total: number;
    valid: number;
    absent: number;
    byShift: { shift: string; count: number }[];
    byMethod: { method: string; count: number }[];
  };
  zalo: {
    sent: number;
    received: number;
    failed: number;
  };
}

/** Báo cáo tổng hợp theo tháng (YYYY-MM). */
export class ReportService {
  async monthly(month: string, branches: string[] | null = null): Promise<MonthlyReport> {
    const m = /^\d{4}-\d{2}$/.test(month) ? month : currentMonthKey();
    const [y, mo] = m.split('-').map(Number);
    const start = new Date(y, mo - 1, 1, 0, 0, 0, 0);
    const end = new Date(y, mo, 1, 0, 0, 0, 0);
    const scope = branches?.length ? { chiNhanh: { in: branches } } : {};

    const [
      totalNew,
      scored,
      pendingDecision,
      pass,
      fail,
      review,
      byBranch,
      inTraining,
      completed,
      notEnoughDays,
      loai,
      employees,
      startedThisMonth,
      attendanceTotal,
      attendanceValid,
      attendanceAbsent,
      byShift,
      byMethod,
      zaloSent,
      zaloReceived,
      zaloFailed,
    ] = await Promise.all([
      prisma.candidate.count({ where: { thoiGian: { gte: start, lt: end }, ...scope } }),
      prisma.candidate.count({ where: { aiScoredAt: { not: null }, ...scope } }),
      prisma.candidate.count({ where: { tongDiem: { not: null }, hrDecision: null, ...scope } }),
      prisma.candidate.count({ where: { hrDecision: 'PASS', hrDecisionAt: { gte: start, lt: end }, ...scope } }),
      prisma.candidate.count({ where: { hrDecision: 'FAIL', hrDecisionAt: { gte: start, lt: end }, ...scope } }),
      prisma.candidate.count({ where: { hrDecision: 'REVIEW', ...scope } }),
      prisma.candidate.groupBy({ by: ['chiNhanh'], where: { thoiGian: { gte: start, lt: end }, ...scope }, _count: { _all: true } }),
      prisma.candidate.count({ where: { trangThaiTraining: { in: ['SAP_BAT_DAU', 'BAT_DAU'] }, ...scope } }),
      prisma.candidate.count({ where: { trangThaiTraining: { in: ['HOAN_THANH', 'NHAN_VIEN_CHINH_THUC'] }, ...scope } }),
      prisma.candidate.count({ where: { trangThaiTraining: 'KHONG_DU_NGAY', ...scope } }),
      prisma.candidate.count({ where: { trangThaiTraining: 'LOAI', ...scope } }),
      prisma.candidate.count({ where: { trangThaiTraining: 'NHAN_VIEN_CHINH_THUC', ...scope } }),
      prisma.candidate.count({ where: { ngayBatDauTraining: { gte: start, lt: end }, ...scope } }),
      prisma.attendanceEvent.count({ where: { date: { gte: m, lte: endOfMonthKey(m) } } }),
      prisma.attendanceEvent.count({ where: { date: { gte: m, lte: endOfMonthKey(m) }, valid: true } }),
      prisma.attendanceEvent.count({ where: { date: { gte: m, lte: endOfMonthKey(m) }, reason: { contains: 'VANG' } } }),
      prisma.attendanceEvent.groupBy({
        by: ['shift'],
        where: { date: { gte: m, lte: endOfMonthKey(m) } },
        _count: { _all: true },
      }),
      prisma.attendanceEvent.groupBy({
        by: ['method'],
        where: { date: { gte: m, lte: endOfMonthKey(m) } },
        _count: { _all: true },
      }),
      prisma.zaloMessage.count({ where: { direction: 'OUT', createdAt: { gte: start, lt: end } } }),
      prisma.zaloMessage.count({ where: { direction: 'IN', createdAt: { gte: start, lt: end } } }),
      prisma.zaloMessage.count({ where: { status: 'FAILED', createdAt: { gte: start, lt: end } } }),
    ]);

    return {
      month: m,
      candidates: {
        totalNew,
        scored,
        pendingDecision,
        pass,
        fail,
        review,
        byBranch: byBranch.map((b) => ({ branch: b.chiNhanh, count: b._count._all })).sort((a, b) => b.count - a.count),
      },
      training: { inTraining, completed, notEnoughDays, loai, employees, startedThisMonth },
      attendance: {
        total: attendanceTotal,
        valid: attendanceValid,
        absent: attendanceAbsent,
        byShift: byShift.map((s) => ({ shift: s.shift, count: s._count._all })),
        byMethod: byMethod.map((s) => ({ method: s.method, count: s._count._all })),
      },
      zalo: { sent: zaloSent, received: zaloReceived, failed: zaloFailed },
    };
  }

  /** Xuất báo cáo tháng dạng CSV (UTF-8 BOM để mở đúng tiếng Việt trên Excel). */
  async exportCSV(report: MonthlyReport): Promise<string> {
    const lines: string[] = [];
    const row = (cells: (string | number)[]) => cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';');
    lines.push(row(['UMBO MILK - BÁO CÁO THÁNG', report.month]));
    lines.push('');
    lines.push('=== TUYỂN DỤNG ===');
    lines.push(row(['Hồ sơ mới', 'Đã chấm điểm', 'Chờ duyệt', 'Đạt', 'Rớt', 'Cần xem lại']));
    lines.push(
      row([
        report.candidates.totalNew,
        report.candidates.scored,
        report.candidates.pendingDecision,
        report.candidates.pass,
        report.candidates.fail,
        report.candidates.review,
      ]),
    );
    lines.push('');
    lines.push('=== THEO CHI NHÁNH ===');
    lines.push(row(['Chi nhánh', 'Hồ sơ mới']));
    for (const b of report.candidates.byBranch) lines.push(row([b.branch, b.count]));
    lines.push('');
    lines.push('=== ĐÀO TẠO ===');
    lines.push(row(['Đang đào tạo', 'Hoàn thành', 'Không đủ ngày', 'Loại', 'Nhân viên chính thức', 'Bắt đầu tháng này']));
    lines.push(
      row([
        report.training.inTraining,
        report.training.completed,
        report.training.notEnoughDays,
        report.training.loai,
        report.training.employees,
        report.training.startedThisMonth,
      ]),
    );
    lines.push('');
    lines.push('=== CHẤM CÔNG ===');
    lines.push(row(['Tổng lượt điểm danh', 'Hợp lệ', 'Vắng']));
    lines.push(row([report.attendance.total, report.attendance.valid, report.attendance.absent]));
    lines.push('');
    lines.push('=== ZALO ===');
    lines.push(row(['Tin đã gửi', 'Tin nhận được', 'Tin lỗi']));
    lines.push(row([report.zalo.sent, report.zalo.received, report.zalo.failed]));
    return `\uFEFF${lines.join('\r\n')}`;
  }
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function endOfMonthKey(month: string): string {
  const [y, mo] = month.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

export const reportService = new ReportService();