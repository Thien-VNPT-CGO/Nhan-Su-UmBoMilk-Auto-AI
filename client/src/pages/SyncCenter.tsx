import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, RotateCcw, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Skeleton, EmptyState, StatCard, ConfirmDialog } from '../components/ui';
import { useToast } from '../stores/Toast';
import { getSocket } from '../api/socket';
import { syncStatusStyle } from '../utils/format';
import { debounce } from '../utils/debounce';
import { formatDateTime } from '../utils/date';

interface SyncRow {
  id: string;
  entity: string;
  entityId: string;
  operation: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  version: number;
  status: string;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SyncData {
  PENDING: number;
  PROCESSING: number;
  SYNCED: number;
  RETRY: number;
  FAILED: number;
  CONFLICT: number;
  TOTAL: number;
  rows: SyncRow[];
  total: number;
}

export function opLabel(op: string): string {
  switch (op) {
    case 'CREATE': return 'TẠO MỚI';
    case 'UPDATE': return 'CẬP NHẬT';
    case 'UPSERT': return 'GHI/CẬP NHẬT';
    case 'DELETE': return 'XÓA';
    case 'SCORE': return 'CHẤM ĐIỂM';
    case 'TRAINING': return 'ĐÀO TẠO';
    case 'ATTENDANCE': return 'CHẤM CÔNG';
    case 'DECISION': return 'QUYẾT ĐỊNH';
    case 'CONFLICT-RESOLVE': return 'XỬ LÝ XUNG ĐỘT';
    default: return op;
  }
}

export default function SyncCenter() {
  const { toast } = useToast();
  const [data, setData] = useState<SyncData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmRetryAll, setConfirmRetryAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = statusFilter ? `?status=${statusFilter}` : '';
      const d = await api.get<SyncData>(`/sync${q}`);
      setData(d);
    } catch {
      toast('error', 'Không tải được trung tâm đồng bộ.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = debounce(() => void load(), 600);
    ['sync:status', 'sync:success', 'sync:failed', 'sync:conflict', 'sync:pending'].forEach((ev) => socket.on(ev, refresh));
    return () => {
      ['sync:status', 'sync:success', 'sync:failed', 'sync:conflict', 'sync:pending'].forEach((ev) => socket.off(ev, refresh));
      refresh.cancel();
    };
  }, [load]);

  const retry = async (id: string) => {
    try {
      await api.post(`/sync/retry/${id}`, {});
      toast('success', 'Đã đưa job vào hàng đợi.');
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thất bại.');
    }
  };

  const retryAll = async () => {
    try {
      const d = await api.post<{ retried: number }>('/sync/retry-all', {});
      toast('success', `Đã đưa ${d.retried} job vào hàng đợi.`);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thất bại.');
    }
  };

  const counts = data?.PENDING !== undefined
    ? {
        SYNCED: data.SYNCED, PENDING: data.PENDING, PROCESSING: data.PROCESSING,
        RETRY: data.RETRY, FAILED: data.FAILED, CONFLICT: data.CONFLICT,
      }
    : { SYNCED: 0, PENDING: 0, PROCESSING: 0, RETRY: 0, FAILED: 0, CONFLICT: 0 };

  const statusOptions = Object.keys(syncStatusStyle);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Trung tâm đồng bộ</h1>
          <p className="text-sm text-slate-500">Web → Node.js → Persistent Queue → Google Sheet → Verify</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => void load()}><RefreshCw size={15} /> Làm mới</button>
          {(data?.FAILED || 0) > 0 || (data?.CONFLICT || 0) > 0 ? (
            <button className="btn-primary" onClick={() => setConfirmRetryAll(true)}>
              <RotateCcw size={15} /> Thử lại tất cả lỗi
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Đã đồng bộ" value={counts.SYNCED} icon={<RefreshCw size={18} />} accent="emerald" />
        <StatCard label="Đang chờ" value={counts.PENDING} icon={<RefreshCw size={18} />} accent="amber" />
        <StatCard label="Đang xử lý" value={counts.PROCESSING} icon={<RefreshCw size={18} />} accent="sky" />
        <StatCard label="Thử lại" value={counts.RETRY} icon={<RotateCcw size={18} />} accent="amber" />
        <StatCard label="Lỗi" value={counts.FAILED} icon={<AlertTriangle size={18} />} accent="rose" />
        <StatCard label="Xung đột" value={counts.CONFLICT} icon={<AlertTriangle size={18} />} accent="indigo" />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2 border-b border-slate-100">
          <span className="text-sm font-bold text-slate-700">Công việc đồng bộ</span>
          <select className="input !w-auto !py-1 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Tất cả trạng thái</option>
            {statusOptions.map((s) => <option key={s} value={s}>{syncStatusStyle[s]?.label}</option>)}
          </select>
        </div>
        {loading ? (
          <Skeleton className="h-64 m-4" />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState title="Không có job đồng bộ" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="table-th">Thời gian</th>
                  <th className="table-th">Mã Job</th>
                  <th className="table-th">Ứng viên</th>
                  <th className="table-th">Thao tác</th>
                  <th className="table-th">Trường</th>
                  <th className="table-th">Giá trị cũ</th>
                  <th className="table-th">Giá trị mới</th>
                  <th className="table-th">Phiên bản</th>
                  <th className="table-th">Thử lại</th>
                  <th className="table-th">Trạng thái</th>
                  <th className="table-th">Lỗi</th>
                  <th className="table-th">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="table-td text-xs text-slate-500">{formatDateTime(r.createdAt)}</td>
                    <td className="table-td font-mono text-xs font-bold text-brand-600">{r.id}</td>
                    <td className="table-td font-mono text-xs">{r.entityId}</td>
                    <td className="table-td"><Badge className="bg-slate-100 text-slate-600">{opLabel(r.operation)}</Badge></td>
                    <td className="table-td text-slate-600">{r.field ?? r.entity}</td>
                    <td className="table-td text-xs text-slate-400 max-w-[140px] truncate">{r.oldValue ?? '—'}</td>
                    <td className="table-td text-xs text-slate-600 max-w-[140px] truncate">{r.newValue ?? '—'}</td>
                    <td className="table-td text-slate-500">v{r.version}</td>
                    <td className="table-td text-slate-500">{r.retryCount > 0 ? `×${r.retryCount}` : '—'}</td>
                    <td className="table-td"><Badge className={syncStatusStyle[r.status]?.cls}>{syncStatusStyle[r.status]?.label}</Badge></td>
                    <td className="table-td text-xs text-rose-500 max-w-[180px] truncate">{r.lastError ?? '—'}</td>
                    <td className="table-td">
                      {['FAILED', 'CONFLICT'].includes(r.status) && (
                        <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => retry(r.id)}>
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmRetryAll}
        onClose={() => setConfirmRetryAll(false)}
        title="Thử lại tất cả job lỗi"
        message={`Đưa ${(data?.FAILED ?? 0) + (data?.CONFLICT ?? 0)} job FAILED/CONFLICT trở lại hàng đợi?`}
        confirmLabel="Thử lại"
        onConfirm={retryAll}
      />
    </div>
  );
}