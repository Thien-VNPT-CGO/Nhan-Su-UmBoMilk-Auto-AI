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

    if (rawShift.toLowerCase().includes('chieu') || rawShift.includes('12h') || rawShift.toLowerCase().includes('trua')) {
      startHour = 12;
      startMin = 0;
    } else if (rawShift.toLowerCase().includes('toi') || rawShift.includes('18h')) {
      startHour = 18;
      startMin = 0;
    }

    const shiftStartTime = new Date(now);
    shiftStartTime.setHours(startHour, startMin, 0, 0);
    const allowedEarlyTime = new Date(shiftStartTime.getTime() - 30 * 60 * 1000);

    const isTooEarly = now < allowedEarlyTime;
    const earlyMinutes = isTooEarly ? Math.ceil((allowedEarlyTime.getTime() - now.getTime()) / (60 * 1000)) : 0;
    const allowedTimeStr = `${String(allowedEarlyTime.getHours()).padStart(2, '0')}:${String(allowedEarlyTime.getMinutes()).padStart(2, '0')}`;

    res.json({
      success: true,
      data: {
        ...candidate,
        isTooEarly,
        earlyMinutes,
        allowedTimeStr,
      },
    });
  } catch (e) {
    next(e);
  }
});

const checkinSchema = z.object({
  image: z.string().min(1, 'Chưa truyền hình ảnh chụp cửa hàng'),
  note: z.string().optional(),
});

// Endpoint ứng viên nộp hình ảnh & xác nhận điểm danh từ Web công khai
router.post('/candidates/:id/attendance-checkin', async (req, res, next) => {
  try {
    const parsed = checkinSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Hình ảnh chụp cửa hàng không hợp lệ.');
    }

    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    }

    const { image } = parsed.data;
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

    if (rawShift.toLowerCase().includes('chieu') || rawShift.includes('12h') || rawShift.toLowerCase().includes('trua')) {
      shiftFolder = 'CA_CHIEU';
      startHour = 12;
      startMin = 0;
    } else if (rawShift.toLowerCase().includes('toi') || rawShift.includes('18h')) {
      shiftFolder = 'CA_TOI';
      startHour = 18;
      startMin = 0;
    }

    // 2. RÀNG BUỘC KHUNG GIỜ: Kiểm tra nếu ứng viên điểm danh quá sớm (Trước ca > 30 phút)
    const shiftStartTime = new Date(now);
    shiftStartTime.setHours(startHour, startMin, 0, 0);
    const allowedEarlyTime = new Date(shiftStartTime.getTime() - 30 * 60 * 1000);

    if (now < allowedEarlyTime) {
      const earlyMins = Math.ceil((allowedEarlyTime.getTime() - now.getTime()) / (60 * 1000));
      const allowedTimeStr = `${String(allowedEarlyTime.getHours()).padStart(2, '0')}:${String(allowedEarlyTime.getMinutes()).padStart(2, '0')}`;
      throw ApiError.badRequest(
        'CHECKIN_TOO_EARLY',
        `Chưa đến khung giờ điểm danh! Bạn đang mở quá sớm ${earlyMins} phút. Khung giờ cho phép điểm danh bắt đầu từ ${allowedTimeStr} (trước ca 30 phút).`
      );
    }

    const cleanCandidateName = `${candidate.tenUv} - ${candidate.sdtZalo.replace(/\D/g, '')}`.replace(/[\\/:*?"<>|]/g, '_');
    const dateFolder = `Ngày ${dateStr}`;

    // 3. Đường dẫn thư mục Google Drive backup chuẩn cấu trúc
    const driveBackupDir = path.join(
      process.cwd(),
      'uploads',
      'drive_backup',
      typeFolder,
      cleanBranch,
      shiftFolder,
      cleanCandidateName,
      dateFolder
    );

    if (!fs.existsSync(driveBackupDir)) {
      fs.mkdirSync(driveBackupDir, { recursive: true });
    }

    // 4. Lưu file ảnh chụp cửa hàng Anh_chup_cua_hang.jpg
    const imageFileName = `Anh_chup_cua_hang.jpg`;
    const imageFilePath = path.join(driveBackupDir, imageFileName);
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(imageFilePath, base64Data, { encoding: 'base64' });

    // 5. Tạo file văn bản Diem_danh.txt với nội dung "ĐIỂM DANH UBM"
    const txtContent = `ĐIỂM DANH UBM
====================================
Họ tên: ${candidate.tenUv}
Số điện thoại: ${candidate.sdtZalo}
Mã UV: ${candidate.id}
Chi nhánh: ${candidate.chiNhanh || 'Chưa chốt'}
Ca làm: ${candidate.caLam || 'Chưa chốt'}
Mốc điểm danh: ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
====================================`;

    const txtFilePath = path.join(driveBackupDir, 'Diem_danh.txt');
    fs.writeFileSync(txtFilePath, txtContent, 'utf8');

    // 6. Kiểm tra thời gian Realtime & Tính phạt trễ 50.000đ
    const graceEndTime = new Date(shiftStartTime.getTime() + 4 * 60 * 1000 + 59 * 1000); // Trễ tới 4m59s vẫn tính đúng giờ

    let isLate = false;
    let lateMinutes = 0;
    let fineAmount = 0;

    if (now > graceEndTime) {
      isLate = true;
      lateMinutes = Math.max(5, Math.floor((now.getTime() - shiftStartTime.getTime()) / (60 * 1000)));
      fineAmount = 50000;
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
        reason: isLate ? `TRE_PHAT_50K_${lateMinutes}M` : 'VALID_ON_TIME',
        lat: null,
        lng: null,
      },
    });

    // 7. Cập nhật số ngày đào tạo (+1) & trạng thái ĐANG TRAINING
    const newVersion = candidate.dataVersion + 1;
    const newDaysDone = Math.min(7, candidate.soNgayDaTraining + 1);

    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        soNgayDaTraining: newDaysDone,
        trangThaiTraining: newDaysDone >= 7 ? TRAINING_STATUS.HOAN_THANH : TRAINING_STATUS.BAT_DAU,
        dataVersion: newVersion,
        updatedBy: 'PUBLIC_ATTENDANCE_CHECKIN',
      },
    });

    await audit({
      user: 'PUBLIC_ATTENDANCE_PAGE',
      action: 'CANDIDATE_CHECKIN_STORE_PHOTO',
      entity: 'candidate',
      entityId: candidate.id,
      newValue: {
        candidateId: candidate.id,
        candidateName: candidate.tenUv,
        isLateStr: isLate ? `LATE_${lateMinutes}M_FINE_50K` : 'ON_TIME',
      },
    });

    res.json({
      success: true,
      data: {
        isLate,
        lateMinutes,
        fineAmount,
        backupFolder: driveBackupDir,
        message: isLate
          ? `Điểm danh trễ ${lateMinutes} phút. Ghi nhận phạt 50.000đ.`
          : 'Điểm danh đúng giờ thành công!',
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
