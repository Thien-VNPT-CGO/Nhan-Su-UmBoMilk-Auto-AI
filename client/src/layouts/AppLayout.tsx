import { useEffect, useRef, useState, useMemo } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, BrainCircuit, GraduationCap, UserCheck, CalendarDays, ClipboardCheck,
  MessageCircle, RefreshCw, FileSpreadsheet, ScrollText, Settings as SettingsIcon,
  LogOut, Milk, Wifi, WifiOff, Database, Circle, Bell, Sun, Moon, Languages, BookOpen, BarChart3, CheckSquare,
  Menu, X,
} from 'lucide-react';
import { useAuth, User } from '../stores/auth';
import { useToast } from '../stores/Toast';
import { useI18n } from '../utils/i18n';
import { useTheme } from '../utils/theme';
import { NotificationManager } from '../components/NotificationManager';
import { api } from '../api/client';
import { getSocket } from '../api/socket';
import { cn } from '../utils/format';
import { debounce } from '../utils/debounce';
import { formatDate, weekdayVi } from '../utils/date';

export const DEFAULT_HR_TABS = ['/dashboard', '/candidates', '/scoring', '/training', '/official-employees', '/shifts', '/approvals'];
export const DEFAULT_VIEWER_TABS = ['/shifts'];

function useI18nNav(user: User | null) {
  const { t } = useI18n();
  const allNavItems = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/candidates', label: t('nav.candidates'), icon: Users },
    { to: '/scoring', label: t('nav.scoring'), icon: BrainCircuit },
    { to: '/training', label: t('nav.training'), icon: GraduationCap },
    { to: '/official-employees', label: 'Nhân viên chính thức', icon: UserCheck },
    { to: '/shifts', label: t('nav.shifts'), icon: CalendarDays },
    { to: '/approvals', label: 'Phê duyệt nhân viên', icon: CheckSquare },
    { to: '/attendance', label: t('nav.attendance'), icon: ClipboardCheck },
    { to: '/zalo', label: t('nav.zalo'), icon: MessageCircle },
    { to: '/reports', label: t('nav.reports'), icon: BarChart3 },
    { to: '/elearning', label: t('nav.elearning'), icon: BookOpen },
    { to: '/sync', label: t('nav.sync'), icon: RefreshCw },
    { to: '/audit', label: t('nav.audit'), icon: ScrollText },
    { to: '/settings', label: t('nav.settings'), icon: SettingsIcon },
  ];

  if (!user) return [];
  if (user.role === 'ADMIN') return allNavItems;

  if (Array.isArray(user.allowedTabs) && user.allowedTabs.length > 0) {
    const allowedSet = new Set(user.allowedTabs);
    return allNavItems.filter((item) => allowedSet.has(item.to));
  }

  const baseTabs = user.role === 'VIEWER' ? DEFAULT_VIEWER_TABS : DEFAULT_HR_TABS;
  return allNavItems.filter((item) => baseTabs.includes(item.to));
}

interface SyncCounts {
  PENDING: number;
  PROCESSING: number;
  SYNCED: number;
  RETRY: number;
  FAILED: number;
  CONFLICT: number;
  TOTAL: number;
}

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  type: string;
  link?: string | null;
  read: boolean;
  createdAt: string;
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
    const t = setInterval(load, 60000);
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
  const [health, setHealth] = useState<{ database: boolean; googleSheet: boolean; ai: boolean; zalo: boolean; zaloReason?: string; demoMode: boolean; queueAgeMs?: number } | null>(null);
  useEffect(() => {
    const load = () => {
      api.get<{ database: boolean; googleSheet: boolean; ai: boolean; zalo: boolean; zaloReason?: string; demoMode: boolean; queueAgeMs?: number }>('/settings/health')
        .then(setHealth)
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  return health;
}

const zaloReasonLabel = (reason?: string) =>
  reason === 'NO_TOKEN'
    ? 'Zalo: chưa có token — vào Cài đặt → Zalo → Kết nối Zalo OA'
    : reason?.startsWith('EXPIRED_REFRESH_FAILED')
      ? 'Zalo: token hết hạn, refresh thất bại' + (reason.includes(':') ? ` — ${reason.split(':').slice(1).join(':').trim()}` : '')
      : reason === 'VALID_NO_PROOF' || reason === 'VALID'
        ? 'Zalo: token hợp lệ'
        : reason?.startsWith('INVALID')
          ? 'Zalo: token không hợp lệ — kết nối lại'
          : reason
            ? 'Zalo: lỗi kiểm tra (' + reason + ')'
            : 'Zalo: chưa có token';

function useNotifications() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const load = (showAll = false) => {
    api
      .get<{ rows: NotificationRow[]; unread: number }>(`/notifications?limit=20${showAll ? '&unreadOnly=true' : ''}`)
      .then((d) => {
        setRows(d.rows);
        setUnread(d.unread);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 120000);
    const socket = getSocket();
    const refresh = debounce(() => load(), 500);
    socket.on('notification:new', refresh);
    socket.on('zalo:incoming', refresh);
    const onClickOutside = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      clearInterval(t);
      socket.off('notification:new', refresh);
      socket.off('zalo:incoming', refresh);
      document.removeEventListener('mousedown', onClickOutside);
      refresh.cancel();
    };
  }, []);

  const markAll = async () => {
    await api.post('/notifications/read-all').catch(() => undefined);
    setRows((r) => r.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };

  return { open, setOpen, unread, rows, markAll, boxRef, reload: load };
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const { t, lang, setLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const now = useClock();
  const counts = useSyncCounts();
  const health = useHealth();
  const NAV = useI18nNav(user);
  const notif = useNotifications();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Tự động đóng menu di động khi chuyển route
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'ADMIN') return;

    const baseTabs = user.role === 'VIEWER' ? DEFAULT_VIEWER_TABS : DEFAULT_HR_TABS;
    const allowedSet = new Set([
      ...baseTabs,
      ...(Array.isArray(user.allowedTabs) ? user.allowedTabs : []),
    ]);
    const path = location.pathname;
    if (path === '/' || path.startsWith('/public')) return;
    if (!allowedSet.has(path)) {
      const fallbackPath = allowedSet.has('/dashboard')
        ? '/dashboard'
        : allowedSet.has('/shifts')
          ? '/shifts'
          : Array.from(allowedSet)[0] || '/shifts';
      toast('error', '⚠️ Bạn chưa được cấp quyền truy cập tab này. Vui lòng liên hệ Admin!');
      navigate(fallbackPath, { replace: true });
    }
  }, [user, location.pathname, navigate, toast]);

  // Lắng nghe Realtime khi Admin Reset Mật Khẩu tài khoản -> Đá Logout lập tức!
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();

    const handlePasswordReset = (data: { userId: string; username: string; defaultPassword: string; message: string }) => {
      if (data.userId === user.id || data.username === user.username) {
        logout().then(() => {
          alert(`⚡ THÔNG BÁO TỪ HỆ THỐNG AI:\nMật khẩu của tài khoản ${data.username} đã được Admin Reset về gốc (${data.defaultPassword}).\nPhiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại với mật khẩu mới!`);
          navigate('/login', { replace: true });
        });
      }
    };

    socket.on('user:password_reset', handlePasswordReset);
    return () => {
      socket.off('user:password_reset', handlePasswordReset);
    };
  }, [user, logout, navigate]);

  const pendingTotal = (counts?.PENDING ?? 0) + (counts?.RETRY ?? 0) + (counts?.PROCESSING ?? 0);
  const syncError = (counts?.FAILED ?? 0) > 0;
  const syncConflict = (counts?.CONFLICT ?? 0) > 0;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
    toast('success', t('header.loggedOut'));
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 font-sans">
      {/* Backdrop cho di động */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300"
        />
      )}

      {/* Sidebar Responsive Drawer */}
      <aside
        className={cn(
          'w-64 shrink-0 bg-white border-r border-slate-100 flex flex-col fixed h-full z-50 transition-transform duration-300 dark:bg-slate-900 dark:border-slate-800',
          'md:translate-x-0 md:w-60',
          mobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="flex items-center justify-between px-5 py-5 border-b border-slate-100 dark:border-slate-800 md:border-none">
          <div className="flex items-center gap-2.5">
            <div className="bg-brand-600 text-white rounded-xl p-2">
              <Milk size={20} />
            </div>
            <div>
              <div className="font-extrabold text-slate-800 leading-tight dark:text-slate-100">UMBO MILK</div>
              <div className="text-[10px] text-slate-400 font-medium">{t('header.subtitle')}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
                )
              }
            >
              <item.icon size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="bg-brand-100 text-brand-700 rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold uppercase dark:bg-brand-500/20 dark:text-brand-300">
              {user?.fullName.slice(0, 1) ?? 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">{user?.fullName}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{user?.role}</div>
            </div>
            <button onClick={handleLogout} title={t('header.logout')} className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 ml-0 md:ml-60 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-100 px-3 sm:px-6 py-2.5 flex items-center gap-2 sm:gap-4 dark:bg-slate-900/90 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden text-slate-600 dark:text-slate-200 p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            title="Mở menu điều hướng"
          >
            <Menu size={20} />
          </button>

          <div className="text-xs sm:text-sm text-slate-600 font-semibold dark:text-slate-300 truncate">
            <span className="hidden sm:inline">{weekdayVi(now)}, </span>{formatDate(now)}
            <span className="ml-2 font-mono text-slate-800 tabular-nums dark:text-slate-100">
              {now.toLocaleTimeString('vi-VN', { hour12: false })}
            </span>
          </div>
          <div className="flex-1" />

          {health?.demoMode && (
            <span className="hidden sm:inline-flex rounded-full bg-amber-100 text-amber-700 px-3 py-1 text-[11px] font-bold border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30">
              {t('header.demoMode')}
            </span>
          )}

          {/* Sync status */}
          <button
            onClick={() => navigate('/sync')}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5 text-[11px] font-bold border transition-colors shrink-0',
              syncConflict
                ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30'
                : syncError
                  ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30'
                  : pendingTotal > 0
                    ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
            )}
          >
            <FileSpreadsheet size={13} />
            <span className="hidden xs:inline">{t('header.sheet')}</span>
          </button>

          {/* Theme Switcher (Dark/Light Mode) */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 p-2 sm:px-3 sm:py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 transition-colors text-xs font-semibold shrink-0"
            title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
          >
            {theme === 'dark' ? (
              <>
                <Sun size={16} className="text-amber-400 fill-amber-400/20" />
                <span className="hidden sm:inline">Giao diện Sáng</span>
              </>
            ) : (
              <>
                <Moon size={16} className="text-indigo-600 fill-indigo-600/10" />
                <span className="hidden sm:inline">Giao diện Tối</span>
              </>
            )}
          </button>

          {/* Notifications */}
          <div className="relative" ref={notif.boxRef}>
            <button
              onClick={() => notif.setOpen(!notif.open)}
              className="relative text-slate-500 hover:text-slate-700 p-2 rounded-xl border border-slate-200 dark:border-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
              title="Thông báo"
            >
              <Bell size={16} />
              {notif.unread > 0 && (
                <span className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full w-4 h-4 text-[10px] font-black flex items-center justify-center animate-pulse">
                  {notif.unread > 9 ? '9+' : notif.unread}
                </span>
              )}
            </button>

            {notif.open && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl z-50 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <span className="font-bold text-xs text-slate-800 dark:text-slate-100">Thông báo hệ thống ({notif.unread})</span>
                  <button onClick={notif.markAll} className="text-[11px] text-brand-600 hover:underline">Đã đọc tất cả</button>
                </div>
                <div className="max-h-80 overflow-y-auto space-y-2">
                  {notif.rows.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-4">Không có thông báo mới</div>
                  ) : (
                    notif.rows.map((row) => (
                      <div
                        key={row.id}
                        onClick={() => {
                          notif.setOpen(false);
                          if (row.link) navigate(row.link);
                        }}
                        className={cn('p-2.5 rounded-xl border text-xs space-y-1 cursor-pointer', row.read ? 'bg-slate-50 border-slate-100 dark:bg-slate-800/40 dark:border-slate-800' : 'bg-brand-50/50 border-brand-200 dark:bg-brand-500/10 dark:border-brand-500/30')}
                      >
                        <div className="font-bold text-slate-800 dark:text-slate-100">{row.title}</div>
                        <div className="text-slate-600 dark:text-slate-300 text-[11px]">{row.body}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Health */}
          <div className="hidden lg:flex items-center gap-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1"><Circle size={8} className="fill-emerald-500 text-emerald-500" /> Node.js</span>
            <span className={cn('flex items-center gap-1', health?.database ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500')}>
              {health?.database ? <Wifi size={12} /> : <WifiOff size={12} />} Database
            </span>
            <span className={cn('flex items-center gap-1', health?.googleSheet ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')}>
              {health?.googleSheet ? <Wifi size={12} /> : <WifiOff size={12} />} Google Sheet
            </span>
            <span className={cn('flex items-center gap-1', health?.ai ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')}>
              {health?.ai ? <Wifi size={12} /> : <WifiOff size={12} />} AI
            </span>
            <span
              title={zaloReasonLabel(health?.zaloReason)}
              className={cn('flex items-center gap-1 cursor-help', health?.zalo ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')}
            >
              {health?.zalo ? <Wifi size={12} /> : <WifiOff size={12} />} Zalo
            </span>
            <Database size={13} className="text-slate-300 dark:text-slate-600" />
          </div>
        </header>

        <main className="flex-1 p-6 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}