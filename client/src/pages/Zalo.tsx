import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, MessageCircle, Send, Eye } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Skeleton, EmptyState } from '../components/ui';
import { useToast } from '../stores/Toast';
import { getSocket } from '../api/socket';
import { debounce } from '../utils/debounce';
import { formatDateTime } from '../utils/date';

interface ZaloRow {
  id: string;
  candidateId: string | null;
  phone: string;
  content: string;
  status: string;
  error: string | null;
  provider: string;
  createdAt: string;
  candidate: { tenUv: string } | null;
}

export default function Zalo() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ZaloRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = debounce(() => void load(), 500);
    socket.on('zalo:status', refresh);
    return () => {
      socket.off('zalo:status', refresh);
      refresh.cancel();
    };
  }, [load]);

  const sent = rows.filter((r) => r.status === 'SENT').length;
  const failed = rows.filter((r) => r.status === 'FAILED').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Zalo OA</h1>
          <p className="text-sm text-slate-500">{rows.length} tin nhắn · {sent} gửi thành công · {failed} lỗi</p>
        </div>
        <button className="btn-secondary" onClick={() => void load()}><RefreshCw size={15} /> Làm mới</button>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState title="Chưa có tin nhắn" hint="Gửi thông báo Training từ trang Ứng viên hoặc Training." /></div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((m) => (
            <div key={m.id} className="card p-4">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="rounded-xl bg-sky-50 text-sky-600 p-2"><MessageCircle size={16} /></div>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-sm font-semibold text-slate-800">
                    {m.candidate?.tenUv ?? '—'} <span className="text-slate-400 font-normal">· {m.phone}</span>
                  </div>
                  <div className="text-[11px] text-slate-400">{formatDateTime(m.createdAt)} · provider: {m.provider}</div>
                </div>
                <Badge className={m.status === 'SENT' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}>
                  {m.status === 'SENT' ? 'ĐÃ GỬI' : 'LỖI'}
                </Badge>
                <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                  <Eye size={14} />
                </button>
              </div>
              {expanded === m.id && (
                <pre className="mt-3 rounded-xl bg-slate-50 p-3.5 text-xs text-slate-600 whitespace-pre-wrap font-sans">
                  {m.content}
                </pre>
              )}
              {m.error && <div className="mt-2 text-xs text-rose-500">⚠ {m.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}