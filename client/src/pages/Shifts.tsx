import { useEffect, useState, useCallback, useMemo } from 'react';
import { RefreshCw, CalendarDays, GraduationCap, Briefcase } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Skeleton, Badge, Modal, Spinner, Field } from '../components/ui';

import { useToast } from '../stores/Toast';
import { getSocket } from '../api/socket';
import { dateKey, addDays, weekdayVi } from '../utils/date';
import { cn, shiftColor } from '../utils/format';
import { debounce } from '../utils/debounce';

interface RowData {
  candidateId: string;
  tenUv: string;
  chiNhanh: string;
  caLam: string;
  shifts: Record<string, { shifts: string }>;
}

const SHIFT_KEYS = ['SANG', 'CHIEU', 'TOI', 'OFF'] as const;

function startOfToday(): string {
  const d = new Date();
  const tzDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return dateKey(tzDate);
}

export default function Shifts() {
  const { toast } = useToast();
  const [tab, setTab] = useState<'training' | 'employees'>('training');
  const [trainingRows, setTrainingRows] = useState<RowData[]>([]);
  const [employeeRows, setEmployeeRows] = useState<RowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ candidateId: string; tenUv: string; date: string; current: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editInfo, setEditInfo] = useState<{ candidateId: string; tenUv: string; chiNhanh: string; caLam: string } | null>(null);
  const [branchDraft, setBranchDraft] = useState('');
  const [shiftDraft, setShiftDraft] = useState('');

  const saveBranchAndShift = async () => {
    if (!editInfo) return;
    try {
      await api.patch(`/training/${editInfo.candidateId}`, {
        chiNhanh: branchDraft.trim() || undefined,
        caLam: shiftDraft.trim() || undefined,
      });
      toast('success', 'Đã cập nhật Chi nhánh & Ca làm chính thức!');
      setEditInfo(null);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    }
  };


  const today = startOfToday();
  const endDate = '2026-12-31';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ training: RowData[]; employees: RowData[] }>(`/shifts?from=${today}&to=${endDate}`);
      setTrainingRows(data.training);
      setEmployeeRows(data.employees);
    } catch {
      toast('error', 'Không tải được lịch làm việc.');
    } finally {
      setLoading(false);
    }
  }, [today, endDate, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = debounce(() => void load(), 500);
    socket.on('shift:updated', refresh);
    socket.on('candidate:decision', refresh);
    socket.on('training:updated', refresh);
    return () => {
      socket.off('shift:updated', refresh);
      socket.off('candidate:decision', refresh);
      socket.off('training:updated', refresh);
      refresh.cancel();
    };
  }, [load]);

  const dates = useMemo(() => {
    const list: string[] = [];
    let cur = new Date(`${today}T00:00:00`);
    const end = new Date('2026-12-31T00:00:00');
    while (cur <= end) {
      list.push(dateKey(cur));
      cur = addDays(cur, 1);
    }
    return list;
  }, [today]);

  const save = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      await api.put(`/shifts/${edit.candidateId}/${edit.date}`, { shifts: selected.length ? selected : ['OFF'] });
      toast('success', 'Đã lưu ca.');
      setEdit(null);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Lưu ca thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const toggleShift = (k: string) => {
    setSelected((s) => {
      if (k === 'OFF') return ['OFF'];
      const withoutOff = s.filter((x) => x !== 'OFF');
      return withoutOff.includes(k) ? withoutOff.filter((x) => x !== k) : [...withoutOff, k];
    });
  };

  const isToday = (d: string) => d === today;
  const rows = tab === 'training' ? trainingRows : employeeRows;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Lịch làm việc</h1>
          <p className="text-sm text-slate-500">
            {today} → 31/12/2026 · click ô để đổi ca
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['SÁNG', 'CHIỀU', 'TỐI', 'OFF'] as const).map((s) => {
            const c = shiftColor(s);
            return <Badge key={s} className={c.bg + ' ' + c.text}>{c.label}</Badge>;
          })}
          <button className="btn-secondary" onClick={() => void load()}><RefreshCw size={15} /> Làm mới</button>
        </div>
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={() => setTab('training')}
          className={cn(
            'rounded-xl px-4 py-2 text-sm font-bold transition-all flex items-center gap-1.5',
            tab === 'training' ? 'bg-brand-500 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200',
          )}
        >
          <GraduationCap size={15} /> Đào tạo 7 ngày
          <Badge className={tab === 'training' ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-600'}>{trainingRows.length}</Badge>
        </button>
        <button
          onClick={() => setTab('employees')}
          className={cn(
            'rounded-xl px-4 py-2 text-sm font-bold transition-all flex items-center gap-1.5',
            tab === 'employees' ? 'bg-violet-600 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200',
          )}
        >
          <Briefcase size={15} /> Nhân viên chính thức
          <Badge className={tab === 'employees' ? 'bg-white/20 text-white' : 'bg-violet-50 text-violet-600'}>{employeeRows.length}</Badge>
        </button>
      </div>

      {tab === 'training' && (
        <p className="text-xs text-slate-500">
          <b>TH1 – Đào tạo:</b> xếp ca cho <b>7 ngày bất kỳ</b> trong quá trình training. Người đủ 7 ngày sẽ tự chuyển HOÀN THÀNH.
        </p>
      )}
      {tab === 'employees' && (
        <p className="text-xs text-slate-500">
          <b>TH2 – Nhân viên chính thức:</b> đã hoàn thành training và được xác nhận nhận việc — xếp ca làm việc bình thường (SÁNG / CHIỀU / TỐI / OFF).
        </p>
      )}

      {loading ? (
        <Skeleton className="h-96" />
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">
          {tab === 'training'
            ? 'Chưa có nhân sự đào tạo. Duyệt ĐẠT ứng viên tại trang Ứng viên.'
            : 'Chưa có nhân viên chính thức. Xác nhận nhận việc tại trang Đào tạo khi nhân sự hoàn thành 7 ngày.'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="table-th sticky left-0 bg-slate-50 z-20 min-w-[180px] border-r border-slate-100">
                    <div className="flex items-center gap-1.5"><CalendarDays size={13} /> Nhân sự / Ngày</div>
                  </th>
                  {dates.map((d) => {
                    const dt = new Date(`${d}T00:00:00`);
                    return (
                      <th
                        key={d}
                        className={cn(
                          'min-w-[84px] text-center px-1 py-2 border-r border-slate-100',
                          isToday(d) && 'bg-brand-50 text-brand-700',
                        )}
                      >
                        <div className="text-[10px] font-semibold uppercase text-slate-400">{weekdayVi(dt).replace('Thứ ', 'T')}</div>
                        <div className="text-xs font-bold">{d.slice(8, 10)}/{d.slice(5, 7)}</div>
                        {isToday(d) && <div className="text-[9px] font-extrabold text-brand-500">HÔM NAY</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.candidateId} className="hover:bg-brand-50/30">
                    <td className="sticky left-0 bg-white z-10 min-w-[200px] px-3 py-2 border-r border-slate-100">
                      <div className="font-semibold text-slate-800 text-sm">{r.tenUv}</div>
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        <span className="text-[10px] font-mono text-brand-600 font-bold">{r.candidateId}</span>
                        {r.chiNhanh && !r.chiNhanh.includes('Có thể làm') ? (
                          <span className="text-[10px] text-slate-500 font-medium">· {r.chiNhanh}</span>
                        ) : (
                          <button
                            type="button"
                            className="text-[9px] font-bold text-amber-700 bg-amber-100/90 hover:bg-amber-200 px-1.5 py-0.5 rounded border border-amber-300 animate-pulse"
                            onClick={() => {
                              setEditInfo({ candidateId: r.candidateId, tenUv: r.tenUv, chiNhanh: r.chiNhanh, caLam: r.caLam });
                              setBranchDraft(r.chiNhanh || '');
                              setShiftDraft(r.caLam || '');
                            }}
                          >
                            ⚠️ Chốt chi nhánh
                          </button>
                        )}
                        {r.caLam && !r.caLam.includes('Có thể làm') ? (
                          <span className="text-[10px] text-slate-400">· {r.caLam}</span>
                        ) : (
                          <button
                            type="button"
                            className="text-[9px] font-bold text-rose-700 bg-rose-100/90 hover:bg-rose-200 px-1.5 py-0.5 rounded border border-rose-300 animate-pulse"
                            onClick={() => {
                              setEditInfo({ candidateId: r.candidateId, tenUv: r.tenUv, chiNhanh: r.chiNhanh, caLam: r.caLam });
                              setBranchDraft(r.chiNhanh || '');
                              setShiftDraft(r.caLam || '');
                            }}
                          >
                            ⚠️ Chốt ca
                          </button>
                        )}
                      </div>
                    </td>

                    {dates.map((d) => {
                      const cell = r.shifts?.[d];
                      const shifts = cell ? cell.shifts.split('|').filter(Boolean) : [];
                      const colors = shifts.map((s) => shiftColor(s).bg);
                      return (
                        <td key={d} className="border-r border-slate-50 p-1 text-center">
                          <button
                            onClick={() => {
                              setEdit({ candidateId: r.candidateId, tenUv: r.tenUv, date: d, current: shifts.join('|') });
                              setSelected(shifts.length ? shifts : ['OFF']);
                            }}
                            className={cn(
                              'w-full h-9 rounded-lg flex items-center justify-center gap-0.5 transition-all hover:ring-2 hover:ring-brand-300',
                              shifts.length === 0 && 'bg-slate-50 hover:bg-slate-100',
                              isToday(d) && 'ring-1 ring-brand-200',
                              shifts.length === 1 ? colors[0] : 'bg-slate-100',
                            )}
                            title={`${r.tenUv} – ${d}: ${shifts.join(' + ') || 'Chưa xếp'}`}
                          >
                            {shifts.length > 1 ? (
                              <span className="flex gap-0.5">
                                {shifts.map((s, i) => (
                                  <span key={i} className={cn('w-2.5 h-4 rounded-sm', shiftColor(s).bg)} />
                                ))}
                              </span>
                            ) : shifts.length === 1 ? (
                              <span className={cn('text-[10px] font-extrabold', shiftColor(shifts[0]).text)}>
                                {shifts[0] === 'OFF' ? 'OFF' : shifts[0].slice(0, 3)}
                              </span>
                            ) : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? `${edit.tenUv} – ${edit.date.slice(8, 10)}/${edit.date.slice(5, 7)}/${edit.date.slice(0, 4)}` : ''}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEdit(null)}>Hủy</button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving && <Spinner size={14} />} Lưu ca
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500">Có thể chọn nhiều ca trong ngày (với training: tối đa 1 ngày training/ngày):</p>
          <div className="grid grid-cols-2 gap-2.5">
            {SHIFT_KEYS.map((k) => {
              const c = shiftColor(k);
              const active = selected.includes(k);
              return (
                <button
                  key={k}
                  onClick={() => toggleShift(k)}
                  className={cn(
                    'rounded-xl border-2 px-4 py-3 text-sm font-bold transition-all',
                    active ? c.bg + ' ' + c.text + ' border-transparent' : 'bg-white border-slate-200 text-slate-500',
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
            Hiện tại: <b>{edit?.current.replace(/\|/g, ' + ') || 'Chưa xếp'}</b>
            {selected.length === 0 && <span className="ml-2 text-amber-600">→ sẽ lưu OFF</span>}
          </div>
        </div>
      </Modal>

      <Modal open={!!editInfo} onClose={() => setEditInfo(null)} title={`Chốt Chi Nhánh & Ca Làm Chính Thức – ${editInfo?.tenUv ?? ''}`}>
        <div className="space-y-4">
          <Field label="Chi nhánh làm việc chính thức">
            <input
              className="input text-xs font-medium"
              placeholder="Nhập chi nhánh chính thức (VD: 111 Tôn Đản, Quận 4)..."
              value={branchDraft}
              onChange={(e) => setBranchDraft(e.target.value)}
            />
          </Field>
          <Field label="Ca làm việc chính thức">
            <input
              className="input text-xs font-medium"
              placeholder="Nhập ca làm chính thức (VD: Ca Sáng: 7g00 - 12g00)..."
              value={shiftDraft}
              onChange={(e) => setShiftDraft(e.target.value)}
            />
          </Field>
          <button className="btn-primary w-full !py-3 text-xs font-bold" onClick={saveBranchAndShift}>
            Lưu Chi Nhánh & Ca Làm Chính Thức
          </button>
        </div>
      </Modal>
    </div>
  );

}