import { useEffect, useState } from 'react';
import {
  Shield,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Milk,
  User,
  Clock,
  DollarSign,
  ArrowRightLeft,
  Key,
  Lock,
  Send,
  AlertTriangle,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Spinner } from '../components/ui';
import { getSocket } from '../api/socket';
import PublicAttendance from './PublicAttendance';

interface EmployeeSession {
  candidate: {
    id: string;
    tenUv: string;
    sdtZalo: string;
    chiNhanh: string;
    caLam: string;
    trangThaiTraining: string;
    soNgayDaTraining: number;
  };
  keyInfo: {
    key: string;
    type: string;
    status: string;
    deviceId: string;
    activatedAt: string;
  };
}

interface PayrollData {
  type: string;
  completedDays?: number;
  targetDays?: number;
  progressPercent?: number;
  dailyWage?: number;
  completedShifts?: number;
  shiftWage?: number;
  grossSalary: number;
  totalFines: number;
  netSalary: number;
  currencyStr: string;
  summaryText: string;
}

export default function EmployeePortal() {
  const [candidateIdInput, setCandidateIdInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [session, setSession] = useState<EmployeeSession | null>(null);
  const [activeTab, setActiveTab] = useState<'ATTENDANCE' | 'DEVICE' | 'SWAP' | 'PAYROLL'>('ATTENDANCE');

  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // States cho Reset thiết bị TH1
  const [resetReason, setResetReason] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);
  const [resetErrorMsg, setResetErrorMsg] = useState<string | null>(null);

  // States cho Lương AI
  const [payroll, setPayroll] = useState<PayrollData | null>(null);

  // Local deviceId generator
  const getDeviceId = () => {
    let devId = localStorage.getItem('umbomilk_device_id');
    if (!devId) {
      devId = 'DEV_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('umbomilk_device_id', devId);
    }
    return devId;
  };

  // Restore saved session
  useEffect(() => {
    const saved = localStorage.getItem('umbomilk_emp_session');
    if (saved) {
      try {
        setSession(JSON.parse(saved));
      } catch {
        localStorage.removeItem('umbomilk_emp_session');
      }
    }
  }, []);

  // Lắng nghe Socket.io Realtime FORCE LOGOUT khi IT Admin duyệt Reset máy
  useEffect(() => {
    if (!session?.candidate.id) return;
    const socket = getSocket();

    const handleForceLogout = (data: { candidateId: string; reason: string }) => {
      if (data.candidateId === session.candidate.id) {
        localStorage.removeItem('umbomilk_emp_session');
        setSession(null);
        alert(`⚡ THÔNG BÁO TỪ HỆ THỐNG AI:\n${data.reason || 'Thiết bị của bạn đã được IT Admin Reset thành công. Phiên làm việc trên máy này đã được Logout.'}`);
      }
    };

    socket.on('device_key:force_logout', handleForceLogout);
    return () => {
      socket.off('device_key:force_logout', handleForceLogout);
    };
  }, [session?.candidate.id]);

  // Load Lương AI Realtime khi chuyển sang Tab PAYROLL
  useEffect(() => {
    if (session?.candidate.id && activeTab === 'PAYROLL') {
      api.get<PayrollData>(`/public/employee/payroll-ai/${encodeURIComponent(session.candidate.id)}`)
        .then((res) => setPayroll(res))
        .catch(() => null);
    }
  }, [activeTab, session?.candidate.id]);

  // Xử lý Đăng nhập 1 lần & Kích hoạt Key
  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidateIdInput.trim() || !keyInput.trim()) {
      setLoginError('Vui lòng nhập đầy đủ Mã Nhân Viên và Key Kích Hoạt.');
      return;
    }
    setLoading(true);
    setLoginError(null);

    const deviceId = getDeviceId();

    api.post<EmployeeSession>('/public/employee/activate-login', {
      candidateId: candidateIdInput.trim(),
      key: keyInput.trim(),
      deviceId,
    })
      .then((data) => {
        setSession(data);
        localStorage.setItem('umbomilk_emp_session', JSON.stringify(data));
        setLoading(false);
      })
      .catch((err) => {
        setLoginError(err instanceof ApiError ? err.message : 'Đăng nhập không thành công.');
        setLoading(false);
      });
  };

  // Đăng xuất
  const handleLogout = () => {
    localStorage.removeItem('umbomilk_emp_session');
    setSession(null);
  };

  // Gửi phiếu Yêu cầu Reset thiết bị (TH1: Tạo trên máy cũ)
  const handleCreateResetTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !resetReason.trim()) return;
    setResetSubmitting(true);
    setResetSuccessMsg(null);
    setResetErrorMsg(null);

    api.post('/public/employee/device-reset-request', {
      candidateId: session.candidate.id,
      reason: resetReason.trim(),
    })
      .then(() => {
        setResetSuccessMsg('✅ Đã gửi phiếu Yêu cầu Reset thiết bị thành công! Phiếu đang được Quản lý Cửa hàng & IT Admin duyệt.');
        setResetReason('');
        setResetSubmitting(false);
      })
      .catch((err) => {
        setResetErrorMsg(err instanceof ApiError ? err.message : 'Gửi phiếu thất bại.');
        setResetSubmitting(false);
      });
  };

  // GIAO DIỆN ĐĂNG NHẬP (Chưa kích hoạt / Chưa đăng nhập)
  if (!session) {
    return (
      <div className="min-h-screen bg-[#0a0c14] text-slate-100 flex flex-col items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md space-y-6">
          {/* Header Branding */}
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center text-white mx-auto shadow-xl shadow-pink-500/30">
              <Milk size={36} />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white uppercase">
              UMBO MILK PORTAL
            </h1>
            <p className="text-xs text-pink-400 font-bold">
              WEB APP DÀNH RIÊNG CHO NHÂN VIÊN
            </p>
          </div>

          {/* Form Card */}
          <form onSubmit={handleLoginSubmit} className="bg-slate-900/90 backdrop-blur-xl p-6 rounded-3xl border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-300 pb-2 border-b border-slate-800">
              <Lock size={16} className="text-pink-400" />
              <span>ĐĂNG NHẬP & KÍCH HOẠT 1 THIẾT BỊ DUY NHẤT</span>
            </div>

            {loginError && (
              <div className="bg-rose-950/80 border border-rose-500/60 p-3 rounded-2xl text-xs text-rose-200 flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-400" />
                <span>{loginError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                MÃ NHÂN VIÊN (GÁN CỨNG)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={candidateIdInput}
                  onChange={(e) => setCandidateIdInput(e.target.value)}
                  placeholder="Ví dụ: UBM_25/08/2026_NV0008"
                  className="w-full bg-slate-800/90 border border-slate-700 focus:border-pink-500 rounded-2xl px-4 py-3 text-xs text-white placeholder:text-slate-500 outline-none font-mono font-bold"
                  required
                />
                <User size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                KEY KÍCH HOẠT (ADMIN CẤP)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Ví dụ: TRN-8812-4412 hoặc EMP-9912-1102"
                  className="w-full bg-slate-800/90 border border-slate-700 focus:border-pink-500 rounded-2xl px-4 py-3 text-xs text-white placeholder:text-slate-500 outline-none font-mono font-bold tracking-wider"
                  required
                />
                <Key size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" />
              </div>
            </div>

            {/* Note về Device Lock */}
            <div className="bg-amber-950/40 border border-amber-500/40 p-3 rounded-2xl text-[11px] text-amber-200 flex items-start gap-2">
              <Shield size={16} className="shrink-0 mt-0.5 text-amber-400" />
              <span>
                <strong>BẢO MẬT 1 THIẾT BỊ:</strong> Khi đăng nhập thành công, tài khoản sẽ gán cứng với điện thoại này. Không thể đăng nhập giùm trên máy khác.
              </span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-full font-black text-sm bg-gradient-to-r from-pink-600 via-rose-600 to-purple-600 hover:from-pink-500 hover:to-rose-500 text-white shadow-xl shadow-pink-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              {loading ? (
                <>
                  <Spinner size={18} className="text-white" />
                  <span>ĐANG ĐĂNG NHẬP & KÍCH HOẠT...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} />
                  <span>KÍCH HOẠT THIẾT BỊ & ĐĂNG NHẬP</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // GIAO DIỆN CHÍNH (WEB APP DÀNH CHO NHÂN VIÊN - 4 TAB REALTIME)
  return (
    <div className="min-h-screen bg-[#0a0c14] text-slate-100 flex flex-col items-center justify-start p-3 sm:p-5 font-sans">
      <div className="w-full max-w-md space-y-4">
        {/* Top App Header */}
        <div className="bg-slate-900/90 backdrop-blur-xl p-4 rounded-3xl border border-slate-800/90 shadow-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-pink-600 to-rose-400 p-0.5 shadow-lg shrink-0">
              <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-pink-400 font-black text-sm">
                {session.candidate.tenUv ? session.candidate.tenUv.charAt(0).toUpperCase() : <User size={20} />}
              </div>
            </div>
            <div className="text-xs space-y-0.5">
              <h2 className="font-black text-white text-sm truncate">{session.candidate.tenUv}</h2>
              <p className="text-[11px] text-pink-400 font-mono font-bold">{session.candidate.id}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-400 p-2.5 rounded-2xl border border-slate-700 transition-colors cursor-pointer"
            title="Đăng xuất"
          >
            <LogOut size={16} />
          </button>
        </div>

        {/* Tab Selector Buttons */}
        <div className="grid grid-cols-4 gap-1.5 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('ATTENDANCE')}
            className={`py-2 px-1 rounded-xl text-[10px] sm:text-xs font-black flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'ATTENDANCE'
                ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock size={15} />
            <span>Điểm danh</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('DEVICE')}
            className={`py-2 px-1 rounded-xl text-[10px] sm:text-xs font-black flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'DEVICE'
                ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone size={15} />
            <span>Đổi máy</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('SWAP')}
            className={`py-2 px-1 rounded-xl text-[10px] sm:text-xs font-black flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'SWAP'
                ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowRightLeft size={15} />
            <span>Đổi ca</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('PAYROLL')}
            className={`py-2 px-1 rounded-xl text-[10px] sm:text-xs font-black flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'PAYROLL'
                ? 'bg-pink-600 text-white shadow-lg shadow-pink-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <DollarSign size={15} />
            <span>Lương AI</span>
          </button>
        </div>

        {/* TAB 1: ĐIỂM DANH CHECK-IN / CHECK-OUT */}
        {activeTab === 'ATTENDANCE' && (
          <div className="space-y-4">
            <PublicAttendance propCandidateId={session.candidate.id} />
          </div>
        )}

        {/* TAB 2: QUẢN LÝ THIẾT BỊ & YÊU CẦU RESET (TH1: TẠO TRÊN MÁY CỦ) */}
        {activeTab === 'DEVICE' && (
          <div className="bg-slate-900/80 p-5 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200 pb-2 border-b border-slate-800">
              <Smartphone size={16} className="text-pink-400" />
              <span>THÔNG TIN THIẾT BỊ GÁN CỨNG (DEVICE LOCK)</span>
            </div>

            <div className="bg-slate-800/80 p-3.5 rounded-2xl text-xs space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Key loại:</span>
                <span className="font-bold text-pink-400">{session.keyInfo.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Mã Key:</span>
                <span className="font-bold text-white">{session.keyInfo.key}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Mã Thiết Bị:</span>
                <span className="font-bold text-emerald-400 truncate max-w-[180px]">{session.keyInfo.deviceId}</span>
              </div>
            </div>

            <form onSubmit={handleCreateResetTicket} className="space-y-3 pt-2">
              <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle size={15} />
                <span>BÁO ĐỔI ĐIỆN THOẠI / RESET KEY (TH1: TRÊN MÁY CỦ)</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Nếu bạn muốn chuyển sang dùng điện thoại mới, hãy nhập lý do gửi phiếu bên dưới. Quản lý Cửa hàng và IT Admin sẽ duyệt để tự động kích hoạt máy mới.
              </p>

              {resetSuccessMsg && (
                <div className="bg-emerald-950/80 border border-emerald-500/60 p-3 rounded-2xl text-xs text-emerald-200">
                  {resetSuccessMsg}
                </div>
              )}
              {resetErrorMsg && (
                <div className="bg-rose-950/80 border border-rose-500/60 p-3 rounded-2xl text-xs text-rose-200">
                  {resetErrorMsg}
                </div>
              )}

              <textarea
                rows={3}
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                placeholder="Nhập lý do đổi máy (ví dụ: đổi sang máy mới, bán máy cũ...)..."
                className="w-full bg-slate-800/90 border border-slate-700 focus:border-amber-500 rounded-2xl p-3 text-xs text-white outline-none"
                required
              />

              <button
                type="submit"
                disabled={resetSubmitting || !resetReason.trim()}
                className="w-full py-3 rounded-full text-xs font-black bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 text-white shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {resetSubmitting ? <Spinner size={16} /> : <Send size={15} />}
                <span>GỬI PHIẾU YÊU CẦU RESET CHO IT ADMIN</span>
              </button>
            </form>
          </div>
        )}

        {/* TAB 3: ĐỔI CA LÀM REALTIME */}
        {activeTab === 'SWAP' && (
          <div className="bg-slate-900/80 p-5 rounded-3xl border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200 pb-2 border-b border-slate-800">
              <ArrowRightLeft size={16} className="text-pink-400" />
              <span>HOÁN ĐỔI CA LÀM LINH HOẠT (REALTIME)</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Tạo đơn xin hoán đổi ca làm với đồng nghiệp. Đơn sẽ gửi trực tiếp đến màn hình Phê duyệt của Quản lý cửa hàng theo thời gian thực.
            </p>
            <div className="bg-slate-800/60 p-4 rounded-2xl text-center space-y-2">
              <p className="text-xs text-slate-300">
                Để tạo đơn đổi ca nhanh, vui lòng mở trang Phê duyệt ca làm việc hoặc liên hệ Quản lý chi nhánh.
              </p>
              <a
                href="/approvals"
                target="_blank"
                rel="noreferrer"
                className="inline-block bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold px-4 py-2 rounded-full transition-colors"
              >
                Trang Tạo Đơn & Xem Lịch Sử Đổi Ca
              </a>
            </div>
          </div>
        )}

        {/* TAB 4: BẢNG LƯƠNG & TIẾN ĐỘ AI REALTIME */}
        {activeTab === 'PAYROLL' && (
          <div className="bg-slate-900/80 p-5 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200 pb-2 border-b border-slate-800">
              <DollarSign size={16} className="text-pink-400" />
              <span>BẢNG LƯƠNG & TIẾN ĐỘ AI REALTIME</span>
            </div>

            {payroll ? (
              <div className="space-y-4">
                <div className="bg-gradient-to-br from-slate-800 to-slate-850 p-4 rounded-2xl border border-slate-700/80 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Loại nhân sự:</span>
                    <span className="font-bold text-pink-400">
                      {payroll.type === 'TRAINING' ? 'NHÂN VIÊN TRAINING (7 NGÀY)' : 'NHÂN VIÊN CHÍNH THỨC'}
                    </span>
                  </div>

                  {payroll.type === 'TRAINING' && (
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-[11px] font-bold">
                        <span className="text-slate-300">Tiến độ Training:</span>
                        <span className="text-pink-400">{payroll.completedDays}/7 Ngày</span>
                      </div>
                      <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-pink-500 to-rose-500 transition-all duration-500"
                          style={{ width: `${payroll.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-700/60 space-y-1.5 text-xs font-mono">
                    <div className="flex justify-between text-slate-300">
                      <span>Lương/Phụ cấp ca:</span>
                      <span>{(payroll.grossSalary || 0).toLocaleString('vi-VN')}đ</span>
                    </div>
                    <div className="flex justify-between text-rose-400">
                      <span>Tiền phạt trễ/vắng:</span>
                      <span>-{(payroll.totalFines || 0).toLocaleString('vi-VN')}đ</span>
                    </div>
                    <div className="flex justify-between text-emerald-400 font-bold text-sm pt-1 border-t border-slate-700/80">
                      <span>LƯƠNG DỰ TÍNH NHẬN:</span>
                      <span>{payroll.currencyStr}</span>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400 italic text-center">
                  * {payroll.summaryText}
                </p>
              </div>
            ) : (
              <div className="py-8 text-center space-y-2">
                <RefreshCw size={24} className="animate-spin mx-auto text-pink-400" />
                <p className="text-xs text-slate-400">Đang AI tính toán lương Realtime...</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
