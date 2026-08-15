import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ClipboardCheck, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Skeleton, EmptyState, Modal, Field, Spinner } from '../components/ui';
import { useToast } from '../stores/Toast';
import { getSocket } from '../api/socket';
import { dateKey, formatDateTime } from '../utils/date';
import { cn, shiftColor } from '../utils/format';

interface EventRow {
  id: string;
  candidateId: string;
  date: string;
  shift: string;
  checkinAt: string;
  method: string;
  valid: boolean;
  reason: string | null;
  trainingDay: number | null;
  candidate: { tenUv: string; sdtZalo: string } | null;
}

interface Candidate {
  id: string;
  tenUv: string;
  sdtZalo: string;
  caLam: string;
  chiNhanh: string;
}

export default function Attendance() {
  const { toast } = useToast();
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [today] = useState(dateKey());
  const [manualOpen, setManualOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState('');
  const [shift, setShift] = useState('SANG');
  const [checkinAt, setCheckinAt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<EventRow[]>(`/attendance?date=${today}`);
      setRows(data);
    } catch {
      toast('error', 'Không tải được điểm danh.');
    } finally {
      setLoading(false);
    }
  }, [today, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => void load();
    socket.on('attendance:checked', refresh);
    return () => {
      socket.off('attendance:checked', refresh);
    };
  }, [load]);

  const openManual = async () => {
    setManualOpen(true);
    const [train, emp] = await Promise.all([
      api.get<{ rows: Candidate[] }>('/candidates?pageSize=100&status=TRAINING').catch(() => null),
      api.get<{ rows: Candidate[] }>('/candidates?pageSize=100&status=EMPLOYEE').catch(() => null),
    ]);
    const all = [...(train?.rows ?? []), ...(emp?.rows ?? [])];
    const seen = new Set<string>();
    setCandidates(all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))));
  };

  const submit = async () => {
    if (!candidateId) {
      toast('error', 'Chọn ứng viên.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ valid: boolean; reason: string }>('/attendance/checkin', {
        candidateId,
        shift,
        checkinAt: checkinAt ? `${today}T${checkinAt}` : undefined,
      });
      if (res.valid) toast('success', 'Điểm danh hợp lệ ✅');
      else toast('error', `Điểm danh không hợp lệ: ${res.reason}`);
      setManualOpen(false);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const validCount = rows.filter((r) => r.valid).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Điểm danh – {today}</h1>
          <p className="text-sm text-slate-500">{validCount}/{rows.length} hợp lệ hôm nay</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={openManual}>
            <ClipboardCheck size={15} /> Điểm danh thủ công
          </button>
          <button className="btn-secondary" onClick={() => void load()}><RefreshCw size={15} /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {(['SANG', 'CHIEU', 'TOI'] as const).map((s) => {
          const c = shiftColor(s);
          const count = rows.filter((r) => r.shift === s && r.valid).length;
          return (
            <div key={s} className="card p-4 flex items-center gap-3">
              <div className={cn('rounded-xl p-2.5', c.bg)}><Clock size={18} className={c.text} /></div>
              <div>
                <div className="text-lg font-extrabold text-slate-800 leading-none">{count}</div>
                <div className="text-xs text-slate-500 mt-1">Ca {c.label} ({s === 'SANG' ? '06:45–07:05' : s === 'CHIEU' ? '11:45–12:05' : '17:45–18:05'})</div>
              </div>
            </div>
          );
        })}
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState title="Chưa có lượt điểm danh hôm nay" hint="Ứng viên điểm danh qua Zalo hoặc HR điểm danh thủ công." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="table-th">Thời gian</th>
                  <th className="table-th">Ứng viên</th>
                  <th className="table-th">Ca</th>
                  <th className="table-th">Phương thức</th>
                  <th className="table-th">Kết quả</th>
                  <th className="table-th">Lý do</th>
                  <th className="table-th">Training ngày</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="table-td text-xs text-slate-500">{formatDateTime(r.checkinAt)}</td>
                    <td className="table-td font-semibold">{r.candidate?.tenUv ?? r.candidateId}</td>
                    <td className="table-td">
                      <Badge className={cn(shiftColor(r.shift).bg, shiftColor(r.shift).text)}>{shiftColor(r.shift).label}</Badge>
                    </td>
                    <td className="table-td text-slate-500">{r.method}</td>
                    <td className="table-td">
                      {r.valid
                        ? <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 size={11} /> Hợp lệ</Badge>
                        : <Badge className="bg-rose-100 text-rose-700"><XCircle size={11} /> Không hợp lệ</Badge>}
                    </td>
                    <td className="table-td text-xs text-slate-500 max-w-[220px] truncate">{r.reason ?? '—'}</td>
                    <td className="table-td">{r.trainingDay ? `Ngày ${r.trainingDay}/7` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={manualOpen} onClose={() => setManualOpen(false)} title="Điểm danh thủ công"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setManualOpen(false)}>Hủy</button>
            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving && <Spinner size={14} />} Điểm danh
            </button>
          </>
        }>
        <div className="space-y-4">
          <Field label="Ứng viên (đang training)">
            <select className="input" value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
              <option value="">— Chọn ứng viên —</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.tenUv} · {c.chiNhanh} · {c.caLam}</option>
              ))}
            </select>
          </Field>
          <Field label="Ca">
            <select className="input" value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="SANG">SÁNG (06:45–07:05)</option>
              <option value="CHIEU">CHIỀU (11:45–12:05)</option>
              <option value="TOI">TỐI (17:45–18:05)</option>
            </select>
          </Field>
          <Field label="Thời gian điểm danh (mặc định: bây giờ)">
            <input type="time" className="input" value={checkinAt} onChange={(e) => setCheckinAt(e.target.value)} />
          </Field>
          <p className="text-[11px] text-slate-400">
            Điểm danh hợp lệ khi: đang Training, có lịch ca hôm đó, đúng khung giờ ca, chưa điểm danh trùng.
          </p>
        </div>
      </Modal>
    </div>
  );
}