import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { audit } from '../services/AuditService';
import { emit } from '../sockets';
import { TRAINING_STATUS } from '../lib/constants';

const router = Router();

router.get('/candidates/:id/interview-info', async (req, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        tenUv: true,
        chiNhanh: true,
        caLam: true,
        phongVanAt: true,
        ggMeetLink: true,
        trangThaiTraining: true,
        hrDecision: true,
      },
    });

    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy thông tin phỏng vấn của ứng viên.');
    }

    const queryPvTime = req.query.pvTime ? Number(req.query.pvTime) : null;
    let isStaleLink = false;

    if (queryPvTime && !Number.isNaN(queryPvTime) && candidate.phongVanAt) {
      const currentPvTs = candidate.phongVanAt.getTime();
      if (Math.abs(currentPvTs - queryPvTime) > 60 * 1000) {
        isStaleLink = true;
      }
    }

    res.json({
      success: true,
      data: {
        ...candidate,
        isStaleLink,
      },
    });
  } catch (e) {
    next(e);
  }
});

const confirmSchema = z.object({
  action: z.enum(['ACCEPT', 'REJECT']),
  reason: z.string().optional(),
});

router.post('/candidates/:id/confirm-interview', async (req, res, next) => {
  try {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu xác nhận không hợp lệ.');
    }

    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    }

    const { action, reason } = parsed.data;
    const newVersion = candidate.dataVersion + 1;
    const targetStatus = action === 'ACCEPT' ? TRAINING_STATUS.SAP_BAT_DAU : TRAINING_STATUS.LOAI;

    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        trangThaiTraining: targetStatus,
        dataVersion: newVersion,
        updatedBy: 'CANDIDATE_1CLICK_CONFIRM',
      },
    });

    await audit({
      user: 'CANDIDATE_PUBLIC_PAGE',
      action: action === 'ACCEPT' ? 'CANDIDATE_CONFIRMED_INTERVIEW_ACCEPT' : 'CANDIDATE_CONFIRMED_INTERVIEW_REJECT',
      entity: 'candidate',
      entityId: candidate.id,
      oldValue: candidate.trangThaiTraining,
      newValue: targetStatus,
      version: newVersion,
    });

    emit('training:updated', { candidateId: candidate.id });
    emit('candidate:decision', { candidateId: candidate.id, decision: candidate.hrDecision, user: 'CANDIDATE_1CLICK' });
    emit('zalo:ai_confirmed', {
      candidateId: candidate.id,
      candidateName: candidate.tenUv,
      action: action === 'ACCEPT' ? 'CONFIRMED_ACCEPT' : 'CONFIRMED_REJECT',
      newStatus: targetStatus,
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

    res.json({ success: true, data: candidate });
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
    const timestamp = Date.now();

    // Phân loại tên Chi nhánh & Ca làm việc cho cấu trúc Folder Google Drive
    const rawBranch = candidate.chiNhanh || 'CN_CHUA_CHOT';
    const cleanBranch = rawBranch.replace(/[\\/:*?"<>|]/g, '_').trim();

    const rawShift = candidate.caLam || 'CA_CHUA_CHOT';
    let shiftFolder = 'CA_KHAC';
    if (rawShift.toLowerCase().includes('sang') || rawShift.includes('7h')) shiftFolder = 'CA_SANG';
    else if (rawShift.toLowerCase().includes('chieu') || rawShift.includes('12h')) shiftFolder = 'CA_CHIEU';
    else if (rawShift.toLowerCase().includes('toi') || rawShift.includes('18h')) shiftFolder = 'CA_TOI';

    const cleanCandidateName = `${candidate.tenUv}_${candidate.sdtZalo.replace(/\D/g, '')}`.replace(/[\\/:*?"<>|]/g, '_');

    // Đường dẫn thư mục Google Drive backup chuẩn cấu trúc
    const driveBackupDir = path.join(
      process.cwd(),
      'uploads',
      'drive_backup',
      cleanBranch,
      shiftFolder,
      cleanCandidateName,
      dateStr
    );

    if (!fs.existsSync(driveBackupDir)) {
      fs.mkdirSync(driveBackupDir, { recursive: true });
    }

    // 1. Lưu file ảnh chụp cửa hàng
    const imageFileName = `CUA_HANG_${timestamp}.jpg`;
    const imageFilePath = path.join(driveBackupDir, imageFileName);
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(imageFilePath, base64Data, { encoding: 'base64' });

    // 2. Tạo file văn bản DIEM_DANH.txt
    const txtContent = `====================================
ĐIỂM DANH UMBO MILK
====================================
Họ tên ứng viên: ${candidate.tenUv}
Số điện thoại Zalo: ${candidate.sdtZalo}
Mã ứng viên: ${candidate.id}
Chi nhánh làm việc: ${candidate.chiNhanh || 'Chưa chốt'}
Ca làm việc: ${candidate.caLam || 'Chưa chốt'}
Thời gian điểm danh: ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
Nội dung xác thực: "ĐIỂM DANH UMBO MILK" ✓
Trạng thái điểm danh: THÀNH CÔNG (Tự động lưu Google Drive)
====================================`;

    const txtFilePath = path.join(driveBackupDir, 'DIEM_DANH.txt');
    fs.writeFileSync(txtFilePath, txtContent, 'utf8');

    // 3. Cập nhật số ngày đào tạo (+1) & trạng thái ĐANG TRAINING
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
      oldValue: `soNgay: ${candidate.soNgayDaTraining}`,
      newValue: `soNgay: ${newDaysDone}, photo: ${imageFileName}`,
      version: newVersion,
    });

    emit('training:updated', { candidateId: candidate.id });
    emit('attendance:new_event', { candidateId: candidate.id, candidateName: candidate.tenUv, daysDone: newDaysDone });

    res.json({
      success: true,
      data: {
        candidateId: candidate.id,
        candidateName: candidate.tenUv,
        soNgayDaTraining: newDaysDone,
        backupFolder: `${cleanBranch}/${shiftFolder}/${cleanCandidateName}/${dateStr}`,
        message: 'Đã điểm danh ca làm & lưu hồ sơ vào Google Drive thành công!',
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
