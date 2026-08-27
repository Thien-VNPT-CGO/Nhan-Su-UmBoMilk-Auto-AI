import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireWrite, requireRole, AuthedRequest, branchScope, canAccessBranch } from '../middleware/auth';
import { candidateService, normalizePhone } from '../services/CandidateService';
import { dedupService } from '../services/DedupService';
import { candidateScoringService } from '../services/CandidateScoringService';
import { syncQueue } from '../services/SyncQueueService';
import { audit } from '../services/AuditService';
import { getGoogleSheetService } from '../services/GoogleSheetService';
import { getSettings, saveSettings } from '../services/SettingsService';
import { ApiError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { emit } from '../sockets';
import { zaloService } from '../services/ZaloService';
import { parseLocalPhanVanAt } from '../lib/date';

const router = Router();
router.use(requireAuth);

const CANDIDATE_FIELDS: Record<string, { label: string; schema: z.ZodTypeAny }> = {
  tenUv: { label: 'TEN_UV', schema: z.string() },
  namSinh: { label: 'NAM_SINH', schema: z.string() },
  trinhDo: { label: 'TRINH_DO', schema: z.string() },
  queQuan: { label: 'QUE_QUAN', schema: z.string() },
  sdtZalo: { label: 'SDT_ZALO', schema: z.string() },
  zaloUserId: { label: 'ZALO_USER_ID', schema: z.string().max(64) },
  caLam: { label: 'CA_LAM', schema: z.string() },
  caHoTro: { label: 'CA_HO_TRO', schema: z.string() },
  chiNhanh: { label: 'CHI_NHANH', schema: z.string() },
  kinhNghiem: { label: 'KINH_NGHIEM', schema: z.string() },
  xuLy: { label: 'XU_LY', schema: z.string() },
  linkFb: { label: 'LINK_FB', schema: z.string() },
  kenhBietTin: { label: 'KENH_BIET_TIN', schema: z.string() },
};

router.get('/booked-interviews', async (_req, res, next) => {
  try {
    const list = await prisma.candidate.findMany({
      where: { phongVanAt: { not: null } },
      select: { id: true, tenUv: true, phongVanAt: true, ggMeetLink: true },
      orderBy: { phongVanAt: 'asc' },
    });
    res.json({ success: true, data: list });
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const result = await candidateService.list({
      search: String(req.query.search ?? ''),
      chiNhanh: String(req.query.chiNhanh ?? ''),
      caLam: String(req.query.caLam ?? ''),
      status: String(req.query.status ?? ''),
      from: String(req.query.from ?? ''),
      to: String(req.query.to ?? ''),
      sort: String(req.query.sort ?? 'newest'),
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

const updateSchema = z.object({
  version: z.number().int().positive(),
  patch: z.record(z.unknown()).refine((v) => Object.keys(v).length > 0, 'Patch trống'),
});

// SUB-ROUTES VỚI WILDCARD ID SUPPORT UBM_DD/MM/YYYY_NV0001
router.post('/:id(*)/score', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    const result = await candidateScoringService.scoreCandidate(candidate, req.user!.username);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

router.post('/:id(*)/resolve-zalo-user-id', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    res.json({ success: true, data: { zaloUserId: candidate.sdtZalo, note: 'Sử dụng Zalo Cá Nhân theo SĐT' } });
  } catch (e) {
    next(e);
  }
});

const decisionSchema = z.object({
  decision: z.enum(['PASS', 'FAIL', 'REVIEW', 'PASS_HS', 'PASS_PV']),
  reason: z.string().optional(),
  phongVanAt: z.string().optional(),
  ggMeetLink: z.string().optional(),
  interview: z.object({
    phongVanAt: z.string().optional(),
    ggMeetLink: z.string().optional(),
  }).optional(),
});

router.patch('/:id(*)/decision', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const { decision, reason, phongVanAt, ggMeetLink, interview } = parsed.data;

    const pvAtStr = phongVanAt || interview?.phongVanAt;
    const meetLinkStr = ggMeetLink || interview?.ggMeetLink;
    const isPassDecision = decision === 'PASS' || decision === 'PASS_HS' || decision === 'PASS_PV';

    if (isPassDecision && !pvAtStr) {
      throw ApiError.badRequest('INTERVIEW_REQUIRED', 'Chấm PASS cần nhập thời gian phỏng vấn.');
    }
    let phongVanAtDate: Date | undefined;
    if (pvAtStr) {
      phongVanAtDate = parseLocalPhanVanAt(pvAtStr);
      if (!phongVanAtDate || Number.isNaN(phongVanAtDate.getTime())) {
        throw ApiError.badRequest('INVALID_DATETIME', 'Thời gian phỏng vấn không hợp lệ.');
      }
    }

    const decisionCode = isPassDecision ? 'PASS' : decision;

    const candidate = await candidateService.makeDecision(
      req.params.id,
      req.user!.username,
      decisionCode,
      reason,
      isPassDecision ? { phongVanAt: phongVanAtDate, ggMeetLink: meetLinkStr } : undefined,
    );

    let zalo: { ok: boolean; provider: string; messageId?: string } | null = null;
    if (isPassDecision) {
      try {
        zalo = await zaloService.sendInterviewInvite(candidate.id);
      } catch (e) {
        zalo = { ok: false, provider: 'ERROR' };
        console.error('Zalo interview invite failed:', e);
      }
    }
    res.json({ success: true, data: candidate, zalo });
  } catch (e) {
    next(e);
  }
});

const interviewPatchSchema = z.object({
  phongVanAt: z.string().optional(),
  ggMeetLink: z.string().optional(),
  interviewStatus: z.enum(['CHUA_PV', 'DA_PV', 'QUA_PV', 'TRUOT_PV', 'VANG']).optional(),
  hrDecision: z.string().optional(),
  hrReason: z.string().optional(),
  sendZaloNotice: z.boolean().optional(),
  resend: z.boolean().optional(),
});

router.patch('/:id(*)/interview', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = interviewPatchSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const { phongVanAt, ggMeetLink, interviewStatus, hrDecision, hrReason, sendZaloNotice, resend } = parsed.data;

    let phongVanAtDate: Date | undefined;
    if (phongVanAt) {
      if (req.user?.role !== 'ADMIN') {
        throw ApiError.forbidden('Chỉ có Admin mới có quyền sửa lịch phỏng vấn.');
      }
      phongVanAtDate = parseLocalPhanVanAt(phongVanAt);
      if (!phongVanAtDate || Number.isNaN(phongVanAtDate.getTime())) {
        throw ApiError.badRequest('INVALID_DATETIME', 'Thời gian phỏng vấn không hợp lệ.');
      }
    }

    const candidate = await candidateService.updateInterview(req.params.id, req.user!.username, {
      phongVanAt: phongVanAtDate,
      ggMeetLink,
      interviewStatus,
      hrDecision,
      hrReason,
    });

    let zalo: { ok: boolean; provider: string; messageId?: string } | null = null;
    if (resend) {
      try {
        zalo = await zaloService.sendInterviewInvite(candidate.id);
      } catch (e) {
        zalo = { ok: false, provider: 'ERROR' };
        console.error('Zalo interview resend failed:', e);
      }
    } else if (sendZaloNotice && hrDecision && ['PASS_PV', 'PASS_HS', 'FAIL'].includes(hrDecision)) {
      try {
        zalo = await zaloService.sendInterviewOutcomeNotice(candidate.id, hrDecision as 'PASS_PV' | 'PASS_HS' | 'FAIL', hrReason);
      } catch (e) {
        zalo = { ok: false, provider: 'ERROR' };
        console.error('Zalo interview outcome notice failed:', e);
      }
    }
    res.json({ success: true, data: candidate, zalo });
  } catch (e) {
    next(e);
  }
});

const startTrainingSchema = z.object({
  ngayBatDau: z.string().min(1),
  version: z.number().int().positive().optional(),
});

router.post('/:id(*)/training/start', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = startTrainingSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const candidate = await candidateService.startTraining(
      req.params.id,
      req.user!.username,
      new Date(parsed.data.ngayBatDau),
      parsed.data.version,
    );
    res.json({ success: true, data: candidate });
  } catch (e) {
    next(e);
  }
});

const autoDetectSchema = z.object({
  content: z.string().min(1),
});

router.post('/:id(*)/auto-detect-zalo-reply', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = autoDetectSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const result = await candidateService.processZaloAutoConfirmation(
      req.params.id,
      parsed.data.content,
      req.user!.username,
    );
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

// ROUTE LẤY / XÓA / SỬA CANDIDATE VỚI WILDCARD ID SUPPORT UBM_DD/MM/YYYY_NV0001
router.get('/:id(*)', async (req: AuthedRequest, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    res.json({ success: true, data: candidate });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id(*)', requireRole('ADMIN', 'HR'), async (req: AuthedRequest, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    try {
      const cleared = await getGoogleSheetService().clearFormResponseRows(candidate.sdtZalo, candidate.thoiGian);
      if (cleared > 0) console.log(`[DELETE] Đã xóa ${cleared} dòng phản hồi form của ${candidate.id}`);
    } catch (e) {
      console.warn('[DELETE] clearFormResponseRows:', e instanceof Error ? e.message : String(e));
    }

    try {
      const settings = await getSettings();
      const tomb = Array.isArray((settings as Record<string, unknown>).deletedFormResponses)
        ? ((settings as Record<string, unknown>).deletedFormResponses as { sdt: string; thoiGian: string | null }[])
        : [];
      const entry = { sdt: normalizePhone(candidate.sdtZalo), thoiGian: candidate.thoiGian?.toISOString() ?? null };
      if (!tomb.some((t) => t.sdt === entry.sdt && t.thoiGian === entry.thoiGian)) {
        tomb.unshift(entry);
        await saveSettings({ deletedFormResponses: tomb.slice(0, 500) }, req.user!.username);
      }
    } catch (e) {
      console.warn('[DELETE] tombstone:', e instanceof Error ? e.message : String(e));
    }

    await syncQueue.enqueue({
      entity: 'candidate',
      entityId: req.params.id,
      operation: 'DELETE',
      version: candidate.dataVersion + 1,
      idempotencyKey: `candidate:${req.params.id}:delete:v1`,
    });
    await prisma.candidate.delete({ where: { id: req.params.id } });
    await audit({
      user: req.user!.username,
      action: 'DELETE_CANDIDATE',
      entity: 'candidate',
      entityId: req.params.id,
      oldValue: { tenUv: candidate.tenUv, sdtZalo: candidate.sdtZalo },
      version: candidate.dataVersion,
    });

    res.json({ success: true, data: { id: req.params.id, deleted: true } });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id(*)', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');

    const patch: Record<string, unknown> = {};
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.data.patch)) {
      const field = CANDIDATE_FIELDS[k];
      if (!field) throw ApiError.badRequest('INVALID_FIELD', `Field không hỗ trợ: ${k}`);
      const fv = field.schema.safeParse(v);
      if (!fv.success) throw ApiError.badRequest('INVALID_VALUE', `Giá trị ${k} không hợp lệ.`);
      if (k === 'sdtZalo') patch[k] = normalizePhone(String(v));
      else if (k === 'zaloUserId') patch[k] = String(v).trim() || null;
      else patch[k] = v;
      labels[k] = field.label;
    }

    const candidate = await candidateService.updateFields(
      req.params.id,
      req.user!.username,
      parsed.data.version,
      patch as never,
      labels,
    );
    res.json({ success: true, data: candidate });
  } catch (e) {
    next(e);
  }
});

export default router;