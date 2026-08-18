import { env } from '../../config/env';
import { getSettings } from '../SettingsService';

export interface AIClassification {
  trinhDo: { classification: string; score: number; reason: string };
  kinhNghiem: { classification: 'NO_EXPERIENCE' | 'OTHER_EXPERIENCE' | 'FNB_EXPERIENCE'; score: number; reason: string };
  xuLy: { score: number; note: string; analysis: Record<string, boolean> };
  queQuan: { region: string; score: number; reason: string };
  sdt: { valid: boolean; status: 'VERIFIED' | 'UNVERIFIED' | 'INVALID' };
  linkFb: { status: 'CO_VE_CHINH_CHU' | 'CAN_XAC_MINH' | 'KHONG_TRUY_CAP' | 'LINK_KHONG_HOP_LE'; score: number; reason: string };
  confidence: number;
  provider: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIProvider {
  readonly name: string;
  score(candidateProfile: {
    tenUv: string; namSinh: string; queQuan: string; sdtZalo: string;
    trinhDo: string; kinhNghiem: string; xuLy: string; linkFb: string;
  }): Promise<AIClassification>;
  /** Trò chuyện tự do — dùng cho Zalo auto-reply, chatbot hỗ trợ HR... */
  chat(messages: ChatMessage[]): Promise<string>;
  ping(): Promise<boolean>;
}

class MockProvider implements AIProvider {
  readonly name = 'MOCK';

  async ping(): Promise<boolean> {
    return true;
  }

  /** Trả lời theo quy tắc (không cần API key) cho câu hỏi thường gặp của ứng viên. */
  async chat(messages: ChatMessage[]): Promise<string> {
    const last = [...messages].reverse().find((m) => m.role === 'user');
    const q = (last?.content ?? '').toLowerCase();
    if (/(điểm danh|checkin|chấm công)/.test(q)) {
      return 'Bạn chỉ cần nhắn: "điểm danh" đến OA UMBO MILK trong khung giờ cho phép (SÁNG 06:45–07:05, CHIỀU 11:45–12:05, TỐI 17:45–18:05). Nếu đang ở gần chi nhánh, hãy gửi kèm vị trí (GPS) để xác nhận địa điểm.';
    }
    if (/(giờ làm|giờ làm việc|khung giờ|ca làm|thời gian)/.test(q)) {
      return 'UMBO MILK có 3 ca: SÁNG 06:45–07:05 bắt đầu, CHIỀU 11:45–12:05, TỐI 17:45–18:05. Lịch ca cụ thể của bạn do quản lý chi nhánh sắp xếp và thông báo qua Zalo.';
    }
    if (/(lương|thu nhập|bao nhiêu tiền|hoa hồng)/.test(q)) {
      return 'Vui lòng liên hệ quản lý chi nhánh nơi bạn ứng tuyển để được tư vấn chính xác về lương, thưởng và hoa hồng theo chính sách từng thời kỳ của UMBO MILK.';
    }
    if (/(chi nhánh|địa chỉ|ở đâu|chỗ làm)/.test(q)) {
      return 'Bạn có thể xem địa chỉ chi nhánh đã đăng ký trong thông báo Training gửi qua Zalo, hoặc liên hệ quản lý chi nhánh để được hướng dẫn đường đi.';
    }
    if (/(training|đào tạo|học việc|thử việc)/.test(q)) {
      return 'Chương trình đào tạo của UMBO MILK kéo dài 7 ngày làm việc. Bạn sẽ nhận thông báo lịch qua Zalo và phải điểm danh đúng khung giờ mỗi ca. Hoàn thành đủ 7 ngày sẽ được công nhận.';
    }
    if (/(nghỉ|xin phép|vắng|off)/.test(q)) {
      return 'Nếu bạn cần nghỉ, hãy báo trước cho quản lý chi nhánh và sắp xếp đổi ca. Nhớ thông báo sớm để không bị tính là vắng không phép.';
    }
    if (/(chào|hello|hi|alo)/.test(q)) {
      return 'Chào bạn! 👋 Mình là trợ lý tuyển dụng của UMBO MILK. Bạn cần hỗ trợ gì: thông tin điểm danh, giờ làm, đào tạo hay lương thưởng?';
    }
    return 'Cảm ơn bạn đã liên hệ UMBO MILK! 🐮 Để được hỗ trợ nhanh nhất, bạn có thể nhắn rõ câu hỏi (ví dụ: "điểm danh", "giờ làm", "lương") hoặc liên hệ trực tiếp quản lý chi nhánh của bạn.';
  }

  async score(p: {
    tenUv: string; namSinh: string; queQuan: string; sdtZalo: string;
    trinhDo: string; kinhNghiem: string; xuLy: string; linkFb: string;
  }): Promise<AIClassification> {
    const t = p.trinhDo.toLowerCase();
    let trinhDo: AIClassification['trinhDo'];
    if (/(đang học|sinh viên|học viên|cao đẳng|đại học)/.test(t)) {
      trinhDo = { classification: 'SinhVienDaiHoc_CaoDang', score: 1, reason: 'Sinh viên Đại học/Cao đẳng.' };
    } else if (/(nghỉ học|bỏ học|thôi học|không học)/.test(t)) {
      trinhDo = { classification: 'NghiHoc', score: 2, reason: 'Nghỉ học (không bận việc học).' };
    } else if (/(tốt nghiệp|đã tốt nghiệp)/.test(t)) {
      trinhDo = { classification: 'TotNghiep', score: 1, reason: 'Đã tốt nghiệp, có bằng cấp.' };
    } else {
      trinhDo = { classification: 'KHAC', score: 1, reason: 'Có trình độ học vấn.' };
    }

    const k = p.kinhNghiem.toLowerCase();
    let kinhNghiem: AIClassification['kinhNghiem'];
    if (/(f&b|fnb|trà sữa|nhà hàng|quán ăn|barista|pha chế|phục vụ|bán hàng|chạy bàn|order|cà phê)/.test(k)) {
      kinhNghiem = { classification: 'FNB_EXPERIENCE', score: 2, reason: 'Có kinh nghiệm ngành F&B.' };
    } else if (/(chưa|không có|chưa từng|no experience|không kinh nghiệm)/.test(k)) {
      kinhNghiem = { classification: 'NO_EXPERIENCE', score: 0, reason: 'Chưa có kinh nghiệm.' };
    } else if (k.trim().length > 0) {
      kinhNghiem = { classification: 'OTHER_EXPERIENCE', score: 1, reason: 'Có kinh nghiệm làm việc khác.' };
    } else {
      kinhNghiem = { classification: 'NO_EXPERIENCE', score: 0, reason: 'Không có thông tin kinh nghiệm.' };
    }

    const x = p.xuLy.toLowerCase();
    const hasAnswer = x.trim().length > 0;
    const analysis = {
      responsibility: /(báo|thông báo|liên hệ|gọi|nhắn|xin phép)/.test(x),
      manager: /(quản lý|quản lý|leader|sếp|anh chị quản lý)/.test(x),
      proactiveSwap: /(đổi ca|hoán đổi|nhờ|thay|đổi lịch|sắp xếp)/.test(x),
      alternative: /(thay thế|người thay|bù|đền bù|khác giờ)/.test(x),
    };
    const xuLy = {
      score: hasAnswer ? 1 : 0,
      note: hasAnswer
        ? `Ứng viên ${analysis.responsibility ? 'có ý thức báo' : 'chưa rõ việc báo'} quản lý, ${analysis.proactiveSwap ? 'chủ động đổi ca' : 'chưa đề xuất đổi ca'}.`
        : 'Không có câu trả lời.',
      analysis,
    };

    const q = p.queQuan.toLowerCase();
    const mienTay = /(cần thơ|vĩnh long|bến tre|trà vinh|sóc trăng|hậu giang|đồng tháp|an giang|kiên giang|tiền giang|long an|bạc liêu|cà mau|miền tây)/.test(q);
    const tp = /(hcm|hồ chí minh|saigon|sài gòn|tp\.? ?hcm|tphcm|thành phố hồ chí minh)/.test(q);
    const queQuan = mienTay || tp
      ? { region: mienTay ? 'MIEN_TAY' : 'TP_HCM', score: 1, reason: 'Miền Tây / TP.HCM.' }
      : { region: 'KHAC', score: 0, reason: 'Ngoài khu vực ưu tiên.' };

    const phone = String(p.sdtZalo ?? '').replace(/[\s.-]/g, '');
    const validPhone = /^(\+84|0|84)?[0-9]{9,10}$/.test(phone);
    const sdt = validPhone
      ? { valid: true, status: 'UNVERIFIED' as const, score: 1 }
      : { valid: false, status: 'INVALID' as const, score: 0 };

    const fb = String(p.linkFb ?? '');
    let linkFb: AIClassification['linkFb'];
    if (!fb || !fb.trim()) {
      linkFb = { status: 'KHONG_TRUY_CAP', score: 0, reason: 'Không có link Facebook.' };
    } else if (/^(https?:\/\/)?(www\.)?(facebook|fb)\.(com|me)/i.test(fb.trim())) {
      linkFb = { status: 'CO_VE_CHINH_CHU', score: 1, reason: 'Có link Facebook hợp lệ.' };
    } else {
      linkFb = { status: 'LINK_KHONG_HOP_LE', score: 0, reason: 'Link Facebook không hợp lệ.' };
    }

    return {
      trinhDo, kinhNghiem, xuLy, queQuan, sdt, linkFb,
      confidence: 0.85,
      provider: 'MOCK',
    };
  }
}

class OpenAIProvider implements AIProvider {
  readonly name = 'OPENAI';
  constructor(private baseUrl: string, private apiKey: string, private model: string) {}

  async ping(): Promise<boolean> {
    try {
      await fetch(`${this.baseUrl}/models`, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      return true;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, temperature: 0.5, messages }),
    });
    if (!res.ok) throw new Error(`AI API lỗi ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI không trả kết quả');
    return String(content).trim();
  }

  async score(p: Parameters<AIProvider['score']>[0]): Promise<AIClassification> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Hồ sơ ứng viên:\n${JSON.stringify(p, null, 2)}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`AI API lỗi ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI không trả kết quả');
    const parsed = JSON.parse(content);
    return { ...parsed, provider: 'OPENAI' };
  }
}

class GeminiProvider implements AIProvider {
  readonly name = 'GEMINI';
  constructor(private apiKey: string, private model: string) {}

  async ping(): Promise<boolean> {
    try {
      await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
      return true;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig: { temperature: 0.5 } }),
      },
    );
    if (!res.ok) throw new Error(`Gemini API lỗi ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini không trả kết quả');
    return String(text).trim();
  }

  async score(p: Parameters<AIProvider['score']>[0]): Promise<AIClassification> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nHồ sơ ứng viên:\n${JSON.stringify(p, null, 2)}` }] }],
          generationConfig: { temperature: 0.2 },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini API lỗi ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini không trả kết quả');
    const cleaned = text.replace(/```json|```/g, '').trim();
    return { ...JSON.parse(cleaned), provider: 'GEMINI' };
  }
}

const SYSTEM_PROMPT = `Bạn là AI chấm hồ sơ tuyển dụng cho UMBO MILK (chuỗi trà sữa).
Phân tích hồ sơ ứng viên và trả về JSON đúng schema:
{
  "trinhDo": { "classification": "SinhVienDaiHoc_CaoDang|NghiHoc|TotNghiep|KHAC", "score": 0, "reason": "..." },
  "kinhNghiem": { "classification": "NO_EXPERIENCE|OTHER_EXPERIENCE|FNB_EXPERIENCE", "score": 0, "reason": "..." },
  "xuLy": { "score": 0, "note": "...", "analysis": { "responsibility": false, "manager": false, "proactiveSwap": false, "alternative": false } },
  "queQuan": { "region": "MIEN_TAY|TP_HCM|KHAC", "score": 0, "reason": "..." },
  "sdt": { "valid": true, "status": "VERIFIED|UNVERIFIED|INVALID", "score": 0 },
  "linkFb": { "status": "CO_VE_CHINH_CHU|CAN_XAC_MINH|KHONG_TRUY_CAP|LINK_KHONG_HOP_LE", "score": 0, "reason": "..." },
  "confidence": 0.0
}
Quy tắc điểm: trinhDo SinhVienDaiHoc_CaoDang=1, NghiHoc=2; kinhNghiem FNB=2, OTHER=1, NO_EXPERIENCE=0; sdt hợp lệ=1 (không có API xác minh thì UNVERIFIED, không crawl); linkFb CO_VE_CHINH_CHU=1 còn lại 0. Không tự bịa thông tin.`;

export async function getAIProvider(): Promise<AIProvider> {
  const settings = await getSettings();
  const cfg = settings.ai ?? { provider: 'mock', baseUrl: '', apiKey: '', model: '' };
  const provider = (cfg.provider || 'mock').toLowerCase();
  if (provider === 'mock') return new MockProvider();
  if (provider === 'openai') {
    return new OpenAIProvider(cfg.baseUrl || 'https://api.openai.com/v1', cfg.apiKey, cfg.model || 'gpt-4o-mini');
  }
  if (provider === 'gemini') {
    return new GeminiProvider(cfg.apiKey, cfg.model || 'gemini-1.5-flash');
  }
  if (provider === 'openai-compatible') {
    return new OpenAIProvider(cfg.baseUrl, cfg.apiKey, cfg.model || 'gpt-4o-mini');
  }
  return new MockProvider();
}

/** Tiện ích: chat 1 lượt với hệ thống (tự lấy provider theo settings). */
export async function chatWithAI(system: string, userText: string): Promise<string> {
  const provider = await getAIProvider();
  return provider.chat([
    { role: 'system', content: system },
    { role: 'user', content: userText },
  ]);
}