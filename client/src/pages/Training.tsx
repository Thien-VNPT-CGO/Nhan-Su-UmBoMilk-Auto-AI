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
  interviewStatus: string | null;
  dataVersion: number;
}

const INTERVIEW_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  DA_PV: { label: 'Đã PV', cls: 'bg-sky-100 text-sky-700' },
  QUA_PV: { label: 'Qua PV', cls: 'bg-emerald-100 text-emerald-700' },
  TRUOT_PV: { label: 'Trượt PV', cls: 'bg-rose-100 text-rose-700' },
  VANG: { label: 'Vắng', cls: 'bg-rose-100 text-rose-700' },
  CHUA_PV: { label: 'Chưa PV', cls: 'bg-amber-100 text-amber-700' },
};

const STATUS_OPTIONS = [
  'CHUA_THAM_GIA', 'SAP_BAT_DAU', 'BAT_DAU', 'HOAN_THANH', 'KHONG_DU_NGAY', 'LOAI', 'NHAN_VIEN_CHINH_THUC',
];

const FILTERS = [
  { key: 'all', label: 'Toàn bộ' },
  { key: 'today', label: 'PV hôm nay' },
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
  const [newBranch, setNewBranch] = useState('');
  const [interviewEdit, setInterviewEdit] = useState<TrainingRow | null>(null);
  const [ivPhongVanAt, setIvPhongVanAt] = useState('');
  const [ivGgMeetLink, setIvGgMeetLink] = useState('');
  const [ivResend, setIvResend] = useState(true);

  const BRANCH_OPTIONS = [
    '111 Tôn Đản, Quận 4',
    '232 Nguyễn Thị Minh Khai, Quận 3',
    'Chi Nhánh Quận 1',
    'Chi Nhánh Gò Vấp',
    'Chi Nhánh Bình Thạnh',
  ];

  const SHIFT_OPTIONS = [
    'Ca Sáng: 7g00 - 12g00',
    'Ca Chiều: 12g00 - 17g00',
    'Ca Tối: 17g00 - 22g00',
    'Ca Sáng + Ca Tối',
    'Ca Sáng + Ca Chiều',
    'Ca Chiều + Ca Tối',
  ];

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

  const openEditModal = (r: TrainingRow) => {
    setEdit(r);
    setStartDate(r.ngayBatDauTraining ? r.ngayBatDauTraining.slice(0, 10) : dateKey());
    setNewShift(r.caLam || '');
    setNewBranch(r.chiNhanh || '');
  };

  const saveTrainingInfo = async () => {
    if (!edit) return;
    try {
      await api.patch(`/training/${edit.id}`, {
        ngayBatDau: `${startDate}T00:00:00`,
        caLam: newShift.trim() || undefined,
        chiNhanh: newBranch.trim() || undefined,
      });
      toast('success', 'Đã cập nhật Ngày bắt đầu, Ca làm & Chi nhánh chính thức!');
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

  const updateInterviewResult = async (id: string, interviewStatus: string) => {
    try {
      await api.patch(`/candidates/${id}/interview`, { interviewStatus });
      toast('success', 'Đã cập nhật kết quả phỏng vấn!');
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    }
  };

  const openInterviewEdit = (r: TrainingRow) => {
    setInterviewEdit(r);
    setIvPhongVanAt(r.phongVanAt ? r.phongVanAt.slice(0, 16) : '');
    setIvGgMeetLink(r.ggMeetLink ?? '');
    setIvResend(true);
  };

  const saveInterviewEdit = async () => {
    if (!interviewEdit) return;
    if (!ivPhongVanAt) {
      toast('error', 'Chọn thời gian phỏng vấn.');
      return;
    }
    try {
      const res = await api.patch<{ zalo: { ok: boolean } | null }>(`/candidates/${interviewEdit.id}/interview`, {
        phongVanAt: ivPhongVanAt,
        ggMeetLink: ivGgMeetLink.trim() || undefined,
        resend: ivResend,
      });
      toast('success', `Đã sửa lịch phỏng vấn.${ivResend && !res.zalo?.ok ? ' ⚠ Không gửi được tin Zalo.' : ''}`);
      setInterviewEdit(null);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Sửa lịch thất bại.');
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
    today: rows.filter((r) => r.phongVanAt && formatDate(r.phongVanAt) === formatDate(new Date())).length,
    waiting: rows.filter((r) => !r.ngayBatDauTraining).length,
    started: rows.filter((r) => ['SAP_BAT_DAU', 'BAT_DAU'].includes(r.trangThaiTraining ?? '')).length,
    done: rows.filter((r) => r.trangThaiTraining === 'HOAN_THANH').length,
    need: rows.filter((r) => ['KHONG_DU_NGAY', 'LOAI'].includes(r.trangThaiTraining ?? '')).length,
  };

  const visible = rows.filter((r) => {
    if (filter === 'today') return r.phongVanAt && formatDate(r.phongVanAt) === formatDate(new Date());
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
            {summary.today} PV hôm nay · {summary.waiting} chờ phỏng vấn · {summary.started} đang training · {summary.done} hoàn thành · {summary.need} cần xử lý
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
              {f.key === 'all' ? summary.all : f.key === 'today' ? summary.today : f.key === 'waiting' ? summary.waiting : f.key === 'training' ? summary.started : f.key === 'done' ? summary.done : summary.need}
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
                    <td className="table-td">
                      {r.chiNhanh && !r.chiNhanh.includes('Có thể làm') ? (
                        <span className="font-medium text-slate-800">{r.chiNhanh}</span>
                      ) : (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-amber-700 bg-amber-100/90 hover:bg-amber-200 px-2.5 py-1 rounded-lg border border-amber-300 flex items-center gap-1 shadow-2xs animate-pulse"
                          onClick={() => openEditModal(r)}
                          title="Click để chốt chi nhánh làm việc chính thức"
                        >
                          ⚠️ Chốt chi nhánh
                        </button>
                      )}
                    </td>
                    <td className="table-td">
                      {r.caLam && !r.caLam.includes('Có thể làm') ? (
                        <button className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => openEditModal(r)}>
                          {r.caLam}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-rose-700 bg-rose-100/90 hover:bg-rose-200 px-2.5 py-1 rounded-lg border border-rose-300 flex items-center gap-1 shadow-2xs animate-pulse"
                          onClick={() => openEditModal(r)}
                          title="Click để chốt ca làm việc chính thức"
                        >
                          ⚠️ Chốt ca làm
                        </button>
                      )}
                    </td>
                    <td className="table-td">
                      <div className="flex flex-col gap-1">
                        {r.phongVanAt ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-emerald-700">{formatDateTime(r.phongVanAt)}</span>
                            <button className="text-[10px] text-slate-400 hover:text-slate-600 underline" onClick={() => openInterviewEdit(r)}>
                              Sửa
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Chưa hẹn</span>
                        )}

                        {/* Bộ 4 nút Kết quả phỏng vấn tích hợp trực tiếp cho từng ứng viên */}
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {[
                            { key: 'DA_PV', label: 'Đã PV', activeCls: 'bg-sky-600 text-white font-bold' },
                            { key: 'QUA_PV', label: 'Qua PV', activeCls: 'bg-emerald-600 text-white font-bold' },
                            { key: 'TRUOT_PV', label: 'Trượt PV', activeCls: 'bg-rose-600 text-white font-bold' },
                            { key: 'VANG', label: 'Vắng', activeCls: 'bg-rose-600 text-white font-bold' },
                          ].map((st) => {
                            const isCurrent = r.interviewStatus === st.key;
                            return (
                              <button
                                key={st.key}
                                type="button"
                                className={cn(
                                  'px-2 py-0.5 rounded text-[10px] transition-all border',
                                  isCurrent
                                    ? st.activeCls + ' border-transparent shadow-2xs'
                                    : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-600'
                                )}
                                onClick={() => updateInterviewResult(r.id, st.key)}
                              >
                                {st.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </td>

                    <td className="table-td">
                      <button
                        className="btn-secondary !px-2 !py-0.5 text-xs"
                        onClick={() => openEditModal(r)}
                      >
                        {formatDate(r.ngayBatDauTraining) || 'Chưa đặt'}
                      </button>
                    </td>
                    <td className="table-td">
                      <span className="font-bold text-brand-700">{r.soNgayDaTraining}/7</span>
                    </td>
                    <td className="table-td">
                      <select
                        className="input !py-1 !text-xs"
                        value={r.trangThaiTraining ?? 'CHUA_THAM_GIA'}
                        onChange={(e) => setConfirmStatus({ row: r, status: e.target.value })}
                      >
                        {STATUS_OPTIONS.map((st) => (
                          <option key={st} value={st}>
                            {trainingStatusLabel[st]?.label ?? st}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="table-td">
                      <div className="flex items-center gap-1">
                        <button
                          className="btn-primary !px-2.5 !py-1.5 !text-xs"
                          onClick={() => openEditModal(r)}
                          title="Cập nhật chi nhánh, ca làm & ngày bắt đầu"
                        >
                          Chốt ca & lịch
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

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Cập Nhật Thông Tin Đào Tạo & Phân Ca – ${edit?.tenUv ?? ''}`}>
        <div className="space-y-4">
          <Field label="Chi nhánh làm việc chính thức">
            <div className="space-y-2">
              <select className="input text-xs" value={newBranch} onChange={(e) => setNewBranch(e.target.value)}>
                <option value="">-- Chọn chi nhánh chính thức --</option>
                {BRANCH_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <input
                className="input text-xs"
                placeholder="Hoặc nhập chi nhánh tùy chỉnh tại đây..."
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
              />
            </div>
          </Field>

          <Field label="Ca làm việc chính thức">
            <div className="space-y-2">
              <select className="input text-xs" value={newShift} onChange={(e) => setNewShift(e.target.value)}>
                <option value="">-- Chọn ca làm chính thức --</option>
                {SHIFT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input
                className="input text-xs"
                placeholder="Hoặc nhập ca làm tùy chỉnh (Ví dụ: Ca Sáng + Ca Tối)..."
                value={newShift}
                onChange={(e) => setNewShift(e.target.value)}
              />
            </div>
          </Field>

          <Field label="Ngày bắt đầu đào tạo">
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>

          <button className="btn-primary w-full !py-3 font-bold text-xs flex items-center justify-center gap-2" onClick={saveTrainingInfo}>
            <GraduationCap size={16} /> Lưu Cập Nhật Đào Tạo & Phân Ca
          </button>
          <p className="text-[11px] text-slate-400">
            Lịch chi tiết từng ngày được tự động đồng bộ sang trang <b>Lịch làm việc</b>.
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

      <Modal open={!!interviewEdit} onClose={() => setInterviewEdit(null)} title={`Sửa lịch phỏng vấn – ${interviewEdit?.tenUv ?? ''}`}>
        <div className="space-y-4">
          <Field label="Thời gian phỏng vấn">
            <input type="datetime-local" className="input" value={ivPhongVanAt} onChange={(e) => setIvPhongVanAt(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: '+1 giờ', get: () => new Date(Date.now() + 60 * 60_000) },
              { label: '+3 giờ', get: () => new Date(Date.now() + 3 * 60 * 60_000) },
              { label: 'Hôm nay 14:00', get: () => { const d = new Date(); d.setHours(14, 0, 0, 0); return d; } },
              { label: 'Hôm nay 15:30', get: () => { const d = new Date(); d.setHours(15, 30, 0, 0); return d; } },
              { label: 'Mai 9:00', get: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
              { label: 'Mai 14:00', get: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(14, 0, 0, 0); return d; } },
            ].map((q) => {
              const d = q.get();
              const pad = (n: number) => String(n).padStart(2, '0');
              return (
                <button key={q.label} className="btn-secondary !px-2.5 !py-1 !text-[11px]" onClick={() => setIvPhongVanAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)}>
                  {q.label}
                </button>
              );
            })}
          </div>
          <Field label="Link Google Meet">
            <input type="url" className="input" value={ivGgMeetLink} onChange={(e) => setIvGgMeetLink(e.target.value)} placeholder="https://meet.google.com/xxx-xxxx-xxx" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={ivResend} onChange={(e) => setIvResend(e.target.checked)} />
            Gửi lại lời mời phỏng vấn qua Zalo sau khi lưu
          </label>
          <button className="btn-primary w-full" onClick={saveInterviewEdit}>
            <Video size={15} /> Lưu lịch phỏng vấn
          </button>
        </div>
      </Modal>
    </div>
  );
}