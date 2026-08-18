import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { ApiError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { candidateService } from '../services/CandidateService';
import { getGoogleSheetService, candidateDataHash } from '../services/GoogleSheetService';
import { conflictService } from '../services/ConflictService';
import { emit } from '../sockets';

const router = Router();

const formSchema = z.object({
  secret: z.string().optional(),
  tenUv: z.string().min(1),
  gioiTinh: z.string().optional().default(''),
  namSinh: z.string().optional().default(''),
  trinhDo: z.string().optional().default(''),
  queQuan: z.string().optional().default(''),
  sdtZalo: z.string().min(1),
  caLam: z.string().optional().default(''),
  chiNhanh: z.string().optional().default(''),
  kinhNghiem: z.string().optional().default(''),
  xuLy: z.string().optional().default(''),
  linkFb: z.string().optional().default(''),
  kenhBietTin: z.string().optional().default(''),
});

router.post('/form', async (req, res, next) => {
  try {
    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu form không hợp lệ.');
    const candidate = await candidateService.createFromForm(parsed.data);
    await prisma.webhookEvent.create({
      data: { id: nextId('WEB'), source: 'GOOGLE_FORM', payload: req.body as object },
    });
    res.status(201).json({ success: true, data: { id: candidate.id } });
  } catch (e) {
    next(e);
  }
});

const sheetWebhookSchema = z.object({
  candidateId: z.string(),
  secret: z.string().optional(),
  sheet: z.string().optional(),
  row: z.number().optional(),
  version: z.number().optional(),
  hash: z.string().optional(),
});

router.post('/sheet', async (req, res, next) => {
  try {
    const secret = req.headers['x-webhook-secret'] ?? req.body?.secret;
    if (secret !== env.webhookSecret) throw ApiError.unauthorized('Webhook secret không hợp lệ.');

    const parsed = sheetWebhookSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Payload không hợp lệ.');

    await prisma.webhookEvent.create({
      data: { id: nextId('WEB'), source: 'GOOGLE_SHEET', payload: req.body as object },
    });

    const { candidateId, sheet: sheetName, row, version, hash } = parsed.data;
    const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw ApiError.notFound('CANDIDATE_NOT_FOUND', 'Không tìm thấy ứng viên.');

    if (version !== undefined && version <= candidate.dataVersion) {
      // stale webhook -> ignore
      return res.json({ success: true, data: { ignored: true, reason: 'STALE' } });
    }

    // read actual row from sheet to detect changes
    const sheet = getGoogleSheetService();
    if (sheet.configured && sheetName) {
      const found = await sheet.findByCandidateId(sheetName, candidateId);
      if (found && hash) {
        const localHash = candidateDataHash(candidate);
        if (localHash !== hash) {
          // sheet differs from web -> conflict for admin to resolve
          await conflictService.createConflict({
            entityId: candidateId,
            field: 'GOOGLE_SHEET_EDIT',
            webValue: localHash,
            sheetValue: hash,
            webVersion: candidate.dataVersion,
            sheetVersion: version,
          });
        }
      }
    }

    emit('candidate:updated', { candidateId });
    res.json({ success: true, data: { processed: true } });
  } catch (e) {
    next(e);
  }
});

export default router;