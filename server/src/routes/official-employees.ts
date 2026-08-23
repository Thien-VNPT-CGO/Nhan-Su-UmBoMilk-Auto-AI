import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { formatDateTime, formatDate } from '../lib/date';

export const officialEmployeesRouter = Router();

officialEmployeesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, chiNhanh, caLam } = req.query;

    const whereClause: Record<string, unknown> = {
      trangThaiTraining: 'NHAN_VIEN_CHINH_THUC',
    };

    if (search && typeof search === 'string') {
      const q = search.trim();
      whereClause.OR = [
        { id: { contains: q } },
        { tenUv: { contains: q } },
        { sdtZalo: { contains: q } },
      ];
    }

    if (chiNhanh && typeof chiNhanh === 'string' && chiNhanh !== 'ALL') {
      whereClause.chiNhanh = { contains: chiNhanh };
    }

    if (caLam && typeof caLam === 'string' && caLam !== 'ALL') {
      whereClause.caLam = { contains: caLam };
    }

    const [allOfficial, employees] = await Promise.all([
      prisma.candidate.findMany({
        where: { trangThaiTraining: 'NHAN_VIEN_CHINH_THUC' },
        select: { chiNhanh: true, caLam: true },
      }),
      prisma.candidate.findMany({
        where: whereClause,
        include: {
          attendanceEvents: {
            where: { valid: true },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const uniqueBranches = Array.from(new Set(allOfficial.map((c) => c.chiNhanh).filter(Boolean)));
    const uniqueShifts = Array.from(new Set(allOfficial.map((c) => c.caLam).filter(Boolean)));

    const result = employees.map((c) => {
      const attended = c.attendanceEvents;
      const totalShifts = attended.length;
      const isEventLate = (a: { reason: string | null }) => !!(a.reason && (a.reason.includes('TRE') || a.reason.includes('TRỄ')));
      const lateEvents = attended.filter(isEventLate);
      const totalLate = lateEvents.length;
      const totalFine = totalLate * 50000;

      const latestEvent = attended[0];
      const latestStatusStr = latestEvent
        ? `${formatDateTime(latestEvent.createdAt)} - ${isEventLate(latestEvent) ? 'TRỄ (50.000đ)' : 'ĐÚNG GIỜ'}`
        : 'CHƯA ĐIỂM DANH';

      return {
        id: c.id,
        tenUv: c.tenUv,
        sdtZalo: c.sdtZalo,
        chiNhanh: c.chiNhanh,
        caLam: c.caLam,
        ngayChinhThuc: formatDate(c.updatedAt),
        tongSoCaDaLam: totalShifts,
        tongSoCaTre: totalLate,
        tongTienPhat: totalFine,
        lichSuDiemDanhMoiNhat: latestStatusStr,
        trangThai: 'DANG_LAM_VIEC',
        dataVersion: c.dataVersion,
        updatedAt: c.updatedAt,
      };
    });

    res.json({
      success: true,
      data: {
        items: result,
        total: result.length,
        branches: uniqueBranches,
        shifts: uniqueShifts,
        summary: {
          totalEmployees: result.length,
          totalShifts: result.reduce((sum, r) => sum + r.tongSoCaDaLam, 0),
          totalLate: result.reduce((sum, r) => sum + r.tongSoCaTre, 0),
          totalFine: result.reduce((sum, r) => sum + r.tongTienPhat, 0),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
