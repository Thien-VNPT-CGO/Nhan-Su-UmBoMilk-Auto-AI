import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ScrollText } from 'lucide-react';
import { api } from '../api/client';
import { Badge, Skeleton, EmptyState } from '../components/ui';
import { useToast } from '../stores/Toast';
import { formatDateTime } from '../utils/date';

interface AuditRow {
  id: string;
  user: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue: string | null;
  newValue: string | null;
  version: number | null;
  time: string;
  ip: string | null;
  syncJobId: string | null;
}

export default function AuditLog() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
      if (entityFilter) q.set('entityId', entityFilter);
      if (actionFilter) q.set('action', actionFilter);
      const d = await api.get<{ rows: AuditRow[]; total: number }>(`/audit?${q}`);
      setRows(d.rows);
      setTotal(d.total);
    } catch {
      toast('error', 'Không tải được nhật ký.');
    } finally {
      setLoading(false);
    }
  }, [entityFilter, actionFilter, page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Nhật ký hệ thống</h1>
          <p className="text-sm text-slate-500">{total} sự kiện · 100% mutation được ghi lại</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input !w-44"
            placeholder="Mã UV..."
            value={entityFilter}
            onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
          />
          <select className="input !w-auto" value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}>
            <option value="">Mọi hành động</option>
            <option value="CREATE_CANDIDATE">CREATE_CANDIDATE</option>
            <option value="UPDATE_CANDIDATE">UPDATE_CANDIDATE</option>
            <option value="AI_SCORE">AI_SCORE</option>
            <option value="HR_DECISION_PASS">HR_DECISION_PASS</option>
            <option value="HR_DECISION_FAIL">HR_DECISION_FAIL</option>
            <option value="HR_DECISION_REVIEW">HR_DECISION_REVIEW</option>
            <option value="START_TRAINING">START_TRAINING</option>
            <option value="CHANGE_TRAINING_STATUS">CHANGE_TRAINING_STATUS</option>
            <option value="CHANGE_SHIFT">CHANGE_SHIFT</option>
            <option value="CHECKIN">CHECKIN</option>
            <option value="LOGIN">LOGIN</option>
            <option value="UPDATE_SETTINGS">UPDATE_SETTINGS</option>
          </select>
          <button className="btn-secondary" onClick={() => void load()}><RefreshCw size={15} /></button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState title="Không có nhật ký" /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="table-th">NGƯỜI DÙNG</th>
                  <th className="table-th">THAO TÁC</th>
                  <th className="table-th">ĐỐI TƯỢNG</th>
                  <th className="table-th">MÃ ĐỐI TƯỢNG</th>
                  <th className="table-th">GIÁ TRỊ CŨ</th>
                  <th className="table-th">GIÁ TRỊ MỚI</th>
                  <th className="table-th">PHIÊN BẢN</th>
                  <th className="table-th">THỜI GIAN</th>
                  <th className="table-th">IP</th>
                  <th className="table-th">JOB ĐỒNG BỘ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="table-td"><b>{r.user}</b></td>
                    <td className="table-td"><Badge className="bg-brand-50 text-brand-700">{r.action}</Badge></td>
                    <td className="table-td text-xs text-slate-500">{r.entity}</td>
                    <td className="table-td font-mono text-xs">{r.entityId}</td>
                    <td className="table-td text-xs text-slate-400 max-w-[160px] truncate">{r.oldValue ?? '—'}</td>
                    <td className="table-td text-xs text-slate-600 max-w-[160px] truncate">{r.newValue ?? '—'}</td>
                    <td className="table-td">{r.version !== null ? `v${r.version}` : '—'}</td>
                    <td className="table-td text-xs text-slate-500">{formatDateTime(r.time)}</td>
                    <td className="table-td text-xs text-slate-400">{r.ip ?? '—'}</td>
                    <td className="table-td font-mono text-[10px] text-slate-400">{r.syncJobId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">Trang {page}/{totalPages}</span>
            <div className="flex gap-2">
              <button className="btn-secondary !px-2.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
              <button className="btn-secondary !px-2.5" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}