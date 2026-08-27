import { useState, useMemo } from 'react';
import { Award, CheckCircle2, AlertCircle, FileText, Send, Sparkles } from 'lucide-react';
import { Modal } from './ui';
import { api, ApiError } from '../api/client';
import { useToast } from '../stores/Toast';
import { useAuth } from '../stores/auth';

export const EVALUATION_CRITERIA_KNOWLEDGE = [
  { id: 'k1', label: '1. Sữa bò váng mới vắt là gì? Nguồn sữa ở đâu?' },
  { id: 'k2', label: '2. Các loại Gu sữa, liệt kê chi tiết 3 gu' },
  { id: 'k3', label: '3. Lượng calo & canxi của sữa là bao nhiêu? Hiển thị vị trí nào trên chai?' },
  { id: 'k4', label: '4. Các chương trình khuyến mãi thường niên?' },
  { id: 'k5', label: '5. Hạn sử dụng từng vị sữa?' },
  { id: 'k6', label: '6. Cách bảo quản từng vị sữa?' },
  { id: 'k7', label: '7. Sữa ship Tỉnh như thế nào?' },
  { id: 'k8', label: '8. Khi khách đến tiệm, Quy trình tư vấn ntn?' },
  { id: 'k9', label: '9. Giải quyết tình huống khiếu nại / khẩn cấp' },
  { id: 'k10', label: '10. Tóc tai gọn gàng, Áo quần sạch sẽ, không nhăn, nhàu nát, không ngả màu.' },
];

export const EVALUATION_CRITERIA_OPERATIONS = [
  { id: 'o1', label: '1. Nắm rõ các quy trình: ướp đá, nhập - hủy sữa, cúng, báo cáo đầu - cuối ca, bàn giao (hỏi 1 hoặc 2 câu)' },
  { id: 'o2', label: '2. Kiểm tra đột xuất các góc khuất vệ sinh cửa hàng' },
  { id: 'o3', label: '3. Liệt kê các thao tác bấm bill bất kỳ' },
  { id: 'o4', label: '4. Cách Mở Ca, Đóng ca và bật tắt món trên App và cửa hàng (tùy chi nhánh)' },
  { id: 'o5', label: '5. Cách viết và xem sổ bàn giao? Khi nào xem?' },
  { id: 'o6', label: '6. Cách Điền và đọc hiểu Phiếu kiểm kê' },
  { id: 'o7', label: '7. Cách kiểm kê sữa/bánh và nhận biết chất lượng sữa/bánh bằng mắt' },
  { id: 'o8', label: '8. Quy trình báo hạn date sữa?' },
  { id: 'o9', label: '9. Cách hủy Sữa tới hạn?' },
  { id: 'o10', label: '10. Thao tác kiểm tra, đối chiếu tiền mặt trong két và chuyển khoản trên máy Pos' },
];

interface StoreEvaluationModalProps {
  open: boolean;
  onClose: () => void;
  candidateId: string;
  candidateName: string;
  chiNhanh?: string;
  caLam?: string;
  aiNote?: string | null;
  onSuccess: () => void;
}

export default function StoreEvaluationModal({
  open,
  onClose,
  candidateId,
  candidateName,
  chiNhanh = 'Chưa chọn',
  caLam = 'Chưa chọn',
  aiNote,
  onSuccess,
}: StoreEvaluationModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  // Bảng lưu điểm từng câu: default tất cả 1.0 điểm
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    EVALUATION_CRITERIA_KNOWLEDGE.forEach((q) => { initial[q.id] = 1.0; });
    EVALUATION_CRITERIA_OPERATIONS.forEach((q) => { initial[q.id] = 1.0; });
    return initial;
  });

  // Bảng lưu ghi chú câu trả lời
  const [questionNotes, setQuestionNotes] = useState<Record<string, string>>({});
  const [evaluatorNotes, setEvaluatorNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleScoreChange = (qId: string, scoreVal: number) => {
    setScores((prev) => ({ ...prev, [qId]: scoreVal }));
  };

  const handleNoteChange = (qId: string, text: string) => {
    setQuestionNotes((prev) => ({ ...prev, [qId]: text }));
  };

  // Tính điểm tổng 2 mục
  const scoreKnowledgeTotal = useMemo(() => {
    return EVALUATION_CRITERIA_KNOWLEDGE.reduce((sum, q) => sum + (scores[q.id] ?? 1.0), 0);
  }, [scores]);

  const scoreOperationsTotal = useMemo(() => {
    return EVALUATION_CRITERIA_OPERATIONS.reduce((sum, q) => sum + (scores[q.id] ?? 1.0), 0);
  }, [scores]);

  const totalScoreAvg = useMemo(() => {
    return (scoreKnowledgeTotal + scoreOperationsTotal) / 2;
  }, [scoreKnowledgeTotal, scoreOperationsTotal]);

  // AI tự động phát hiện tất cả câu có điểm < 1 (tức là 0.5đ hoặc 0.0đ)
  const lowScoreQuestionsList = useMemo(() => {
    const list: string[] = [];
    const checkItem = (q: { id: string; label: string }, category: string) => {
      const score = scores[q.id] ?? 1.0;
      if (score < 1.0) {
        const note = questionNotes[q.id] ? ` (${questionNotes[q.id]})` : '';
        const scoreTag = score === 0.5 ? '[0.5đ - Chưa đầy đủ]' : '[0đ - Sai hoàn toàn]';
        list.push(`[${category}] ${q.label} ${scoreTag}${note}`);
      }
    };

    EVALUATION_CRITERIA_KNOWLEDGE.forEach((q) => checkItem(q, 'Kiến Thức'));
    EVALUATION_CRITERIA_OPERATIONS.forEach((q) => checkItem(q, 'Vận Hành'));
    return list;
  }, [scores, questionNotes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await api.post<{ message: string }>('/training/evaluate', {
        candidateId,
        scoreKnowledge: scoreKnowledgeTotal,
        scoreOperation: scoreOperationsTotal,
        lowScoreQuestions: lowScoreQuestionsList,
        evaluatorNotes: evaluatorNotes.trim(),
      });

      toast('success', res.message || '✅ Đã lưu Phiếu Đánh Giá Nhân Viên Cửa Hàng!');
      onSuccess();
      onClose();
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Chấm điểm thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const isPass = totalScoreAvg > 7;
  const isRetest = totalScoreAvg >= 5 && totalScoreAvg <= 7;

  return (
    <Modal open={open} onClose={onClose} title="📋 PHIẾU ĐÁNH GIÁ NHÂN VIÊN CỬA HÀNG (MẪU CHUẨN UMBO MILK)">
      <form onSubmit={handleSubmit} className="space-y-4 max-h-[82vh] overflow-y-auto pr-1">
        {/* Header phiếu chuẩn doanh nghiệp */}
        <div className="border-2 border-slate-300 rounded-xl p-3 bg-white space-y-2 shadow-xs">
          <div className="flex items-center justify-between border-b pb-2">
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">CÔNG TY TNHH UNIQUE&NICHE — MST: 0318156094</div>
              <div className="text-[10px] text-slate-400">Địa chỉ: 1212/8 Trường Sa, Phường 13, Q.Phú Nhuận, TP.HCM</div>
            </div>
            <span className="bg-rose-100 text-rose-800 text-[11px] font-black px-2.5 py-1 rounded-lg border border-rose-200">
              UMBO MILK
            </span>
          </div>

          <h2 className="text-center text-sm font-black text-rose-700 uppercase tracking-wider py-0.5">
            PHIẾU ĐÁNH GIÁ NHÂN VIÊN CỬA HÀNG
          </h2>

          <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div><b>HỌ VÀ TÊN NHÂN VIÊN:</b> <span className="text-brand-600 font-bold">{candidateName}</span> ({candidateId})</div>
            <div><b>NGƯỜI ĐÁNH GIÁ:</b> <span className="text-slate-800 font-semibold">{user?.fullName || user?.username || 'HR / Manager'}</span></div>
            <div><b>CHI NHÁNH:</b> <span className="text-slate-800 font-medium">{chiNhanh}</span></div>
            <div><b>CA LÀM:</b> <span className="text-slate-800 font-medium">{caLam}</span></div>
          </div>

          {aiNote && (
            <div className="text-purple-700 bg-purple-50 p-2 rounded-lg border border-purple-200 text-[11px] font-medium flex items-start gap-1.5">
              <Sparkles size={14} className="mt-0.5 shrink-0 text-purple-600" />
              <div><b>Ghi chú câu nợ đợt phỏng vấn trước:</b> {aiNote}</div>
            </div>
          )}
        </div>

        {/* Hướng dẫn chấm điểm theo quy định */}
        <div className="bg-amber-50/80 border border-amber-300 rounded-xl p-2.5 text-[11px] text-amber-900 font-medium space-y-1">
          <div className="font-extrabold text-amber-950 flex items-center gap-1">
            <AlertCircle size={13} className="text-amber-600" /> QUY ĐỊNH CHẤM ĐIỂM CHI TIẾT DÀNH CHO NƠI ĐÁNH GIÁ:
          </div>
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <span className="bg-white px-2 py-1 rounded border border-emerald-300 text-emerald-800 font-bold">✅ 1.0 đ: Đúng hoàn toàn</span>
            <span className="bg-white px-2 py-1 rounded border border-amber-300 text-amber-800 font-bold">⚠️ 0.5 đ: Chưa đầy đủ</span>
            <span className="bg-white px-2 py-1 rounded border border-rose-300 text-rose-800 font-bold">❌ 0.0 đ: Sai hoàn toàn</span>
          </div>
        </div>

        {/* MỤC 1: KIẾN THỨC & ỨNG XỬ */}
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
          <div className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white font-extrabold text-xs px-3 py-2 flex items-center justify-between">
            <span>I. KIẾN THỨC & ỨNG XỬ (10 câu hỏi)</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-[11px] font-mono font-bold">
              Tổng điểm: {scoreKnowledgeTotal.toFixed(1)} / 10
            </span>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {EVALUATION_CRITERIA_KNOWLEDGE.map((q) => {
              const scoreVal = scores[q.id] ?? 1.0;
              return (
                <div key={q.id} className="p-2.5 hover:bg-slate-50/80 transition-colors space-y-1.5">
                  <div className="font-semibold text-slate-800 flex items-start justify-between gap-2">
                    <span className="leading-snug">{q.label}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {[1.0, 0.5, 0.0].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => handleScoreChange(q.id, val)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all cursor-pointer ${
                            scoreVal === val
                              ? val === 1.0
                                ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                                : val === 0.5
                                ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                                : 'bg-rose-600 text-white border-rose-700 shadow-xs'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
                          }`}
                        >
                          {val === 1.0 ? '1đ' : val === 0.5 ? '0.5đ' : '0đ'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {scoreVal < 1.0 && (
                    <input
                      type="text"
                      className="input text-[11px] !py-1 bg-amber-50/50 border-amber-200 text-amber-900 placeholder:text-amber-400"
                      placeholder="Nhập ghi chú ý sai/thiếu của câu này (AI sẽ tổng hợp cho lần phỏng vấn 2)..."
                      value={questionNotes[q.id] || ''}
                      onChange={(e) => handleNoteChange(q.id, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* MỤC 2: VẬN HÀNH */}
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
          <div className="bg-gradient-to-r from-indigo-700 to-purple-700 text-white font-extrabold text-xs px-3 py-2 flex items-center justify-between">
            <span>II. VẬN HÀNH (10 quy trình)</span>
            <span className="bg-white/20 px-2 py-0.5 rounded text-[11px] font-mono font-bold">
              Tổng điểm: {scoreOperationsTotal.toFixed(1)} / 10
            </span>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {EVALUATION_CRITERIA_OPERATIONS.map((q) => {
              const scoreVal = scores[q.id] ?? 1.0;
              return (
                <div key={q.id} className="p-2.5 hover:bg-slate-50/80 transition-colors space-y-1.5">
                  <div className="font-semibold text-slate-800 flex items-start justify-between gap-2">
                    <span className="leading-snug">{q.label}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {[1.0, 0.5, 0.0].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => handleScoreChange(q.id, val)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all cursor-pointer ${
                            scoreVal === val
                              ? val === 1.0
                                ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                                : val === 0.5
                                ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                                : 'bg-rose-600 text-white border-rose-700 shadow-xs'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
                          }`}
                        >
                          {val === 1.0 ? '1đ' : val === 0.5 ? '0.5đ' : '0đ'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {scoreVal < 1.0 && (
                    <input
                      type="text"
                      className="input text-[11px] !py-1 bg-amber-50/50 border-amber-200 text-amber-900 placeholder:text-amber-400"
                      placeholder="Nhập ghi chú ý sai/thiếu của câu này (AI sẽ tổng hợp cho lần phỏng vấn 2)..."
                      value={questionNotes[q.id] || ''}
                      onChange={(e) => handleNoteChange(q.id, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* TỔNG ĐIỂM BÌNH QUÂN REALTIME & KẾT QUẢ AI DỰ KIẾN */}
        <div className={`p-3.5 rounded-xl border flex items-center justify-between shadow-xs transition-all ${
          isPass ? 'bg-emerald-50 border-emerald-300 text-emerald-950' : isRetest ? 'bg-amber-50 border-amber-300 text-amber-950' : 'bg-rose-50 border-rose-300 text-rose-950'
        }`}>
          <div>
            <div className="text-[11px] uppercase font-black tracking-wider opacity-80">TỔNG ĐIỂM TRUNG BÌNH ( (KIẾN THỨC + VẬN HÀNH) / 2 )</div>
            <div className="text-3xl font-black font-mono tracking-tight pt-0.5">
              {totalScoreAvg.toFixed(1)} <span className="text-xs font-normal opacity-70">/ 10 điểm</span>
            </div>
          </div>
          <div className="text-right">
            <span className={`inline-block px-3 py-1.5 rounded-xl text-xs font-black shadow-xs ${
              isPass ? 'bg-emerald-600 text-white animate-bounce' : isRetest ? 'bg-amber-600 text-white' : 'bg-rose-600 text-white'
            }`}>
              {isPass ? '🎉 ĐẬU CHÍNH THỨC (Auto 30p nâng NV)' : isRetest ? '🔄 TEST ĐẦU RA LẦN 2' : '❌ CHƯA ĐẠT (Trừ KPI)'}
            </span>
          </div>
        </div>

        {/* AI Danh sách câu bị điểm < 1 (0.5 hoặc 0đ) */}
        {lowScoreQuestionsList.length > 0 && (
          <div className="bg-purple-50/90 border border-purple-200 rounded-xl p-3 text-xs space-y-1.5">
            <div className="font-extrabold text-purple-900 flex items-center gap-1">
              <Sparkles size={14} className="text-purple-600" />
              AI ĐÃ TỰ ĐỘNG LỌC {lowScoreQuestionsList.length} CÂU HỎI ĐIỂM &lt; 1 (SẼ LƯU ĐỂ HỎI LẠI Ở PHỎNG VẤN LẦN 2):
            </div>
            <ul className="list-disc list-inside text-[11px] text-purple-800 space-y-0.5 pl-1 font-medium">
              {lowScoreQuestionsList.map((item, idx) => (
                <li key={idx} className="leading-snug">{item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* NHẬN XẾT CHUNG */}
        <div>
          <label className="text-xs font-extrabold text-slate-800 uppercase block mb-1">
            NHẬN XẾT CHUNG CỦA HR / STORE MANAGER:
          </label>
          <textarea
            className="input text-xs min-h-[70px]"
            value={evaluatorNotes}
            onChange={(e) => setEvaluatorNotes(e.target.value)}
            placeholder="Nhập nhận xét đánh giá tổng quan thái độ, tác phong, điểm cần cải thiện..."
          />
        </div>

        <div className="pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full !py-3 font-extrabold text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 shadow-md cursor-pointer"
          >
            <Send size={16} />
            <span>{submitting ? '⏳ Đang lưu kết quả đánh giá...' : '🚀 LƯU VÀ HOÀN TẤT PHIẾU ĐÁNH GIÁ'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
