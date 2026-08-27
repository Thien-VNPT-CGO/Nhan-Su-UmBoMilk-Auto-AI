import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { nextId } from '../lib/id';
import { audit } from './AuditService';
import { emit } from '../sockets';
import { getGoogleSheetService } from './GoogleSheetService';

export class EmployeeAuthService {
  /** Admin tạo Key kích hoạt cho Nhân viên (Training hoặc Chính thức) */
  async generateKey(input: { candidateId: string; type: 'TRAINING' | 'OFFICIAL'; user: string }) {
    const candidate = await prisma.candidate.findUnique({ where: { id: input.candidateId } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy thông tin nhân sự.');

    // Format Key: TRN-XXXX-YYYY hoặc EMP-XXXX-YYYY
    const prefix = input.type === 'TRAINING' ? 'TRN' : 'EMP';
    const randPart = Math.floor(1000 + Math.random() * 9000);
    const randPart2 = Math.floor(1000 + Math.random() * 9000);
    const key = `${prefix}-${randPart}-${randPart2}`;

    // Hủy các key ACTIVE cũ nếu có
    await prisma.employeeKey.updateMany({
      where: { candidateId: input.candidateId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });

    const keyRecord = await prisma.employeeKey.create({
      data: {
        id: nextId('KEY'),
        key,
        candidateId: input.candidateId,
        type: input.type,
        status: 'ACTIVE',
        deviceId: null,
      },
    });

    await audit({
      user: input.user,
      action: 'GENERATE_EMPLOYEE_KEY',
      entity: 'employee_key',
      entityId: keyRecord.id,
      newValue: { candidateId: input.candidateId, key, type: input.type },
    });

    emit('employee_key:generated', { candidateId: input.candidateId, type: input.type });

    getGoogleSheetService().syncKeyKichHoat({
      key: keyRecord.key,
      candidateId: keyRecord.candidateId,
      type: keyRecord.type,
      status: keyRecord.status,
      deviceId: keyRecord.deviceId,
      createdAt: keyRecord.createdAt,
      activatedAt: keyRecord.activatedAt,
      createdBy: input.user,
    }).catch((err) => console.error('[Sheets] error syncKeyKichHoat:', err));

    return keyRecord;
  }

  /** Đăng nhập & Kích hoạt thiết bị (Device Binding) */
  async activateAndLogin(input: { candidateId: string; key: string; deviceId: string }) {
    const candidate = await prisma.candidate.findUnique({
      where: { id: input.candidateId },
      include: {
        attendanceEvents: { where: { valid: true } },
      },
    });
    if (!candidate) {
      throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy Mã nhân viên trong hệ thống.');
    }

    const keyRecord = await prisma.employeeKey.findFirst({
      where: { key: input.key.trim(), candidateId: input.candidateId },
    });

    if (!keyRecord) {
      throw ApiError.badRequest('INVALID_KEY', 'Key kích hoạt không hợp lệ cho Mã nhân viên này.');
    }

    if (keyRecord.status === 'REVOKED') {
      throw ApiError.badRequest('KEY_REVOKED', 'Key kích hoạt đã bị thu hồi. Vui lòng liên hệ Admin để cấp Key mới.');
    }

    // Tự động khôi phục Key ACTIVE nếu nhân sự đang trong đợt thử việc / chờ HR đánh giá cửa hàng
    if (keyRecord.status === 'EXPIRED' && keyRecord.type === 'TRAINING' && candidate.trangThaiTraining !== 'NHAN_VIEN_CHINH_THUC' && candidate.trangThaiTraining !== 'LOAI') {
      await prisma.employeeKey.update({
        where: { id: keyRecord.id },
        data: { status: 'ACTIVE' },
      });
      keyRecord.status = 'ACTIVE';
    }

    if (keyRecord.status === 'EXPIRED') {
      throw ApiError.badRequest('KEY_EXPIRED', 'Key kích hoạt đã hết hạn.');
    }

    // Kiểm tra loại Key với trạng thái hồ sơ thực tế
    if (keyRecord.type === 'TRAINING') {
      if (candidate.trangThaiTraining === 'NHAN_VIEN_CHINH_THUC') {
        await prisma.employeeKey.update({
          where: { id: keyRecord.id },
          data: { status: 'EXPIRED' },
        });
        throw ApiError.badRequest(
          'TRAINING_COMPLETED',
          'Bạn đã trở thành Nhân viên chính thức! Vui lòng đăng nhập bằng Key Nhân viên chính thức (EMP-XXXX-XXXX) do Admin/HR cấp.'
        );
      }
      if (candidate.trangThaiTraining === 'LOAI') {
        await prisma.employeeKey.update({
          where: { id: keyRecord.id },
          data: { status: 'EXPIRED' },
        });
        throw ApiError.badRequest(
          'KEY_EXPIRED',
          'Tài khoản đã kết thúc đợt thử việc. Vui lòng liên hệ Bộ phận HR.'
        );
      }
    }

    // GÁN CỨNG THIẾT BỊ (DEVICE LOCKING)
    if (!keyRecord.deviceId) {
      // Lần đầu kích hoạt -> Gán deviceId này làm thiết bị duy nhất
      await prisma.employeeKey.update({
        where: { id: keyRecord.id },
        data: {
          deviceId: input.deviceId,
          activatedAt: new Date(),
        },
      });
      keyRecord.deviceId = input.deviceId;

      getGoogleSheetService().syncKeyKichHoat({
        key: keyRecord.key,
        candidateId: keyRecord.candidateId,
        type: keyRecord.type,
        status: keyRecord.status,
        deviceId: keyRecord.deviceId,
        createdAt: keyRecord.createdAt,
        activatedAt: new Date(),
      }).catch((err) => console.error('[Sheets] error syncKeyKichHoat activateAndLogin:', err));
    } else if (keyRecord.deviceId !== input.deviceId) {
      // Thiết bị truy cập khác với thiết bị gán cứng
      throw ApiError.forbidden(
        'Tài khoản này đã được gán cứng với 1 thiết bị duy nhất trước đó. Không thể đăng nhập từ điện thoại khác! Nếu bạn đã đổi máy, vui lòng gửi phiếu Yêu cầu Reset thiết bị.'
      );
    }

    return {
      candidate: {
        id: candidate.id,
        tenUv: candidate.tenUv,
        sdtZalo: candidate.sdtZalo,
        chiNhanh: candidate.chiNhanh,
        caLam: candidate.caLam,
        trangThaiTraining: candidate.trangThaiTraining,
        soNgayDaTraining: candidate.soNgayDaTraining,
      },
      keyInfo: {
        key: keyRecord.key,
        type: keyRecord.type,
        status: keyRecord.status,
        deviceId: keyRecord.deviceId,
        activatedAt: keyRecord.activatedAt,
      },
    };
  }

  /** Kiểm tra tính hợp lệ của Device Token */
  async validateDevice(candidateId: string, deviceId: string) {
    const keyRecord = await prisma.employeeKey.findFirst({
      where: { candidateId, status: 'ACTIVE' },
    });
    if (!keyRecord || !keyRecord.deviceId) {
      return { valid: false, reason: 'Key kích hoạt thiết bị của bạn đã được IT Admin Reset thành công. Phiên làm việc trên máy này đã hết hạn.' };
    }
    if (keyRecord.deviceId !== deviceId) {
      return { valid: false, reason: 'Tài khoản này đã được gán với thiết bị khác.' };
    }
    return { valid: true, keyInfo: keyRecord };
  }
}

export const employeeAuthService = new EmployeeAuthService();
