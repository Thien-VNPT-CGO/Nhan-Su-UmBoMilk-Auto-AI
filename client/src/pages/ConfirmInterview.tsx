import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Calendar, MapPin, Clock, Video, HeartHandshake, Sparkles, Building2 } from 'lucide-react';
import { formatDateTime } from '../utils/date';

interface CandidateInterviewInfo {
  id: string;
  tenUv: string;
  chiNhanh: string;
  caLam: string;
  phongVanAt: string | null;
  ggMeetLink: string | null;
  trangThaiTraining: string | null;
}

export default function ConfirmInterview() {
  const { id } = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<CandidateInterviewInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedStatus, setConfirmedStatus] = useState<'ACCEPT' | 'REJECT' | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/public/candidates/${id}/interview-info`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setCandidate(data.data);
          if (['SAP_BAT_DAU', 'BAT_DAU', 'HOAN_THANH', 'NHAN_VIEN_CHINH_THUC'].includes(data.data.trangThaiTraining)) {
            setConfirmedStatus('ACCEPT');
          } else if (data.data.trangThaiTraining === 'LOAI') {
            setConfirmedStatus('REJECT');
          }
        } else {
          setError(data.message || 'Không tìm thấy thông tin lịch phỏng vấn.');
        }
      })
      .catch(() => setError('Lỗi kết nối máy chủ.'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleConfirm = async (action: 'ACCEPT' | 'REJECT') => {
    if (!id || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/candidates/${id}/confirm-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        setConfirmedStatus(action);
      } else {
        alert(data.message || 'Xác nhận thất bại. Vui lòng thử lại.');
      }
    } catch {
      alert('Lỗi kết nối máy chủ. Thử lại sau.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-12 h-12 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium text-pink-200">Đang tải thông tin thư mời phỏng vấn...</p>
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
        <div className="max-w-md w-full bg-slate-900 rounded-3xl p-6 border border-pink-500/30 text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 bg-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-center mx-auto">
            <XCircle size={32} />
          </div>
          <h2 className="text-lg font-bold text-white">Không tìm thấy thông tin</h2>
          <p className="text-xs text-slate-400">{error || 'Đường dẫn thư mời không tồn tại hoặc đã hết hạn.'}</p>
        </div>
      </div>
    );
  }

  const nameGreeting = candidate.tenUv?.trim()
    ? (candidate.tenUv.trim().toLowerCase().startsWith('sếp') ? candidate.tenUv.trim() : `Sếp ${candidate.tenUv.trim()}`)
    : 'bạn';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-pink-950 flex flex-col items-center justify-center p-4 sm:p-6 text-slate-100 font-sans">
      <div className="max-w-md w-full bg-slate-900/90 backdrop-blur-md rounded-3xl border border-pink-500/30 shadow-2xl overflow-hidden my-6">
        
        {/* Header Banner Pink Theme */}
        <div className="bg-gradient-to-r from-pink-600 via-rose-500 to-pink-500 p-6 text-center relative overflow-hidden">
          <div className="absolute -right-6 -bottom-6 opacity-20 text-white">
            <Sparkles size={120} />
          </div>
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3.5 py-1 rounded-full text-xs font-extrabold text-white mb-2 shadow-xs">
            <HeartHandshake size={14} /> UMBO MILK RECRUITMENT
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            THƯ MỜI PHỎNG VẤN
          </h1>
          <p className="text-xs text-pink-100 mt-1 font-medium">
            Chào mừng {nameGreeting} gia nhập đội ngũ UMBO MILK!
          </p>
        </div>

        {/* Dynamic Content Body */}
        <div className="p-6 space-y-6">

          {confirmedStatus === 'ACCEPT' ? (
            <div className="bg-pink-950/60 border border-pink-500/40 rounded-2xl p-5 text-center space-y-3 animate-fade-in">
              <div className="w-16 h-16 bg-pink-500 text-white rounded-full flex items-center justify-center mx-auto shadow-lg shadow-pink-500/30">
                <CheckCircle2 size={36} />
              </div>
              <h3 className="text-lg font-extrabold text-pink-400">ĐÃ XÁC NHẬN THAM GIA!</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Cảm ơn <b>{nameGreeting}</b> đã xác nhận! Hệ thống đã ghi nhận lịch phỏng vấn chính thức của bạn và chuyển thông tin tới bộ phận HR.
              </p>
              {candidate.ggMeetLink && (
                <a
                  href={candidate.ggMeetLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 text-white font-black text-sm py-3 px-4 rounded-xl transition-all shadow-md mt-2"
                >
                  <Video size={18} />
                  <span>VÀO PHÒNG GOOGLE MEET</span>
                </a>
              )}
            </div>
          ) : confirmedStatus === 'REJECT' ? (
            <div className="bg-rose-950/60 border border-rose-500/40 rounded-2xl p-5 text-center space-y-2 animate-fade-in">
              <div className="w-14 h-14 bg-rose-500/20 text-rose-400 rounded-full flex items-center justify-center mx-auto">
                <XCircle size={32} />
              </div>
              <h3 className="text-base font-bold text-rose-400">Đã Ghi Nhận Phản Hồi Từ Chối</h3>
              <p className="text-xs text-slate-400">
                Cảm ơn bạn đã phản hồi. Nếu có nhu cầu thay đổi lịch hẹn, bạn vui lòng liên hệ lại HR qua Zalo nhé!
              </p>
            </div>
          ) : (
            <>
              {/* Event Details Card */}
              <div className="space-y-3 bg-slate-800/80 rounded-2xl p-4 border border-slate-700/80">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-pink-500/10 text-pink-400 rounded-xl mt-0.5">
                    <Calendar size={18} />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Thời gian phỏng vấn</div>
                    <div className="text-sm font-extrabold text-white mt-0.5">
                      {candidate.phongVanAt ? formatDateTime(candidate.phongVanAt) : 'Theo lịch hẹn với HR'}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-2 border-t border-slate-700/50">
                  <div className="p-2.5 bg-pink-500/10 text-pink-400 rounded-xl mt-0.5">
                    <Building2 size={18} />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Chi nhánh ứng tuyển</div>
                    <div className="text-sm font-semibold text-slate-200 mt-0.5">
                      {candidate.chiNhanh || 'Chi nhánh tuyển dụng UMBO MILK'}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-2 border-t border-slate-700/50">
                  <div className="p-2.5 bg-pink-500/10 text-pink-400 rounded-xl mt-0.5">
                    <Clock size={18} />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Ca làm việc đăng ký</div>
                    <div className="text-sm font-semibold text-slate-200 mt-0.5">
                      {candidate.caLam || '—'}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-2 border-t border-slate-700/50">
                  <div className="p-2.5 bg-pink-500/10 text-pink-400 rounded-xl mt-0.5">
                    <MapPin size={18} />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Hình thức phỏng vấn</div>
                    <div className="text-sm font-semibold text-pink-300 mt-0.5 flex items-center gap-1.5">
                      <span>Online qua Google Meet</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons Pink Theme */}
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleConfirm('ACCEPT')}
                  disabled={submitting}
                  className="w-full bg-gradient-to-r from-pink-500 via-rose-500 to-pink-500 hover:from-pink-400 hover:to-rose-400 text-white font-black text-base py-3.5 px-4 rounded-2xl transition-all shadow-lg shadow-pink-500/30 flex items-center justify-center gap-2 active:scale-98"
                >
                  <CheckCircle2 size={20} />
                  <span>{submitting ? 'Đang xác nhận...' : 'XÁC NHẬN THAM GIA PHỎNG VẤN'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleConfirm('REJECT')}
                  disabled={submitting}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs py-2.5 px-4 rounded-xl border border-slate-700 transition-all flex items-center justify-center gap-1.5"
                >
                  <XCircle size={15} />
                  <span>Từ Chối / Bận Không Tham Gia Được</span>
                </button>
              </div>
            </>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800/80 text-center">
          <p className="text-[11px] text-slate-500">
            🐮 UMBO MILK – Hệ thống tuyển dụng & Đào tạo tự động AI
          </p>
        </div>

      </div>
    </div>
  );
}
