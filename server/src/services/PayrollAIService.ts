import { prisma } from '../lib/prisma';
import { dateKey } from '../lib/date';

export class PayrollAIService {
  /** Tính toán Lương & Phụ cấp AI theo thời gian thực (Realtime Payroll Engine) */
  async calculateRealtimePayroll(candidateId: string) {
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        attendanceEvents: {
          where: { valid: true },
          orderBy: { date: 'asc' },
        },
      },
    });

    if (!candidate) return null;

    // 1. Phân lọc danh sách các ca/ngày ĐÃ HOÀN THÀNH CẢ CHECK-IN VÀ CHECK-OUT
    const completedEvents = candidate.attendanceEvents.filter(
      (a) => a.checkoutAt != null || a.reason?.includes('CHECK_OUT') || a.method === 'MANUAL' || a.method === 'SYSTEM'
    );

    const completedDaysSet = new Set(completedEvents.map((a) => a.date));
    const completedDaysCount = completedDaysSet.size;

    // 2. Tính tổng số tiền phạt từ các ca đi trễ
    let totalFines = 0;
    candidate.attendanceEvents.forEach((att) => {
      const r = (att.reason || '').toUpperCase();
      if (r.includes('VAO_TRE_60P') || r.includes('60P')) {
        totalFines += candidate.caLam?.includes('CHIỀU') || candidate.caLam?.includes('CHIEU') ? 153000 : 127500;
      } else if (r.includes('VAO_TRE_30P') || r.includes('30P')) {
        totalFines += candidate.caLam?.includes('CHIỀU') || candidate.caLam?.includes('CHIEU') ? 76500 : 63750;
      } else if (r.includes('VAO_TRE_5P') || r.includes('TRE_PHAT_30K') || r.includes('5P')) {
        totalFines += 30000;
      }
    });

    // 3. Phân loại tính toán theo trạng thái (Training vs Chính thức)
    const isOfficial = candidate.trangThaiTraining === 'NHAN_VIEN_CHINH_THUC';

    if (!isOfficial) {
      // BẢNG LƯƠNG/PHỤ CẤP TRAINING (Tối đa 7 ngày)
      const dailyAllowance = 150000; // 150.000đ / ngày training đạt
      const grossAllowance = Math.min(7, completedDaysCount) * dailyAllowance;
      const netPayroll = Math.max(0, grossAllowance - totalFines);

      return {
        type: 'TRAINING',
        completedDays: Math.min(7, completedDaysCount),
        targetDays: 7,
        progressPercent: Math.min(100, Math.round((Math.min(7, completedDaysCount) / 7) * 100)),
        dailyWage: dailyAllowance,
        grossSalary: grossAllowance,
        totalFines,
        netSalary: netPayroll,
        currencyStr: `${netPayroll.toLocaleString('vi-VN')}đ`,
        summaryText: `Đã hoàn thành ${Math.min(7, completedDaysCount)}/7 ngày training hợp lệ. Phụ cấp dự tính: ${netPayroll.toLocaleString('vi-VN')}đ`,
      };
    } else {
      // BẢNG LƯƠNG NHÂN VIÊN CHÍNH THỨC
      const normCa = (candidate.caLam || '').toLowerCase();
      let shiftWage = 127500; // 5 tiếng x 25.500đ = 127.500đ (Ca Sáng/Tối)
      if (normCa.includes('chieu') || normCa.includes('12h')) shiftWage = 153000; // 6 tiếng x 25.500đ = 153.000đ (Ca Chiều)

      const grossSalary = completedEvents.length * shiftWage;
      const netPayroll = Math.max(0, grossSalary - totalFines);

      return {
        type: 'OFFICIAL',
        completedShifts: completedEvents.length,
        shiftWage,
        grossSalary,
        totalFines,
        netSalary: netPayroll,
        currencyStr: `${netPayroll.toLocaleString('vi-VN')}đ`,
        summaryText: `Tổng ${completedEvents.length} ca hoàn thành. Lương dự tính tháng: ${netPayroll.toLocaleString('vi-VN')}đ`,
      };
    }
  }
}

export const payrollAIService = new PayrollAIService();
