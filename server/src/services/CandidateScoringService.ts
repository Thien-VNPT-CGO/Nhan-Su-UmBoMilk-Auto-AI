import { prisma } from '../lib/prisma';
import { getAIProvider } from './ai/AIClient';
import { getSettings } from './SettingsService';
import { syncQueue } from './SyncQueueService';
import { audit } from './AuditService';
import { emit } from '../sockets';
import { ApiError } from '../lib/errors';
import { createSemaphore } from '../lib/concurrency';
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
  if (tongDiem >= 12) return 'XUAT_SAC'; // 12-14 điểm: Xuất Sắc
  if (tongDiem >= 10) return 'GIOI';     // 10-11 điểm: Giỏi
  if (tongDiem >= 8) return 'DAT';       // 8-9 điểm: Đạt
  return null;
}

export class CandidateScoringService {
  // Chống chồng lấn khi nhiều yêu cầu chấm điểm cùng lúc (click nhanh + auto-score):
  // tối đa 2 lời gọi AI song song, còn lại xếp hàng chờ - web không bị nghẽn vì hàng loạt request AI.
  private scoreGate = createSemaphore(2);

  async scoreCandidate(candidate: Candidate, user: string): Promise<ScoringResult> {
    return this.scoreGate.run(() => this.scoreCandidateInner(candidate, user));
  }

  private async scoreCandidateInner(candidate: Candidate, user: string): Promise<ScoringResult> {
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

    // Năm sinh: chấm theo giai đoạn (2000–2004: +2, 2005–2008: +1, ≥2009: +0) — các giai đoạn chỉnh được trong Cài đặt
    let p_namSinh = 0;
    let namSinhNote = 'Thiếu dữ liệu';
    if (rules.namSinh.enabled) {
      const year = Number.parseInt(candidate.namSinh.trim(), 10);
      if (Number.isFinite(year)) {
        const tier = (rules.namSinh.tiers ?? []).find(
          (t) =>
            (t.min === undefined || t.min === null || year >= t.min) &&
            (t.max === undefined || t.max === null || year <= t.max),
        );
        if (tier) {
          p_namSinh = tier.score;
          const from = tier.min === null || tier.min === undefined ? '' : `từ ${tier.min}`;
          const to = tier.max === null || tier.max === undefined ? '' : `đến ${tier.max}`;
          namSinhNote = `Năm ${year}: ${[from, to].filter(Boolean).join(' ') || 'không giới hạn'} (+${tier.score}đ)`;
        } else {
          namSinhNote = `Năm ${year}: ngoài giai đoạn cộng điểm (+0đ)`;
        }
      } else if (candidate.namSinh.trim()) {
        p_namSinh = rules.namSinh.score ?? 0;
        namSinhNote = `Năm sinh không xác định được (+${p_namSinh}đ)`;
      }
    }

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

    // Kênh biết tin: "Quảng cáo FB/Tiktok..." = bình thường; "Bạn Bè, Người quen giới thiệu" = AI chấm LOẠI (FAIL) dù điểm cao
    let p_kenhBietTin = 0;
    let kenhBietTinNote = 'Không có dữ liệu';
    let isReferral = false;
    if (rules.kenhBietTin.enabled) {
      const raw = (candidate.kenhBietTin ?? '').trim();
      if (raw) {
        const norm = normalizeNoAccent(raw);
        isReferral = (rules.kenhBietTin.keywords ?? ['gioi thieu', 'ban be', 'nguoi quen']).some((k) =>
          norm.includes(normalizeNoAccent(String(k))),
        );
        if (isReferral) {
          p_kenhBietTin = rules.kenhBietTin.score ?? 0;
          kenhBietTinNote = `Bạn bè/người quen giới thiệu (+${p_kenhBietTin}đ) — AI chấm LOẠI (FAIL) dù điểm cao`;
        } else {
          kenhBietTinNote = `Quảng cáo FB/Tiktok/Instagram... (+0đ)`;
        }
      } else {
        kenhBietTinNote = 'Không có dữ liệu (+0đ)';
      }
    }

    const tongDiem = p_hoTen + p_namSinh + p_queQuan + p_sdt + p_trinhDo + p_kinhNghiem + p_xuLy + p_linkFb + p_kenhBietTin;
    const threshold = settings.scoring.passThreshold ?? 8;
    let aiRecommendation: 'PASS' | 'FAIL' = tongDiem >= threshold ? 'PASS' : 'FAIL';
    let xepLoai = classifyXepLoai(tongDiem);
    // Ràng buộc: chọn "Bạn Bè, Người quen giới thiệu" → AI tự chấm LOẠI cho dù điểm cao đến mấy
    if (isReferral) {
      aiRecommendation = 'FAIL';
      xepLoai = null;
    }

    const noteParts = [
      ai.kinhNghiem.reason,
      ai.xuLy.note,
      ai.queQuan.reason,
      ai.linkFb.reason,
      isReferral ? 'Kênh biết tin: Bạn bè/Người quen giới thiệu → AI chấm LOẠI (FAIL)' : '',
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
      d_kenhBietTin: candidate.kenhBietTin ?? '',
      p_hoTen,
      p_namSinh,
      p_queQuan,
      p_sdt,
      p_trinhDo,
      p_kinhNghiem,
      p_xuLy,
      p_linkFb,
      p_kenhBietTin,
      ai_xu_ly_note: ai.xuLy.note,
      ai_kinh_nghiem_classification: ai.kinhNghiem.classification,
      ai_kinh_nghiem_reason: ai.kinhNghiem.reason,
      ai_trinh_do_classification: ai.trinhDo.classification,
      ai_link_fb_status: ai.linkFb.status,
      ai_sdt_status: ai.sdt.status,
      ai_provider: ai.provider,
      chi_tiet: {
        hoTen: { diem: p_hoTen, nhanXet: candidate.tenUv.trim() ? 'Có dữ liệu' : 'Thiếu dữ liệu' },
        namSinh: { diem: p_namSinh, nhanXet: namSinhNote },
        queQuan: { diem: p_queQuan, nhanXet: ai.queQuan.reason },
        sdt: { diem: p_sdt, nhanXet: ai.sdt.status },
        trinhDo: { diem: p_trinhDo, nhanXet: ai.trinhDo.reason },
        kinhNghiem: { diem: p_kinhNghiem, nhanXet: ai.kinhNghiem.reason },
        xuLy: { diem: p_xuLy, nhanXet: ai.xuLy.note },
        linkFb: { diem: p_linkFb, nhanXet: ai.linkFb.reason },
        kenhBietTin: { diem: p_kenhBietTin, nhanXet: kenhBietTinNote },
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

/** Bỏ dấu tiếng Việt + lowercase để so khớp chuỗi không phân biệt dấu (vd "giới thiệu" == "gioi thieu"). */
export function normalizeNoAccent(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}
