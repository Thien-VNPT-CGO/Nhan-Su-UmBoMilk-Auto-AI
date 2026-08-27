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
  Sun,
  Moon,
  Calendar,
  CalendarDays,
} from 'lucide-react';
import { useTheme } from '../utils/theme';
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
  const { theme, toggleTheme } = useTheme();
  const [candidateIdInput, setCandidateIdInput] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [session, setSession] = useState<EmployeeSession | null>(null);
  const [activeTab, setActiveTab] = useState<'ATTENDANCE' | 'LEAVE_48H' | 'SHIFTS' | 'PAYROLL' | 'DEVICE'>('ATTENDANCE');

  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // States cho Reset thiết bị / Đổi máy Gửi IT Admin
  const [resetReason, setResetReason] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);
  const [resetErrorMsg, setResetErrorMsg] = useState<string | null>(null);

  // States cho Xin Nghỉ Phép (Quy tắc 48h)
  const tomorrowStr = new Date(Date.now() + 3 * 86400 * 1000).toISOString().split('T')[0];
  const [leaveDate, setLeaveDate] = useState(tomorrowStr);
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveSuccessMsg, setLeaveSuccessMsg] = useState<string | null>(null);
  const [leaveErrorMsg, setLeaveErrorMsg] = useState<string | null>(null);

  // States cho Lịch Làm Việc Realtime 1:1
  const [monthlyShifts, setMonthlyShifts] = useState<Array<{ date: string; shifts: string; note?: string }>>([]);
  const [loadingMonthlyShifts, setLoadingMonthlyShifts] = useState(false);

  // State cho Realtime Expiration đề xuất bù ca (1-click first come first served)
  const [expiredReplacements, setExpiredReplacements] = useState<Map<string, string>>(new Map());

  // States cho Lương AI
  const [payroll, setPayroll] = useState<PayrollData | null>(null);

  // States cho Đổi ca làm
  const [colleagues, setColleagues] = useState<ColleagueItem[]>([]);
  const [selectedColleagueId, setSelectedColleagueId] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];
  const [myDate, setMyDate] = useState(todayStr);
  const [myShift, setMyShift] = useState('SÁNG (07:00 - 12:00)');
  const [myShiftSource, setMyShiftSource] = useState('');
  const [targetDate, setTargetDate] = useState(todayStr);
  const [targetShift, setTargetShift] = useState('CHIỀU (12:00 - 18:00)');
  const [targetShiftSource, setTargetShiftSource] = useState('');
  const [swapReason, setSwapReason] = useState('');

  const [swapSubmitting, setSwapSubmitting] = useState(false);
  const [swapSuccessMsg, setSwapSuccessMsg] = useState<string | null>(null);
  const [swapErrorMsg, setSwapErrorMsg] = useState<string | null>(null);

  const [swapHistory, setSwapHistory] = useState<SwapHistoryItem[]>([]);
  const [loadingSwapHistory, setLoadingSwapHistory] = useState(false);

  // Tra cứu ca làm việc chuẩn từ Web HR cho bản thân
  const fetchMyShiftSchedule = useCallback(async (cId: string, date: string) => {
    if (!cId || !date) return;
    try {
      const res = await api.get<{ formattedShift: string; source: string }>(`/public/employee/shift-schedule?candidateId=${encodeURIComponent(cId)}&date=${date}`);
      const data = (res as any)?.data || res;
      if (data?.formattedShift) {
        setMyShift(data.formattedShift);
        setMyShiftSource(data.source === 'WEB_HR_SCHEDULE' ? 'Lịch trực chốt từ Web HR' : 'Ca làm mặc định hồ sơ HR');
      }
    } catch {
      // ignore
    }
  }, []);

  // Tra cứu ca làm việc chuẩn từ Web HR cho Đồng nghiệp
  const fetchTargetShiftSchedule = useCallback(async (cId: string, date: string) => {
    if (!cId || !date) return;
    try {
      const res = await api.get<{ formattedShift: string; source: string }>(`/public/employee/shift-schedule?candidateId=${encodeURIComponent(cId)}&date=${date}`);
      const data = (res as any)?.data || res;
      if (data?.formattedShift) {
        setTargetShift(data.formattedShift);
        setTargetShiftSource(data.source === 'WEB_HR_SCHEDULE' ? 'Lịch trực chốt từ Web HR' : 'Ca làm mặc định hồ sơ HR');
      }
    } catch {
      // ignore
    }
  }, []);

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

  const [pendingReplacements, setPendingReplacements] = useState<any[]>([]);

  const loadPendingReplacements = useCallback(async () => {
    if (!session?.candidate.id) return;
    try {
      const res = await api.get<any[]>(`/public/employee/replacements/${encodeURIComponent(session.candidate.id)}`);
      const list = (res as any)?.data || res;
      setPendingReplacements(Array.isArray(list) ? list : []);
    } catch {
      // ignore
    }
  }, [session?.candidate.id]);

  const handleRespondReplacementEmp = async (replacementId: string, action: 'ACCEPT' | 'REJECT') => {
    if (!session?.candidate.id) return;
    try {
      await api.post('/public/employee/replacements/respond', {
        replacementId,
        action,
        candidateId: session.candidate.id,
      });
      alert(action === 'ACCEPT' ? '✅ Cảm ơn bạn! Bạn đã xác nhận trực thay ca thành công.' : '❌ Bạn đã từ chối nhận ca. AI sẽ tự động đề xuất nhân viên tiếp theo.');
      await loadPendingReplacements();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    }
  };

  useEffect(() => {
    if (session?.candidate.id) {
      loadPendingReplacements();
    }
  }, [session?.candidate.id, loadPendingReplacements]);

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

    // Định kỳ 15 giây kiểm tra 1 lần (Heartbeat)
    const interval = setInterval(checkSession, 15000);

    // Kiểm tra ngay lập tức khi điện thoại mở lại màn hình / chuyển tab (Focus / Wakeup)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkSession();
        loadPendingReplacements();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    // 2. Đăng ký Socket.io Realtime Push từ Web HR
    const socket = getSocket();
    const handleForceLogout = (data: { candidateId: string; reason?: string }) => {
      if (!data || data.candidateId === session.candidate.id) {
        localStorage.removeItem('umbomilk_emp_session');
        setSession(null);
        alert(`⚡ THÔNG BÁO TỪ HỆ THỐNG AI:\n${data?.reason || 'Thiết bị của bạn đã được IT Admin Reset thành công. Phiên làm việc trên máy này đã được Logout.'}`);
      }
    };

    const handleRealtimeWebHRSync = () => {
      checkSession();
      loadPendingReplacements();
      if (session?.candidate.id && myDate) {
        fetchMyShiftSchedule(session.candidate.id, myDate);
      }
    };

    const handleReplacementExpired = (data: { replacementId: string; acceptedByName: string }) => {
      if (data?.replacementId) {
        setExpiredReplacements((prev) => new Map(prev).set(data.replacementId, data.acceptedByName || 'Đồng nghiệp'));
        loadPendingReplacements();
      }
    };

    socket.on('device_key:force_logout', handleForceLogout);
    socket.on('device_reset:approved', handleForceLogout);
    socket.on('candidate:updated', handleRealtimeWebHRSync);
    socket.on('shift:updated', handleRealtimeWebHRSync);
    socket.on('training:updated', handleRealtimeWebHRSync);
    socket.on('attendance:updated', handleRealtimeWebHRSync);
    socket.on('shift_swap:approved', handleRealtimeWebHRSync);
    socket.on('shift_replacement:updated', handleRealtimeWebHRSync);
    socket.on('shift_replacement:expired', handleReplacementExpired);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      socket.off('device_key:force_logout', handleForceLogout);
      socket.off('device_reset:approved', handleForceLogout);
      socket.off('candidate:updated', handleRealtimeWebHRSync);
      socket.off('shift:updated', handleRealtimeWebHRSync);
      socket.off('training:updated', handleRealtimeWebHRSync);
      socket.off('attendance:updated', handleRealtimeWebHRSync);
      socket.off('shift_swap:approved', handleRealtimeWebHRSync);
      socket.off('shift_replacement:updated', handleRealtimeWebHRSync);
      socket.off('shift_replacement:expired', handleReplacementExpired);
    };
  }, [session?.candidate.id, myDate, fetchMyShiftSchedule, loadPendingReplacements]);

  // Load Lịch Làm Việc Realtime 1:1 khi chuyển sang Tab SHIFTS
  const loadMonthlyShifts = useCallback(async () => {
    if (!session?.candidate.id) return;
    setLoadingMonthlyShifts(true);
    try {
      const now = new Date();
      const m = now.getMonth() + 1;
      const y = now.getFullYear();
      const res = await api.get<{ shifts: Array<{ date: string; shifts: string; note?: string }> }>(
        `/shifts/monthly-calendar?candidateId=${encodeURIComponent(session.candidate.id)}&month=${m}&year=${y}`
      );
      setMonthlyShifts(Array.isArray(res) ? res : (res as any)?.shifts || []);
    } catch {
      // ignore
    } finally {
      setLoadingMonthlyShifts(false);
    }
  }, [session?.candidate.id]);

  useEffect(() => {
    if (session?.candidate.id && activeTab === 'SHIFTS') {
      loadMonthlyShifts();
    }
  }, [activeTab, session?.candidate.id, loadMonthlyShifts]);

  // Tạo phiếu Xin Nghỉ Phép (Quy tắc 48h Cứng)
  const handleCreateLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.candidate.id || !leaveDate || !leaveReason.trim()) return;

    setLeaveSubmitting(true);
    setLeaveSuccessMsg(null);
    setLeaveErrorMsg(null);

    try {
      const res = await api.post<{ message: string }>('/public/employee/leave-request', {
        candidateId: session.candidate.id,
        date: leaveDate,
        reason: leaveReason.trim(),
      });

      setLeaveSuccessMsg(res.message || '✅ Đã gửi phiếu xin nghỉ phép 48h thành công!');
      setLeaveReason('');
      if (activeTab === 'SHIFTS') loadMonthlyShifts();
    } catch (err) {
      setLeaveErrorMsg(err instanceof ApiError ? err.message : 'Tạo phiếu xin nghỉ phép thất bại.');
    } finally {
      setLeaveSubmitting(false);
    }
  };

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

            {/* Input Mã Nhân Viên */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  MÃ NHÂN VIÊN (CỐ ĐỊNH TỰ ĐỘNG)
                </label>
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/50 px-2 py-0.5 rounded-full flex items-center gap-1">
                  🔒 CỐ ĐỊNH VỚI WEB HR
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={candidateIdInput}
                  onChange={(e) => setCandidateIdInput(e.target.value)}
                  readOnly={true}
                  placeholder="Ví dụ: UBM_25/08/2026_NV0008"
                  className="w-full border rounded-2xl px-4 py-3 text-xs text-emerald-300 bg-emerald-950/20 border-emerald-500/80 ring-2 ring-emerald-500/30 outline-none font-mono font-bold transition-all cursor-not-allowed"
                  required
                />
                <User size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-400" />
              </div>
              <p className="text-[10px] text-emerald-400/90 font-medium pt-0.5 flex items-center gap-1">
                <Lock size={11} className="shrink-0" />
                <span>Mã NV của bạn đã được gán cố định tự động theo đúng hồ sơ Web HR. Vui lòng nhập Key Kích Hoạt bên dưới.</span>
              </p>
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="bg-slate-800/80 hover:bg-slate-700 text-slate-300 p-2.5 rounded-2xl border border-slate-700 transition-colors cursor-pointer"
              title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
            >
              {theme === 'dark' ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-indigo-400" />}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-400 p-2.5 rounded-2xl border border-slate-700 transition-colors cursor-pointer"
              title="Đăng xuất"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        {/* Banner Thông Báo Trực Thay Ca (Phương Án 1 - Bù ca Đa Tầng + Realtime Expiration 1-Click) */}
        {pendingReplacements.length > 0 && (
          <div className="space-y-3">
            {pendingReplacements.map((rep) => {
              const expiredByName = expiredReplacements.get(rep.id);
              const isExpired = Boolean(expiredByName);

              return (
                <div
                  key={rep.id}
                  className={cn(
                    'border-2 rounded-3xl p-4 shadow-xl space-y-2.5 transition-all',
                    isExpired
                      ? 'bg-slate-900/90 border-slate-700 text-slate-400 opacity-75'
                      : 'bg-gradient-to-br from-amber-950/90 to-rose-950/90 border-amber-500/80 text-amber-100'
                  )}
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 font-extrabold text-amber-300">
                      {!isExpired && <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />}
                      <span>YÊU CẦU TRỰC THAY CA (PHƯƠNG ÁN 1 ĐA TẦNG)</span>
                    </div>
                    {isExpired && (
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono border border-slate-700">
                        ĐÃ HẾT HẠN
                      </span>
                    )}
                  </div>

                  {isExpired ? (
                    <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 text-xs text-amber-300 font-bold flex items-center gap-2">
                      <AlertCircle size={16} className="text-amber-400 shrink-0" />
                      <span>⚠️ Ca thay thế này đã được đồng nghiệp <strong>{expiredByName}</strong> chấp nhận trước đó.</span>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-100/90 leading-relaxed font-medium">
                      Bạn được AI đề xuất trực thay cho <strong>{rep.candidateNameA}</strong> ca <strong>{rep.shiftCode}</strong> ngày <strong>{rep.date}</strong> tại Chi nhánh <strong>{rep.chiNhanh}</strong>.
                    </p>
                  )}

                  {!isExpired && (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleRespondReplacementEmp(rep.id, 'ACCEPT')}
                        className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black py-2.5 px-3 rounded-2xl text-xs shadow-lg transition-all cursor-pointer text-center active:scale-98"
                      >
                        ✅ ĐỒNG Ý NHẬN CA
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRespondReplacementEmp(rep.id, 'REJECT')}
                        className="flex-1 bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 font-bold py-2.5 px-3 rounded-2xl text-xs border border-slate-700 transition-all cursor-pointer text-center"
                      >
                        ❌ TỪ CHỐI
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Tab Selector Buttons (5 TAB MODERN PINK) */}
        <div className="grid grid-cols-5 gap-1 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800 shadow-xl">
          <button
            type="button"
            onClick={() => setActiveTab('ATTENDANCE')}
            className={`py-2 px-1 rounded-xl text-[10px] font-black flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'ATTENDANCE'
                ? 'bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-lg shadow-pink-500/40 scale-102'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock size={15} />
            <span>Điểm danh</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('LEAVE_48H')}
            className={`py-2 px-1 rounded-xl text-[10px] font-black flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'LEAVE_48H'
                ? 'bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-lg shadow-pink-500/40 scale-102'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Calendar size={15} />
            <span>Xin nghỉ 48h</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('SHIFTS')}
            className={`py-2 px-1 rounded-xl text-[10px] font-black flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'SHIFTS'
                ? 'bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-lg shadow-pink-500/40 scale-102'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <CalendarDays size={15} />
            <span>Lịch xem 1:1</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('PAYROLL')}
            className={`py-2 px-1 rounded-xl text-[10px] font-black flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'PAYROLL'
                ? 'bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-lg shadow-pink-500/40 scale-102'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <DollarSign size={15} />
            <span>Lương AI</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('DEVICE')}
            className={`py-2 px-1 rounded-xl text-[10px] font-black flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'DEVICE'
                ? 'bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-lg shadow-pink-500/40 scale-102'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone size={15} />
            <span>Đổi máy</span>
          </button>
        </div>

        {/* TAB 1: ĐIỂM DANH CHECK-IN / CHECK-OUT */}
        {activeTab === 'ATTENDANCE' && (
          <div className="space-y-4">
            <PublicAttendance propCandidateId={session.candidate.id} />
          </div>
        )}

        {/* TAB 2: XIN NGHỈ PHÉP (QUY TẮC 48H CỨNG) */}
        {activeTab === 'LEAVE_48H' && (
          <div className="bg-slate-900/90 backdrop-blur-2xl p-5 rounded-3xl border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-black text-white uppercase tracking-wider">
                <div className="p-1.5 rounded-xl bg-pink-500/20 text-pink-400 border border-pink-500/30">
                  <Calendar size={16} />
                </div>
                <span>TẠO PHIẾU XIN NGHỈ PHÉP (QUY TẮC 48H)</span>
              </div>
              <span className="text-[10px] font-black text-pink-400 bg-pink-950/80 border border-pink-500/40 px-2.5 py-0.5 rounded-full">
                48H STAGE
              </span>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
              Nhân viên tạo phiếu nghỉ phép trước ít nhất <strong>48 giờ (2 ngày)</strong>. AI sẽ tự động duyệt và chuyển ca làm việc sang luồng đề xuất bù ca cho đồng nghiệp rảnh.
            </p>

            {leaveSuccessMsg && (
              <div className="bg-emerald-950/90 border border-emerald-500/70 p-3.5 rounded-2xl text-xs text-emerald-200 flex items-start gap-2 shadow-lg">
                <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-400" />
                <span className="font-semibold">{leaveSuccessMsg}</span>
              </div>
            )}
            {leaveErrorMsg && (
              <div className="bg-rose-950/90 border border-rose-500/70 p-3.5 rounded-2xl text-xs text-rose-200 flex items-start gap-2 shadow-lg">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-400" />
                <span className="font-semibold">{leaveErrorMsg}</span>
              </div>
            )}

            {/* Realtime 48h Validation Check */}
            {(() => {
              const targetStart = new Date(`${leaveDate}T07:00:00`);
              const now = new Date();
              const diffHours = (targetStart.getTime() - now.getTime()) / (1000 * 3600);
              const isValid48h = diffHours >= 48;

              return (
                <form onSubmit={handleCreateLeaveRequest} className="space-y-4">
                  <div>
                    <label className="text-[11px] font-extrabold text-pink-300 uppercase tracking-wider block mb-1">
                      1. Chọn Ngày Xin Nghỉ Phép:
                    </label>
                    <input
                      type="date"
                      value={leaveDate}
                      onChange={(e) => setLeaveDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500/50 [color-scheme:dark] font-mono font-bold"
                      required
                    />
                  </div>

                  {/* 48h Badge Alert */}
                  {isValid48h ? (
                    <div className="bg-emerald-950/80 border border-emerald-500/50 p-3 rounded-2xl text-xs text-emerald-300 font-semibold flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                      <span>✅ ĐỦ ĐIỀU KIỆN 48H: Thời gian xin nghỉ trước ca {Math.floor(diffHours)} giờ (đạt tiêu chuẩn ≥ 48h).</span>
                    </div>
                  ) : (
                    <div className="bg-rose-950/80 border border-rose-500/50 p-3 rounded-2xl text-xs text-rose-300 font-semibold flex items-start gap-2">
                      <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                      <span>❌ CHƯA ĐỦ ĐIỀU KIỆN 48H: Thời gian còn {Math.max(0, Math.floor(diffHours))} giờ (&lt; 48h). Phiếu phải tạo trước ít nhất 48 giờ so với giờ ca làm!</span>
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] font-extrabold text-slate-300 uppercase tracking-wider block mb-1">
                      2. Lý Do Xin Nghỉ Phép:
                    </label>
                    <textarea
                      rows={3}
                      value={leaveReason}
                      onChange={(e) => setLeaveReason(e.target.value)}
                      placeholder="Nhập lý do xin nghỉ (ví dụ: bận việc gia đình, lý do cá nhân...)..."
                      className="w-full bg-slate-950 border border-slate-700 focus:border-pink-500 focus:ring-1 focus:ring-pink-500/50 rounded-2xl p-3 text-xs text-white outline-none placeholder:text-slate-500"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={leaveSubmitting || !isValid48h || !leaveReason.trim()}
                    className="w-full py-3.5 rounded-2xl text-xs font-black bg-gradient-to-r from-pink-600 via-rose-600 to-pink-500 hover:from-pink-500 hover:to-rose-500 text-white shadow-xl shadow-pink-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {leaveSubmitting ? <Spinner size={16} /> : <Send size={15} />}
                    <span>GỬI PHIẾU XIN NGHỈ PHÉP 48H AI DUYỆT</span>
                  </button>
                </form>
              );
            })()}
          </div>
        )}

        {/* TAB 3: HIỂN THỊ LỊCH LÀM VIỆC REALTIME 1:1 VỚI WEB HR */}
        {activeTab === 'SHIFTS' && (
          <div className="bg-slate-900/90 backdrop-blur-2xl p-5 rounded-3xl border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-black text-white uppercase tracking-wider">
                <div className="p-1.5 rounded-xl bg-pink-500/20 text-pink-400 border border-pink-500/30">
                  <CalendarDays size={16} />
                </div>
                <span>LỊCH LÀM VIỆC THÁNG (REALTIME 1:1 WEB HR)</span>
              </div>
              <span className="text-[10px] font-extrabold text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                🟢 READ-ONLY 1:1
              </span>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
              Lịch phân công trực thuộc Chi nhánh <strong>{session.candidate.chiNhanh}</strong>. Tự động đồng bộ Realtime 1:1 với Web HR khi HR xếp lịch hoặc khi bạn Check-in/Check-out.
            </p>

            {loadingMonthlyShifts ? (
              <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                <Spinner size={18} className="mx-auto text-pink-500" />
                <p>Đang tải dữ liệu Lịch Realtime 1:1...</p>
              </div>
            ) : monthlyShifts.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 italic">
                Chưa có dữ liệu lịch làm việc cho tháng này.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {monthlyShifts.map((item) => {
                  const isOff = item.shifts === 'OFF';
                  return (
                    <div
                      key={item.date}
                      className={cn(
                        'p-3 rounded-2xl border text-xs flex items-center justify-between transition-all',
                        isOff
                          ? 'bg-rose-950/40 border-rose-900/50 text-rose-300'
                          : 'bg-slate-950/80 border-slate-800 text-slate-200'
                      )}
                    >
                      <div className="space-y-0.5">
                        <div className="font-mono font-bold text-xs text-white">{item.date}</div>
                        {item.note && <div className="text-[10px] text-slate-400 italic">{item.note}</div>}
                      </div>
                      <Badge className={isOff ? 'bg-rose-900/80 text-rose-200 border-rose-700' : 'bg-emerald-900/80 text-emerald-200 border-emerald-700 font-bold'}>
                        {isOff ? '☕ OFF (Nghỉ)' : `🌅 Ca ${item.shifts}`}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: YÊU CẦU ĐỔI MÁY / RESET KEY GỬI IT ADMIN */}
        {activeTab === 'DEVICE' && (
          <div className="bg-slate-900/90 backdrop-blur-2xl p-5 rounded-3xl border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-black text-white uppercase tracking-wider">
                <div className="p-1.5 rounded-xl bg-pink-500/20 text-pink-400 border border-pink-500/30">
                  <Smartphone size={16} />
                </div>
                <span>TẠO PHIẾU XIN ĐỔI MÁY / RESET KEY</span>
              </div>
              <span className="text-[10px] font-black text-amber-400 bg-amber-950/80 border border-amber-500/40 px-2.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                🔑 GỬI IT ADMIN
              </span>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
              Khi bạn mua điện thoại mới hoặc cần chuyển sang thiết bị khác, hãy điền lý do bên dưới để gửi phiếu xin Reset Key. <strong>IT Admin và Quản lý</strong> sẽ nhận phiếu Realtime để duyệt & cấp Key Reset thiết bị mới cho bạn.
            </p>

            {/* Thông tin thiết bị gán cứng */}
            <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 space-y-2 font-mono text-xs shadow-inner">
              <div className="text-[10px] font-sans font-bold text-pink-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Smartphone size={13} />
                <span>THÔNG TIN THIẾT BỊ ĐANG GÁN CỨNG (DEVICE LOCK):</span>
              </div>
              <div className="flex justify-between border-b border-slate-800/60 pb-1 text-slate-300">
                <span className="text-slate-400 font-sans">Loại Key:</span>
                <span className="font-bold text-pink-400">{session.keyInfo.type}</span>
              </div>
              <div className="flex justify-between border-b border-slate-800/60 pb-1 text-slate-300">
                <span className="text-slate-400 font-sans">Mã Key Kích Hoạt:</span>
                <span className="font-bold text-white">{session.keyInfo.key}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400 font-sans">Mã Thiết Bị (Device ID):</span>
                <span className="font-bold text-emerald-400 truncate max-w-[180px]">{session.keyInfo.deviceId}</span>
              </div>
            </div>

            {resetSuccessMsg && (
              <div className="bg-emerald-950/90 border border-emerald-500/70 p-3.5 rounded-2xl text-xs text-emerald-200 flex items-start gap-2 shadow-lg">
                <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-400" />
                <span className="font-semibold">{resetSuccessMsg}</span>
              </div>
            )}
            {resetErrorMsg && (
              <div className="bg-rose-950/90 border border-rose-500/70 p-3.5 rounded-2xl text-xs text-rose-200 flex items-start gap-2 shadow-lg">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-400" />
                <span className="font-semibold">{resetErrorMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateResetTicket} className="space-y-4 pt-1">
              <div>
                <label className="text-[11px] font-extrabold text-pink-300 uppercase tracking-wider block mb-1">
                  Nhập Lý Do Đổi Máy / Reset Key:
                </label>
                <textarea
                  rows={3.5}
                  value={resetReason}
                  onChange={(e) => setResetReason(e.target.value)}
                  placeholder="Nhập chi tiết lý do (ví dụ: vừa đổi sang iPhone mới, điện thoại cũ bị hỏng màn hình, bán máy cũ...)..."
                  className="w-full bg-slate-950 border border-slate-700 focus:border-pink-500 focus:ring-1 focus:ring-pink-500/50 rounded-2xl p-3.5 text-xs text-white outline-none placeholder:text-slate-500 transition-all"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={resetSubmitting || !resetReason.trim()}
                className="w-full py-3.5 rounded-2xl text-xs font-black bg-gradient-to-r from-pink-600 via-rose-600 to-amber-600 hover:from-pink-500 hover:to-amber-500 text-white shadow-xl shadow-pink-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetSubmitting ? <Spinner size={16} /> : <Send size={15} />}
                <span>🚀 GỬI PHIẾU YÊU CẦU RESET KEY CHO IT ADMIN</span>
              </button>
            </form>
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
