import { prisma } from '../lib/prisma';
import { getAIProvider } from './ai/AIClient';
import { getSettings } from './SettingsService';
import { syncQueue } from './SyncQueueService';
import { audit } from './AuditService';
import { emit } from '../sockets';
import { ApiError } from '../lib/errors';
import type { Candidate } from '@prisma/client';

export interface ScoringResult {
  aiScore: Record<string, unknown>;
  tongDiem: number;
  xepLoai: 'DAT' | 'GIOI' | 'XUAT_SAC' | null;
  aiRecommendation: 'PASS' | 'FAIL';
  aiNote: string;
  aiConfidence: number;
}

export function classifyXepLoai(tongDiem: number): 'DAT' | 'GIOI' | 'XUAT_SAC' | null {
  if (tongDiem >= 9) return 'XUAT_SAC';
  if (tongDiem >= 8) return 'GIOI';
  if (tongDiem >= 7) return 'DAT';
  return null;
}

export class CandidateScoringService {
  async scoreCandidate(candidate: Candidate, user: string): Promise<ScoringResult> {
    const settings = await getSettings();
    const rules = settings.scoring.rules;

    const provider = await getAIProvider();
    const ai = await provider.score({
      tenUv: candidate.tenUv,
      namSinh: candidate.namSinh,
      queQuan: candidate.queQuan,
      sdtZalo: candidate.sdtZalo,
      trinhDo: candidate.trinhDo,
      kinhNghiem: candidate.kinhNghiem,
      xuLy: candidate.xuLy,
      linkFb: candidate.linkFb,
    });

    // ===== P_* point computation from rules =====
    const p_hoTen = rules.hoTen.enabled && candidate.tenUv.trim() ? rules.hoTen.score : 0;
    const p_namSinh = rules.namSinh.enabled && candidate.namSinh.trim() ? rules.namSinh.score : 0;

    let p_queQuan = 0;
    if (rules.queQuan.enabled) {
      const region = ai.queQuan.region;
      const allowed = rules.queQuan.allowed;
      const isAllowed = (region === 'MIEN_TAY' && allowed.includes('Miền Tây')) ||
        (region === 'TP_HCM' && allowed.includes('TP.HCM'));
      if (isAllowed) p_queQuan = rules.queQuan.score;
    }

    const p_sdt = rules.sdt.enabled && ai.sdt.valid ? rules.sdt.score : 0;

    let p_trinhDo = 0;
    if (rules.trinhDo.enabled) {
      const cls = ai.trinhDo.classification;
      if (cls === 'SinhVienDaiHoc_CaoDang') p_trinhDo = rules.trinhDo.scores.SinhVienDaiHoc_CaoDang;
      else if (cls === 'NghiHoc') p_trinhDo = rules.trinhDo.scores.NghiHoc;
      else p_trinhDo = 0;
    }

    let p_kinhNghiem = 0;
    if (rules.kinhNghiem.enabled) {
      p_kinhNghiem = rules.kinhNghiem.scores[ai.kinhNghiem.classification] ?? 0;
    }

    const p_xuLy = rules.xuLy.enabled && ai.xuLy.score > 0 ? rules.xuLy.score : 0;
    const p_linkFb = rules.linkFb.enabled ? ai.linkFb.score : 0;

    const tongDiem = p_hoTen + p_namSinh + p_queQuan + p_sdt + p_trinhDo + p_kinhNghiem + p_xuLy + p_linkFb;
    const threshold = settings.scoring.passThreshold ?? 7;
    const aiRecommendation = tongDiem >= threshold ? 'PASS' : 'FAIL';
    const xepLoai = classifyXepLoai(tongDiem);

    const noteParts = [
      ai.kinhNghiem.reason,
      ai.xuLy.note,
      ai.queQuan.reason,
      ai.linkFb.reason,
    ].filter(Boolean);
    const aiNote = noteParts.join(' | ');
    const aiConfidence = ai.confidence;

    const aiScore = {
      d_hoTen: candidate.tenUv,
      d_namSinh: candidate.namSinh,
      d_queQuan: candidate.queQuan,
      d_sdt: candidate.sdtZalo,
      d_trinhDo: candidate.trinhDo,
      d_kinhNghiem: candidate.kinhNghiem,
      d_xuLy: candidate.xuLy,
      d_linkFb: candidate.linkFb,
      p_hoTen,
      p_namSinh,
      p_queQuan,
      p_sdt,
      p_trinhDo,
      p_kinhNghiem,
      p_xuLy,
      p_linkFb,
      ai_xu_ly_note: ai.xuLy.note,
      ai_kinh_nghiem_classification: ai.kinhNghiem.classification,
      ai_kinh_nghiem_reason: ai.kinhNghiem.reason,
      ai_trinh_do_classification: ai.trinhDo.classification,
      ai_link_fb_status: ai.linkFb.status,
      ai_sdt_status: ai.sdt.status,
      ai_provider: ai.provider,
      chi_tiet: {
        hoTen: { diem: p_hoTen, nhanXet: candidate.tenUv.trim() ? 'Có dữ liệu' : 'Thiếu dữ liệu' },
        namSinh: { diem: p_namSinh, nhanXet: candidate.namSinh.trim() ? 'Có dữ liệu' : 'Thiếu dữ liệu' },
        queQuan: { diem: p_queQuan, nhanXet: ai.queQuan.reason },
        sdt: { diem: p_sdt, nhanXet: ai.sdt.status },
        trinhDo: { diem: p_trinhDo, nhanXet: ai.trinhDo.reason },
        kinhNghiem: { diem: p_kinhNghiem, nhanXet: ai.kinhNghiem.reason },
        xuLy: { diem: p_xuLy, nhanXet: ai.xuLy.note },
        linkFb: { diem: p_linkFb, nhanXet: ai.linkFb.reason },
      },
    };

    const newVersion = candidate.dataVersion + 1;
    const updated = await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        aiScore: aiScore as object,
        tongDiem,
        xepLoai,
        aiRecommendation,
        aiNote,
        aiConfidence,
        aiScoredAt: new Date(),
        dataVersion: newVersion,
        updatedBy: user,
      },
    });

    await audit({
      user,
      action: 'AI_SCORE',
      entity: 'candidate',
      entityId: candidate.id,
      oldValue: { tongDiem: candidate.tongDiem },
      newValue: { tongDiem, xepLoai, aiRecommendation },
      version: newVersion,
    });

    await syncQueue.enqueue({
      entity: 'score',
      entityId: candidate.id,
      operation: 'UPSERT',
      version: newVersion,
      idempotencyKey: `candidate:${candidate.id}:score:v${newVersion}`,
    });

    emit('candidate:scored', { candidateId: candidate.id, tongDiem, xepLoai, aiRecommendation });

    return { aiScore, tongDiem, xepLoai, aiRecommendation, aiNote, aiConfidence };
  }
}

export const candidateScoringService = new CandidateScoringService();
