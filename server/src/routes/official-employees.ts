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

      let totalFine = 0;
      let late5pCount = 0;
      let late30pCount = 0;
      let late60pCount = 0;
      let raSomCount = 0;

      attended.forEach((a) => {
        const r = (a.reason || '').toUpperCase();
        if (r.includes('RA_SOM') || r.includes('SỚM')) {
          raSomCount++;
          totalFine += 50000;
        } else if (r.includes('VAO_TRE_60P') || r.includes('60P')) {
          late60pCount++;
          const shiftWage = a.shift === 'CA_CHIEU' ? 153000 : 127500;
          totalFine += shiftWage;
        } else if (r.includes('VAO_TRE_30P') || r.includes('30P')) {
          late30pCount++;
          const shiftWage = a.shift === 'CA_CHIEU' ? 153000 : 127500;
          totalFine += Math.round(shiftWage * 0.5);
        } else if (r.includes('VAO_TRE_5P') || r.includes('TRE_PHAT_50K') || r.includes('5P') || r.includes('TRE') || r.includes('TRỄ')) {
          late5pCount++;
          totalFine += 30000;
        }
      });

      const totalLate = late5pCount + late30pCount + late60pCount;

      const latestEvent = attended[0];
      const isLatestLate = latestEvent && !!(latestEvent.reason && (latestEvent.reason.includes('TRE') || latestEvent.reason.includes('TRỄ')));
      const isLatestRaSom = latestEvent && !!(latestEvent.reason && (latestEvent.reason.includes('RA_SOM') || latestEvent.reason.includes('SỚM')));

      const latestStatusStr = latestEvent
        ? `${formatDateTime(latestEvent.createdAt)} - ${isLatestRaSom ? 'RA SỚM (50K)' : isLatestLate ? 'VÀO TRỄ' : 'ĐÚNG GIỜ'}`
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
        late5pCount,
        late30pCount,
        late60pCount,
        raSomCount,
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
          totalRaSom: result.reduce((sum, r) => sum + r.raSomCount, 0),
          totalFine: result.reduce((sum, r) => sum + r.tongTienPhat, 0),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
