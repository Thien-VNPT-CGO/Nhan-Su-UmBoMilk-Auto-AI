import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, CheckCircle2, AlertCircle, Building2, Clock, Calendar, RefreshCw, Upload, ShieldCheck } from 'lucide-react';
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get<CandidateAttendanceInfo>(`/public/candidates/${id}/attendance-info`)
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

  const handleCheckinSubmit = async () => {
    if (!id || !imageSrc) return;
    setIsSubmitting(true);
    try {
      await api.post(`/public/candidates/${id}/attendance-checkin`, {
        image: imageSrc,
        note: 'ĐIỂM DANH UMBO MILK',
      });
      setSubmitSuccess(true);
      setIsSubmitting(false);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Điểm danh thất bại, vui lòng thử lại.');
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <Spinner size={32} className="text-pink-500 mb-3" />
        <p className="text-sm font-semibold text-slate-300">Đang tải thông tin điểm danh...</p>
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 max-w-md w-full text-center space-y-3">
          <AlertCircle size={48} className="text-rose-500 mx-auto" />
          <h2 className="text-lg font-black text-rose-400">Không tìm thấy thông tin</h2>
          <p className="text-xs text-slate-300">{error || 'Đường dẫn điểm danh không hợp lệ hoặc đã hết hạn.'}</p>
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

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-start p-3 sm:p-6 font-sans">
      {/* Header Thương Hiệu UMBO MILK */}
      <div className="w-full max-w-md bg-gradient-to-r from-pink-600 to-rose-600 p-5 rounded-3xl shadow-xl border border-pink-500/30 text-center space-y-2 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-xl pointer-events-none" />
        <span className="inline-block bg-white/20 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">
          HỆ THỐNG ĐÀO TẠO UMBO MILK
        </span>
        <h1 className="text-2xl font-black tracking-tight text-white drop-shadow-md">
          ĐIỂM DANH UMBO MILK
        </h1>
        <p className="text-xs text-pink-100 font-medium">{todayStr}</p>
      </div>

      {/* Thẻ Thông Tin Ứng Viên */}
      <div className="w-full max-w-md bg-slate-900 mt-4 p-4 rounded-2xl border border-slate-800 space-y-3 shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400">Ứng viên Training</span>
            <h3 className="text-base font-black text-white">{candidate.tenUv}</h3>
            <p className="text-xs text-slate-400">{candidate.sdtZalo}</p>
          </div>
          <div className="bg-pink-950/80 border border-pink-800/80 px-3 py-1.5 rounded-xl text-center">
            <span className="text-[10px] font-bold text-pink-400 block">Số ngày đã tập</span>
            <span className="text-sm font-black text-pink-300">{candidate.soNgayDaTraining}/7 Ngày</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60 flex items-start gap-2">
            <Building2 size={16} className="text-pink-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-[10px] text-slate-400 block font-semibold">Chi nhánh chính</span>
              <span className="font-bold text-slate-200 text-[11px] leading-tight block">{candidate.chiNhanh || 'Chưa chốt'}</span>
            </div>
          </div>

          <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60 flex items-start gap-2">
            <Clock size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-[10px] text-slate-400 block font-semibold">Ca làm chính thức</span>
              <span className="font-bold text-slate-200 text-[11px] leading-tight block">{candidate.caLam || 'Chưa chốt'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Màn Hình Điểm Danh Thành Công */}
      {submitSuccess ? (
        <div className="w-full max-w-md bg-emerald-950/90 border border-emerald-600 mt-4 p-6 rounded-3xl text-center space-y-3 shadow-2xl animate-fade-in">
          <CheckCircle2 size={56} className="text-emerald-400 mx-auto animate-bounce" />
          <h2 className="text-xl font-black text-emerald-300">ĐIỂM DANH THÀNH CÔNG!</h2>
          <p className="text-xs text-emerald-200 leading-relaxed">
            Hệ thống đã ghi nhận ảnh chụp cửa hàng & tự động lưu hồ sơ điểm danh ngày <strong>{todayStr}</strong> vào Google Drive.
          </p>
          <div className="bg-emerald-900/60 p-3 rounded-xl border border-emerald-700/60 text-xs text-emerald-100 font-mono font-bold">
            CHỮ ĐIỂM DANH: "ĐIỂM DANH UMBO MILK" ✓
          </div>
          <p className="text-[11px] text-slate-400">Chúc bạn có một buổi làm việc và đào tạo hiệu quả tại Umbo Milk!</p>
        </div>
      ) : (
        /* Màn Hình Chụp Hình & Điểm Danh */
        <div className="w-full max-w-md bg-slate-900 mt-4 p-4 rounded-3xl border border-slate-800 space-y-4 shadow-xl">
          <div className="text-center space-y-1">
            <h4 className="text-sm font-black text-pink-400 flex items-center justify-center gap-1">
              <Camera size={16} /> Chụp hình cửa hàng điểm danh
            </h4>
            <p className="text-[11px] text-slate-400">Vui lòng đứng trước cửa hàng chi nhánh để chụp ảnh xác nhận.</p>
          </div>

          {/* Vùng Chọn / Chụp Ảnh */}
          <div className="space-y-3">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />

            {imageSrc ? (
              <div className="relative rounded-2xl overflow-hidden border-2 border-pink-500 shadow-lg group">
                <img src={imageSrc} alt="Ảnh cửa hàng điểm danh" className="w-full h-56 object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-3">
                  <span className="bg-pink-600 text-white text-xs font-black px-2.5 py-1 rounded-lg w-fit shadow-md flex items-center gap-1">
                    <ShieldCheck size={14} /> ĐIỂM DANH UMBO MILK
                  </span>
                  <span className="text-[10px] text-slate-300 mt-1 font-mono">{new Date().toLocaleString('vi-VN')}</span>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute top-2 right-2 bg-slate-900/80 hover:bg-slate-900 text-white p-2 rounded-xl border border-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw size={14} /> Chụp lại
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-48 border-2 border-dashed border-pink-500/50 hover:border-pink-500 bg-pink-950/20 hover:bg-pink-950/40 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all cursor-pointer group"
              >
                <div className="w-14 h-14 rounded-full bg-pink-600/20 group-hover:bg-pink-600/30 flex items-center justify-center text-pink-400 group-hover:scale-110 transition-transform">
                  <Camera size={28} />
                </div>
                <span className="text-xs font-bold text-pink-300 group-hover:text-pink-200">
                  Bấm vào đây để chụp ảnh cửa hàng
                </span>
                <span className="text-[10px] text-slate-400">Hoặc tải lên hình chụp thực tế</span>
              </button>
            )}
          </div>

          {/* Dòng chữ ĐIỂM DANH thương hiệu */}
          <div className="bg-slate-800 p-3 rounded-2xl border border-slate-700 text-center space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Nội dung xác thực hệ thống</span>
            <div className="text-lg font-black text-pink-400 tracking-wider font-mono">
              "ĐIỂM DANH UMBO MILK"
            </div>
            <p className="text-[10px] text-slate-400 italic">
              * Ảnh & thông tin sẽ tự động phân loại lưu vào Google Drive theo Chi nhánh & Ca làm việc.
            </p>
          </div>

          {/* Nút XÁC NHẬN ĐIỂM DANH */}
          <button
            type="button"
            disabled={!imageSrc || isSubmitting}
            onClick={handleCheckinSubmit}
            className={`w-full py-3.5 px-4 rounded-2xl font-black text-sm transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer ${
              imageSrc && !isSubmitting
                ? 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white animate-pulse'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            }`}
          >
            {isSubmitting ? (
              <>
                <Spinner size={18} className="text-white" />
                <span>Đang đồng bộ Google Drive...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={18} />
                <span>XÁC NHẬN ĐIỂM DANH</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
