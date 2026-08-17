import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, BrainCircuit, GraduationCap, CalendarDays, ClipboardCheck,
  MessageCircle, RefreshCw, FileSpreadsheet, ScrollText, Settings as SettingsIcon,
  LogOut, Milk, Wifi, WifiOff, Database, Cpu, Circle,
} from 'lucide-react';
import { useAuth } from '../stores/auth';
import { useToast } from '../stores/Toast';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import { cn } from '../utils/format';
import { debounce } from '../utils/debounce';
import { formatDate, weekdayVi } from '../utils/date';

const NAV = [
  { to: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { to: '/candidates', label: 'Ứng viên', icon: Users },
  { to: '/scoring', label: 'AI chấm hồ sơ', icon: BrainCircuit },
  { to: '/training', label: 'Đào tạo', icon: GraduationCap },
  { to: '/shifts', label: 'Lịch làm việc', icon: CalendarDays },
  { to: '/attendance', label: 'Điểm danh', icon: ClipboardCheck },
  { to: '/zalo', label: 'Zalo', icon: MessageCircle },
  { to: '/sync', label: 'Đồng bộ dữ liệu', icon: RefreshCw },
  { to: '/audit', label: 'Nhật ký', icon: ScrollText },
  { to: '/settings', label: 'Cài đặt', icon: SettingsIcon },
];

interface SyncCounts {
  PENDING: number;
  PROCESSING: number;
  SYNCED: number;
  RETRY: number;
  FAILED: number;
  CONFLICT: number;
  TOTAL: number;
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useSyncCounts() {
  const [counts, setCounts] = useState<SyncCounts | null>(null);
  useEffect(() => {
    const load = () => {
      api.get<SyncCounts & { rows: unknown[]; total: number }>('/sync?limit=1')
        .then((d) => setCounts({ ...d }))
        .catch(() => undefined);
    };
    const debounced = debounce(load, 800);
    load();
    const t = setInterval(load, 15000);
    const socket = getSocket();
    socket.on('sync:status', debounced);
    socket.on('sync:success', debounced);
    socket.on('sync:failed', debounced);
    socket.on('sync:conflict', debounced);
    return () => {
      clearInterval(t);
      socket.off('sync:status', debounced);
      socket.off('sync:success', debounced);
      socket.off('sync:failed', debounced);
      socket.off('sync:conflict', debounced);
      debounced.cancel();
    };
  }, []);
  return counts;
}

function useHealth() {
  const [health, setHealth] = useState<{ database: boolean; googleSheet: boolean; ai: boolean; zalo: boolean; demoMode: boolean } | null>(null);
  useEffect(() => {
    const load = () => {
      api.get<{ database: boolean; googleSheet: boolean; ai: boolean; zalo: boolean; demoMode: boolean }>('/settings/health')
        .then(setHealth)
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  return health;
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const now = useClock();
  const counts = useSyncCounts();
  const health = useHealth();

  const pendingTotal = (counts?.PENDING ?? 0) + (counts?.RETRY ?? 0) + (counts?.PROCESSING ?? 0);
  const syncError = (counts?.FAILED ?? 0) > 0;
  const syncConflict = (counts?.CONFLICT ?? 0) > 0;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
    toast('success', 'Đã đăng xuất.');
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-white border-r border-slate-100 flex flex-col fixed h-full z-40">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="bg-brand-600 text-white rounded-xl p-2">
            <Milk size={20} />
          </div>
          <div>
            <div className="font-extrabold text-slate-800 leading-tight">UMBO MILK</div>
            <div className="text-[10px] text-slate-400 font-medium">Tuyển dụng & Đào tạo AI</div>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                )
              }
            >
              <item.icon size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="bg-brand-100 text-brand-700 rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold uppercase">
              {user?.fullName.slice(0, 1) ?? 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate">{user?.fullName}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{user?.role}</div>
            </div>
            <button onClick={handleLogout} title="Đăng xuất" className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 ml-60 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-100 px-6 py-3 flex items-center gap-4">
          <div className="text-sm text-slate-600 font-semibold">
            {weekdayVi(now)}, {formatDate(now)}
            <span className="ml-3 font-mono text-slate-800 tabular-nums">
              {now.toLocaleTimeString('vi-VN', { hour12: false })}
            </span>
          </div>
          <div className="flex-1" />

          {health?.demoMode && (
            <span className="rounded-full bg-amber-100 text-amber-700 px-3 py-1 text-[11px] font-bold border border-amber-200">
              DEMO MODE
            </span>
          )}

          {/* Sync status */}
          <button
            onClick={() => navigate('/sync')}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold border transition-colors',
              syncConflict
                ? 'bg-purple-50 text-purple-700 border-purple-200'
                : syncError
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : pendingTotal > 0
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200',
            )}
          >
            <FileSpreadsheet size={13} />
            Google Sheet
            {syncConflict
              ? '● Xung đột'
              : syncError
                ? '● Lỗi kết nối'
                : pendingTotal > 0
                  ? `● ${pendingTotal} dữ liệu đang chờ`
                  : '● Đồng bộ'}
          </button>

          {/* Health */}
          <div className="hidden lg:flex items-center gap-3 text-[11px] font-semibold text-slate-500">
            <span className="flex items-center gap-1"><Circle size={8} className="fill-emerald-500 text-emerald-500" /> Node.js</span>
            <span className={cn('flex items-center gap-1', health?.database ? 'text-emerald-600' : 'text-rose-500')}>
              {health?.database ? <Wifi size={12} /> : <WifiOff size={12} />} Database
            </span>
            <span className={cn('flex items-center gap-1', health?.googleSheet ? 'text-emerald-600' : 'text-slate-400')}>
              {health?.googleSheet ? <Wifi size={12} /> : <WifiOff size={12} />} Google Sheet
            </span>
            <span className={cn('flex items-center gap-1', health?.ai ? 'text-emerald-600' : 'text-slate-400')}>
              {health?.ai ? <Wifi size={12} /> : <WifiOff size={12} />} AI
            </span>
            <span className={cn('flex items-center gap-1', health?.zalo ? 'text-emerald-600' : 'text-slate-400')}>
              {health?.zalo ? <Wifi size={12} /> : <WifiOff size={12} />} Zalo
            </span>
            <Database size={13} className="text-slate-300" />
          </div>
        </header>

        <main className="flex-1 p-6 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}