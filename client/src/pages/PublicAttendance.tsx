import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Camera,
  CheckCircle2,
  AlertCircle,
  Building2,
  Clock,
  RefreshCw,
  ShieldCheck,
  Award,
  Sparkles,
  CalendarCheck,
  Check,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Spinner } from '../components/ui';

interface CandidateAttendanceInfo {
  id: string;
  tenUv: string;
  sdtZalo: string;
  chiNhanh: string;
  caLam: string;
  ngayBatDauTraining: string | null;
  soNgayDaTraining: number;
}

export default function PublicAttendance() {
  const { id } = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<CandidateAttendanceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Live Clock Update
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setCurrentTime(
        d.toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<CandidateAttendanceInfo>(`/public/candidates/${id}/attendance-info`)
      .then((data) => {
        setCandidate(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : 'Không tìm thấy thông tin ứng viên.');
        setLoading(false);
      });
  }, [id]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('Kích thước hình ảnh quá lớn (Tối đa 10MB). Vui lòng chọn ảnh nhỏ hơn.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const [submitResult, setSubmitResult] = useState<{
    isLate: boolean;
    lateMinutes: number;
    fineAmount: number;
    backupFolder: string;
    message: string;
  } | null>(null);

  const handleCheckinSubmit = async () => {
    if (!id || !imageSrc) return;
    setIsSubmitting(true);
    try {
      const data = await api.post<{
        isLate: boolean;
        lateMinutes: number;
        fineAmount: number;
        backupFolder: string;
        message: string;
      }>(`/public/candidates/${id}/attendance-checkin`, {
        image: imageSrc,
        note: 'ĐIỂM DANH UBM',
      });
      setSubmitResult(data);
      setSubmitSuccess(true);
      setIsSubmitting(false);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Điểm danh thất bại, vui lòng thử lại.');
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-sans">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-4 border-pink-500/20 border-t-pink-500 animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles size={20} className="text-pink-400 animate-pulse" />
          </div>
        </div>
        <p className="text-sm font-bold text-slate-300 mt-4 tracking-wide">
          Đang kết nối hệ thống UMBO MILK...
        </p>
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-sans">
        <div className="bg-slate-900/90 p-6 rounded-3xl border border-rose-500/30 max-w-md w-full text-center space-y-4 shadow-2xl backdrop-blur-xl">
          <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto text-rose-500">
            <AlertCircle size={36} />
          </div>
          <h2 className="text-lg font-black text-rose-400">Không tìm thấy ứng viên</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            {error || 'Đường dẫn điểm danh không hợp lệ hoặc đã bị thay đổi.'}
          </p>
        </div>
      </div>
    );
  }

  const todayStr = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const progressPercent = Math.min(100, Math.round((candidate.soNgayDaTraining / 7) * 100));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-3 sm:p-5 font-sans selection:bg-pink-500 selection:text-white">
      <div className="w-full max-w-md space-y-4">
        {/* Top Header Card */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-pink-600 via-rose-600 to-purple-700 p-5 shadow-2xl border border-white/10 text-center text-white">
          <div className="absolute top-0 right-0 -mr-6 -mt-6 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 -ml-6 -mb-6 w-32 h-32 bg-pink-400/20 rounded-full blur-2xl pointer-events-none" />

          <div className="inline-flex items-center gap-1.5 bg-black/20 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black tracking-wider uppercase border border-white/10 mb-2">
            <Sparkles size={12} className="text-pink-300 animate-spin" />
            HỆ THỐNG ĐIỂM DANH TỰ ĐỘNG UMBO MILK
          </div>

          <h1 className="text-2xl font-black tracking-tight drop-shadow-md">ĐIỂM DANH UBM</h1>
          <p className="text-xs text-pink-100/90 font-medium">{todayStr}</p>

          {/* Live Realtime Clock */}
          <div className="mt-3 inline-flex items-center gap-2 bg-black/30 backdrop-blur-md px-4 py-1.5 rounded-2xl border border-white/15">
            <Clock size={15} className="text-pink-300 animate-pulse" />
            <span className="font-mono text-base font-black tracking-widest text-white">
              {currentTime}
            </span>
          </div>
        </div>

        {/* Candidate Profile Card */}
        <div className="bg-slate-900/90 backdrop-blur-xl p-4 rounded-3xl border border-slate-800 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div>
              <span className="text-[10px] uppercase font-bold text-pink-400 tracking-wider">
                Ứng viên Đào tạo
              </span>
              <h3 className="text-lg font-black text-white">{candidate.tenUv}</h3>
              <p className="text-xs font-mono text-slate-400">{candidate.sdtZalo}</p>
            </div>

            <div className="bg-slate-800/90 border border-slate-700/80 px-3.5 py-2 rounded-2xl text-center">
              <div className="flex items-center justify-center gap-1 text-amber-400 mb-0.5">
                <Award size={14} />
                <span className="text-[10px] font-extrabold uppercase">Tiến độ</span>
              </div>
              <span className="text-sm font-black text-white font-mono">
                {candidate.soNgayDaTraining}/7 Ngày
              </span>
            </div>
          </div>

          {/* Training Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] font-bold text-slate-400">
              <span>Đào tạo thử việc 7 ngày</span>
              <span className="text-pink-400">{progressPercent}%</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/50">
              <div
                className="h-full bg-gradient-to-r from-pink-500 to-rose-500 rounded-full transition-all duration-500 shadow-sm"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Branch & Shift Details */}
          <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <div className="bg-slate-800/60 p-3 rounded-2xl border border-slate-700/50 flex items-start gap-2.5">
              <div className="p-1.5 rounded-xl bg-pink-500/10 text-pink-400 shrink-0">
                <Building2 size={16} />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Chi nhánh</span>
                <span className="font-bold text-slate-100 text-[11px] leading-snug block">
                  {candidate.chiNhanh || 'Chưa phân ca'}
                </span>
              </div>
            </div>

            <div className="bg-slate-800/60 p-3 rounded-2xl border border-slate-700/50 flex items-start gap-2.5">
              <div className="p-1.5 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
                <Clock size={16} />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Ca làm việc</span>
                <span className="font-bold text-slate-100 text-[11px] leading-snug block">
                  {candidate.caLam || 'Chưa phân ca'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Screen State: Success/Result vs Capture Form */}
        {submitSuccess ? (
          submitResult?.isLate ? (
            /* Late Penalty Result Card */
            <div className="bg-rose-950/90 border-2 border-rose-500/80 p-6 rounded-3xl text-center space-y-4 shadow-2xl animate-fade-in backdrop-blur-xl">
              <div className="w-16 h-16 bg-rose-500/20 rounded-full flex items-center justify-center mx-auto text-rose-400 animate-pulse">
                <AlertCircle size={40} />
              </div>

              <div>
                <h2 className="text-xl font-black text-rose-300">ĐIỂM DANH TRỄ – PHẠT 50.000Đ</h2>
                <p className="text-xs text-rose-200/90 mt-1">
                  Bạn đã trễ <strong className="font-mono text-white font-extrabold">{submitResult.lateMinutes} phút</strong> so với khung giờ ca làm!
                </p>
              </div>

              <div className="bg-rose-900/60 p-4 rounded-2xl border border-rose-700/60 text-xs text-rose-100 space-y-2">
                <p className="font-bold text-rose-200">
                  ⚠️ Mức phạt <span className="text-amber-300 font-extrabold">50.000đ</span> đã được hệ thống tự động ghi nhận trực tiếp vào Web chấm công.
                </p>
                <p className="text-[11px] text-rose-300 opacity-90 leading-relaxed">
                  Ảnh chụp cửa hàng & xác thực chữ <strong>"ĐIỂM DANH UBM"</strong> đã lưu an toàn vào Google Drive.
                </p>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-2xl border border-slate-700 text-xs text-emerald-400 font-mono font-bold flex items-center justify-center gap-1.5">
                <Check size={14} /> NỘI DUNG XÁC THỰC: "ĐIỂM DANH UBM" ✓
              </div>

              <p className="text-[11px] text-slate-400 italic">
                Vui lòng chú ý thời gian có mặt đúng giờ ở các ca tiếp theo!
              </p>
            </div>
          ) : (
            /* On-Time Success Result Card */
            <div className="bg-emerald-950/90 border-2 border-emerald-500/80 p-6 rounded-3xl text-center space-y-4 shadow-2xl animate-fade-in backdrop-blur-xl">
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto text-emerald-400 animate-bounce">
                <CheckCircle2 size={40} />
              </div>

              <div>
                <h2 className="text-xl font-black text-emerald-300">ĐIỂM DANH THÀNH CÔNG!</h2>
                <p className="text-xs text-emerald-200/90 mt-1">
                  Chúc mừng bạn đã điểm danh đúng giờ cho ca làm hôm nay.
                </p>
              </div>

              <div className="bg-emerald-900/50 p-4 rounded-2xl border border-emerald-700/50 text-xs text-emerald-100 space-y-2">
                <p className="font-bold text-emerald-200">
                  ✅ Ảnh chụp cửa hàng & thông tin điểm danh ngày <strong>{todayStr}</strong> đã được lưu lên Google Drive.
                </p>
                <p className="text-[11px] text-emerald-300 opacity-90">
                  Tự động tích lũy <strong className="text-white font-extrabold">+1 Ngày Đào Tạo</strong> vào hồ sơ.
                </p>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-2xl border border-slate-700 text-xs text-emerald-400 font-mono font-bold flex items-center justify-center gap-1.5">
                <Check size={14} /> NỘI DUNG XÁC THỰC: "ĐIỂM DANH UBM" ✓
              </div>

              <p className="text-[11px] text-slate-400 italic">
                Chúc bạn có một buổi làm việc và học tập hiệu quả tại Umbo Milk!
              </p>
            </div>
          )
        ) : (
          /* Main Photo Capture & Submit Card */
          <div className="bg-slate-900/90 backdrop-blur-xl p-5 rounded-3xl border border-slate-800 space-y-4 shadow-xl">
            <div className="text-center space-y-1">
              <h4 className="text-sm font-black text-pink-400 flex items-center justify-center gap-1.5">
                <Camera size={18} /> Chụp hình cửa hàng điểm danh
              </h4>
              <p className="text-[11px] text-slate-400">
                Đứng trước mặt tiền cửa hàng chi nhánh để chụp hình xác nhận.
              </p>
            </div>

            {/* Hidden File Input with Camera Capture */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Photo Capture Area / Preview */}
            <div className="space-y-3">
              {imageSrc ? (
                <div className="relative rounded-2xl overflow-hidden border-2 border-pink-500 shadow-xl group">
                  <img
                    src={imageSrc}
                    alt="Ảnh cửa hàng điểm danh"
                    className="w-full h-56 object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent flex flex-col justify-end p-3">
                    <span className="bg-pink-600 text-white text-xs font-black px-3 py-1 rounded-xl w-fit shadow-md flex items-center gap-1">
                      <ShieldCheck size={14} /> ĐIỂM DANH UMBO MILK
                    </span>
                    <span className="text-[10px] text-slate-300 mt-1 font-mono">
                      {new Date().toLocaleString('vi-VN')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute top-3 right-3 bg-slate-900/90 hover:bg-slate-900 text-white px-3 py-1.5 rounded-xl border border-slate-700 text-xs font-bold flex items-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
                  >
                    <RefreshCw size={14} /> Chụp lại
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-52 border-2 border-dashed border-pink-500/40 hover:border-pink-500 bg-pink-950/20 hover:bg-pink-950/40 rounded-2xl flex flex-col items-center justify-center gap-3 transition-all cursor-pointer group p-4"
                >
                  <div className="w-16 h-16 rounded-2xl bg-pink-600/20 group-hover:bg-pink-600/30 flex items-center justify-center text-pink-400 group-hover:scale-110 transition-transform shadow-inner">
                    <Camera size={32} />
                  </div>
                  <div className="text-center space-y-1">
                    <span className="text-xs font-extrabold text-pink-300 group-hover:text-pink-200 block">
                      Bấm vào đây để mở Camera chụp ảnh cửa hàng
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      Hình chụp cửa hàng + chữ "ĐIỂM DANH UBM"
                    </span>
                  </div>
                </button>
              )}
            </div>

            {/* Brand Validation Box */}
            <div className="bg-slate-800/80 p-3.5 rounded-2xl border border-slate-700/80 text-center space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Nội dung xác thực hệ thống
              </span>
              <div className="text-base font-black text-pink-400 tracking-wider font-mono">
                "ĐIỂM DANH UMBO MILK"
              </div>
              <p className="text-[10px] text-slate-400 italic">
                * Tự động lưu Google Drive theo thư mục Chi nhánh & Ca làm việc.
              </p>
            </div>

            {/* Submit Button */}
            <button
              type="button"
              disabled={!imageSrc || isSubmitting}
              onClick={handleCheckinSubmit}
              className={`w-full py-4 px-4 rounded-2xl font-black text-sm transition-all shadow-2xl flex items-center justify-center gap-2 cursor-pointer ${
                imageSrc && !isSubmitting
                  ? 'bg-gradient-to-r from-pink-600 via-rose-600 to-purple-600 hover:from-pink-500 hover:to-rose-500 text-white shadow-pink-600/30 animate-pulse active:scale-[0.98]'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/60'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Spinner size={18} className="text-white" />
                  <span>Đang ghi nhận điểm danh & lưu Drive...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={20} />
                  <span>XÁC NHẬN ĐIỂM DANH</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
