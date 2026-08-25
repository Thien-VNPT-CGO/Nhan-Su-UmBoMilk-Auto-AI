import { useEffect, useState, useCallback } from 'react';
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
  History,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Spinner, Badge } from '../components/ui';
import { getSocket } from '../api/socket';
import { cn } from '../utils/format';
import PublicAttendance from './PublicAttendance';

interface ColleagueItem {
  id: string;
  tenUv: string;
  sdtZalo: string;
  chiNhanh?: string;
  caLam?: string;
}

interface SwapHistoryItem {
  id: string;
  candidateIdA: string;
  candidateNameA: string;
  caLamA: string;
  dateA: string;
  candidateIdB: string;
  candidateNameB: string;
  caLamB: string;
  dateB: string;
  reason: string;
  status: 'PENDING_MANAGER' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

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

function extractCandidateIdFromWindow(): string | null {
  const href = window.location.href;
  const decodedHref = decodeURIComponent(href);

  // 1. Chạy Regex tìm chuẩn format UBM_DD/MM/YYYY_NVXXXX hoặc UBM_... trong URL
  const ubmMatch = decodedHref.match(/UBM_\d{2}[\/\%2F]\d{2}[\/\%2F]\d{4}_NV\d{4}/i)
    || decodedHref.match(/UBM_[A-Za-z0-9_\/]+/i)
    || href.match(/UBM_[A-Za-z0-9_%-]+/i);

  if (ubmMatch && ubmMatch[0]) {
    let raw = decodeURIComponent(ubmMatch[0]).trim();
    raw = raw.replace(/%2F/gi, '/');
    return raw;
  }

  // 2. Query parameters (?id=... hoặc ?candidateId=... hoặc ?madv=...)
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const fromSearch = searchParams.get('id') || searchParams.get('candidateId') || searchParams.get('madv') || searchParams.get('code');
    if (fromSearch) {
      return decodeURIComponent(fromSearch).trim().replace(/%2F/gi, '/');
    }
  } catch {
    // ignore
  }

  // 3. Hash parameters (#id=...)
  if (window.location.hash) {
    try {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const fromHash = hashParams.get('id') || hashParams.get('candidateId');
      if (fromHash) {
        return decodeURIComponent(fromHash).trim().replace(/%2F/gi, '/');
      }
    } catch {
      // ignore
    }
  }

  return null;
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

  const [isAutoFilledId, setIsAutoFilledId] = useState(false);

  // Tự động nhận và gán cứng MÃ NHÂN VIÊN từ URL params (?id=UBM_...) hoặc Regex quét URL
  useEffect(() => {
    const extractedId = extractCandidateIdFromWindow();
    if (extractedId) {
      setCandidateIdInput(extractedId);
      setIsAutoFilledId(true);
      localStorage.setItem('umbomilk_last_candidate_id', extractedId);
    } else {
      const savedId = localStorage.getItem('umbomilk_last_candidate_id');
      if (savedId) {
        setCandidateIdInput(savedId);
        setIsAutoFilledId(true);
      }
    }
  }, []);

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

  // KÍCH HOẠT DUAL MECHANISM FORCE LOGOUT (Socket.io Realtime + Active Heartbeat/Focus Check)
  useEffect(() => {
    if (!session?.candidate.id) return;
    const deviceId = getDeviceId();

    // 1. Hàm kiểm tra hợp lệ phiên làm việc trực tiếp với Server
    const checkSession = async () => {
      try {
        const res = await api.post<{ valid: boolean; reason?: string }>('/public/employee/session-check', {
          candidateId: session.candidate.id,
          deviceId,
        });
        if (res && res.valid === false) {
          localStorage.removeItem('umbomilk_emp_session');
          setSession(null);
          alert(`⚡ THÔNG BÁO TỪ HỆ THỐNG AI:\n${res.reason || 'Thiết bị của bạn đã được IT Admin Reset thành công. Phiên làm việc trên máy này đã được Logout.'}`);
        }
      } catch {
        // ignore network glitches
      }
    };

    // Kiểm tra ngay khi khởi chạy
    checkSession();

    // Định kỳ 5 giây kiểm tra 1 lần (Heartbeat)
    const interval = setInterval(checkSession, 5000);

    // Kiểm tra ngay lập tức khi điện thoại mở lại màn hình / chuyển tab (Focus / Wakeup)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkSession();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    // 2. Đăng ký Socket.io Realtime Push
    const socket = getSocket();
    const handleForceLogout = (data: { candidateId: string; reason?: string }) => {
      if (!data || data.candidateId === session.candidate.id) {
        localStorage.removeItem('umbomilk_emp_session');
        setSession(null);
        alert(`⚡ THÔNG BÁO TỪ HỆ THỐNG AI:\n${data?.reason || 'Thiết bị của bạn đã được IT Admin Reset thành công. Phiên làm việc trên máy này đã được Logout.'}`);
      }
    };

    socket.on('device_key:force_logout', handleForceLogout);
    socket.on('device_reset:approved', handleForceLogout);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      socket.off('device_key:force_logout', handleForceLogout);
      socket.off('device_reset:approved', handleForceLogout);
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

  // States cho Đổi ca làm
  const [colleagues, setColleagues] = useState<ColleagueItem[]>([]);
  const [selectedColleagueId, setSelectedColleagueId] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];
  const [myDate, setMyDate] = useState(todayStr);
  const [myShift, setMyShift] = useState('SÁNG (06:00 - 14:00)');
  const [targetDate, setTargetDate] = useState(todayStr);
  const [targetShift, setTargetShift] = useState('CHIỀU (14:00 - 22:00)');
  const [swapReason, setSwapReason] = useState('');

  const [swapSubmitting, setSwapSubmitting] = useState(false);
  const [swapSuccessMsg, setSwapSuccessMsg] = useState<string | null>(null);
  const [swapErrorMsg, setSwapErrorMsg] = useState<string | null>(null);

  const [swapHistory, setSwapHistory] = useState<SwapHistoryItem[]>([]);
  const [loadingSwapHistory, setLoadingSwapHistory] = useState(false);

  // Load danh sách đồng nghiệp
  const loadColleagues = useCallback(async () => {
    try {
      const res = await api.get<ColleagueItem[]>('/public/employee/colleagues');
      const list = Array.isArray(res) ? res : Array.isArray((res as any)?.data) ? (res as any).data : [];
      setColleagues(list.filter((c: ColleagueItem) => c.id !== session?.candidate.id));
    } catch {
      // ignore
    }
  }, [session?.candidate.id]);

  // Load lịch sử đổi ca
  const loadSwapHistory = useCallback(async () => {
    if (!session?.candidate.id) return;
    setLoadingSwapHistory(true);
    try {
      const res = await api.get<SwapHistoryItem[]>(`/public/employee/shift-swap-history/${encodeURIComponent(session.candidate.id)}`);
      const list = Array.isArray(res) ? res : Array.isArray((res as any)?.data) ? (res as any).data : [];
      setSwapHistory(list);
    } catch {
      // ignore
    } finally {
      setLoadingSwapHistory(false);
    }
  }, [session?.candidate.id]);

  // Tự động nạp dữ liệu khi chuyển sang Tab SWAP
  useEffect(() => {
    if (session?.candidate.id && activeTab === 'SWAP') {
      loadColleagues();
      loadSwapHistory();
    }
  }, [activeTab, session?.candidate.id, loadColleagues, loadSwapHistory]);

  // Lắng nghe Socket.io Realtime khi có cập nhật đơn đổi ca
  useEffect(() => {
    if (!session?.candidate.id || activeTab !== 'SWAP') return;
    const socket = getSocket();
    const handleUpdate = () => {
      loadSwapHistory();
    };

    socket.on('shift_swap:created', handleUpdate);
    socket.on('shift_swap:approved', handleUpdate);
    socket.on('shift_swap:rejected', handleUpdate);

    return () => {
      socket.off('shift_swap:created', handleUpdate);
      socket.off('shift_swap:approved', handleUpdate);
      socket.off('shift_swap:rejected', handleUpdate);
    };
  }, [activeTab, session?.candidate.id, loadSwapHistory]);

  // Tạo đơn xin đổi ca
  const handleCreateSwapRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.candidate.id || !selectedColleagueId || !swapReason.trim()) return;

    setSwapSubmitting(true);
    setSwapSuccessMsg(null);
    setSwapErrorMsg(null);

    try {
      await api.post('/public/employee/shift-swap-request', {
        candidateIdA: session.candidate.id,
        caLamA: myShift,
        dateA: myDate,
        candidateIdB: selectedColleagueId,
        caLamB: targetShift,
        dateB: targetDate,
        reason: swapReason.trim(),
      });

      setSwapSuccessMsg('🎉 Gửi đơn xin đổi ca thành công! Đơn đã được chuyển trực tiếp tới Quản lý cửa hàng.');
      setSwapReason('');
      setSelectedColleagueId('');
      loadSwapHistory();
    } catch (err) {
      setSwapErrorMsg(err instanceof ApiError ? err.message : 'Tạo đơn xin đổi ca thất bại.');
    } finally {
      setSwapSubmitting(false);
    }
  };

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

            {/* Input Mã Nhân Viên */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  MÃ NHÂN VIÊN (GÁN CỨNG)
                </label>
                {isAutoFilledId && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/50 px-2 py-0.5 rounded-full flex items-center gap-1">
                      ✓ TỰ ĐỘNG ĐIỀN
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAutoFilledId(false)}
                      className="text-[10px] font-semibold text-slate-400 hover:text-pink-400 underline"
                    >
                      (Sửa Mã)
                    </button>
                  </div>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={candidateIdInput}
                  onChange={(e) => setCandidateIdInput(e.target.value)}
                  readOnly={isAutoFilledId}
                  placeholder="Ví dụ: UBM_25/08/2026_NV0008"
                  className={cn(
                    'w-full border rounded-2xl px-4 py-3 text-xs text-white placeholder:text-slate-500 outline-none font-mono font-bold transition-all',
                    isAutoFilledId
                      ? 'bg-emerald-950/20 border-emerald-500/80 text-emerald-300 ring-2 ring-emerald-500/30 cursor-not-allowed'
                      : 'bg-slate-800/90 border-slate-700 focus:border-pink-500'
                  )}
                  required
                />
                <User size={16} className={cn('absolute right-4 top-1/2 -translate-y-1/2', isAutoFilledId ? 'text-emerald-400' : 'text-slate-500')} />
              </div>
              {isAutoFilledId && (
                <p className="text-[10px] text-emerald-400/90 font-medium pt-0.5">
                  🔒 Mã NV của bạn đã được gán cứng tự động theo đúng đường link HR gửi. Vui lòng nhập Key Kích Hoạt bên dưới.
                </p>
              )}
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

        {/* TAB 3: HOÁN ĐỔI CA LÀM LINH HOẠT REALTIME */}
        {activeTab === 'SWAP' && (
          <div className="space-y-4">
            {/* Header & Form Đổi ca */}
            <div className="bg-slate-900/80 p-5 rounded-3xl border border-slate-800 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200 pb-2 border-b border-slate-800">
                <ArrowRightLeft size={16} className="text-pink-400" />
                <span>HOÁN ĐỔI CA LÀM LINH HOẠT (REALTIME)</span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Tạo đơn xin hoán đổi ca làm với đồng nghiệp. Đơn sẽ gửi trực tiếp đến màn hình Phê duyệt của Quản lý cửa hàng theo thời gian thực.
              </p>

              {swapSuccessMsg && (
                <div className="bg-emerald-950/80 border border-emerald-500/60 p-3 rounded-2xl text-xs text-emerald-200 flex items-start gap-2">
                  <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-400" />
                  <span>{swapSuccessMsg}</span>
                </div>
              )}
              {swapErrorMsg && (
                <div className="bg-rose-950/80 border border-rose-500/60 p-3 rounded-2xl text-xs text-rose-200 flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-400" />
                  <span>{swapErrorMsg}</span>
                </div>
              )}

              <form onSubmit={handleCreateSwapRequest} className="space-y-3">
                {/* 1. Chọn Ca & Ngày làm của bạn */}
                <div className="bg-slate-800/80 p-3.5 rounded-2xl border border-slate-700/80 space-y-2">
                  <label className="text-[11px] font-bold text-pink-400 uppercase tracking-wider block">
                    1. CA LÀM & NGÀY CỦA BẠN (CẦN ĐỔI)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-slate-400 font-semibold block mb-1">Ngày làm:</span>
                      <input
                        type="date"
                        value={myDate}
                        onChange={(e) => setMyDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-pink-500"
                        required
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-semibold block mb-1">Ca làm:</span>
                      <select
                        value={myShift}
                        onChange={(e) => setMyShift(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-pink-500"
                      >
                        <option value="SÁNG (06:00 - 14:00)">SÁNG (06:00 - 14:00)</option>
                        <option value="CHIỀU (14:00 - 22:00)">CHIỀU (14:00 - 22:00)</option>
                        <option value="HÀNH CHÍNH (08:00 - 17:00)">HÀNH CHÍNH (08:00 - 17:00)</option>
                        <option value="TỐI (18:00 - 22:00)">TỐI (18:00 - 22:00)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 2. Chọn Đồng nghiệp & Ca làm muốn nhận */}
                <div className="bg-slate-800/80 p-3.5 rounded-2xl border border-slate-700/80 space-y-2">
                  <label className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block">
                    2. ĐỒNG NGHIỆP & CA LÀM MUỐN NHẬN
                  </label>
                  
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold block mb-1">Chọn Đồng nghiệp:</span>
                    <select
                      value={selectedColleagueId}
                      onChange={(e) => setSelectedColleagueId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                      required
                    >
                      <option value="">-- Bấm để chọn Đồng Nghiệp --</option>
                      {colleagues.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.tenUv} ({c.sdtZalo}) - {c.chiNhanh || 'Chi nhánh'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <div>
                      <span className="text-[10px] text-slate-400 font-semibold block mb-1">Ngày làm đồng nghiệp:</span>
                      <input
                        type="date"
                        value={targetDate}
                        onChange={(e) => setTargetDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                        required
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-semibold block mb-1">Ca làm đồng nghiệp:</span>
                      <select
                        value={targetShift}
                        onChange={(e) => setTargetShift(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                      >
                        <option value="CHIỀU (14:00 - 22:00)">CHIỀU (14:00 - 22:00)</option>
                        <option value="SÁNG (06:00 - 14:00)">SÁNG (06:00 - 14:00)</option>
                        <option value="HÀNH CHÍNH (08:00 - 17:00)">HÀNH CHÍNH (08:00 - 17:00)</option>
                        <option value="TỐI (18:00 - 22:00)">TỐI (18:00 - 22:00)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 3. Lý do đổi ca */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    3. LÝ DO XIN ĐỔI CA
                  </label>
                  <textarea
                    rows={2}
                    value={swapReason}
                    onChange={(e) => setSwapReason(e.target.value)}
                    placeholder="Vui lòng nhập lý do đổi ca (ví dụ: bận việc gia đình, đổi ca trực trùng...)..."
                    className="w-full bg-slate-800/90 border border-slate-700 focus:border-pink-500 rounded-2xl p-3 text-xs text-white outline-none"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={swapSubmitting || !selectedColleagueId || !swapReason.trim()}
                  className="w-full py-3 rounded-full text-xs font-black bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {swapSubmitting ? <Spinner size={16} /> : <Send size={15} />}
                  <span>GỬI ĐƠN XIN ĐỔI CA CHO QUẢN LÝ</span>
                </button>
              </form>
            </div>

            {/* Lịch sử Đổi Ca */}
            <div className="bg-slate-900/80 p-5 rounded-3xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                  <History size={16} className="text-emerald-400" />
                  <span>LỊCH SỬ ĐƠN ĐỔI CA CỦA BẠN ({swapHistory.length})</span>
                </div>
                <button
                  type="button"
                  onClick={loadSwapHistory}
                  className="text-[11px] font-semibold text-slate-400 hover:text-white"
                >
                  ↻ Làm mới
                </button>
              </div>

              {loadingSwapHistory ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  <Spinner size={16} className="mx-auto text-pink-500 mb-1" />
                  Đang tải lịch sử đổi ca...
                </div>
              ) : swapHistory.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 italic">
                  Bạn chưa tạo hoặc có đơn xin đổi ca nào.
                </div>
              ) : (
                <div className="space-y-3">
                  {swapHistory.map((item) => (
                    <div key={item.id} className="bg-slate-800/80 p-3.5 rounded-2xl border border-slate-700/80 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-[11px] text-slate-400">#{item.id}</span>
                        <Badge
                          className={
                            item.status === 'APPROVED'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50'
                              : item.status === 'REJECTED'
                                ? 'bg-rose-950 text-rose-300 border border-rose-500/50'
                                : 'bg-amber-950 text-amber-300 border border-amber-500/50'
                          }
                        >
                          {item.status === 'APPROVED'
                            ? '✅ Quản lý Đã Duyệt'
                            : item.status === 'REJECTED'
                              ? '❌ Đã Từ Chối'
                              : '⏳ Chờ QL Cửa Hàng Duyệt'}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 bg-slate-900/60 p-2.5 rounded-xl text-[11px]">
                        <div>
                          <div className="text-slate-400 font-semibold">Người gửi (Bạn):</div>
                          <div className="font-bold text-pink-300">{item.candidateNameA}</div>
                          <div className="text-slate-300">{item.dateA} ({item.caLamA})</div>
                        </div>
                        <div>
                          <div className="text-slate-400 font-semibold">Đồng nghiệp:</div>
                          <div className="font-bold text-amber-300">{item.candidateNameB}</div>
                          <div className="text-slate-300">{item.dateB} ({item.caLamB})</div>
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-400 italic">
                        Lý do: "{item.reason}"
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
