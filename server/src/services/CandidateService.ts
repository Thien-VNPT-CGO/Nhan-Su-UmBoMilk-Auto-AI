import { prisma } from '../lib/prisma';
import { nextCandidateId, dataHash } from '../lib/id';
import { formatDateTime } from '../lib/date';
import { ApiError } from '../lib/errors';
import { audit } from './AuditService';
import { syncQueue } from './SyncQueueService';
import { emit } from '../sockets';
import { getGoogleSheetService, parseFormTimestamp } from './GoogleSheetService';
import { getSettings, saveSettings } from './SettingsService';
import { zaloService } from './ZaloService';
import { calendarService } from './GoogleCalendarService';
import { TRAINING_STATUS } from '../lib/constants';
import { Prisma } from '@prisma/client';
import type { Candidate } from '@prisma/client';

function computeHash(c: {
  id: string; tenUv: string; namSinh: string; trinhDo: string; queQuan: string;
  sdtZalo: string; caLam: string; chiNhanh: string; kinhNghiem: string; xuLy: string;
  linkFb: string; kenhBietTin: string | null; hrDecision: string | null; tongDiem: number | null;
  aiRecommendation: string | null; dataVersion: number;
  ngayBatDauTraining: Date | null; trangThaiTraining: string | null;
}): string {
  return dataHash({
    id: c.id,
    tenUv: c.tenUv,
    namSinh: c.namSinh,
    trinhDo: c.trinhDo,
    queQuan: c.queQuan,
    sdtZalo: c.sdtZalo,
    caLam: c.caLam,
    chiNhanh: c.chiNhanh,
    kinhNghiem: c.kinhNghiem,
    xuLy: c.xuLy,
    linkFb: c.linkFb,
    kenhBietTin: c.kenhBietTin ?? '',
    hrDecision: c.hrDecision,
    tongDiem: c.tongDiem,
    aiRecommendation: c.aiRecommendation,
    dataVersion: c.dataVersion,
    ngayBatDauTraining: c.ngayBatDauTraining ? formatDateTime(c.ngayBatDauTraining) : '',
    trangThaiTraining: c.trangThaiTraining,
  });
}

export function normalizePhone(raw: string): string {
  let p = String(raw ?? '').trim().replace(/[\s.\-()]/g, '');
  if (p.startsWith('+84')) p = '0' + p.slice(3);
  else if (p.startsWith('84') && p.length > 9) p = '0' + p.slice(2);
  return p;
}

export class CandidateService {
  async createFromForm(input: {
    thoiGian?: string;
    tenUv: string;
    gioiTinh?: string;
    namSinh: string;
    trinhDo: string;
    queQuan: string;
    sdtZalo: string;
    caLam: string;
    chiNhanh: string;
    kinhNghiem: string;
    xuLy: string;
    linkFb: string;
    kenhBietTin?: string;
    source?: string;
  }): Promise<Candidate> {
    const sdt = normalizePhone(input.sdtZalo);
    if (!sdt) throw ApiError.badRequest('INVALID_PHONE', 'Thiếu số điện thoại.');

    const existing = await prisma.candidate.findFirst({ where: { sdtZalo: sdt } });
    if (existing) {
      const parsedTs = parseFormTimestamp(input.thoiGian);
      const incoming = parsedTs ? parsedTs.getTime() : NaN;
      const sameTs = !Number.isNaN(incoming) &&
        Math.abs(incoming - existing.thoiGian.getTime()) < 1000;
      if (sameTs) {
        // Dòng form này đã được nhập rồi → KHÔNG tạo/thay thế lại (chống trùng lặp mỗi chu kỳ import)
        const dataSame =
          existing.tenUv === input.tenUv &&
          (existing.gioiTinh ?? '') === (input.gioiTinh ?? '') &&
          existing.namSinh === input.namSinh &&
          existing.trinhDo === input.trinhDo &&
          existing.queQuan === input.queQuan &&
          existing.caLam === input.caLam &&
          existing.chiNhanh === input.chiNhanh &&
          existing.kinhNghiem === input.kinhNghiem &&
          existing.xuLy === input.xuLy &&
          existing.linkFb === input.linkFb &&
          (existing.kenhBietTin ?? '') === (input.kenhBietTin ?? '');
        if (dataSame) return existing;
        // Cùng thời gian nhưng dữ liệu đã sửa trên web → chỉ cập nhật nếu chưa bị HR can thiệp
        return this.updateFromForm(existing, input, existing.thoiGian);
      }
      const isNewer = Number.isNaN(incoming) || incoming > existing.thoiGian.getTime();
      if (isNewer) {
        // Cùng SĐT nhưng đăng ký mới hơn → thay thế hồ sơ cũ, giữ hồ sơ mới nhất
        console.log(`[REPLACE] ${existing.id} -> bản đăng ký mới hơn, thay thế hồ sơ cũ (SĐT ${sdt})`);
        await deleteCandidateWithCleanup(existing.id, 'SYSTEM-REPLACE', 'DELETE_CANDIDATE_REPLACE');
      } else {
        // Bản trong form cũ hơn hồ sơ đang có → đồng bộ dữ liệu + thời gian thật từ form
        return this.updateFromForm(existing, input, parsedTs ?? new Date());
      }
    }

    const parsedFormTime = parseFormTimestamp(input.thoiGian) ?? new Date();
    const id = await nextCandidateId(parsedFormTime);
    const candidate = await prisma.candidate.create({
      data: {
        id,
        thoiGian: parsedFormTime,
        tenUv: input.tenUv,
        gioiTinh: input.gioiTinh ?? '',
        namSinh: input.namSinh,
        trinhDo: input.trinhDo,
        queQuan: input.queQuan,
        sdtZalo: sdt,
        caLam: input.caLam,
        chiNhanh: input.chiNhanh,
        kinhNghiem: input.kinhNghiem,
        xuLy: input.xuLy,
        linkFb: input.linkFb,
        kenhBietTin: input.kenhBietTin ?? '',
        source: input.source ?? 'GOOGLE_FORM',
        dataVersion: 1,
      },
    });

    const withHash = await prisma.candidate.update({
      where: { id: candidate.id },
      data: { dataHash: computeHash(candidate) },
    });

    await audit({
      user: 'SYSTEM',
      action: 'CREATE_CANDIDATE',
      entity: 'candidate',
      entityId: withHash.id,
      newValue: { tenUv: withHash.tenUv, sdtZalo: withHash.sdtZalo, chiNhanh: withHash.chiNhanh },
      version: 1,
    });

    await syncQueue.enqueue({
      entity: 'candidate',
      entityId: withHash.id,
      operation: 'CREATE',
      version: 1,
      idempotencyKey: `candidate:${withHash.id}:create:v1`,
    });

    emit('candidate:new', { candidateId: withHash.id });

    // Tự động gửi tin nhắn chào mừng Zalo Cá Nhân trực tiếp tới SĐT ứng viên ngay khi nộp Form
    void (async () => {
      try {
        const welcomeText = [
          '🐮 [UMBO MILK] – CẢM ƠN BẠN ĐÃ ĐĂNG KÝ ỨNG TUYỂN ✨',
          '',
          `Chào ${withHash.tenUv.trim()} ❤️`,
          `Hệ thống tuyển dụng UmBo Milk đã nhận được hồ sơ ứng tuyển của bạn tại chi nhánh ${withHash.chiNhanh}.`,
          '',
          '📌 Bộ phận HR sẽ xem xét hồ sơ và liên hệ thông báo kết quả/lịch phỏng vấn sớm nhất cho bạn!',
          'Chúc bạn một ngày nhiều năng lượng! 🍀',
        ].join('\n');
        await zaloService.sendText(sdt, welcomeText, withHash.id);
      } catch (e) {
        console.warn('[FormSubmit] Lỗi gửi Zalo chào mừng:', e instanceof Error ? e.message : String(e));
      }
    })();

    // Thông báo nội bộ cho HR khi có hồ sơ mới
    try {
      const { notificationService } = await import('./NotificationService');
      await notificationService.notify({
        role: 'HR',
        title: 'Hồ sơ mới',
        body: `${withHash.tenUv} (${withHash.chiNhanh}) vừa đăng ký — ${withHash.id}`,
        type: 'INFO',
        link: '/candidates',
      });
    } catch {
      // thông báo không được phép phá luồng tạo hồ sơ
    }

    return withHash;
  }

  /** Cập nhật dữ liệu + thời gian thật từ form vào hồ sơ đang có (không tạo hồ sơ mới, AI chấm lại). */
  private async updateFromForm(existing: Candidate, input: {
    thoiGian?: string;
    tenUv: string;
    gioiTinh?: string;
    namSinh: string;
    trinhDo: string;
    queQuan: string;
    caLam: string;
    chiNhanh: string;
    kinhNghiem: string;
    xuLy: string;
    linkFb: string;
    kenhBietTin?: string;
  }, thoiGian: Date): Promise<Candidate> {
    const humanEdited = existing.hrDecision !== null ||
      (existing.updatedBy !== null && !existing.updatedBy.startsWith('SYSTEM'));
    if (humanEdited) {
      throw ApiError.conflict('DUPLICATE_CANDIDATE', `Ứng viên ${existing.id} đã được HR xử lý/sửa, không ghi đè từ form.`);
    }
    const newVersion = existing.dataVersion + 1;
    const updated = await prisma.candidate.update({
      where: { id: existing.id },
      data: {
        thoiGian,
        tenUv: input.tenUv,
        gioiTinh: input.gioiTinh ?? '',
        namSinh: input.namSinh,
        trinhDo: input.trinhDo,
        queQuan: input.queQuan,
        caLam: input.caLam,
        chiNhanh: input.chiNhanh,
        kinhNghiem: input.kinhNghiem,
        xuLy: input.xuLy,
        linkFb: input.linkFb,
        kenhBietTin: input.kenhBietTin ?? '',
        aiScore: Prisma.JsonNull,
        tongDiem: null,
        xepLoai: null,
        aiRecommendation: null,
        aiNote: null,
        aiConfidence: null,
        aiScoredAt: null,
        dataHash: null,
        dataVersion: newVersion,
        updatedBy: 'SYSTEM-FORM',
      },
    });
    const withHash = await prisma.candidate.update({
      where: { id: existing.id },
      data: { dataHash: computeHash(updated) },
    });
    await audit({
      user: 'SYSTEM-FORM',
      action: 'UPDATE_CANDIDATE_FROM_FORM',
      entity: 'candidate',
      entityId: existing.id,
      oldValue: { thoiGian: existing.thoiGian.toISOString(), tongDiem: existing.tongDiem },
      newValue: { thoiGian: updated.thoiGian.toISOString() },
      version: newVersion,
    });
    await syncQueue.enqueue({
      entity: 'candidate',
      entityId: existing.id,
      operation: 'UPDATE',
      version: newVersion,
      idempotencyKey: `candidate:${existing.id}:form-update:v${newVersion}`,
    });
    emit('candidate:updated', { candidateId: existing.id });
    console.log(`[FORM-UPDATE] ${existing.id} đã cập nhật dữ liệu + thời gian thật từ form, AI sẽ chấm lại`);
    return withHash;
  }

  async list(query: {
    search?: string;
    chiNhanh?: string;
    caLam?: string;
    status?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
    branches?: string[] | null;
  }): Promise<{ rows: Candidate[]; total: number }> {
    const where: Prisma.CandidateWhereInput = {};
    if (query.branches?.length) where.chiNhanh = { in: query.branches };
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { tenUv: { contains: s } },
        { sdtZalo: { contains: s } },
        { id: { contains: s } },
      ];
    }
    if (query.chiNhanh) where.chiNhanh = query.chiNhanh;
    if (query.caLam) where.caLam = { contains: query.caLam };
    if (query.from) where.thoiGian = { gte: new Date(query.from) };
    if (query.to) {
      const to = new Date(query.to);
      to.setHours(23, 59, 59, 999);
      where.thoiGian = { ...(where.thoiGian as object), lte: to };
    }
    if (query.status) {
      if (query.status === 'PASS') where.hrDecision = 'PASS';
      else if (query.status === 'FAIL') where.hrDecision = 'FAIL';
      else if (query.status === 'REVIEW') where.hrDecision = 'REVIEW';
      else if (query.status === 'TRAINING') where.trangThaiTraining = { in: ['SAP_BAT_DAU', 'BAT_DAU'] };
      else if (query.status === 'EMPLOYEE') where.trangThaiTraining = 'NHAN_VIEN_CHINH_THUC';
      else if (query.status === 'SCORED') where.tongDiem = { not: null };
    }

    const orderBy: Prisma.CandidateOrderByWithRelationInput[] = [];
    switch (query.sort) {
      case 'oldest': orderBy.push({ thoiGian: 'asc' }); break;
      case 'score_desc': orderBy.push({ tongDiem: 'desc' }); break;
      case 'score_asc': orderBy.push({ tongDiem: 'asc' }); break;
      case 'newest': orderBy.push({ thoiGian: 'desc' }); break;
      default:
        // Ưu tiên AI: XUẤT SẮC -> GIỎI -> ĐẠT -> (chưa chấm), rồi điểm cao -> mới nhất
        orderBy.push({ xepLoai: { sort: 'desc', nulls: 'last' } });
        orderBy.push({ tongDiem: 'desc' });
        orderBy.push({ thoiGian: 'desc' });
    }
    orderBy.push({ id: 'desc' });

    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(query.pageSize) || 20));

    const [rows, total] = await Promise.all([
      prisma.candidate.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Chỉ đếm conflicts (UI dùng); bỏ _count.syncJobs - subquery trên bảng SyncJob phình to
        // làm query danh sách chậm dần theo thời gian.
        include: { _count: { select: { conflicts: true } } },
      }),
      prisma.candidate.count({ where }),
    ]);
    return { rows, total };
  }

  async getById(id: string): Promise<Candidate & { shifts: unknown[]; attendanceEvents: unknown[]; conflicts: unknown[]; zaloMessages: unknown[] }> {
    const c = await prisma.candidate.findUnique({
      where: { id },
      include: {
        shifts: { orderBy: { date: 'asc' } },
        attendanceEvents: { orderBy: { createdAt: 'desc' } },
        conflicts: { where: { status: 'OPEN' } },
        zaloMessages: { orderBy: { createdAt: 'asc' }, take: 50 },

      },
    });
    if (!c) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    return c as never;
  }

  async updateFields(
    id: string,
    user: string,
    expectedVersion: number,
    patch: Record<string, string>,
    fieldLabels: Record<string, string>,
  ): Promise<Candidate> {
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    if (candidate.dataVersion !== expectedVersion) {
      throw ApiError.conflict('VERSION_CONFLICT', `Dữ liệu đã được người khác cập nhật (version ${candidate.dataVersion}). Vui lòng tải lại.`);
    }

    // Ràng buộc SĐT duy nhất: không cho sửa thành SĐT đã thuộc ứng viên khác
    const sdtZalo = String(patch.sdtZalo ?? '');
    if (sdtZalo) {
      const dup = await prisma.candidate.findFirst({
        where: { sdtZalo: normalizePhone(sdtZalo), id: { not: id } },
      });
      if (dup) {
        throw ApiError.conflict('DUPLICATE_CANDIDATE', `SĐT ${dup.sdtZalo} đã thuộc ứng viên ${dup.id}. Mỗi SĐT chỉ được giữ 1 hồ sơ.`);
      }
    }

    const newVersion = candidate.dataVersion + 1;
    const oldSnapshot: Record<string, unknown> = {};
    const newSnapshot: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      oldSnapshot[fieldLabels[k] ?? k] = (candidate as unknown as Record<string, unknown>)[k] ?? '';
      newSnapshot[fieldLabels[k] ?? k] = v ?? '';
    }

    const updated = await prisma.candidate.update({
      where: { id },
      data: { ...patch, dataVersion: newVersion, updatedBy: user },
    });
    await prisma.candidate.update({ where: { id }, data: { dataHash: computeHash(updated) } });
    const final = await prisma.candidate.findUniqueOrThrow({ where: { id } });

    await audit({
      user,
      action: 'UPDATE_CANDIDATE',
      entity: 'candidate',
      entityId: id,
      oldValue: oldSnapshot,
      newValue: newSnapshot,
      version: newVersion,
    });

    for (const [k] of Object.entries(patch)) {
      await syncQueue.enqueue({
        entity: 'candidate',
        entityId: id,
        operation: 'UPDATE',
        field: k,
        oldValue: (candidate as unknown as Record<string, unknown>)[k],
        newValue: (patch as unknown as Record<string, unknown>)[k],
        version: newVersion,
        idempotencyKey: `candidate:${id}:${k}:v${newVersion}`,
      });
    }

    emit('candidate:updated', { candidateId: id });
    return final;
  }

  private async checkInterviewConflict(candidateId: string, phongVanAt: Date): Promise<void> {
    const targetMs = phongVanAt.getTime();
    const windowStart = new Date(targetMs - 29 * 60 * 1000);
    const windowEnd = new Date(targetMs + 29 * 60 * 1000);

    const conflict = await prisma.candidate.findFirst({
      where: {
        id: { not: candidateId },
        phongVanAt: {
          not: null,
          gte: windowStart,
          lte: windowEnd,
        },
      },
      select: { id: true, tenUv: true, phongVanAt: true },
    });

    if (conflict && conflict.phongVanAt) {
      throw ApiError.conflict(
        'INTERVIEW_TIME_CONFLICT',
        `Khung giờ này quá gần lịch phỏng vấn đã hẹn của ứng viên ${conflict.tenUv} (${formatDateTime(conflict.phongVanAt)}). Lịch phỏng vấn giữa các ứng viên phải cách nhau ít nhất 30 phút.`,
      );
    }
  }

  async makeDecision(
    id: string,
    user: string,
    decision: 'PASS' | 'FAIL' | 'REVIEW',
    reason?: string,
    interview?: { phongVanAt?: Date; ggMeetLink?: string },
  ): Promise<Candidate> {
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    let phongVanAt = candidate.phongVanAt;
    let ggMeetLink = candidate.ggMeetLink;
    let calendarEventId = candidate.calendarEventId;
    if (decision === 'PASS') {
      if (!interview?.phongVanAt) {
        throw ApiError.badRequest('INTERVIEW_REQUIRED', 'Chấm PASS cần nhập thời gian phỏng vấn.');
      }
      await this.checkInterviewConflict(id, interview.phongVanAt);
      phongVanAt = interview.phongVanAt;
      let link = (interview.ggMeetLink ?? '').trim();
      if (!link) {
        // 1) Ưu tiên tự tạo link Meet qua Google Calendar (nếu đã kết nối)
        try {
          const settings0 = await getSettings();
          if (settings0.googleCalendar?.enabled && settings0.googleCalendar?.refreshToken) {
            const ev = await calendarService.createEvent({
              summary: `Phỏng vấn – ${candidate.tenUv}`,
              description: `Ứng viên: ${candidate.tenUv} (${candidate.id})\nSĐT/Zalo: ${candidate.sdtZalo}\nChi nhánh: ${candidate.chiNhanh}\nCa: ${candidate.caLam}`,
              start: phongVanAt,
              durationMinutes: settings0.interview?.durationMinutes ?? 30,
            });
            link = ev.hangoutLink;
            calendarEventId = ev.id;
          }
        } catch (e) {
          console.warn('[makeDecision] tạo Meet qua Calendar lỗi:', e instanceof Error ? e.message : String(e));
        }
        // 2) Link GG Meet mặc định theo chi nhánh (nếu có cấu hình)
        if (!link) {
          const settings0 = await getSettings();
          link = (settings0.interview?.branchMeetLinks ?? {})[candidate.chiNhanh] ?? '';
        }
        // 3) Không có nguồn link nào → báo lỗi rõ ràng
        if (!link) {
          throw ApiError.badRequest(
            'MEET_LINK_REQUIRED',
            'Không có link GG Meet: hãy kết nối Google Calendar (Cài đặt), cấu hình link chi nhánh hoặc nhập link thủ công.',
          );
        }
      }
      ggMeetLink = link;
    }

    const newVersion = candidate.dataVersion + 1;
    const updated = await prisma.candidate.update({
      where: { id },
      data: {
        hrDecision: decision,
        hrUser: user,
        hrReason: reason ?? null,
        hrDecisionAt: new Date(),
        phongVanAt,
        ggMeetLink,
        calendarEventId,
        trangThaiTraining: decision === 'PASS' ? TRAINING_STATUS.CHUA_THAM_GIA : candidate.trangThaiTraining,
        dataVersion: newVersion,
        updatedBy: user,
      },
    });

    await prisma.candidate.update({ where: { id }, data: { dataHash: computeHash(updated) } });
    const final = await prisma.candidate.findUniqueOrThrow({ where: { id } });

    await audit({
      user,
      action: `HR_DECISION_${decision}`,
      entity: 'candidate',
      entityId: id,
      oldValue: candidate.hrDecision,
      newValue: decision,
      version: newVersion,
    });

    await syncQueue.enqueue({
      entity: 'decision',
      entityId: id,
      operation: 'UPDATE',
      field: 'KET_QUA_PV',
      oldValue: candidate.hrDecision,
      newValue: decision,
      version: newVersion,
      idempotencyKey: `candidate:${id}:decision:v${newVersion}`,
    });

    emit('candidate:decision', { candidateId: id, decision, user });
    return final;
  }

  /** Sửa lịch phỏng vấn / link Meet / trạng thái sau PV — độc lập với quyết định PASS. */
  async updateInterview(
    id: string,
    user: string,
    patch: { phongVanAt?: Date; ggMeetLink?: string; interviewStatus?: string; hrDecision?: string; hrReason?: string },
  ): Promise<Candidate> {
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    if (patch.phongVanAt) {
      await this.checkInterviewConflict(id, patch.phongVanAt);
    }

    const data: Prisma.CandidateUpdateInput = {
      dataVersion: candidate.dataVersion + 1,
      updatedBy: user,
    };
    if (patch.phongVanAt) data.phongVanAt = patch.phongVanAt;
    if (patch.ggMeetLink !== undefined) {
      data.ggMeetLink = patch.ggMeetLink.trim() || null;
      // Link thay đổi → sự kiện Calendar cũ (nếu có) không còn khớp, xóa liên kết
      data.calendarEventId = null;
    }
    if (patch.interviewStatus) data.interviewStatus = patch.interviewStatus;
    if (patch.hrDecision !== undefined) {
      data.hrDecision = patch.hrDecision;
      data.hrDecisionAt = new Date();
      data.hrUser = user;
    }
    if (patch.hrReason !== undefined) {
      data.hrReason = patch.hrReason ? patch.hrReason.trim() : null;
    }

    const updated = await prisma.candidate.update({ where: { id }, data });
    await prisma.candidate.update({ where: { id }, data: { dataHash: computeHash(updated) } });
    const final = await prisma.candidate.findUniqueOrThrow({ where: { id } });

    await audit({
      user,
      action: 'INTERVIEW_UPDATE',
      entity: 'candidate',
      entityId: id,
      oldValue: JSON.stringify({
        phongVanAt: candidate.phongVanAt ? formatDateTime(candidate.phongVanAt) : null,
        ggMeetLink: candidate.ggMeetLink,
        interviewStatus: candidate.interviewStatus,
      }),
      newValue: JSON.stringify({
        phongVanAt: final.phongVanAt ? formatDateTime(final.phongVanAt) : null,
        ggMeetLink: final.ggMeetLink,
        interviewStatus: final.interviewStatus,
      }),
      version: candidate.dataVersion + 1,
    });

    emit('candidate:updated', { candidateId: id, user });
    return final;
  }

  async startTraining(id: string, user: string, ngayBatDau: Date, expectedVersion?: number): Promise<Candidate> {
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    if (candidate.hrDecision !== 'PASS' && candidate.hrDecision !== 'PASS_HS' && candidate.hrDecision !== 'PASS_PV') {
      throw ApiError.badRequest('NOT_PASSED', 'Ứng viên phải PASS trước khi vào Training.');
    }
    if (expectedVersion !== undefined && candidate.dataVersion !== expectedVersion) {
      throw ApiError.conflict('VERSION_CONFLICT', 'Dữ liệu đã được cập nhật. Vui lòng tải lại.');
    }

    const newVersion = candidate.dataVersion + 1;
    const updated = await prisma.candidate.update({
      where: { id },
      data: {
        ngayBatDauTraining: ngayBatDau,
        trangThaiTraining: TRAINING_STATUS.SAP_BAT_DAU,
        dataVersion: newVersion,
        updatedBy: user,
      },
    });
    await prisma.candidate.update({ where: { id }, data: { dataHash: computeHash(updated) } });
    const final = await prisma.candidate.findUniqueOrThrow({ where: { id } });

    await audit({
      user,
      action: 'START_TRAINING',
      entity: 'candidate',
      entityId: id,
      oldValue: candidate.ngayBatDauTraining,
      newValue: ngayBatDau,
      version: newVersion,
    });

    await syncQueue.enqueue({
      entity: 'training',
      entityId: id,
      operation: 'UPDATE',
      field: 'NGAY_BAT_DAU_TRAINING',
      oldValue: candidate.ngayBatDauTraining ? formatDateTime(candidate.ngayBatDauTraining) : '',
      newValue: formatDateTime(ngayBatDau),
      version: newVersion,
      idempotencyKey: `candidate:${id}:training-start:v${newVersion}`,
    });

    // Tự động gửi thông báo lịch Training qua Zalo (không chặn lưu lịch nếu Zalo lỗi)
    void zaloService
      .sendTrainingNotice(id)
      .then((r) => {
        if (r.ok) console.log(`[CandidateService] đã gửi thông báo Training: ${id}`);
      })
      .catch((e) =>
        console.warn('[CandidateService] gửi thông báo Training lỗi:', e instanceof Error ? e.message : String(e)),
      );

    emit('training:updated', { candidateId: id });
    return final;
  }

  async setTrainingStatus(id: string, user: string, status: string): Promise<Candidate> {
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    const newVersion = candidate.dataVersion + 1;
    const updated = await prisma.candidate.update({
      where: { id },
      data: { trangThaiTraining: status, dataVersion: newVersion, updatedBy: user },
    });
    await prisma.candidate.update({ where: { id }, data: { dataHash: computeHash(updated) } });
    const final = await prisma.candidate.findUniqueOrThrow({ where: { id } });

    await audit({
      user,
      action: 'CHANGE_TRAINING_STATUS',
      entity: 'candidate',
      entityId: id,
      oldValue: candidate.trangThaiTraining,
      newValue: status,
      version: newVersion,
    });
    await syncQueue.enqueue({
      entity: 'training',
      entityId: id,
      operation: 'UPDATE',
      field: 'TRANG_THAI_TRAINING',
      version: newVersion,
      idempotencyKey: `candidate:${id}:training-status:v${newVersion}`,
    });
    emit('training:updated', { candidateId: id });
    return final;
  }

  async stats(): Promise<Record<string, number>> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const [today, scored, pendingDecision, passToday, failToday, training, done, needReview] = await Promise.all([
      prisma.candidate.count({ where: { thoiGian: { gte: todayStart, lte: todayEnd } } }),
      prisma.candidate.count({ where: { aiScoredAt: { not: null } } }),
      prisma.candidate.count({ where: { tongDiem: { not: null }, hrDecision: null } }),
      prisma.candidate.count({ where: { hrDecision: 'PASS', hrDecisionAt: { gte: todayStart, lte: todayEnd } } }),
      prisma.candidate.count({ where: { hrDecision: 'FAIL', hrDecisionAt: { gte: todayStart, lte: todayEnd } } }),
      prisma.candidate.count({ where: { trangThaiTraining: { in: ['SAP_BAT_DAU', 'BAT_DAU'] } } }),
      prisma.candidate.count({ where: { trangThaiTraining: { in: ['HOAN_THANH', 'NHAN_VIEN_CHINH_THUC'] } } }),
      prisma.candidate.count({ where: { hrDecision: 'REVIEW' } }),
    ]);
    return { today, scored, pendingDecision, passToday, failToday, training, done, needReview };
  }

  /** AI Tự động nhận diện nội dung phản hồi Zalo của ứng viên để chuyển trạng thái xác nhận. */
  async processZaloAutoConfirmation(id: string, text: string, user = 'AI_AUTO'): Promise<{ processed: boolean; action?: string; newStatus?: string }> {
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) return { processed: false };

    const normalized = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const acceptKeywords = ['xac nhan tham gia', 'tham gia', 'dong y', 'co nha', 'se den', 'den phong van', 'xac nhan', 'em den', 'chac chan den', 'ok sep', 'dong y tham gia'];
    const rejectKeywords = ['tu choi', 'khong tham gia', 'ban roi', 'huy lich', 'khong den', 'khong di duoc'];

    const isAccept = acceptKeywords.some((kw) => normalized.includes(kw));
    const isReject = rejectKeywords.some((kw) => normalized.includes(kw));

    if (isAccept) {
      const newVersion = candidate.dataVersion + 1;
      await prisma.candidate.update({
        where: { id },
        data: {
          trangThaiTraining: TRAINING_STATUS.SAP_BAT_DAU,
          dataVersion: newVersion,
          updatedBy: user,
        },
      });

      await audit({
        user,
        action: 'AI_AUTO_CONFIRM_ACCEPT',
        entity: 'candidate',
        entityId: id,
        oldValue: candidate.trangThaiTraining,
        newValue: TRAINING_STATUS.SAP_BAT_DAU,
        version: newVersion,
      });

      emit('training:updated', { candidateId: id });
      emit('candidate:decision', { candidateId: id, decision: candidate.hrDecision, user });
      return { processed: true, action: 'CONFIRMED_ACCEPT', newStatus: 'SAP_BAT_DAU' };
    }

    if (isReject) {
      const newVersion = candidate.dataVersion + 1;
      await prisma.candidate.update({
        where: { id },
        data: {
          trangThaiTraining: TRAINING_STATUS.LOAI,
          dataVersion: newVersion,
          updatedBy: user,
        },
      });

      await audit({
        user,
        action: 'AI_AUTO_CONFIRM_REJECT',
        entity: 'candidate',
        entityId: id,
        oldValue: candidate.trangThaiTraining,
        newValue: TRAINING_STATUS.LOAI,
        version: newVersion,
      });

      emit('training:updated', { candidateId: id });
      emit('candidate:decision', { candidateId: id, decision: candidate.hrDecision, user });
      return { processed: true, action: 'CONFIRMED_REJECT', newStatus: 'LOAI' };
    }

    return { processed: false };
  }
}

/** Xóa 1 ứng viên kèm đầy đủ dọn dẹp: dòng phản hồi form, tombstone, DELETE sync về Google Sheet. */
export async function deleteCandidateWithCleanup(id: string, user: string, action = 'DELETE_CANDIDATE_DUP'): Promise<void> {
  const candidate = await prisma.candidate.findUnique({ where: { id } });
  if (!candidate) return;
  try {
    const cleared = await getGoogleSheetService().clearFormResponseRows(candidate.sdtZalo, candidate.thoiGian);
    if (cleared > 0) console.log(`[CLEANUP] Đã xóa ${cleared} dòng phản hồi form của ${candidate.id}`);
  } catch (e) {
    console.warn('[CLEANUP] clearFormResponseRows:', e instanceof Error ? e.message : String(e));
  }
  try {
    const settings = await getSettings();
    const tomb = Array.isArray((settings as Record<string, unknown>).deletedFormResponses)
      ? ((settings as Record<string, unknown>).deletedFormResponses as { sdt: string; thoiGian: string | null }[])
      : [];
    const entry = { sdt: normalizePhone(candidate.sdtZalo), thoiGian: candidate.thoiGian?.toISOString() ?? null };
    if (!tomb.some((t) => t.sdt === entry.sdt && t.thoiGian === entry.thoiGian)) {
      tomb.unshift(entry);
      await saveSettings({ deletedFormResponses: tomb.slice(0, 500) }, user);
    }
  } catch (e) {
    console.warn('[CLEANUP] tombstone:', e instanceof Error ? e.message : String(e));
  }
  await syncQueue.enqueue({
    entity: 'candidate',
    entityId: id,
    operation: 'DELETE',
    version: candidate.dataVersion + 1,
    idempotencyKey: `candidate:${id}:delete:v1`,
  });
  await prisma.candidate.delete({ where: { id } });
  await audit({
    user,
    action,
    entity: 'candidate',
    entityId: id,
    oldValue: { tenUv: candidate.tenUv, sdtZalo: candidate.sdtZalo },
    version: candidate.dataVersion,
  });
  emit('candidate:deleted', { candidateId: id });
}

export const candidateService = new CandidateService();
