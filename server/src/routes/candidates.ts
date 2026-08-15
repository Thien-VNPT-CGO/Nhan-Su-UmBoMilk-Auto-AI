import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireWrite, AuthedRequest } from '../middleware/auth';
import { candidateService, normalizePhone } from '../services/CandidateService';
import { candidateScoringService } from '../services/CandidateScoringService';
import { ApiError } from '../lib/errors';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(requireAuth);

const CANDIDATE_FIELDS: Record<string, { label: string; schema: z.ZodTypeAny }> = {
  tenUv: { label: 'TEN_UV', schema: z.string() },
  namSinh: { label: 'NAM_SINH', schema: z.string() },
  trinhDo: { label: 'TRINH_DO', schema: z.string() },
  queQuan: { label: 'QUE_QUAN', schema: z.string() },
  sdtZalo: { label: 'SDT_ZALO', schema: z.string() },
  caLam: { label: 'CA_LAM', schema: z.string() },
  chiNhanh: { label: 'CHI_NHANH', schema: z.string() },
  kinhNghiem: { label: 'KINH_NGHIEM', schema: z.string() },
  xuLy: { label: 'XU_LY', schema: z.string() },
  linkFb: { label: 'LINK_FB', schema: z.string() },
};

router.get('/', async (req, res, next) => {
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

router.get('/filters', async (_req, res, next) => {
  try {
    const branches = await prisma.candidate.findMany({ distinct: ['chiNhanh'], select: { chiNhanh: true } });
    const shifts = await prisma.candidate.findMany({ distinct: ['caLam'], select: { caLam: true } });
    res.json({
      success: true,
      data: {
        chiNhanh: branches.map((b) => b.chiNhanh).sort(),
        caLam: shifts.map((s) => s.caLam),
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const candidate = await candidateService.getById(req.params.id);
    res.json({ success: true, data: candidate });
  } catch (e) {
    next(e);
  }
});

const updateSchema = z.object({
  version: z.number().int().positive(),
  patch: z.record(z.unknown()).refine((v) => Object.keys(v).length > 0, 'Patch trống'),
});

router.patch('/:id', requireWrite(), async (req: AuthedRequest, res, next) => {
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

router.post('/:id/score', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');
    const result = await candidateScoringService.scoreCandidate(candidate, req.user!.username);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

const decisionSchema = z.object({
  decision: z.enum(['PASS', 'FAIL', 'REVIEW']),
  reason: z.string().optional(),
});

router.patch('/:id/decision', requireWrite(), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const candidate = await candidateService.makeDecision(
      req.params.id,
      req.user!.username,
      parsed.data.decision,
      parsed.data.reason,
    );
    res.json({ success: true, data: candidate });
  } catch (e) {
    next(e);
  }
});

const startTrainingSchema = z.object({
  ngayBatDau: z.string().min(1),
  version: z.number().int().positive().optional(),
});

router.post('/:id/training/start', requireWrite(), async (req: AuthedRequest, res, next) => {
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

export default router;