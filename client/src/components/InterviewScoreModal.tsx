import { useState, useMemo } from 'react';
import { Award, CheckCircle2, XCircle, AlertTriangle, FileCheck, HelpCircle } from 'lucide-react';
import { Modal } from './ui';
import { cn } from '../utils/format';

interface QuestionItem {
  id: string;
  title: string;
  subtitle?: string;
  options: { label: string; value: number | 'LOAI'; badge?: string }[];
}

const QUESTIONS_CO_KN: QuestionItem[] = [
  {
    id: 'q1',
    title: '1. Kinh nghiệm làm việc & quy trình từng làm',
    options: [
      { label: 'Không trả lời được, Không trung thực', value: 'LOAI', badge: 'LOẠI' },
      { label: 'Chỉ trả lời qua loa được 1 công việc', value: 1, badge: '1đ' },
      { label: 'Trả lời rành mạch các bước đã từng làm', value: 2, badge: '2đ' },
    ],
  },
  {
    id: 'q2',
    title: '2. Lý do vì sao Em nghỉ việc?',
    options: [
      { label: 'Trả lời tiêu cực, phê phán công ty cũ', value: 'LOAI', badge: 'LOẠI' },
      { label: 'Trả lời nửa vời, không tích cực, không tiêu cực', value: 1, badge: '1đ' },
      { label: 'Trả lời theo hướng tích cực, không đổ lỗi', value: 2, badge: '2đ' },
    ],
  },
  {
    id: 'q3',
    title: '3. Tình huống khó xử ở công ty cũ & cách giải quyết',
    options: [
      { label: 'Không trả lời được / Sơ sài', value: 0, badge: '0đ' },
      { label: 'Trả lời rành mạch, có tư duy xử lý tốt', value: 1, badge: '1đ' },
    ],
  },
  {
    id: 'q4',
    title: '4. Tham gia sự kiện tình nguyện / CLB trường (Nếu là Sinh viên)',
    subtitle: 'Nếu ứng viên là Sinh viên',
    options: [
      { label: 'Không tham gia / thái độ rụt rè, ít nói', value: 0, badge: '0đ' },
      { label: 'Ưu tiên các bạn hướng ngoại, có tham gia CLB', value: 2, badge: '2đ' },
    ],
  },
  {
    id: 'q5',
    title: '5. Sở thích cá nhân (Nếu ứng viên không bằng cấp)',
    subtitle: 'Nếu ứng viên không bằng cấp đi làm',
    options: [
      { label: 'Hướng ngoại (chạy bộ, cà phê, thể thao đồng đội bóng đá, cầu lông...)', value: 1, badge: '1đ' },
      { label: 'Độc lập, yên tĩnh (đọc sách, chơi game, vẽ, làm bánh...)', value: 'LOAI', badge: 'LOẠI THẲNG' },
    ],
  },
  {
    id: 'q6',
    title: '6. Ngoại hình, Tác phong & Giọng nói',
    options: [
      { label: 'Mặt căng, không chào hỏi', value: 'LOAI', badge: 'LOẠI' },
      { label: 'Mặt hiền hậu, vui vẻ, tóc tai gọn gàng', value: 1, badge: '1đ' },
      { label: 'Giọng nói dễ nghe, nhẹ nhàng, lịch sự', value: 1, badge: '1đ' },
    ],
  },
  {
    id: 'q7',
    title: '7. Kỹ năng Up-sale (Tư vấn từ 1 chai lên 5 chai)',
    options: [
      { label: 'Không trả lời được / Trả lời sơ sài', value: 0, badge: '0đ' },
      { label: 'Trả lời chi tiết, cụ thể, rõ ràng', value: 1, badge: '1đ' },
    ],
  },
  {
    id: 'q8',
    title: '8. Kỹ năng tư vấn đổi vị sữa khi hết hàng',
    options: [
      { label: 'Không trả lời được / Trả lời sơ sài', value: 0, badge: '0đ' },
      { label: 'Trả lời chi tiết, cụ thể, rõ ràng', value: 2, badge: '2đ' },
    ],
  },
  {
    id: 'q9',
    title: '9. Thắc mắc về công việc',
    options: [
      { label: 'Không hỏi gì hết', value: 0, badge: '0đ' },
      { label: 'Có đặt câu hỏi thắc mắc tìm hiểu công việc', value: 1, badge: '1đ' },
    ],
  },
];

const QUESTIONS_KHONG_KN: QuestionItem[] = [
  {
    id: 'q1',
    title: '1. Tự nhận xét về điểm mạnh & điểm yếu của bản thân',
    options: [
      { label: 'Trả lời qua loa / Khoe điểm mạnh quá nhiều, thiếu trung thực', value: 'LOAI', badge: 'LOẠI' },
      { label: 'Chỉ trả lời qua loa 1-2 ý', value: 1, badge: '1đ' },
      { label: 'Trả lời rành mạch, chia sẻ điểm yếu & hướng khắc phục', value: 2, badge: '2đ' },
    ],
  },
  {
    id: 'q2',
    title: '2. Xử lý tình huống bị nghi copy bài / đổ oan tại trường',
    options: [
      { label: 'Trả lời tiêu cực, phê phán thầy cô/bạn bè', value: 'LOAI', badge: 'LOẠI' },
      { label: 'Trả lời nửa vời, không tích cực, không tiêu cực', value: 1, badge: '1đ' },
      { label: 'Trả lời theo hướng tích cực, không đổ lỗi', value: 2, badge: '2đ' },
    ],
  },
  {
    id: 'q3',
    title: '3. Chia sẻ tình huống khó xử / bất đồng quan điểm & cách giải quyết',
    options: [
      { label: 'Không trả lời được', value: 0, badge: '0đ' },
      { label: 'Trả lời sơ sài', value: 1, badge: '1đ' },
      { label: 'Trả lời rành mạch, thuyết phục', value: 2, badge: '2đ' },
    ],
  },
  {
    id: 'q4',
    title: '4. Ngoại hình, Tác phong & Giọng nói',
    options: [
      { label: 'Mặt căng, không chào hỏi', value: 'LOAI', badge: 'LOẠI' },
      { label: 'Mặt hiền hậu, vui vẻ, tóc tai gọn gàng', value: 1, badge: '1đ' },
      { label: 'Giọng nói dễ nghe, nhẹ nhàng, lịch sự', value: 1, badge: '1đ' },
    ],
  },
  {
    id: 'q5',
    title: '5. Kỹ năng Up-sale (Tư vấn từ 1 chai lên 5 chai)',
    options: [
      { label: 'Không trả lời được', value: 0, badge: '0đ' },
      { label: 'Trả lời sơ sài', value: 1, badge: '1đ' },
      { label: 'Trả lời chi tiết, cụ thể, rõ ràng', value: 2, badge: '2đ' },
    ],
  },
  {
    id: 'q6',
    title: '6. Kỹ năng tư vấn đổi vị sữa khi hết hàng',
    options: [
      { label: 'Không trả lời được', value: 0, badge: '0đ' },
      { label: 'Trả lời sơ sài', value: 1, badge: '1đ' },
      { label: 'Trả lời chi tiết, cụ thể, rõ ràng', value: 2, badge: '2đ' },
    ],
  },
  {
    id: 'q7',
    title: '7. Thắc mắc về công việc',
    options: [
      { label: 'Không hỏi gì hết', value: 0, badge: '0đ' },
      { label: 'Có đặt câu hỏi thắc mắc tìm hiểu công việc', value: 1, badge: '1đ' },
    ],
  },
];

interface InterviewScoreModalProps {
  open: boolean;
  onClose: () => void;
  candidateId: string;
  candidateName: string;
  kinhNghiem?: string;
  hrDecision?: string | null;
  isAdmin?: boolean;
  onSuccess: (decision: 'PASS_PV' | 'PASS_HS' | 'FAIL', note: string, score: number) => void;
}

export default function InterviewScoreModal({
  open,
  onClose,
  candidateId,
  candidateName,
  kinhNghiem,
  hrDecision,
  isAdmin,
  onSuccess,
}: InterviewScoreModalProps) {
  const isPassPv = Boolean(isAdmin) || hrDecision === 'PASS_PV' || hrDecision === 'PASS_HS';

  const hasExperience = Boolean(
    kinhNghiem &&
    kinhNghiem !== 'Chưa có kinh nghiệm' &&
    !kinhNghiem.toLowerCase().includes('khong') &&
    !kinhNghiem.toLowerCase().includes('chua')
  );

  const [mode, setMode] = useState<'CO_KN' | 'KHONG_KN'>(hasExperience ? 'CO_KN' : 'KHONG_KN');
  const [answers, setAnswers] = useState<Record<string, number | 'LOAI'>>({});
  const [note, setNote] = useState('');

  const questions = mode === 'CO_KN' ? QUESTIONS_CO_KN : QUESTIONS_KHONG_KN;
  const maxScore = mode === 'CO_KN' ? 13 : 18;

  const handleSelectAnswer = (qId: string, val: number | 'LOAI') => {
    if (!isPassPv) return;
    setAnswers((prev) => ({ ...prev, [qId]: val }));
  };

  const { totalScore, isLoai, recommendation } = useMemo(() => {
    let sum = 0;
    let hasLoai = false;

    Object.values(answers).forEach((val) => {
      if (val === 'LOAI') {
        hasLoai = true;
      } else if (typeof val === 'number') {
        sum += val;
      }
    });

    let rec: 'PASS' | 'CAN_NHAC' | 'FAIL' = 'FAIL';
    if (hasLoai) {
      rec = 'FAIL';
    } else if (sum >= 12) {
      rec = 'PASS';
    } else if (sum >= 10) {
      rec = 'CAN_NHAC';
    } else {
      rec = 'FAIL';
    }

    return { totalScore: sum, isLoai: hasLoai, recommendation: rec };
  }, [answers]);

  const hasAnsweredAny = Object.keys(answers).length > 0;

  const handleConfirm = (decision: 'PASS_PV' | 'PASS_HS' | 'FAIL') => {
    if (decision === 'PASS_HS' && !isPassPv) {
      alert('⚠️ Bạn vui lòng bấm nút "Chốt ĐẠT PHỎNG VẤN (PASS PV)" trước khi chốt ĐẠT HỒ SƠ!');
      return;
    }
    if (decision === 'PASS_HS' && !hasAnsweredAny) {
      alert('⚠️ Vui lòng chọn các câu hỏi trong Bảng tiêu chí chấm điểm phỏng vấn trước khi chốt ĐẠT HỒ SƠ!');
      return;
    }
    if (decision === 'PASS_HS' && isLoai) {
      alert('⚠️ Ứng viên dính điểm LOẠI trong Bảng tiêu chí phỏng vấn. Hệ thống không cho phép chốt PASS HS!');
      return;
    }
    onSuccess(decision, note, totalScore);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`📝 Phiếu Chấm Điểm Phỏng Vấn – ${candidateName}`}
    >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {/* Banner Thông Báo Trạng Thái Ràng Buộc */}
        {!isPassPv ? (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-xs font-bold flex items-center gap-2 shadow-2xs">
            <AlertTriangle size={20} className="text-amber-600 shrink-0" />
            <span>
              🔒 <strong>Ứng viên chưa PASS PV</strong>: Vui lòng bấm nút <strong>Chốt ĐẠT PHỎNG VẤN (PASS PV)</strong> màu xanh lá bên dưới trước. Sau khi ĐẠT PHỎNG VẤN, hệ thống sẽ mở khóa 2 Bảng Tiêu Chí Chấm Điểm & Nút Chốt ĐẠT HỒ SƠ (PASS HS).
            </span>
          </div>
        ) : (
          <div className="p-2.5 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-xs font-bold flex items-center gap-2 shadow-2xs">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            <span>
              🎉 <strong>ĐÃ ĐẠT PHỎNG VẤN</strong>: 2 Bảng Tiêu Chí Chấm Điểm đã được mở khóa! Vui lòng chọn các câu hỏi đánh giá bên dưới để chốt ĐẠT HỒ SƠ (PASS HS).
            </span>
          </div>
        )}

        {/* Bộ lọc loại tiêu chí */}
        <div className="flex items-center justify-between bg-slate-100 p-2 rounded-xl border border-slate-200">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
            <Award size={14} className="text-brand-600" /> Loại tiêu chí phỏng vấn:
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!isPassPv}
              onClick={() => { setMode('CO_KN'); setAnswers({}); }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                !isPassPv
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                  : mode === 'CO_KN'
                  ? 'bg-brand-600 text-white shadow-2xs cursor-pointer'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200 cursor-pointer'
              }`}
            >
              CÓ KINH NGHIỆM (Max 13đ)
            </button>
            <button
              type="button"
              disabled={!isPassPv}
              onClick={() => { setMode('KHONG_KN'); setAnswers({}); }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                !isPassPv
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                  : mode === 'KHONG_KN'
                  ? 'bg-brand-600 text-white shadow-2xs cursor-pointer'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200 cursor-pointer'
              }`}
            >
              KHÔNG CÓ KN (Max 18đ)
            </button>
          </div>
        </div>

        {/* Danh sách câu hỏi chấm điểm (Bị khóa nếu chưa PASS PV) */}
        <div className="space-y-3">
          {questions.map((q) => (
            <div key={q.id} className={`p-3 rounded-xl border space-y-2 transition-all ${!isPassPv ? 'bg-slate-100/60 border-slate-200 opacity-60' : 'bg-slate-50 border-slate-200/80'}`}>
              <div>
                <p className="text-xs font-bold text-slate-800">{q.title}</p>
                {q.subtitle && <p className="text-[11px] text-rose-600 font-semibold mt-0.5">{q.subtitle}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {q.options.map((opt, idx) => {
                  const isSelected = answers[q.id] === opt.value;
                  const isOptLoai = opt.value === 'LOAI';
                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={!isPassPv}
                      onClick={() => handleSelectAnswer(q.id, opt.value)}
                      className={`text-left p-2 rounded-lg border text-[11px] transition-all flex items-start justify-between gap-1.5 ${
                        !isPassPv
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : isSelected
                          ? isOptLoai
                            ? 'bg-rose-600 text-white border-rose-700 font-bold shadow-2xs cursor-pointer'
                            : 'bg-emerald-600 text-white border-emerald-700 font-bold shadow-2xs cursor-pointer'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100/70 cursor-pointer'
                      }`}
                    >
                      <span className="leading-snug">{opt.label}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-black shrink-0 ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : isOptLoai
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {opt.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Tổng Điểm & Khuyến Nghị Tự Động */}
        <div className="p-3.5 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3 bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-lg">
          <div>
            <div className="text-xs text-slate-300">Tổng điểm phỏng vấn:</div>
            <div className="text-xl font-black text-amber-300">
              {totalScore} / {maxScore} điểm {isLoai && <span className="text-rose-400 text-xs">(Có câu dính LOẠI)</span>}
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-slate-300 mb-0.5">Đánh giá hệ thống:</div>
            {isLoai ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-black bg-rose-600 text-white">
                <XCircle size={14} /> ❌ KHÔNG ĐẠT (Dính điểm LOẠI)
              </span>
            ) : recommendation === 'PASS' ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-black bg-emerald-500 text-white">
                <CheckCircle2 size={14} /> 🎉 ĐẠT (PASS - {totalScore}đ)
              </span>
            ) : recommendation === 'CAN_NHAC' ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-black bg-amber-500 text-white">
                <AlertTriangle size={14} /> ⚠️ CÂN NHẮC ĐẠT ({totalScore}đ)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-black bg-rose-500 text-white">
                <XCircle size={14} /> ❌ TRƯỢT ({totalScore}đ &lt; 10đ)
              </span>
            )}
          </div>
        </div>

        {/* Ghi chú nhận xét của HR / Người PV */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
            📝 Ghi chú nhận xét của Người phỏng vấn:
          </label>
          <textarea
            rows={2}
            className="input text-xs w-full"
            placeholder="Nhập nhận xét nhanh (VD: Ngoại hình sáng, giao tiếp tự tin, nhà gần chi nhánh Bình Thạnh, sẵn sàng đi ca tối)..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-[10px] text-slate-400 italic">
            💡 Ghi chú này sẽ tự động lưu và chuyển sang cho Trưởng ca / Quản lý theo dõi trong 7 ngày Đào tạo.
          </p>
        </div>

        {/* Nút thao tác chốt kết quả */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary !py-2 !px-3 text-xs"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => handleConfirm('FAIL')}
            className="btn-danger !py-2 !px-3 text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <XCircle size={14} /> Chốt TRƯỢT (FAIL)
          </button>
          <button
            type="button"
            disabled={!isPassPv}
            onClick={() => handleConfirm('PASS_HS')}
            className={cn(
              'py-2 px-3 text-xs font-bold rounded-xl flex items-center gap-1 transition-all shadow-2xs',
              !isPassPv
                ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed opacity-50'
                : 'bg-teal-600 hover:bg-teal-700 text-white cursor-pointer'
            )}
            title={!isPassPv ? '🔒 Khóa: Vui lòng chốt PASS PV trước khi chốt ĐẠT HỒ SƠ' : 'Chốt ĐẠT HỒ SƠ cho ứng viên'}
          >
            <FileCheck size={14} /> Chốt ĐẠT HỒ SƠ (PASS HS) {!isPassPv && '🔒'}
          </button>
          {!isPassPv && (
            <button
              type="button"
              onClick={() => handleConfirm('PASS_PV')}
              className="btn-success !py-2 !px-4 text-xs font-bold flex items-center gap-1 cursor-pointer shadow-2xs"
            >
              <CheckCircle2 size={14} /> Chốt ĐẠT PHỎNG VẤN (PASS PV)
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
