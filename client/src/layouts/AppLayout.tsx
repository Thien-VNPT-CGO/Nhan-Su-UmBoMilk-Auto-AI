import { useEffect, useRef, useState, useMemo } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, BrainCircuit, GraduationCap, CalendarDays, ClipboardCheck,
  MessageCircle, RefreshCw, FileSpreadsheet, ScrollText, Settings as SettingsIcon,
  LogOut, Milk, Wifi, WifiOff, Database, Circle, Bell, Sun, Moon, Languages, BookOpen, BarChart3,
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

export const DEFAULT_HR_TABS = ['/dashboard', '/candidates', '/scoring', '/training', '/shifts'];
export const DEFAULT_VIEWER_TABS = ['/shifts'];

function useI18nNav(user: User | null) {
  const { t } = useI18n();
  const allNavItems = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { to: '/candidates', label: t('nav.candidates'), icon: Users },
    { to: '/scoring', label: t('nav.scoring'), icon: BrainCircuit },
    { to: '/training', label: t('nav.training'), icon: GraduationCap },
    { to: '/shifts', label: t('nav.shifts'), icon: CalendarDays },
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

  const baseTabs = user.role === 'VIEWER' ? DEFAULT_VIEWER_TABS : DEFAULT_HR_TABS;
  const allowedSet = new Set([
    ...baseTabs,
    ...(Array.isArray(user.allowedTabs) ? user.allowedTabs : []),
  ]);

  return allNavItems.filter((item) => allowedSet.has(item.to));
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

  const pendingTotal = (counts?.PENDING ?? 0) + (counts?.RETRY ?? 0) + (counts?.PROCESSING ?? 0);
  const syncError = (counts?.FAILED ?? 0) > 0;
  const syncConflict = (counts?.CONFLICT ?? 0) > 0;

  const handleLogout = async () => {
    await logout();
    navigate('/login');
    toast('success', t('header.loggedOut'));
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-white border-r border-slate-100 flex flex-col fixed h-full z-40 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="bg-brand-600 text-white rounded-xl p-2">
            <Milk size={20} />
          </div>
          <div>
            <div className="font-extrabold text-slate-800 leading-tight dark:text-slate-100">UMBO MILK</div>
            <div className="text-[10px] text-slate-400 font-medium">{t('header.subtitle')}</div>
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
      <div className="flex-1 ml-60 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-100 px-6 py-3 flex items-center gap-4 dark:bg-slate-900/90 dark:border-slate-800">
          <div className="text-sm text-slate-600 font-semibold dark:text-slate-300">
            {weekdayVi(now)}, {formatDate(now)}
            <span className="ml-3 font-mono text-slate-800 tabular-nums dark:text-slate-100">
              {now.toLocaleTimeString('vi-VN', { hour12: false })}
            </span>
          </div>
          <div className="flex-1" />

          {health?.demoMode && (
            <span className="rounded-full bg-amber-100 text-amber-700 px-3 py-1 text-[11px] font-bold border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30">
              {t('header.demoMode')}
            </span>
          )}

          {/* Sync status */}
          <button
            onClick={() => navigate('/sync')}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold border transition-colors',
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
            {t('header.sheet')}
            {syncConflict
              ? `● ${t('header.conflict')}`
              : syncError
                ? `● ${t('header.syncError')}`
                : pendingTotal > 0
                  ? `● ${pendingTotal} ${t('header.pending')}`
                  : `● ${t('header.synced')}`}
          </button>

          {/* Desktop Web Push Notification Manager */}
          <NotificationManager />

          {/* Language toggle */}
          <button
            onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
            title={t('header.language')}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Languages size={16} />
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={toggleTheme}
            title={t('header.darkMode')}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Notification bell */}
          <div className="relative" ref={notif.boxRef}>
            <button
              onClick={() => notif.setOpen((o) => !o)}
              title={t('header.notifications')}
              className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <Bell size={16} />
              {notif.unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white rounded-full min-w-4 h-4 px-1 text-[9px] font-bold flex items-center justify-center">
                  {notif.unread > 99 ? '99+' : notif.unread}
                </span>
              )}
            </button>
            {notif.open && (
              <div className="absolute right-0 mt-2 w-80 card shadow-xl overflow-hidden z-50">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{t('header.notifications')}</div>
                  <button onClick={() => void notif.markAll()} className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
                    {t('header.markAllRead')}
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800">
                  {notif.rows.length === 0 && (
                    <div className="px-4 py-10 text-center text-xs text-slate-400">{t('header.noNotifications')}</div>
                  )}
                  {notif.rows.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        void api.post(`/notifications/${n.id}/read`).catch(() => undefined);
                        notif.setOpen(false);
                        if (n.link) navigate(n.link);
                      }}
                      className={cn('w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60', !n.read && 'bg-brand-50/60 dark:bg-brand-500/10')}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'w-1.5 h-1.5 rounded-full shrink-0',
                            n.type === 'ERROR' ? 'bg-rose-500' : n.type === 'WARNING' ? 'bg-amber-500' : n.type === 'SUCCESS' ? 'bg-emerald-500' : 'bg-sky-500',
                          )}
                        />
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{n.title}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{n.body}</div>
                    </button>
                  ))}
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