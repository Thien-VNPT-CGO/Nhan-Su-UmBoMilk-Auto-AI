import { Router } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { audit } from '../services/AuditService';
import { nextId } from '../lib/id';
import { TRAINING_STATUS } from '../lib/constants';
import { formatDateTime } from '../lib/date';
import { googleDriveUploadService } from '../services/GoogleDriveUploadService';
import { trainingService } from '../services/TrainingService';

const router = Router();

// Helper lấy mốc thời gian chuẩn Việt Nam (Asia/Ho_Chi_Minh GMT+7) bất kể server ở múi giờ UTC nào
function getVietnamNowParts() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '0';

  const year = parseInt(getPart('year'), 10);
  const month = parseInt(getPart('month'), 10) - 1;
  const day = parseInt(getPart('day'), 10);
  let hour = parseInt(getPart('hour'), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(getPart('minute'), 10);
  const second = parseInt(getPart('second'), 10);

  const vnNow = new Date(year, month, day, hour, minute, second);
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { vnNow, year, month, day, hour, minute, second, dateStr };
}

// Endpoint lấy thông tin ứng viên phỏng vấn từ Web công khai
router.get('/candidates/:id(*)/interview-info', async (req, res, next) => {
  try {
    const candidateId = decodeURIComponent(req.params.id);
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
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
const handleConfirmPv = async (req: any, res: any, next: any) => {
  try {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Phản hồi không hợp lệ.');
    }

    const candidateId = decodeURIComponent(req.params.id);
    const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
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
};

router.post('/candidates/:id(*)/confirm-pv', handleConfirmPv);
router.post('/candidates/:id(*)/confirm-interview', handleConfirmPv);

// Endpoint lấy thông tin điểm danh công khai cho ứng viên
router.get('/candidates/:id(*)/attendance-info', async (req, res, next) => {
  try {
    const candidateId = decodeURIComponent(req.params.id);
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
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

    const { vnNow, year, month, day, dateStr } = getVietnamNowParts();
    const normShift = (candidate.caLam || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u066f]/g, '');

    let startHour = 7;
    let startMin = 0;
    let endHour = 12;
    let endMin = 0;

    if (normShift.includes('chieu') || normShift.includes('12h') || normShift.includes('trua') || normShift.includes('ca 2')) {
      startHour = 12;
      startMin = 0;
      endHour = 18;
      endMin = 0;
    } else if (normShift.includes('toi') || normShift.includes('18h') || normShift.includes('ca 3') || normShift.includes('dem')) {
      startHour = 18;
      startMin = 0;
      endHour = 23;
      endMin = 0;
    }

    const shiftStartTime = new Date(year, month, day, startHour, startMin, 0);
    const allowedEarlyTime = new Date(shiftStartTime.getTime() - 30 * 60 * 1000);

    const shiftEndTime = new Date(year, month, day, endHour, endMin, 0);

    const isTooEarly = vnNow < allowedEarlyTime;
    const earlyMinutes = isTooEarly ? Math.ceil((allowedEarlyTime.getTime() - vnNow.getTime()) / (60 * 1000)) : 0;
    const allowedTimeStr = `${String(allowedEarlyTime.getHours()).padStart(2, '0')}:${String(allowedEarlyTime.getMinutes()).padStart(2, '0')}`;
    const shiftTimeRangeStr = `${String(startHour).padStart(2, '0')}:00 - ${String(endHour).padStart(2, '0')}:00`;
    const shiftEndTimeStr = `${String(endHour).padStart(2, '0')}:00`;

    // Kiểm tra lịch sử sự kiện điểm danh hôm nay
    const todayEvents = await prisma.attendanceEvent.findMany({
      where: {
        candidateId: candidate.id,
        date: dateStr,
        valid: true,
      },
    });

    const checkinEvent = todayEvents.find(
      (e) => !e.reason?.includes('CHECK_OUT') && !e.reason?.includes('RA_SOM')
    );
    const checkoutEvent = todayEvents.find(
      (e) => e.reason?.includes('CHECK_OUT') || e.reason?.includes('RA_SOM')
    );

    const hasCheckedInToday = !!checkinEvent;
    const hasCheckedOutToday = !!checkoutEvent;

    // RÀNG BUỘC MỚI: Check-out CHỈ ĐƯỢC MỞ ĐÚNG GIỜ HẾT CA TRỞ ĐI (vnNow >= shiftEndTime)
    const isCheckoutTooEarly = vnNow < shiftEndTime;

    // Kiểm tra đi trễ khi Check-in (sau giờ bắt đầu ca + 5 phút)
    const graceEndTime = new Date(shiftStartTime.getTime() + 4 * 60 * 1000 + 59 * 1000);
    const isLateNow = vnNow > graceEndTime;
    const lateMinutesNow = isLateNow ? Math.max(5, Math.floor((vnNow.getTime() - shiftStartTime.getTime()) / (60 * 1000))) : 0;
    const shiftStartTimeStr = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;

    res.json({
      success: true,
      data: {
        ...candidate,
        isTooEarly,
        earlyMinutes,
        allowedTimeStr,
        shiftTimeRangeStr,
        hasCheckedInToday,
        hasCheckedOutToday,
        checkinTimeStr: checkinEvent ? formatDateTime(checkinEvent.createdAt) : null,
        checkoutTimeStr: checkoutEvent ? formatDateTime(checkoutEvent.createdAt) : null,
        isCheckoutTooEarly,
        allowedCheckoutTimeStr: shiftEndTimeStr,
        shiftEndTimeStr,
        isLateNow,
        lateMinutesNow,
        shiftStartTimeStr,
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
  lateReason: z.string().optional(),
});

// Endpoint ứng viên nộp hình ảnh & xác nhận điểm danh (Check-in / Check-out) từ Web công khai
router.post('/candidates/:id(*)/attendance-checkin', async (req, res, next) => {
  try {
    const parsed = checkinSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('INVALID_INPUT', 'Thông tin điểm danh không hợp lệ.');
    }

    const candidateId = decodeURIComponent(req.params.id);
    const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    }

    const { image, type, lateReason } = parsed.data;
    const { vnNow, year, month, day, dateStr } = getVietnamNowParts();

    // Lấy sự kiện điểm danh hôm nay để khóa trùng lặp
    const todayEvents = await prisma.attendanceEvent.findMany({
      where: {
        candidateId: candidate.id,
        date: dateStr,
        valid: true,
      },
    });

    const hasCheckedInToday = todayEvents.some(
      (e) => !e.reason?.includes('CHECK_OUT') && !e.reason?.includes('RA_SOM')
    );
    const hasCheckedOutToday = todayEvents.some(
      (e) => e.reason?.includes('CHECK_OUT') || e.reason?.includes('RA_SOM')
    );

    if (type === 'CHECK_IN' && hasCheckedInToday) {
      throw ApiError.badRequest('ALREADY_CHECKED_IN', 'Bạn đã hoàn tất điểm danh vào ca cho hôm nay rồi!');
    }

    if (type === 'CHECK_OUT' && hasCheckedOutToday) {
      throw ApiError.badRequest('ALREADY_CHECKED_OUT', 'Bạn đã hoàn tất xác nhận ra ca cho hôm nay rồi!');
    }

    // 1. Phân loại tên Chi nhánh & Ca làm việc
    const typeFolder = candidate.trangThaiTraining === 'NHAN_VIEN_CHINH_THUC' ? 'NHAN_VIEN_CHINH_THUC' : 'NHAN_VIEN_TRAINING';
    const rawBranch = candidate.chiNhanh || 'CN1: 130 Vạn Kiếp, Phường 3, Quận Bình Thạnh';
    const cleanBranch = rawBranch.replace(/[\\/:*?"<>|]/g, '_').trim();

    const normShift = (candidate.caLam || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u066f]/g, '');
    let shiftFolder = 'CA_SANG';
    let startHour = 7;
    let startMin = 0;
    let endHour = 12;
    let endMin = 0;

    if (normShift.includes('chieu') || normShift.includes('12h') || normShift.includes('trua') || normShift.includes('ca 2')) {
      shiftFolder = 'CA_CHIEU';
      startHour = 12;
      startMin = 0;
      endHour = 18;
      endMin = 0;
    } else if (normShift.includes('toi') || normShift.includes('18h') || normShift.includes('ca 3') || normShift.includes('dem')) {
      shiftFolder = 'CA_TOI';
      startHour = 18;
      startMin = 0;
      endHour = 23;
      endMin = 0;
    }

    const shiftStartTime = new Date(year, month, day, startHour, startMin, 0);
    const shiftEndTime = new Date(year, month, day, endHour, endMin, 0);

    // 2. KHI VÀO CA (CHECK-IN): RÀNG BUỘC KHUNG GIỜ MỞ ĐIỂM DANH (TRƯỚC CA 30 PHÚT)
    if (type === 'CHECK_IN') {
      const allowedEarlyTime = new Date(shiftStartTime.getTime() - 30 * 60 * 1000);
      if (vnNow < allowedEarlyTime) {
        const earlyMins = Math.ceil((allowedEarlyTime.getTime() - vnNow.getTime()) / (60 * 1000));
        const allowedTimeStr = `${String(allowedEarlyTime.getHours()).padStart(2, '0')}:${String(allowedEarlyTime.getMinutes()).padStart(2, '0')}`;
        throw ApiError.badRequest(
          'CHECKIN_TOO_EARLY',
          `Chưa đến khung giờ điểm danh! Bạn đang mở quá sớm ${earlyMins} phút. Khung giờ cho phép điểm danh bắt đầu từ ${allowedTimeStr} (trước ca 30 phút).`
        );
      }
    }

    // 3. KHI RA CA (CHECK-OUT): RÀNG BUỘC ĐÚNG GIỜ HẾT CA MỚI ĐƯỢC MỞ (vnNow >= shiftEndTime)
    if (type === 'CHECK_OUT') {
      if (vnNow < shiftEndTime) {
        const earlyMins = Math.ceil((shiftEndTime.getTime() - vnNow.getTime()) / (60 * 1000));
        const shiftEndTimeStr = `${String(shiftEndTime.getHours()).padStart(2, '0')}:${String(shiftEndTime.getMinutes()).padStart(2, '0')}`;
        throw ApiError.badRequest(
          'CHECKOUT_TOO_EARLY',
          `Chưa đến giờ hết ca! Bạn đang mở quá sớm ${earlyMins} phút. Nút Check-out ca làm này chỉ mở từ ${shiftEndTimeStr} trở đi.`
        );
      }
    }

    const cleanCandidateName = `${candidate.tenUv} - ${candidate.sdtZalo.replace(/\D/g, '')}`.replace(/[\\/:*?"<>|]/g, '_');
    const dateFolder = `${String(day).padStart(2, '0')}-${String(month + 1).padStart(2, '0')}-${year}`;
    const actionFolder = type === 'CHECK_OUT' ? 'CHECK_OUT' : 'CHECK_IN';

    // 4. Thư mục Google Drive backup
    const driveBackupDir = path.join(
      process.cwd(),
      'uploads',
      'drive_backup',
      typeFolder,
      cleanBranch,
      shiftFolder,
      cleanCandidateName,
      dateFolder,
      actionFolder
    );

    if (!fs.existsSync(driveBackupDir)) {
      fs.mkdirSync(driveBackupDir, { recursive: true });
    }

    // 5. Lưu file ảnh chụp cửa hàng Anh_chup_cua_hang.jpg
    const imageFileName = `Anh_chup_cua_hang.jpg`;
    const imageFilePath = path.join(driveBackupDir, imageFileName);
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(imageFilePath, base64Data, { encoding: 'base64' });

    // 7. Tính toán Vi phạm & Tiền phạt theo QUY CHẾ LÀM VIỆC (25.500đ/1h)
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
      if (vnNow > graceEndTime) {
        isLate = true;
        lateMinutes = Math.max(5, Math.floor((vnNow.getTime() - shiftStartTime.getTime()) / (60 * 1000)));

        // RÀNG BUỘC BẮT BUỘC: ĐI TRỄ PHẢI CÓ LÝ DO CHÍNH ĐÁNG
        const trimmedLateReason = lateReason?.trim();
        if (!trimmedLateReason) {
          throw ApiError.badRequest(
            'LATE_REASON_REQUIRED',
            `Bạn đang điểm danh trễ ${lateMinutes} phút so với giờ vào ca (${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}). Vui lòng nhập lý do đi trễ chính đáng trước khi gửi điểm danh!`
          );
        }

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
      isEarlyLeave = false;
      fineAmount = 0;
      errCode = 'CHECK_OUT_ON_TIME';
      fineLabel = 'RA CA ĐÚNG GIỜ';
    }

    const savedLateReason = isLate ? (lateReason?.trim() || null) : null;

    // 6. Tạo file văn bản Diem_danh.txt
    const txtContent = `${type === 'CHECK_OUT' ? 'XÁC NHẬN RA CA UBM' : 'ĐIỂM DANH UBM'}
====================================
Họ tên: ${candidate.tenUv}
Số điện thoại: ${candidate.sdtZalo}
Mã UV: ${candidate.id}
Chi nhánh: ${candidate.chiNhanh || 'Chưa chốt'}
Ca làm: ${candidate.caLam || 'Chưa chốt'}
Loại: ${type === 'CHECK_OUT' ? 'CHECK-OUT (RA CA)' : 'CHECK-IN (VÀO CA)'}
Mốc thời gian: ${vnNow.toLocaleString('vi-VN')}
Trạng thái: ${isLate ? `ĐI TRỄ ${lateMinutes} PHÚT (${fineLabel})` : 'ĐÚNG GIỜ'}
${savedLateReason ? `Lý do đi trễ chính đáng: ${savedLateReason}` : ''}
====================================`;

    const txtFilePath = path.join(driveBackupDir, 'Diem_danh.txt');
    fs.writeFileSync(txtFilePath, txtContent, 'utf8');

    // Tự động đẩy file ảnh và Diem_danh.txt lên Google Drive theo thời gian thực (Realtime 1:1)
    try {
      await googleDriveUploadService.uploadAttendanceFiles({
        typeFolder,
        cleanBranch,
        shiftFolder,
        cleanCandidateName,
        dateFolder,
        actionFolder,
        imageFilePath,
        txtFilePath,
      });
    } catch (driveErr) {
      console.warn('[AttendanceRoute] Drive upload warning:', driveErr instanceof Error ? driveErr.message : String(driveErr));
    }

    // Ghi nhận / Cập nhật sự kiện AttendanceEvent
    const existingEvent = await prisma.attendanceEvent.findUnique({
      where: { candidateId_date_shift: { candidateId: candidate.id, date: dateStr, shift: shiftFolder } },
    });

    if (type === 'CHECK_IN') {
      if (existingEvent) {
        await prisma.attendanceEvent.update({
          where: { id: existingEvent.id },
          data: {
            checkinAt: vnNow,
            eventType: 'CHECK_IN',
            valid: true,
            reason: errCode,
            lateReason: savedLateReason,
          },
        });
      } else {
        await prisma.attendanceEvent.create({
          data: {
            id: nextId('ATT'),
            candidateId: candidate.id,
            date: dateStr,
            shift: shiftFolder,
            checkinAt: vnNow,
            checkoutAt: null,
            eventType: 'CHECK_IN',
            method: 'PUBLIC_WEB',
            valid: true,
            reason: errCode,
            lateReason: savedLateReason,
          },
        });
      }
      // CHÚ Ý: CHECK-IN CHƯA TÍNH TĂNG NGÀY ĐÀO TẠO! Bắt buộc phải Check-out mới được tính ngày!
    } else if (type === 'CHECK_OUT') {
      if (!existingEvent) {
        throw ApiError.badRequest('NO_CHECK_IN', 'Bạn chưa điểm danh vào ca (Check-in) cho ca này! Vui lòng Check-in trước khi Check-out.');
      }

      const updatedReason = `${existingEvent.reason || ''}|CHECK_OUT`.replace(/^\|/, '');
      await prisma.attendanceEvent.update({
        where: { id: existingEvent.id },
        data: {
          checkoutAt: vnNow,
          eventType: 'COMPLETED',
          reason: updatedReason,
        },
      });

      // BÂY GIỜ ĐÃ ĐỦ CẢ CHECK-IN VÀ CHECK-OUT -> TÍNH +1 NGÀY ĐÀO TẠO KHI CHECK-OUT THÀNH CÔNG!
      const allCandidateEvents = await prisma.attendanceEvent.findMany({
        where: { candidateId: candidate.id, valid: true },
      });
      const completedEvents = allCandidateEvents.filter(
        (a) => a.checkoutAt != null || a.reason?.includes('CHECK_OUT') || a.method === 'MANUAL' || a.method === 'SYSTEM'
      );
      const newDaysDone = Math.min(7, new Set(completedEvents.map((a) => a.date)).size);

      const newVersion = candidate.dataVersion + 1;
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
          soNgayDaTraining: newDaysDone,
          trangThaiTraining: newDaysDone >= 7 ? TRAINING_STATUS.HOAN_THANH : TRAINING_STATUS.BAT_DAU,
          dataVersion: newVersion,
          updatedBy: 'PUBLIC_ATTENDANCE_CHECK_OUT',
        },
      });

      await trainingService.refreshTrainingStatus(candidate.id);
    }

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
          ? '🎉 Xác nhận ra ca thành công! Ca làm việc của bạn đã được tính hoàn thành.'
          : isLate
            ? `Điểm danh trễ ${lateMinutes} phút. Ghi nhận phạt: ${fineLabel}. Vui lòng nhớ Check-out khi hết ca để được tính ngày làm việc.`
            : '✅ Điểm danh vào ca thành công! Vui lòng nhớ bấm Check-out khi hết ca để được tính ngày làm việc.',
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
