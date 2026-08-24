import { Router } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { audit } from '../services/AuditService';
import { nextId } from '../lib/id';
import { TRAINING_STATUS } from '../lib/constants';

const router = Router();

// Endpoint lấy thông tin ứng viên phỏng vấn từ Web công khai
router.get('/candidates/:id/interview-info', async (req, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        tenUv: true,
        sdtZalo: true,
        chiNhanh: true,
        caLam: true,
        trangThaiTraining: true,
        phongVanAt: true,
        ggMeetLink: true,
      },
    });

    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy thông tin ứng viên.');
    }

    res.json({ success: true, data: candidate });
  } catch (e) {
    next(e);
  }
});

const confirmSchema = z.object({
  action: z.enum(['ACCEPT', 'REJECT']),
  reason: z.string().optional(),
});

// Endpoint ứng viên xác nhận / từ chối phỏng vấn từ Web công khai
router.post('/candidates/:id/confirm-pv', async (req, res, next) => {
  try {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Phản hồi không hợp lệ.');
    }

    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    }

    const { action } = parsed.data;
    const targetStatus = action === 'ACCEPT' ? 'XAC_NHAN_PV' : 'TU_CHOI_PV';

    const newVersion = candidate.dataVersion + 1;
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        trangThaiTraining: targetStatus,
        dataVersion: newVersion,
        updatedBy: 'PUBLIC_WEB_CANDIDATE',
      },
    });

    await audit({
      user: `CANDIDATE:${candidate.id}`,
      action: 'PUBLIC_CONFIRM_INTERVIEW',
      entity: 'candidate',
      entityId: candidate.id,
      newValue: {
        candidateId: candidate.id,
        candidateName: candidate.tenUv,
        action: action === 'ACCEPT' ? 'CONFIRMED_ACCEPT' : 'CONFIRMED_REJECT',
        newStatus: targetStatus,
      },
    });

    res.json({
      success: true,
      data: {
        candidateId: candidate.id,
        candidateName: candidate.tenUv,
        status: targetStatus,
        message: action === 'ACCEPT' ? 'Xác nhận tham gia phỏng vấn thành công!' : 'Đã ghi nhận phản hồi từ chối.',
      },
    });
  } catch (e) {
    next(e);
  }
});

// Endpoint lấy thông tin điểm danh công khai cho ứng viên
router.get('/candidates/:id/attendance-info', async (req, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        tenUv: true,
        sdtZalo: true,
        chiNhanh: true,
        caLam: true,
        ngayBatDauTraining: true,
        soNgayDaTraining: true,
        trangThaiTraining: true,
      },
    });

    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy thông tin điểm danh của ứng viên.');
    }

    const now = new Date();
    const rawShift = candidate.caLam || 'CA_SANG';
    let startHour = 7;
    let startMin = 0;
    let endHour = 12;
    let endMin = 0;

    if (rawShift.toLowerCase().includes('chieu') || rawShift.includes('12h') || rawShift.toLowerCase().includes('trua')) {
      startHour = 12;
      startMin = 0;
      endHour = 18;
      endMin = 0;
    } else if (rawShift.toLowerCase().includes('toi') || rawShift.includes('18h')) {
      startHour = 18;
      startMin = 0;
      endHour = 23;
      endMin = 0;
    }

    const shiftStartTime = new Date(now);
    shiftStartTime.setHours(startHour, startMin, 0, 0);
    const allowedEarlyTime = new Date(shiftStartTime.getTime() - 30 * 60 * 1000);

    const isTooEarly = now < allowedEarlyTime;
    const earlyMinutes = isTooEarly ? Math.ceil((allowedEarlyTime.getTime() - now.getTime()) / (60 * 1000)) : 0;
    const allowedTimeStr = `${String(allowedEarlyTime.getHours()).padStart(2, '0')}:${String(allowedEarlyTime.getMinutes()).padStart(2, '0')}`;
    const shiftTimeRangeStr = `${String(startHour).padStart(2, '0')}:00 - ${String(endHour).padStart(2, '0')}:00`;

    res.json({
      success: true,
      data: {
        ...candidate,
        isTooEarly,
        earlyMinutes,
        allowedTimeStr,
        shiftTimeRangeStr,
      },
    });
  } catch (e) {
    next(e);
  }
});

const checkinSchema = z.object({
  image: z.string().min(1, 'Chưa truyền hình ảnh chụp cửa hàng'),
  note: z.string().optional(),
  type: z.enum(['CHECK_IN', 'CHECK_OUT']).default('CHECK_IN'),
});

// Endpoint ứng viên nộp hình ảnh & xác nhận điểm danh (Check-in / Check-out) từ Web công khai
router.post('/candidates/:id/attendance-checkin', async (req, res, next) => {
  try {
    const parsed = checkinSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Thông tin điểm danh không hợp lệ.');
    }

    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    }

    const { image, type } = parsed.data;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

    // 1. Phân loại tên Chi nhánh & Ca làm việc cho cấu trúc Folder Google Drive
    const typeFolder = candidate.trangThaiTraining === 'NHAN_VIEN_CHINH_THUC' ? 'NHAN_VIEN_CHINH_THUC' : 'NHAN_VIEN_TRAINING';
    const rawBranch = candidate.chiNhanh || 'CN1: 130 Vạn Kiếp, Phường 3, Quận Bình Thạnh';
    const cleanBranch = rawBranch.replace(/[\\/:*?"<>|]/g, '_').trim();

    const rawShift = candidate.caLam || 'CA_SANG';
    let shiftFolder = 'CA_SANG';
    let startHour = 7;
    let startMin = 0;
    let endHour = 12;
    let endMin = 0;

    if (rawShift.toLowerCase().includes('chieu') || rawShift.includes('12h') || rawShift.toLowerCase().includes('trua')) {
      shiftFolder = 'CA_CHIEU';
      startHour = 12;
      startMin = 0;
      endHour = 18;
      endMin = 0;
    } else if (rawShift.toLowerCase().includes('toi') || rawShift.includes('18h')) {
      shiftFolder = 'CA_TOI';
      startHour = 18;
      startMin = 0;
      endHour = 23;
      endMin = 0;
    }

    const shiftStartTime = new Date(now);
    shiftStartTime.setHours(startHour, startMin, 0, 0);

    const shiftEndTime = new Date(now);
    shiftEndTime.setHours(endHour, endMin, 0, 0);

    // 2. KHI VÀO CA (CHECK-IN): RÀNG BUỘC KHUNG GIỜ
    if (type === 'CHECK_IN') {
      const allowedEarlyTime = new Date(shiftStartTime.getTime() - 30 * 60 * 1000);
      if (now < allowedEarlyTime) {
        const earlyMins = Math.ceil((allowedEarlyTime.getTime() - now.getTime()) / (60 * 1000));
        const allowedTimeStr = `${String(allowedEarlyTime.getHours()).padStart(2, '0')}:${String(allowedEarlyTime.getMinutes()).padStart(2, '0')}`;
        throw ApiError.badRequest(
          'CHECKIN_TOO_EARLY',
          `Chưa đến khung giờ điểm danh! Bạn đang mở quá sớm ${earlyMins} phút. Khung giờ cho phép điểm danh bắt đầu từ ${allowedTimeStr} (trước ca 30 phút).`
        );
      }
    }

    const cleanCandidateName = `${candidate.tenUv} - ${candidate.sdtZalo.replace(/\D/g, '')}`.replace(/[\\/:*?"<>|]/g, '_');
    const actionFolder = type === 'CHECK_OUT' ? `RaCa_Ngay_${dateStr}` : `VaoCa_Ngay_${dateStr}`;

    // 3. Thư mục Google Drive backup
    const driveBackupDir = path.join(
      process.cwd(),
      'uploads',
      'drive_backup',
      typeFolder,
      cleanBranch,
      shiftFolder,
      cleanCandidateName,
      actionFolder
    );

    if (!fs.existsSync(driveBackupDir)) {
      fs.mkdirSync(driveBackupDir, { recursive: true });
    }

    // 4. Lưu file ảnh chụp cửa hàng Anh_chup_cua_hang.jpg
    const imageFileName = `Anh_chup_cua_hang.jpg`;
    const imageFilePath = path.join(driveBackupDir, imageFileName);
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(imageFilePath, base64Data, { encoding: 'base64' });

    // 5. Tạo file văn bản Diem_danh.txt
    const txtContent = `${type === 'CHECK_OUT' ? 'XÁC NHẬN RA CA UBM' : 'ĐIỂM DANH UBM'}
====================================
Họ tên: ${candidate.tenUv}
Số điện thoại: ${candidate.sdtZalo}
Mã UV: ${candidate.id}
Chi nhánh: ${candidate.chiNhanh || 'Chưa chốt'}
Ca làm: ${candidate.caLam || 'Chưa chốt'}
Loại: ${type === 'CHECK_OUT' ? 'CHECK-OUT (RA CA)' : 'CHECK-IN (VÀO CA)'}
Mốc thời gian: ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
====================================`;

    const txtFilePath = path.join(driveBackupDir, 'Diem_danh.txt');
    fs.writeFileSync(txtFilePath, txtContent, 'utf8');

    // 6. Tính toán Vi phạm & Tiền phạt theo QUY CHẾ LÀM VIỆC (25.500đ/1h)
    let isLate = false;
    let isEarlyLeave = false;
    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    let fineAmount = 0;
    let errCode = 'VALID_ON_TIME';
    let fineLabel = '';

    // Lương tiêu chuẩn ca
    let shiftHours = 5;
    if (shiftFolder === 'CA_CHIEU') shiftHours = 6;
    const shiftBaseWage = shiftHours * 25500;

    if (type === 'CHECK_IN') {
      const graceEndTime = new Date(shiftStartTime.getTime() + 4 * 60 * 1000 + 59 * 1000); // Trễ dưới 5m -> Đúng giờ
      if (now > graceEndTime) {
        isLate = true;
        lateMinutes = Math.max(5, Math.floor((now.getTime() - shiftStartTime.getTime()) / (60 * 1000)));

        if (lateMinutes < 30) {
          fineAmount = 30000;
          errCode = `VAO_TRE_5P_30K_${lateMinutes}M`;
          fineLabel = 'VÀO TRỄ 5P (PHẠT 30.000Đ)';
        } else if (lateMinutes < 60) {
          fineAmount = Math.round(shiftBaseWage * 0.5);
          errCode = `VAO_TRE_30P_50PERCENT_${lateMinutes}M`;
          fineLabel = `VÀO TRỄ 30P (PHẠT 50% LƯƠNG CA = ${fineAmount.toLocaleString('vi-VN')}đ)`;
        } else {
          fineAmount = shiftBaseWage;
          errCode = `VAO_TRE_60P_100PERCENT_${lateMinutes}M`;
          fineLabel = `VÀO TRỄ ≥ 60P (PHẠT 100% LƯƠNG CA = ${fineAmount.toLocaleString('vi-VN')}đ)`;
        }
      }
    } else if (type === 'CHECK_OUT') {
      // RA CA SỚM: Phạt 50.000 đ / lần nếu ra sớm trước ca > 5 phút
      const allowedCheckOutTime = new Date(shiftEndTime.getTime() - 5 * 60 * 1000); // Cho phép ra ca trước tối đa 5 phút
      if (now < allowedCheckOutTime) {
        isEarlyLeave = true;
        earlyLeaveMinutes = Math.ceil((shiftEndTime.getTime() - now.getTime()) / (60 * 1000));
        fineAmount = 50000; // Phạt 50.000đ / lần theo quy chế RA SOM
        errCode = `RA_SOM_50K_${earlyLeaveMinutes}M`;
        fineLabel = `RA CA SỚM ${earlyLeaveMinutes} PHÚT (PHẠT 50.000Đ/LẦN)`;
      } else {
        errCode = 'CHECK_OUT_ON_TIME';
        fineLabel = 'RA CA ĐÚNG GIỜ';
      }
    }

    // Ghi nhận sự kiện AttendanceEvent
    await prisma.attendanceEvent.create({
      data: {
        id: nextId('ATT'),
        candidateId: candidate.id,
        date: dateStr,
        shift: shiftFolder,
        checkinAt: now,
        method: 'PUBLIC_WEB',
        valid: true,
        reason: errCode,
        lat: null,
        lng: null,
      },
    });

    // 7. Cập nhật số ngày đào tạo (+1 khi Check-in) & trạng thái ĐANG TRAINING
    let newDaysDone = candidate.soNgayDaTraining;
    if (type === 'CHECK_IN') {
      newDaysDone = Math.min(7, candidate.soNgayDaTraining + 1);
    }

    const newVersion = candidate.dataVersion + 1;
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        soNgayDaTraining: newDaysDone,
        trangThaiTraining: newDaysDone >= 7 ? TRAINING_STATUS.HOAN_THANH : TRAINING_STATUS.BAT_DAU,
        dataVersion: newVersion,
        updatedBy: `PUBLIC_ATTENDANCE_${type}`,
      },
    });

    await audit({
      user: 'PUBLIC_ATTENDANCE_PAGE',
      action: type === 'CHECK_OUT' ? 'CANDIDATE_CHECKOUT_STORE_PHOTO' : 'CANDIDATE_CHECKIN_STORE_PHOTO',
      entity: 'candidate',
      entityId: candidate.id,
      newValue: {
        candidateId: candidate.id,
        candidateName: candidate.tenUv,
        type,
        errCode,
        fineAmount,
        fineLabel,
      },
    });

    res.json({
      success: true,
      data: {
        isLate,
        isEarlyLeave,
        lateMinutes,
        earlyLeaveMinutes,
        fineAmount,
        errCode,
        fineLabel,
        backupFolder: driveBackupDir,
        message: type === 'CHECK_OUT'
          ? isEarlyLeave
            ? `Ra ca sớm ${earlyLeaveMinutes} phút. Ghi nhận phạt: 50.000đ.`
            : 'Xác nhận ra ca đúng giờ thành công!'
          : isLate
            ? `Điểm danh trễ ${lateMinutes} phút. Ghi nhận phạt: ${fineLabel}.`
            : 'Điểm danh vào ca đúng giờ thành công!',
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
