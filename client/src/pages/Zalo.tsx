import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, MessageCircle, Send, Eye, MapPin, Bot } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Skeleton, EmptyState } from '../components/ui';
import { useToast } from '../stores/Toast';
import { useAuth } from '../stores/auth';
import { useI18n } from '../utils/i18n';
import { getSocket } from '../api/socket';
import { debounce } from '../utils/debounce';
import { formatDateTime } from '../utils/date';
import { cn } from '../utils/format';

interface ZaloRow {
  id: string;
  candidateId: string | null;
  phone: string;
  content: string;
  status: string;
  direction: string;
  messageType: string;
  lat: number | null;
  lng: number | null;
  error: string | null;
  provider: string;
  createdAt: string;
  candidate: { tenUv: string } | null;
}

export default function Zalo() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useI18n();
  const [rows, setRows] = useState<ZaloRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoReply, setAutoReply] = useState(true);
  const isAdmin = user?.role === 'ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ZaloRow[]>('/zalo/messages');
      setRows(data);
    } catch {
      toast('error', 'Không tải được tin nhắn Zalo.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadAutoReply = useCallback(async () => {
    try {
      const data = await api.get<{ autoReply: boolean }>('/settings/health');
      setAutoReply(data.autoReply);
    } catch {
      /* giữ mặc định */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadAutoReply();
  }, [load, loadAutoReply]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = debounce(() => void load(), 500);
    socket.on('zalo:status', refresh);
    socket.on('zalo:incoming', refresh);
    return () => {
      socket.off('zalo:status', refresh);
      socket.off('zalo:incoming', refresh);
      refresh.cancel();
    };
  }, [load]);

  const toggleAutoReply = async () => {
    if (!isAdmin) return;
    try {
      const r = await api.post<{ autoReply: boolean }>('/zalo/auto-reply', { enabled: !autoReply });
      setAutoReply(r.autoReply);
      toast('success', r.autoReply ? 'AI tự trả lời: BẬT.' : 'AI tự trả lời: TẮT.');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Đổi trạng thái thất bại.');
    }
  };

  const sent = rows.filter((r) => r.status === 'SENT').length;
  const failed = rows.filter((r) => r.status === 'FAILED').length;
  const received = rows.filter((r) => r.direction === 'IN').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-slate-100">Zalo OA</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {rows.length} tin · {sent} {t('reports.sent')} · {received} {t('reports.received')} · {failed} {t('reports.failed')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => void toggleAutoReply()}
              className={cn('btn-secondary', autoReply && '!border-emerald-300 !text-emerald-700 dark:!border-emerald-500/40 dark:!text-emerald-300')}
            >
              <Bot size={15} className={autoReply ? 'text-emerald-500' : 'text-slate-400'} />
              AI auto-reply: {autoReply ? 'ON' : 'OFF'}
            </button>
          )}
          <button className="btn-secondary" onClick={() => void load()}><RefreshCw size={15} /> Làm mới</button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState title="Chưa có tin nhắn" hint="Gửi thông báo Training từ trang Ứng viên hoặc Training." /></div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((m) => {
            const isIn = m.direction === 'IN';
            return (
              <div key={m.id} className={cn('card p-4', isIn && 'border-l-4 !border-l-sky-400')}>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className={cn('rounded-xl p-2', isIn ? 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300')}>
                    {isIn ? <MessageCircle size={16} /> : <Send size={16} />}
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {m.candidate?.tenUv ?? '—'} <span className="text-slate-400 font-normal">· {m.phone}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">{formatDateTime(m.createdAt)} · provider: {m.provider}</div>
                  </div>
                  <Badge className={isIn ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'}>
                    {isIn ? t('zalo.incoming') : t('zalo.outgoing')}
                  </Badge>
                  {m.messageType === 'location' && (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      <MapPin size={11} /> {t('zalo.location')}
                      {m.lat != null && m.lng != null && <span className="font-mono"> ({m.lat.toFixed(5)}, {m.lng.toFixed(5)})</span>}
                    </Badge>
                  )}
                  <Badge className={m.status === 'SENT' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'}>
                    {m.status === 'SENT' ? 'ĐÃ GỬI' : 'LỖI'}
                  </Badge>
                  <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                    <Eye size={14} />
                  </button>
                </div>
                {expanded === m.id && (
                  <pre className="mt-3 rounded-xl bg-slate-50 p-3.5 text-xs text-slate-600 whitespace-pre-wrap font-sans dark:bg-slate-800/60 dark:text-slate-300">
                    {m.content}
                  </pre>
                )}
                {m.error && <div className="mt-2 text-xs text-rose-500">⚠ {m.error}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}