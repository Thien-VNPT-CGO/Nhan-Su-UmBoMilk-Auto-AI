import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrainCircuit, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Skeleton, EmptyState } from '../components/ui';
import { useToast } from '../stores/Toast';
import { getSocket } from '../api/socket';
import { formatDateTime } from '../utils/date';
import { cn } from '../utils/format';

interface Row {
  id: string;
  tenUv: string;
  thoiGian: string;
  sdtZalo: string;
  chiNhanh: string;
  caLam: string;
  tongDiem: number | null;
  aiRecommendation: string | null;
  aiScoredAt: string | null;
  aiNote: string | null;
  hrDecision: string | null;
  dataVersion: number;
}

export default function Scoring() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ rows: Row[] }>('/candidates?pageSize=100&sort=newest');
      setRows(data.rows);
    } catch {
      toast('error', 'Không tải được danh sách.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => void load();
    ['candidate:new', 'candidate:scored', 'candidate:decision'].forEach((ev) => socket.on(ev, refresh));
    return () => ['candidate:new', 'candidate:scored', 'candidate:decision'].forEach((ev) => socket.off(ev, refresh));
  }, [load]);

  const score = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/candidates/${id}/score`, {});
      toast('success', 'AI đã chấm xong.');
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Chấm hồ sơ thất bại.');
    } finally {
      setBusyId(null);
    }
  };

  const decide = async (id: string, decision: 'PASS' | 'FAIL' | 'REVIEW') => {
    try {
      await api.patch(`/candidates/${id}/decision`, { decision });
      toast('success', `Đã ${decision}.`);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thất bại.');
    }
  };

  const pending = rows.filter((r) => !r.aiScoredAt);
  const scored = rows.filter((r) => r.aiScoredAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">AI chấm hồ sơ</h1>
          <p className="text-sm text-slate-500">{pending.length} chờ chấm · {scored.length} đã chấm</p>
        </div>
        <button className="btn-secondary" onClick={() => void load()}><RefreshCw size={15} /> Làm mới</button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState title="Chưa có hồ sơ nào" hint="Hồ sơ từ Google Form sẽ xuất hiện tại đây theo thời gian thực." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="table-th">Mã UV</th>
                  <th className="table-th">Thời gian</th>
                  <th className="table-th">Tên</th>
                  <th className="table-th">SĐT</th>
                  <th className="table-th">Chi nhánh</th>
                  <th className="table-th">Ca</th>
                  <th className="table-th">Điểm AI</th>
                  <th className="table-th">Gợi ý AI</th>
                  <th className="table-th">Quyết định HR</th>
                  <th className="table-th">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-brand-50/40">
                    <td className="table-td font-mono text-xs font-bold text-brand-600">{r.id}</td>
                    <td className="table-td text-xs text-slate-500">{formatDateTime(r.thoiGian)}</td>
                    <td className="table-td font-semibold">{r.tenUv}</td>
                    <td className="table-td">{r.sdtZalo}</td>
                    <td className="table-td">{r.chiNhanh}</td>
                    <td className="table-td">{r.caLam}</td>
                    <td className="table-td">
                      <span className={cn(
                        'inline-flex items-center justify-center w-8 h-8 rounded-xl text-sm font-extrabold',
                        r.tongDiem !== null && r.tongDiem >= 7 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
                      )}>
                        {r.tongDiem ?? '—'}
                      </span>
                    </td>
                    <td className="table-td">
                      {r.aiRecommendation === 'PASS' && <Badge className="bg-emerald-100 text-emerald-700">ĐẠT</Badge>}
                      {r.aiRecommendation === 'FAIL' && <Badge className="bg-slate-100 text-slate-500">LOẠI</Badge>}
                      {!r.aiScoredAt && <Badge className="bg-amber-100 text-amber-700">Chưa chấm</Badge>}
                    </td>
                    <td className="table-td">
                      {r.hrDecision === 'PASS' && <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 size={11} /> ĐẠT</Badge>}
                      {r.hrDecision === 'FAIL' && <Badge className="bg-rose-100 text-rose-700"><XCircle size={11} /> LOẠI</Badge>}
                      {r.hrDecision === 'REVIEW' && <Badge className="bg-amber-100 text-amber-700"><AlertTriangle size={11} /> CẦN XEM LẠI</Badge>}
                      {!r.hrDecision && <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="table-td">
                      <div className="flex items-center gap-1.5">
                        <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => score(r.id)} disabled={busyId === r.id}>
                          {busyId === r.id ? <RefreshCw size={13} className="animate-spin" /> : <BrainCircuit size={13} />}
                          {r.aiScoredAt ? 'Chấm lại' : 'Chấm'}
                        </button>
                        {r.aiScoredAt && (
                          <>
                            <button className="btn-success !px-2.5 !py-1.5" onClick={() => decide(r.id, 'PASS')}><CheckCircle2 size={13} /></button>
                            <button className="btn-danger !px-2.5 !py-1.5" onClick={() => decide(r.id, 'FAIL')}><XCircle size={13} /></button>
                          </>
                        )}
                        <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => navigate('/candidates')}>Chi tiết</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}