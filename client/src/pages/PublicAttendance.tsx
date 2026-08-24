import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Camera,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Check,
  Milk,
  Image as ImageIcon,
  User,
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
  isTooEarly?: boolean;
  earlyMinutes?: number;
  allowedTimeStr?: string;
}

export default function PublicAttendance() {
  const { id } = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<CandidateAttendanceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    if (candidate?.isTooEarly) {
      alert(`Chưa đến khung giờ điểm danh! Khung giờ cho phép mở điểm danh bắt đầu từ ${candidate.allowedTimeStr} (trước ca 30 phút).`);
      return;
    }

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
      <div className="min-h-screen bg-[#0d0f18] text-white flex flex-col items-center justify-center p-4 font-sans">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-4 border-pink-500/20 border-t-pink-500 animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Milk size={22} className="text-pink-400 animate-pulse" />
          </div>
        </div>
        <p className="text-sm font-bold text-slate-300 mt-4 tracking-wide">
          Đang tải trang điểm danh Umbo Milk...
        </p>
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="min-h-screen bg-[#0d0f18] text-white flex flex-col items-center justify-center p-4 font-sans">
        <div className="bg-slate-900/90 p-6 rounded-3xl border border-rose-500/30 max-w-md w-full text-center space-y-4 shadow-2xl backdrop-blur-xl">
          <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto text-rose-500">
            <AlertCircle size={36} />
          </div>
          <h2 className="text-lg font-black text-rose-400">Không tìm thấy thông tin</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            {error || 'Đường dẫn điểm danh không hợp lệ hoặc đã bị thay đổi.'}
          </p>
        </div>
      </div>
    );
  }

  const daysDone = candidate.soNgayDaTraining || 0;
  const daysLeft = Math.max(0, 7 - daysDone);
  const progressPercent = Math.min(100, Math.round((daysDone / 7) * 100));

  // Determine shift time display
  const shiftStr = (candidate.caLam || 'SÁNG').toUpperCase();
  let shiftTimeStr = '06:45 - 12:00';
  if (shiftStr.includes('CHIEU') || shiftStr.includes('CHIỀU') || shiftStr.includes('12H')) {
    shiftTimeStr = '11:45 - 18:00';
  } else if (shiftStr.includes('TOI') || shiftStr.includes('TỐI') || shiftStr.includes('18H')) {
    shiftTimeStr = '17:45 - 22:00';
  }

  return (
    <div className="min-h-screen bg-[#0a0c14] text-slate-100 flex flex-col items-center justify-start p-3 sm:p-5 font-sans">
      <div className="w-full max-w-md space-y-4">
        {/* Top Logo & Title */}
        <div className="flex items-center justify-between pt-2 px-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center text-white font-black shadow-lg shadow-pink-500/30">
              <Milk size={18} />
            </div>
            <span className="text-sm font-black tracking-wider text-pink-400 uppercase">
              UMBO MILK
            </span>
          </div>

          <span className="text-[10px] bg-pink-950/60 border border-pink-500/30 text-pink-300 font-bold px-2.5 py-1 rounded-full">
            ĐỊNH DANH HỆ THỐNG
          </span>
        </div>

        <h1 className="text-xl sm:text-2xl font-black text-center text-white tracking-tight drop-shadow-md">
          ĐIỂM DANH UMBO MILK
        </h1>

        {/* Candidate Info Glass Card */}
        <div className="bg-slate-900/80 backdrop-blur-xl p-4 sm:p-5 rounded-3xl border border-slate-800/90 shadow-2xl space-y-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-pink-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="flex items-start gap-3">
            {/* Avatar Circle */}
            <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-pink-600 to-rose-400 p-0.5 shadow-lg shrink-0">
              <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-pink-400 font-black text-lg">
                {candidate.tenUv ? candidate.tenUv.charAt(0).toUpperCase() : <User size={24} />}
              </div>
            </div>

            {/* Candidate Details */}
            <div className="flex-1 min-w-0 text-xs space-y-1">
              <h3 className="text-base font-black text-white truncate">{candidate.tenUv}</h3>
              <div className="text-[11px] text-slate-300">
                <span className="text-slate-400 font-medium">Mã UV: </span>
                <span className="font-mono font-bold text-pink-400">{candidate.id}</span>
              </div>
              <div className="text-[11px] text-slate-300 truncate">
                <span className="text-slate-400 font-medium">Chi nhánh: </span>
                <span className="font-semibold text-slate-200">{candidate.chiNhanh || 'Chưa chốt'}</span>
              </div>
              <div className="text-[11px] text-slate-300">
                <span className="text-slate-400 font-medium">Ca làm: </span>
                <span className="font-bold text-amber-400">{candidate.caLam || 'Ca SÁNG'}</span>
              </div>
              <div className="text-[11px] text-slate-300">
                <span className="text-slate-400 font-medium">Thời gian: </span>
                <span className="font-mono text-slate-200 font-semibold">{shiftTimeStr}</span>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold">
              <span className="text-slate-300 uppercase tracking-wider">
                TIẾN ĐỘ ĐÀO TẠO: <span className="text-pink-400 font-black">{daysDone}/7 Ngày</span>
              </span>
              <span className="text-slate-400 font-normal">{daysLeft} ngày còn lại</span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/60">
              <div
                className="h-full bg-gradient-to-r from-pink-500 via-rose-500 to-purple-500 rounded-full transition-all duration-500 shadow-sm"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* TOO EARLY WARNING ALERT BOX */}
        {candidate?.isTooEarly && (
          <div className="bg-amber-950/90 border-2 border-amber-500/80 p-4 sm:p-5 rounded-3xl text-center space-y-2 shadow-2xl backdrop-blur-xl animate-pulse">
            <div className="w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto text-amber-400">
              <AlertCircle size={28} />
            </div>
            <h3 className="text-base font-black text-amber-300">⚠️ CHƯA ĐẾN KHUNG GIỜ ĐIỂM DANH!</h3>
            <p className="text-xs text-amber-100 leading-relaxed">
              Bạn đang mở trang quá sớm <strong className="font-mono text-white font-black">{candidate.earlyMinutes} phút</strong>.
              Khung giờ điểm danh cho ca <strong className="text-amber-300 font-bold">{candidate.caLam || 'SÁNG'}</strong> chỉ mở từ <strong className="font-mono text-white font-extrabold">{candidate.allowedTimeStr}</strong> trở đi (trước ca 30 phút).
            </p>
            <p className="text-[11px] text-amber-300/80 italic font-medium">
              * Nút xác nhận điểm danh đã được khóa cho đến khi vào đúng khung giờ.
            </p>
          </div>
        )}

        {/* Result Cards OR Upload Form */}
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
                  ✅ Ảnh chụp cửa hàng & thông tin điểm danh đã được lưu lên Google Drive.
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
          /* Photo Upload Section */
          <div className="bg-slate-900/80 backdrop-blur-xl p-4 sm:p-5 rounded-3xl border border-slate-800/90 shadow-2xl space-y-4">
            <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider">
              TẢI LÊN ẢNH CỬA HÀNG
            </h4>

            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />

            {imageSrc ? (
              <div className="relative rounded-2xl overflow-hidden border-2 border-pink-500 shadow-2xl group">
                <img
                  src={imageSrc}
                  alt="Ảnh cửa hàng điểm danh"
                  className="w-full h-56 object-cover"
                />

                {/* Shield Badge Overlay */}
                <div className="absolute top-1/2 right-4 -translate-y-1/2 bg-gradient-to-br from-pink-600/90 to-rose-700/90 backdrop-blur-md border border-white/20 p-3.5 rounded-2xl shadow-2xl flex flex-col items-center text-center text-white space-y-1 animate-pulse">
                  <ShieldCheck size={28} className="text-pink-200" />
                  <span className="text-[10px] font-black tracking-wider uppercase leading-tight">
                    ĐIỂM DANH<br />UMBO MILK
                  </span>
                </div>

                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3 flex justify-between items-end">
                  <span className="text-[10px] text-slate-300 font-mono">
                    {candidate.chiNhanh || 'Umbo Milk Store'}
                  </span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-slate-900/90 hover:bg-slate-900 text-white px-3 py-1.5 rounded-xl border border-slate-700 text-xs font-bold flex items-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
                  >
                    <RefreshCw size={13} /> Chụp lại
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-48 border-2 border-dashed border-slate-700 hover:border-pink-500/80 bg-slate-850/50 hover:bg-pink-950/20 rounded-2xl flex flex-col items-center justify-center gap-2.5 transition-all cursor-pointer group p-4"
              >
                <div className="w-14 h-14 rounded-2xl bg-pink-600/15 group-hover:bg-pink-600/25 flex items-center justify-center text-pink-400 group-hover:scale-110 transition-transform">
                  <Camera size={28} />
                </div>
                <div className="text-center space-y-1">
                  <span className="text-xs font-extrabold text-pink-300 group-hover:text-pink-200 block">
                    Bấm vào đây để chụp ảnh cửa hàng
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    Chụp hình trước cửa hàng chi nhánh để xác nhận
                  </span>
                </div>
              </button>
            )}

            <p className="text-[10px] text-slate-400 text-center">
              Hình ảnh cửa hàng {candidate.chiNhanh || 'Umbo Milk'}
            </p>

            {/* Note Box */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                GHI CHÚ
              </label>
              <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-mono font-bold text-slate-200 tracking-wide">
                  ĐIỂM DANH UBM
                </span>
                <ImageIcon size={18} className="text-slate-500" />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="button"
              disabled={!imageSrc || isSubmitting || candidate?.isTooEarly}
              onClick={handleCheckinSubmit}
              className={`w-full py-4 px-4 rounded-full font-black text-sm transition-all shadow-2xl flex items-center justify-center gap-2 cursor-pointer ${
                candidate?.isTooEarly
                  ? 'bg-amber-950/80 text-amber-400 border border-amber-500/50 cursor-not-allowed shadow-none'
                  : imageSrc && !isSubmitting
                    ? 'bg-gradient-to-r from-pink-600 via-rose-600 to-purple-600 hover:from-pink-500 hover:to-rose-500 text-white shadow-pink-600/40 animate-pulse active:scale-[0.98]'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/60'
              }`}
            >
              {candidate?.isTooEarly ? (
                <>
                  <AlertCircle size={18} />
                  <span>⏳ CHƯA ĐẾN GIỜ (MỞ TỪ {candidate.allowedTimeStr})</span>
                </>
              ) : isSubmitting ? (
                <>
                  <Spinner size={18} className="text-white" />
                  <span>Đang ghi nhận điểm danh...</span>
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
