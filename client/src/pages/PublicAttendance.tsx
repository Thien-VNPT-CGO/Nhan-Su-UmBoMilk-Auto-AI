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
  LogIn,
  LogOut,
  Clock,
  AlertTriangle,
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
  shiftTimeRangeStr?: string;
  hasCheckedInToday?: boolean;
  hasCheckedOutToday?: boolean;
  checkinTimeStr?: string | null;
  checkoutTimeStr?: string | null;
  isCheckoutTooEarly?: boolean;
  allowedCheckoutTimeStr?: string;
  shiftEndTimeStr?: string;
  isLateNow?: boolean;
  lateMinutesNow?: number;
  shiftStartTimeStr?: string;
}

export default function PublicAttendance() {
  const params = useParams();
  const id = (params['*'] || params.id || '').replace(/^\/+/, '');
  const [candidate, setCandidate] = useState<CandidateAttendanceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [attendanceType, setAttendanceType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [lateReason, setLateReason] = useState('');
  const [showLateModal, setShowLateModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAttendanceInfo = () => {
    if (!id) return;
    setLoading(true);
    api
      .get<CandidateAttendanceInfo>(`/public/candidates/${encodeURIComponent(id)}/attendance-info`)
      .then((data) => {
        setCandidate(data);
        setLoading(false);
        // Tự động chuyển tab sang CHECK_OUT nếu đã điểm danh vào ca hôm nay
        if (data.hasCheckedInToday && !data.hasCheckedOutToday) {
          setAttendanceType('CHECK_OUT');
        }
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : 'Không tìm thấy thông tin ứng viên.');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAttendanceInfo();
  }, [id]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Nén ảnh trực tiếp từ ObjectURL để tránh nạp chuỗi Base64 dung lượng lớn gây lỗi 'request entity too large'
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 800; // 800px chuẩn nét và siêu nhẹ cho ảnh điểm danh mobile (~50KB)
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.round((height * MAX_SIZE) / width);
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.round((width * MAX_SIZE) / height);
          height = MAX_SIZE;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.6);
        setImageSrc(compressedDataUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const reader = new FileReader();
      reader.onload = (event) => {
        const rawDataUrl = event.target?.result as string;
        if (!rawDataUrl) return;
        const fallbackImg = new Image();
        fallbackImg.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 800;
          canvas.height = Math.round((fallbackImg.height * 800) / fallbackImg.width) || 600;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(fallbackImg, 0, 0, canvas.width, canvas.height);
            setImageSrc(canvas.toDataURL('image/jpeg', 0.6));
          } else {
            setImageSrc(rawDataUrl);
          }
        };
        fallbackImg.onerror = () => setImageSrc(rawDataUrl);
        fallbackImg.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    };

    img.src = objectUrl;
  };

  const [submitResult, setSubmitResult] = useState<{
    isLate: boolean;
    isEarlyLeave: boolean;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    fineAmount: number;
    errCode?: string;
    fineLabel?: string;
    backupFolder: string;
    message: string;
  } | null>(null);

  const handleCheckinSubmit = async () => {
    if (!id || !imageSrc) return;
    if (attendanceType === 'CHECK_IN' && candidate?.hasCheckedInToday) {
      alert('Bạn đã điểm danh vào ca hôm nay rồi!');
      return;
    }
    if (attendanceType === 'CHECK_OUT' && candidate?.hasCheckedOutToday) {
      alert('Bạn đã xác nhận ra ca hôm nay rồi!');
      return;
    }
    if (attendanceType === 'CHECK_IN' && candidate?.isTooEarly) {
      alert(`Chưa đến khung giờ điểm danh! Khung giờ cho phép mở điểm danh bắt đầu từ ${candidate.allowedTimeStr} (trước ca 30 phút).`);
      return;
    }
    if (attendanceType === 'CHECK_OUT' && candidate?.isCheckoutTooEarly) {
      alert(`Chưa đến khung giờ Check-out! Khung giờ cho phép Check-out ca này mở từ ${candidate.allowedCheckoutTimeStr} trở đi (trước giờ hết ca 30 phút).`);
      return;
    }

    // Nếu là CHECK_IN và BỊ TRỄ mà CHƯA MỞ MODAL LÝ DO -> Mở Modal yêu cầu nhập lý do!
    if (attendanceType === 'CHECK_IN' && candidate?.isLateNow && !showLateModal) {
      setShowLateModal(true);
      return;
    }

    // Nếu đã mở Modal mà lý do bỏ trống -> Báo lỗi yêu cầu nhập
    if (attendanceType === 'CHECK_IN' && candidate?.isLateNow && showLateModal && !lateReason.trim()) {
      alert('Vui lòng nhập lý do đi trễ chính đáng trước khi bấm XÁC NHẬN!');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await api.post<{
        isLate: boolean;
        isEarlyLeave: boolean;
        lateMinutes: number;
        earlyLeaveMinutes: number;
        fineAmount: number;
        errCode?: string;
        fineLabel?: string;
        backupFolder: string;
        message: string;
      }>(`/public/candidates/${encodeURIComponent(id)}/attendance-checkin`, {
        image: imageSrc,
        note: attendanceType === 'CHECK_OUT' ? 'XÁC NHẬN RA CA UBM' : 'ĐIỂM DANH UBM',
        type: attendanceType,
        lateReason: lateReason.trim(),
      });
      setShowLateModal(false);
      setSubmitResult(data);
      setSubmitSuccess(true);
      setIsSubmitting(false);
      // Tải lại thông tin trạng thái sau khi điểm danh
      fetchAttendanceInfo();
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

  const isCheckinAllowed = attendanceType === 'CHECK_IN' && !candidate.hasCheckedInToday && !candidate.isTooEarly;
  const isCheckoutAllowed = attendanceType === 'CHECK_OUT' && !candidate.hasCheckedOutToday && !candidate.isCheckoutTooEarly;

  // Determine shift time display
  const shiftStr = (candidate.caLam || 'SÁNG').toUpperCase();
  let shiftTimeStr = '07:00 - 12:00';
  if (shiftStr.includes('CHIEU') || shiftStr.includes('CHIỀU') || shiftStr.includes('12H')) {
    shiftTimeStr = '12:00 - 18:00';
  } else if (shiftStr.includes('TOI') || shiftStr.includes('TỐI') || shiftStr.includes('18H')) {
    shiftTimeStr = '18:00 - 23:00';
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

        {/* CHECK-IN vs CHECK-OUT TOGGLE SWITCHER */}
        <div className="bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800 flex gap-2 shadow-xl">
          <button
            type="button"
            onClick={() => {
              setAttendanceType('CHECK_IN');
              setImageSrc(null);
              setSubmitSuccess(false);
            }}
            className={`flex-1 py-2.5 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              attendanceType === 'CHECK_IN'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-900/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <LogIn size={15} />
            <span>VÀO CA (CHECK-IN)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAttendanceType('CHECK_OUT');
              setImageSrc(null);
              setSubmitSuccess(false);
            }}
            className={`flex-1 py-2.5 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              attendanceType === 'CHECK_OUT'
                ? 'bg-gradient-to-r from-rose-600 to-pink-600 text-white shadow-lg shadow-rose-900/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <LogOut size={15} />
            <span>RA CA (CHECK-OUT)</span>
          </button>
        </div>

        {/* Banner Nhắc nhở Quy định Điểm danh */}
        <div className="bg-amber-950/40 border border-amber-500/40 p-3.5 rounded-2xl text-xs text-amber-200 flex items-start gap-2.5 shadow-md">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">
            <strong className="text-amber-300 block mb-0.5">⚠️ QUY ĐỊNH BẮT BUỘC ĐIỂM DANH:</strong>
            Nhân viên vào ca phải bấm <strong>VÀO CA (Check-in)</strong> và khi hết ca làm phải bấm <strong>RA CA (Check-out)</strong>. <span className="text-rose-400 font-bold underline">Nếu chỉ Check-in mà KHÔNG Check-out thì ngày làm đó sẽ KHÔNG ĐƯỢC TÍNH!</span>
          </div>
        </div>

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
                <span className="text-slate-400 font-medium">Thời gian ca: </span>
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

        {/* CẢNH BÁO / THÔNG BÁO CHO TAB VÀO CA (CHECK-IN) */}
        {attendanceType === 'CHECK_IN' && (
          candidate.hasCheckedInToday ? (
            <div className="bg-emerald-950/80 border border-emerald-500/60 p-4 rounded-2xl text-center space-y-1 shadow-lg backdrop-blur-xl">
              <div className="flex items-center justify-center gap-2 text-emerald-300 font-black text-sm">
                <CheckCircle2 size={18} />
                <span>BẠN ĐÃ ĐIỂM DANH VÀO CA HÔM NAY</span>
              </div>
              {candidate.checkinTimeStr && (
                <p className="text-[11px] text-emerald-200/90">
                  Mốc thời gian ghi nhận: <strong className="font-mono text-white">{candidate.checkinTimeStr}</strong>
                </p>
              )}
            </div>
          ) : candidate.isTooEarly ? (
            <div className="bg-amber-950/90 border-2 border-amber-500/80 p-4 sm:p-5 rounded-3xl text-center space-y-2 shadow-2xl backdrop-blur-xl animate-pulse">
              <div className="w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto text-amber-400">
                <AlertCircle size={28} />
              </div>
              <h3 className="text-base font-black text-amber-300">⚠️ CHƯA ĐẾN KHUNG GIỜ ĐIỂM DANH!</h3>
              <p className="text-xs text-amber-100 leading-relaxed">
                Bạn đang mở trang quá sớm <strong className="font-mono text-white font-black">{candidate.earlyMinutes} phút</strong>.
                Khung giờ điểm danh ca <strong className="text-amber-300 font-bold">{candidate.caLam || 'SÁNG'}</strong> chỉ mở từ <strong className="font-mono text-white font-extrabold">{candidate.allowedTimeStr}</strong> trở đi (trước ca 30 phút).
              </p>
            </div>
          ) : null
        )}

        {/* CẢNH BÁO / THÔNG BÁO CHO TAB RA CA (CHECK-OUT) */}
        {attendanceType === 'CHECK_OUT' && (
          candidate.hasCheckedOutToday ? (
            <div className="bg-emerald-950/80 border border-emerald-500/60 p-4 rounded-2xl text-center space-y-1 shadow-lg backdrop-blur-xl">
              <div className="flex items-center justify-center gap-2 text-emerald-300 font-black text-sm">
                <CheckCircle2 size={18} />
                <span>BẠN ĐÃ XÁC NHẬN RA CA HÔM NAY</span>
              </div>
              {candidate.checkoutTimeStr && (
                <p className="text-[11px] text-emerald-200/90">
                  Mốc thời gian ra ca: <strong className="font-mono text-white">{candidate.checkoutTimeStr}</strong>
                </p>
              )}
            </div>
          ) : candidate.isCheckoutTooEarly ? (
            <div className="bg-amber-950/90 border-2 border-amber-500/80 p-4 sm:p-5 rounded-3xl text-center space-y-2 shadow-2xl backdrop-blur-xl animate-pulse">
              <div className="w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto text-amber-400">
                <Clock size={28} />
              </div>
              <h3 className="text-base font-black text-amber-300">⏳ CHƯA ĐẾN GIỜ HẾT CA (CHECK-OUT)!</h3>
              <p className="text-xs text-amber-100 leading-relaxed">
                Nút Check-out (ra ca) ca làm này <strong className="text-amber-300 font-bold">chỉ mở đúng từ {candidate.shiftEndTimeStr} trở đi</strong> (khi kết thúc ca làm).
              </p>
              <p className="text-[11px] text-amber-300/80 italic font-medium">
                * Nút xác nhận ra ca đang khóa cho đến đúng giờ hết ca.
              </p>
            </div>
          ) : (
            <div className="bg-emerald-950/80 border border-emerald-500/60 p-3.5 rounded-2xl text-center space-y-1 shadow-lg backdrop-blur-xl">
              <p className="text-xs font-bold text-emerald-300">
                ⏰ ĐÃ ĐẾN GIỜ HẾT CA! Nút Check-out đã mở ({candidate.shiftEndTimeStr} trở đi).
              </p>
              <p className="text-[10px] text-emerald-200 font-medium">
                * Bạn đang ra ca đúng giờ. Hệ thống ghi nhận 0đ phạt.
              </p>
            </div>
          )
        )}

        {/* Result Cards OR Upload Form */}
        {submitSuccess ? (
          submitResult?.isEarlyLeave ? (
            /* Early Leave Penalty Result Card */
            <div className="bg-rose-950/90 border-2 border-rose-500/80 p-6 rounded-3xl text-center space-y-4 shadow-2xl animate-fade-in backdrop-blur-xl">
              <div className="w-16 h-16 bg-rose-500/20 rounded-full flex items-center justify-center mx-auto text-rose-400 animate-pulse">
                <AlertCircle size={40} />
              </div>

              <div>
                <h2 className="text-xl font-black text-rose-300">⚠️ RA CA SỚM – PHẠT 50.000Đ/LẦN</h2>
                <p className="text-xs text-rose-200/90 mt-1">
                  Bạn đã check-out ra ca sớm <strong className="font-mono text-white font-extrabold">{submitResult.earlyLeaveMinutes} phút</strong> trước giờ hết ca ({candidate.shiftEndTimeStr})!
                </p>
              </div>

              <div className="bg-rose-900/60 p-4 rounded-2xl border border-rose-700/60 text-xs text-rose-100 space-y-2">
                <p className="font-bold text-rose-200">
                  ⚠️ Mức phạt theo Quy chế: <span className="text-amber-300 font-extrabold">RA SỚM: 50.000đ / lần</span> đã được tự động ghi nhận trực tiếp vào Web chấm công.
                </p>
                <p className="text-[11px] text-rose-300 opacity-90 leading-relaxed">
                  Ảnh chụp cửa hàng & xác thực chữ <strong>"XÁC NHẬN RA CA UBM"</strong> đã lưu an toàn vào Google Drive.
                </p>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-2xl border border-slate-700 text-xs text-emerald-400 font-mono font-bold flex items-center justify-center gap-1.5">
                <Check size={14} /> NỘI DUNG XÁC THỰC: "XÁC NHẬN RA CA UBM" ✓
              </div>

              <p className="text-[11px] text-slate-400 italic">
                Vui lòng chú ý thời gian ra ca đúng quy định ở các buổi làm việc tiếp theo!
              </p>
            </div>
          ) : submitResult?.isLate ? (
            /* Late Penalty Result Card */
            <div className="bg-rose-950/90 border-2 border-rose-500/80 p-6 rounded-3xl text-center space-y-4 shadow-2xl animate-fade-in backdrop-blur-xl">
              <div className="w-16 h-16 bg-rose-500/20 rounded-full flex items-center justify-center mx-auto text-rose-400 animate-pulse">
                <AlertCircle size={40} />
              </div>

              <div>
                <h2 className="text-xl font-black text-rose-300">
                  {submitResult.lateMinutes >= 5 && submitResult.lateMinutes < 30
                    ? 'ĐIỂM DANH TRỄ 5P – PHẠT 30.000Đ'
                    : submitResult.lateMinutes >= 30 && submitResult.lateMinutes < 60
                      ? 'ĐIỂM DANH TRỄ 30P – PHẠT 50% LƯƠNG CA'
                      : 'ĐIỂM DANH TRỄ ≥ 60P – PHẠT 100% LƯƠNG CA'}
                </h2>
                <p className="text-xs text-rose-200/90 mt-1">
                  Bạn đã trễ <strong className="font-mono text-white font-extrabold">{submitResult.lateMinutes} phút</strong> so với khung giờ ca làm!
                </p>
              </div>

              <div className="bg-rose-900/60 p-4 rounded-2xl border border-rose-700/60 text-xs text-rose-100 space-y-2">
                <p className="font-bold text-rose-200">
                  ⚠️ Mức phạt theo Quy chế làm việc:{' '}
                  <span className="text-amber-300 font-extrabold">
                    {submitResult.lateMinutes >= 5 && submitResult.lateMinutes < 30
                      ? 'VÀO TRỄ 5P: PHẠT 30.000Đ'
                      : submitResult.fineLabel || `${submitResult.fineAmount.toLocaleString('vi-VN')}đ`}
                  </span>{' '}
                  đã được hệ thống tự động ghi nhận trực tiếp vào Web chấm công.
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
                <h2 className="text-xl font-black text-emerald-300">
                  {attendanceType === 'CHECK_OUT' ? 'RA CA THÀNH CÔNG!' : 'ĐIỂM DANH VÀO CA THÀNH CÔNG!'}
                </h2>
                <p className="text-xs text-emerald-200/90 mt-1">
                  {attendanceType === 'CHECK_OUT'
                    ? 'Bạn đã hoàn tất xác nhận ra ca đúng giờ. Cảm ơn bạn!'
                    : 'Chúc mừng bạn đã điểm danh đúng giờ cho ca làm hôm nay.'}
                </p>
              </div>

              <div className="bg-emerald-900/50 p-4 rounded-2xl border border-emerald-700/50 text-xs text-emerald-100 space-y-2">
                <p className="font-bold text-emerald-200">
                  ✅ Ảnh chụp cửa hàng & thông tin đã được lưu lên Google Drive.
                </p>
                {attendanceType === 'CHECK_IN' && (
                  <p className="text-[11px] text-emerald-300 opacity-90">
                    Tự động tích lũy <strong className="text-white font-extrabold">+1 Ngày Đào Tạo</strong> vào hồ sơ.
                  </p>
                )}
              </div>

              <div className="bg-slate-900/80 p-3 rounded-2xl border border-slate-700 text-xs text-emerald-400 font-mono font-bold flex items-center justify-center gap-1.5">
                <Check size={14} /> NỘI DUNG XÁC THỰC: "{attendanceType === 'CHECK_OUT' ? 'XÁC NHẬN RA CA UBM' : 'ĐIỂM DANH UBM'}" ✓
              </div>

              <p className="text-[11px] text-slate-400 italic">
                Chúc bạn có một ngày làm việc và học tập hiệu quả tại Umbo Milk!
              </p>
            </div>
          )
        ) : (isCheckinAllowed || isCheckoutAllowed) ? (
          /* Photo Upload Section */
          <div className="bg-slate-900/80 backdrop-blur-xl p-4 sm:p-5 rounded-3xl border border-slate-800/90 shadow-2xl space-y-4">
            <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider">
              {attendanceType === 'CHECK_OUT' ? 'TẢI LÊN ẢNH XÁC NHẬN RA CA' : 'TẢI LÊN ẢNH CỬA HÀNG VÀO CA'}
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
                    {attendanceType === 'CHECK_OUT' ? 'RA CA' : 'ĐIỂM DANH'}<br />UMBO MILK
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
                    Bấm vào đây để chụp ảnh {attendanceType === 'CHECK_OUT' ? 'ra ca' : 'cửa hàng'}
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    Chụp hình tại cửa hàng chi nhánh để xác nhận
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
                GHI CHÚ XÁC THỰC
              </label>
              <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-mono font-bold text-slate-200 tracking-wide">
                  {attendanceType === 'CHECK_OUT' ? 'XÁC NHẬN RA CA UBM' : 'ĐIỂM DANH UBM'}
                </span>
                <ImageIcon size={18} className="text-slate-500" />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="button"
              disabled={!imageSrc || isSubmitting}
              onClick={handleCheckinSubmit}
              className={`w-full py-4 px-4 rounded-full font-black text-sm transition-all shadow-2xl flex items-center justify-center gap-2 cursor-pointer ${
                imageSrc && !isSubmitting
                  ? attendanceType === 'CHECK_OUT'
                    ? 'bg-gradient-to-r from-rose-600 via-pink-600 to-purple-600 hover:from-rose-500 hover:to-pink-500 text-white shadow-rose-600/40 animate-pulse active:scale-[0.98]'
                    : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/40 animate-pulse active:scale-[0.98]'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/60'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Spinner size={18} className="text-white" />
                  <span>Đang ghi nhận {attendanceType === 'CHECK_OUT' ? 'ra ca' : 'điểm danh'}...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={20} />
                  <span>{attendanceType === 'CHECK_OUT' ? 'XÁC NHẬN RA CA' : 'XÁC NHẬN ĐIỂM DANH VÀO CA'}</span>
                </>
              )}
            </button>
          </div>
        ) : null}
      </div>

      {/* MODAL POPUP CẢNH BÁO ĐI TRỄ VÀ BẮT BUỘC NHẬP LÝ DO */}
      {showLateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-[#121624] via-[#1c192e] to-[#121624] border-2 border-amber-500/90 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-2.5 text-amber-300 font-black text-xs sm:text-sm uppercase tracking-wider">
              <AlertTriangle size={22} className="text-amber-400 shrink-0 animate-bounce" />
              <span>CẢNH BÁO ĐI TRỄ ({candidate?.lateMinutesNow || 0} PHÚT)</span>
            </div>
            <p className="text-[11px] sm:text-xs text-amber-200/90 leading-relaxed">
              Giờ vào ca chuẩn: <strong>{candidate?.shiftStartTimeStr}</strong>. Theo quy chế làm việc, trường hợp đi trễ <strong>bắt buộc phải nhập lý do chính đáng</strong> bên dưới trước khi gửi điểm danh.
            </p>
            <div className="space-y-1.5 pt-1">
              <label className="text-[10px] font-black text-amber-300 uppercase tracking-wider flex items-center justify-between">
                <span>LÝ DO ĐI TRỄ (BẮT BUỘC NHẬP CHÍNH ĐÁNG)</span>
                <span className="text-rose-400 font-extrabold">* BẮT BUỘC</span>
              </label>
              <textarea
                rows={3}
                value={lateReason}
                onChange={(e) => setLateReason(e.target.value)}
                placeholder="Nhập lý do đi trễ chính đáng của bạn (ví dụ: kẹt xe, sự cố hỏng xe...)..."
                className="w-full bg-slate-900/95 border border-amber-500/70 focus:border-amber-400 rounded-2xl p-3.5 text-xs text-white placeholder:text-slate-500 outline-none transition-colors"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowLateModal(false)}
                className="px-4 py-2.5 rounded-full text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={!lateReason.trim() || isSubmitting}
                onClick={handleCheckinSubmit}
                className={`px-6 py-3 rounded-full text-xs font-black text-white transition-all flex items-center gap-2 shadow-xl ${
                  !lateReason.trim() || isSubmitting
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                    : 'bg-gradient-to-r from-amber-600 via-rose-600 to-pink-600 hover:from-amber-500 hover:to-rose-500 text-white shadow-amber-600/40 cursor-pointer active:scale-95 animate-pulse'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Spinner size={16} className="text-white" />
                    <span>ĐANG ĐIỂM DANH...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>XÁC NHẬN</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
