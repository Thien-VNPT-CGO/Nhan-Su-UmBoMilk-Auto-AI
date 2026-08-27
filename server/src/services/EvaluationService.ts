import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/errors';
import { nextId } from '../lib/id';
import { emit } from '../sockets';
import { zaloPersonalService } from './ZaloPersonalService';
import { audit } from './AuditService';
import { employeeAuthService } from './EmployeeAuthService';

export interface SubmitEvaluationInput {
  candidateId: string;
  testTicketId?: string;
  scoreKnowledge: number; // 0 - 10
  scoreOperation: number; // 0 - 10
  lowScoreQuestions?: string[]; // Ghi chú các câu < 1 điểm
  evaluatorNotes?: string;
  forceTerminate?: boolean; // HR tick chọn loại hẳn & đăng xuất 30s
  user: string;
}

export class EvaluationService {
  async submitEvaluation(input: SubmitEvaluationInput) {
    const candidate = await prisma.candidate.findUnique({ where: { id: input.candidateId } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    if (input.scoreKnowledge < 0 || input.scoreKnowledge > 10 || input.scoreOperation < 0 || input.scoreOperation > 10) {
      throw ApiError.badRequest('INVALID_SCORE', 'Thang điểm đánh giá phải từ 0 đến 10.');
    }

    const totalScore = (input.scoreKnowledge + input.scoreOperation) / 2;
    const prevCount = await prisma.storeEvaluation.count({ where: { candidateId: candidate.id } });
    const attemptNumber = prevCount >= 1 ? 2 : 1;

    let evaluationStatus = 'FAILED';
    if (totalScore > 7) {
      evaluationStatus = 'PASSED_OFFICIAL';
    } else if (totalScore >= 5) {
      evaluationStatus = 'RETEST_REQUIRED';
    }

    const evalId = nextId('EVL');
    const evaluation = await prisma.storeEvaluation.create({
      data: {
        id: evalId,
        candidateId: candidate.id,
        testTicketId: input.testTicketId ?? null,
        attemptNumber,
        scoreKnowledge: input.scoreKnowledge,
        scoreOperation: input.scoreOperation,
        totalScore,
        lowScoreQuestions: input.lowScoreQuestions || [],
        evaluationStatus,
        evaluatorUser: input.user,
        evaluatorNotes: input.evaluatorNotes ?? null,
      },
    });

    await audit({
      user: input.user,
      action: 'SUBMIT_STORE_EVALUATION',
      entity: 'store_evaluation',
      entityId: evaluation.id,
      newValue: JSON.stringify({ totalScore, evaluationStatus, attemptNumber, forceTerminate: Boolean(input.forceTerminate) }),
    });

    // 1. TRƯỜNG HỢP 5 <= TỔNG ĐIỂM <= 7 VÀ KHÔNG CHỌN LOẠI HẲN (RỚT PHẢI TEST LẦN 2)
    if (evaluationStatus === 'RETEST_REQUIRED' && !input.forceTerminate) {
      const lowQuestionsStr = Array.isArray(input.lowScoreQuestions) && input.lowScoreQuestions.length > 0
        ? ` (Các câu điểm < 1 cần hỏi lại: ${input.lowScoreQuestions.join(', ')})`
        : '';
      const noteMsg = `[TEST LẦN 1: ${totalScore.toFixed(1)}đ] - Chờ HR tạo phiếu Test lần 2${lowQuestionsStr}`;

      await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
          trangThaiTraining: 'TEST_DAU_RA_LAN_2',
          aiNote: noteMsg,
          updatedBy: input.user,
        },
      });

      emit('evaluation:completed', {
        candidateId: candidate.id,
        evaluationStatus,
        totalScore,
        forceLogout: false,
        message: 'Bạn chưa đạt điểm ở Lần 1. Vui lòng ôn tập chờ HR đặt lịch Test lần 2.',
      });
      emit('training:updated', { candidateId: candidate.id });
      emit('candidate:updated', { candidateId: candidate.id });
    }

    // 2. TRƯỜNG HỢP RỚT VÀ HR TICK [x] XÁC NHẬN LOẠI HẲN & CHO ĐĂNG XUẤT 30S
    if ((evaluationStatus === 'FAILED' || input.forceTerminate) && evaluationStatus !== 'PASSED_OFFICIAL') {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
          trangThaiTraining: 'LOAI',
          aiNote: `[KẾT THÚC THỬ VIỆC] - Đánh giá ${totalScore.toFixed(1)}đ. HR xác nhận không đạt yêu cầu thử việc.`,
          updatedBy: input.user,
        },
      });

      emit('evaluation:completed', {
        candidateId: candidate.id,
        evaluationStatus: 'FAILED',
        totalScore,
        forceLogout: true,
        message: '❌ HR đã gửi thông báo kết thúc đợt thử việc.',
      });
      emit('training:updated', { candidateId: candidate.id });
      emit('candidate:updated', { candidateId: candidate.id });

      if (candidate.sdtZalo) {
        void zaloPersonalService.sendMessageByPhone(
          candidate.sdtZalo,
          `🐮 [UMBO MILK] – THÔNG BÁO KẾT QUẢ ĐÁNH GIÁ 📋\n\nRất tiếc ${candidate.tenUv}!\nKết quả đánh giá cửa hàng của bạn đạt ${totalScore.toFixed(1)}/10đ và chưa đáp ứng tiêu chuẩn thử việc.\nCảm ơn bạn đã đồng hành cùng UmBo Milk trong thời gian qua.`
        ).catch(() => null);
      }
    }

    // 3. TRƯỜNG HỢP TỔNG ĐIỂM > 7 (ĐẬU CHÍNH THỨC) -> KÍCH HOẠT DỮ LIỆU ĐẬU + TRIGGER 30S AUTO LOGOUT ON APP
    if (evaluationStatus === 'PASSED_OFFICIAL') {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
          trangThaiTraining: 'DAU_CHINH_THUC',
          aiNote: `[TEST ĐẦU RA ĐẬU: ${totalScore.toFixed(1)}đ] - Đủ điều kiện trở thành NV Chính Thức`,
          updatedBy: input.user,
        },
      });

      emit('evaluation:completed', {
        candidateId: candidate.id,
        evaluationStatus,
        totalScore,
        forceLogout: true,
        message: '🎉 Chúc mừng bạn đã HOÀN THÀNH XUẤT SẮC bài đánh giá cửa hàng! Tài khoản sẽ tự động đăng xuất sau 30 giây để hoàn tất thủ tục.',
      });
      emit('training:updated', { candidateId: candidate.id });
      emit('candidate:updated', { candidateId: candidate.id });

      // Gửi tin nhắn Zalo / Notification chúc mừng tới Web App Nhân Viên
      if (candidate.sdtZalo) {
        void zaloPersonalService.sendMessageByPhone(
          candidate.sdtZalo,
          `🐮 [UMBO MILK] – THÔNG BÁO KẾT QUẢ TEST ĐẦU RA 🎉\n\nChúc mừng ${candidate.tenUv}!\nBạn đã đạt điểm tổng: ${totalScore.toFixed(1)}/10đ và chính thức ĐẬU đợt Đánh Giá Nhân Viên Cửa Hàng.\nHệ thống AI sẽ tự động chuyển bạn sang Nhân Viên Chính Thức sau 30 phút.`
        ).catch(() => null);
      }

      // ⚡ TỰ ĐỘNG CHUYỂN SANG NHÂN VIÊN CHÍNH THỨC SAU 30 PHÚT (30 * 60 * 1000 ms)
      const autoPromoteDelayMs = 30 * 60 * 1000;
      setTimeout(async () => {
        try {
          // Nâng trạng thái thành NHAN_VIEN_CHINH_THUC
          await prisma.candidate.update({
            where: { id: candidate.id },
            data: {
              trangThaiTraining: 'NHAN_VIEN_CHINH_THUC',
              updatedBy: 'AI-SYSTEM',
            },
          });

          // Cấp Key Chính Thức (OFFICIAL) nếu chưa có
          await employeeAuthService.generateKey({
            candidateId: candidate.id,
            type: 'OFFICIAL',
            user: 'AI-SYSTEM',
          }).catch(() => null);

          await prisma.storeEvaluation.update({
            where: { id: evalId },
            data: { promotedAt: new Date() },
          });

          // Bắn Sockets Realtime 1:1 báo chuyển NV Chính thức thành công!
          emit('candidate:promoted', { candidateId: candidate.id, status: 'NHAN_VIEN_CHINH_THUC' });
          emit('official_employees:updated', { candidateId: candidate.id });
          emit('training:updated', { candidateId: candidate.id });
          emit('shift:updated', { candidateId: candidate.id });
        } catch (e) {
          console.error('[EvaluationService] Auto promote error:', e);
        }
      }, autoPromoteDelayMs);
    }

    return evaluation;
  }

  async listEvaluations(candidateId?: string) {
    const where: any = {};
    if (candidateId) where.candidateId = candidateId;
    return prisma.storeEvaluation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

export const evaluationService = new EvaluationService();
