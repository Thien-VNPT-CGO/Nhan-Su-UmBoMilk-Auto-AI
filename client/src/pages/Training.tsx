import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, CalendarDays, Send, RefreshCw, Briefcase, Video } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Skeleton, EmptyState, Modal, Field, ConfirmDialog } from '../components/ui';
import { useToast } from '../stores/Toast';
import { getSocket } from '../api/socket';
import { cn, trainingStatusLabel } from '../utils/format';
import { debounce } from '../utils/debounce';
import { formatDate, formatDateTime, dateKey, addDays } from '../utils/date';

interface TrainingRow {
  id: string;
  tenUv: string;
  chiNhanh: string;
  caLam: string;
  sdtZalo: string;
  ngayBatDauTraining: string | null;
  trangThaiTraining: string | null;
  soNgayDaTraining: number;
  phongVanAt: string | null;
  ggMeetLink: string | null;
  dataVersion: number;
}

const STATUS_OPTIONS = [
  'CHUA_THAM_GIA', 'SAP_BAT_DAU', 'BAT_DAU', 'HOAN_THANH', 'KHONG_DU_NGAY', 'LOAI', 'NHAN_VIEN_CHINH_THUC',
];

const FILTERS = [
  { key: 'all', label: 'Toàn bộ' },
  { key: 'waiting', label: 'Chờ phỏng vấn' },
  { key: 'training', label: 'Đang training' },
  { key: 'done', label: 'Hoàn thành' },
  { key: 'need', label: 'Cần xử lý' },
];

export default function Training() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TrainingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [edit, setEdit] = useState<TrainingRow | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<{ row: TrainingRow; status: string } | null>(null);
  const [confirmEmployee, setConfirmEmployee] = useState<TrainingRow | null>(null);
  const [startDate, setStartDate] = useState(dateKey());
  const [newShift, setNewShift] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<TrainingRow[]>('/training');
      setRows(data);
    } catch {
      toast('error', 'Không tải được danh sách đào tạo.');
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
    ['training:updated', 'shift:updated', 'attendance:checked', 'candidate:decision'].forEach((ev) => socket.on(ev, refresh));
    return () => {
      ['training:updated', 'shift:updated', 'attendance:checked', 'candidate:decision'].forEach((ev) => socket.off(ev, refresh));
      refresh.cancel();
    };
  }, [load]);

  const saveStart = async () => {
    if (!edit) return;
    try {
      await api.patch(`/training/${edit.id}`, { ngayBatDau: `${startDate}T00:00:00` });
      toast('success', 'Đã lưu ngày bắt đầu Training.');
      setEdit(null);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thất bại.');
    }
  };

  const changeStatus = async () => {
    if (!confirmStatus) return;
    try {
      await api.patch(`/training/${confirmStatus.row.id}`, { trangThaiTraining: confirmStatus.status });
      toast('success', 'Đã cập nhật trạng thái.');
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thất bại.');
    }
  };

  const saveShift = async () => {
    if (!edit || !newShift) return;
    try {
      await api.patch(`/training/${edit.id}`, { caLam: newShift, version: edit.dataVersion });
      toast('success', 'Đã đổi ca.');
      setEdit(null);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Đổi ca thất bại (có thể bị xung đột version).');
    }
  };

  const notify = async (id: string) => {
    try {
      const d = await api.post<{ ok: boolean; provider: string }>(`/training/${id}/zalo-notify`, {});
      toast('success', `Đã gửi Zalo (${d.provider}).`);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gửi Zalo thất bại.');
    }
  };

  const notifyInterview = async (id: string) => {
    try {
      const d = await api.post<{ ok: boolean; provider: string }>(`/training/${id}/interview-notify`, {});
      toast('success', `Đã gửi lại lời mời phỏng vấn (${d.provider}).`);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gửi lời mời phỏng vấn thất bại.');
    }
  };

  const confirmEmployeeFn = async () => {
    if (!confirmEmployee) return;
    try {
      await api.post(`/training/${confirmEmployee.id}/employee`, {});
      toast('success', `${confirmEmployee.tenUv} đã trở thành nhân viên chính thức.`);
      setConfirmEmployee(null);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Xác nhận thất bại.');
    }
  };

  const summary = {
    all: rows.length,
    waiting: rows.filter((r) => !r.ngayBatDauTraining).length,
    started: rows.filter((r) => ['SAP_BAT_DAU', 'BAT_DAU'].includes(r.trangThaiTraining ?? '')).length,
    done: rows.filter((r) => r.trangThaiTraining === 'HOAN_THANH').length,
    need: rows.filter((r) => ['KHONG_DU_NGAY', 'LOAI'].includes(r.trangThaiTraining ?? '')).length,
  };

  const visible = rows.filter((r) => {
    if (filter === 'waiting') return !r.ngayBatDauTraining;
    if (filter === 'training') return ['SAP_BAT_DAU', 'BAT_DAU'].includes(r.trangThaiTraining ?? '');
    if (filter === 'done') return r.trangThaiTraining === 'HOAN_THANH';
    if (filter === 'need') return ['KHONG_DU_NGAY', 'LOAI'].includes(r.trangThaiTraining ?? '');
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Nhân Viên Training</h1>
          <p className="text-sm text-slate-500">
            {summary.waiting} chờ phỏng vấn · {summary.started} đang training · {summary.done} hoàn thành · {summary.need} cần xử lý
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => navigate('/shifts')}>
            <CalendarDays size={15} /> Lịch làm việc
          </button>
          <button className="btn-secondary" onClick={() => void load()}><RefreshCw size={15} /> Làm mới</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-bold transition',
              filter === f.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className={cn('ml-1.5 opacity-70', filter === f.key ? 'text-white' : 'text-slate-400')}>
              {f.key === 'all' ? summary.all : f.key === 'waiting' ? summary.waiting : f.key === 'training' ? summary.started : f.key === 'done' ? summary.done : summary.need}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : visible.length === 0 ? (
        <div className="card"><EmptyState title="Chưa có nhân sự Training" hint="Duyệt PASS ứng viên (kèm hẹn phỏng vấn) để đưa vào đây." /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="table-th">Mã UV</th>
                  <th className="table-th">Tên</th>
                  <th className="table-th">SĐT</th>
                  <th className="table-th">Chi nhánh</th>
                  <th className="table-th">Ca</th>
                  <th className="table-th">Lịch phỏng vấn</th>
                  <th className="table-th">Ngày bắt đầu</th>
                  <th className="table-th">Số ngày</th>
                  <th className="table-th">Trạng thái</th>
                  <th className="table-th">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-brand-50/40">
                    <td className="table-td font-mono text-xs font-bold text-brand-600">{r.id}</td>
                    <td className="table-td font-semibold">{r.tenUv}</td>
                    <td className="table-td">{r.sdtZalo}</td>
                    <td className="table-td">{r.chiNhanh}</td>
                    <td className="table-td">
                      <button className="btn-secondary !px-2 !py-0.5 text-xs" onClick={() => { setEdit(r); setNewShift(r.caLam); }}>
                        {r.caLam}
                      </button>
                    </td>
                    <td className="table-td">
                      {r.phongVanAt ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold text-emerald-700">{formatDateTime(r.phongVanAt)}</span>
                          {r.ggMeetLink && (
                            <a className="text-[11px] text-sky-600 underline truncate max-w-[180px]" href={r.ggMeetLink} target="_blank" rel="noreferrer">
                              {r.ggMeetLink}
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Chưa hẹn</span>
                      )}
                    </td>
                    <td className="table-td">
                      <button
                        className="btn-secondary !px-2 !py-0.5 text-xs"
                        onClick={() => {
                          setEdit(r);
                          setStartDate(r.ngayBatDauTraining ? r.ngayBatDauTraining.slice(0, 10) : dateKey());
                        }}
                      >
                        {formatDate(r.ngayBatDauTraining) || 'Chưa đặt'}
                      </button>
                    </td>
                    <td className="table-td">
                      <div className="flex items-center gap-1.5">
                        <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(100, (r.soNgayDaTraining / 7) * 100)}%` }} />
                        </div>
                        <span className="text-xs font-bold text-slate-600">{r.soNgayDaTraining}/7</span>
                      </div>
                    </td>
                    <td className="table-td">
                      <select
                        className="input !w-auto !py-1 text-xs"
                        value={r.trangThaiTraining ?? 'CHUA_THAM_GIA'}
                        onChange={(e) => setConfirmStatus({ row: r, status: e.target.value })}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{trainingStatusLabel[s]?.label ?? s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="table-td">
                      <div className="flex gap-1.5">
                        {r.trangThaiTraining === 'HOAN_THANH' && (
                          <button
                            className="btn-primary !px-2.5 !py-1.5 !text-xs"
                            onClick={() => setConfirmEmployee(r)}
                            title="Xác nhận nhân viên chính thức"
                          >
                            <Briefcase size={13} /> Nhận việc
                          </button>
                        )}
                        {r.phongVanAt && !r.ngayBatDauTraining && (
                          <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => notifyInterview(r.id)} title="Gửi lại lời mời phỏng vấn qua Zalo">
                            <Video size={13} />
                          </button>
                        )}
                        <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => notify(r.id)} title="Gửi thông báo Training Zalo">
                          <Send size={13} />
                        </button>
                        <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => navigate(`/shifts`)}>
                          <CalendarDays size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Chỉnh Training – ${edit?.tenUv ?? ''}`}>
        <div className="space-y-4">
          <Field label="Ngày bắt đầu đào tạo">
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <button className="btn-primary w-full" onClick={saveStart}>
            <GraduationCap size={15} /> Lưu ngày bắt đầu
          </button>
          <div className="border-t border-slate-100 pt-4">
            <Field label="Đổi ca">
              <select className="input" value={newShift} onChange={(e) => setNewShift(e.target.value)}>
                {['SÁNG', 'CHIỀU', 'TỐI', 'CA 2 (SÁNG + CHIỀU)', 'CA 3 (SÁNG + TỐI)'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <button className="btn-secondary w-full mt-3" onClick={saveShift}>Lưu ca mới</button>
          </div>
          <p className="text-[11px] text-slate-400">
            Lịch chi tiết từng ngày được quản lý tại trang <b>Lịch làm việc</b>. Deadline tự động: {formatDate(addDays(new Date(`${startDate}T00:00:00`), 14))} (14 ngày).
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmStatus}
        onClose={() => setConfirmStatus(null)}
        title="Đổi trạng thái Training"
        message={confirmStatus ? `Đổi trạng thái của ${confirmStatus.row.tenUv} sang "${trainingStatusLabel[confirmStatus.status]?.label ?? confirmStatus.status}"?` : ''}
        confirmLabel="Cập nhật"
        onConfirm={changeStatus}
      />

      <ConfirmDialog
        open={!!confirmEmployee}
        onClose={() => setConfirmEmployee(null)}
        title="Xác nhận nhân viên chính thức"
        message={confirmEmployee ? `${confirmEmployee.tenUv} đã hoàn thành 7 ngày training. Xác nhận thành nhân viên chính thức? Sau khi xác nhận, nhân sự sẽ được xếp ca làm việc bình thường tại tab "Nhân viên chính thức" của trang Lịch làm việc.` : ''}
        confirmLabel="Xác nhận nhận việc"
        onConfirm={confirmEmployeeFn}
      />
    </div>
  );
}