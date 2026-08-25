import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { formatDateTime, formatDate } from '../lib/date';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { nextCandidateId } from '../lib/id';
import { employeeAuthService } from '../services/EmployeeAuthService';
import { audit } from '../services/AuditService';
import { emit } from '../sockets';

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

const importSchema = z.object({
  employees: z.array(
    z.object({
      tenUv: z.string().min(1, 'Họ tên không được trống'),
      sdtZalo: z.string().min(1, 'SĐT Zalo không được trống'),
      chiNhanh: z.string().min(1, 'Chi nhánh không được trống'),
      caLam: z.string().min(1, 'Ca làm không được trống'),
      namSinh: z.string().optional(),
      trinhDo: z.string().optional(),
      queQuan: z.string().optional(),
      kinhNghiem: z.string().optional(),
      linkFb: z.string().optional(),
      ngayChinhThuc: z.string().optional(),
    })
  ),
});

officialEmployeesRouter.post('/import', requireAuth, requireRole('ADMIN', 'MANAGER', 'HR'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Dữ liệu file import không hợp lệ.' });
      return;
    }

    const { employees } = parsed.data;
    let insertedCount = 0;
    let updatedCount = 0;
    const errors: { row: number; name: string; error: string }[] = [];

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const lineNo = i + 2; // Row 1 là tiêu đề Excel
      const cleanPhone = emp.sdtZalo.replace(/\D/g, '');

      if (cleanPhone.length < 9) {
        errors.push({ row: lineNo, name: emp.tenUv, error: 'SĐT Zalo không đúng định dạng.' });
        continue;
      }

      try {
        const existing = await prisma.candidate.findFirst({
          where: { sdtZalo: cleanPhone },
        });

        if (existing) {
          const newVersion = existing.dataVersion + 1;
          await prisma.candidate.update({
            where: { id: existing.id },
            data: {
              tenUv: emp.tenUv.trim(),
              chiNhanh: emp.chiNhanh.trim(),
              caLam: emp.caLam.trim(),
              namSinh: emp.namSinh || existing.namSinh,
              trinhDo: emp.trinhDo || existing.trinhDo,
              queQuan: emp.queQuan || existing.queQuan,
              kinhNghiem: emp.kinhNghiem || existing.kinhNghiem,
              linkFb: emp.linkFb || existing.linkFb,
              trangThaiTraining: 'NHAN_VIEN_CHINH_THUC',
              dataVersion: newVersion,
              updatedBy: req.user?.username || 'ADMIN_IMPORT',
            },
          });

          await employeeAuthService.generateKey({
            candidateId: existing.id,
            type: 'OFFICIAL',
            user: req.user?.username || 'ADMIN_IMPORT',
          }).catch(() => null);

          updatedCount++;
        } else {
          const newId = await nextCandidateId(emp.ngayChinhThuc || new Date());
          const newCandidate = await prisma.candidate.create({
            data: {
              id: newId,
              thoiGian: new Date(),
              tenUv: emp.tenUv.trim(),
              sdtZalo: cleanPhone,
              chiNhanh: emp.chiNhanh.trim(),
              caLam: emp.caLam.trim(),
              namSinh: emp.namSinh || '2000',
              trinhDo: emp.trinhDo || 'Không chọn',
              queQuan: emp.queQuan || 'Chưa cập nhật',
              kinhNghiem: emp.kinhNghiem || 'Chưa cập nhật',
              xuLy: 'Nhân viên chính thức (Import)',
              linkFb: emp.linkFb || '',
              trangThaiTraining: 'NHAN_VIEN_CHINH_THUC',
              ngayBatDauTraining: emp.ngayChinhThuc ? new Date(emp.ngayChinhThuc) : new Date(),
              updatedBy: req.user?.username || 'ADMIN_IMPORT',
            },
          });

          await employeeAuthService.generateKey({
            candidateId: newCandidate.id,
            type: 'OFFICIAL',
            user: req.user?.username || 'ADMIN_IMPORT',
          }).catch(() => null);

          insertedCount++;
        }
      } catch (e) {
        errors.push({
          row: lineNo,
          name: emp.tenUv,
          error: e instanceof Error ? e.message : 'Lỗi xử lý cơ sở dữ liệu.',
        });
      }
    }

    await audit({
      user: req.user?.username || 'ADMIN_IMPORT',
      action: 'IMPORT_OFFICIAL_EMPLOYEES',
      entity: 'official_employee',
      entityId: 'BATCH_IMPORT',
      newValue: { insertedCount, updatedCount, totalProcessed: employees.length, errorCount: errors.length },
    });

    emit('official_employees:updated', { count: insertedCount + updatedCount });
    emit('training:updated', {});

    res.json({
      success: true,
      data: {
        insertedCount,
        updatedCount,
        totalProcessed: employees.length,
        errors,
      },
    });
  } catch (e) {
    next(e);
  }
});
