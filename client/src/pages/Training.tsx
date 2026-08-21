import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, CalendarDays, Send, RefreshCw, Briefcase, Video, CheckCircle2, XCircle, FileCheck, FileText } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Skeleton, EmptyState, Modal, Field, ConfirmDialog } from '../components/ui';
import InterviewScoreModal from '../components/InterviewScoreModal';
import { useToast } from '../stores/Toast';
import { useAuth } from '../stores/auth';
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
  kinhNghiem?: string;
  ngayBatDauTraining: string | null;
  trangThaiTraining: string | null;
  soNgayDaTraining: number;
  phongVanAt: string | null;
  ggMeetLink: string | null;
  interviewStatus: string | null;
  hrDecision: string | null;
  hrReason?: string | null;
  dataVersion: number;
}

function getInterviewStatus(phongVanAtStr: string | null): 'CHUA_PV' | 'DANG_PV' | 'DA_PV' {
  if (!phongVanAtStr) return 'CHUA_PV';
  const pvTime = new Date(phongVanAtStr).getTime();
  if (isNaN(pvTime)) return 'CHUA_PV';

  const now = Date.now();
  const pvEndTime = pvTime + 30 * 60 * 1000; // 30 phút thời lượng phỏng vấn

  if (now < pvTime) return 'CHUA_PV';
  if (now >= pvTime && now <= pvEndTime) return 'DANG_PV';
  return 'DA_PV';
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
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [rows, setRows] = useState<TrainingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [edit, setEdit] = useState<TrainingRow | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<{ row: TrainingRow; status: string } | null>(null);
  const [confirmEmployee, setConfirmEmployee] = useState<TrainingRow | null>(null);
  const [newBranch, setNewBranch] = useState('');
  const [newShift, setNewShift] = useState('');
  const [startDate, setStartDate] = useState('');
  const [interviewEdit, setInterviewEdit] = useState<TrainingRow | null>(null);
  const [ivPhongVanAt, setIvPhongVanAt] = useState('');
  const [ivGgMeetLink, setIvGgMeetLink] = useState('');
  const [ivResend, setIvResend] = useState(true);

  const BRANCH_OPTIONS = [
    'CN1: 130 Vạn Kiếp, Phường 3, Quận Bình Thạnh',
    'CN2: 261 Tô Hiến Thành, Phường 12, Quận 10',
    'CN3: 120 Hoàng Diệu 2, Phường Linh Chiểu, TP. Thủ Đức',
    'CN4: 111 Tôn Đản, Phường 15, Quận 4',
  ];

  const SHIFT_OPTIONS = [
    'Ca sáng: 7h00 - 12h00',
    'Ca chiều: 12h00 - 18h00',
    'Ca tối: 18h00 - 23h00',
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
    const refreshData = debounce(() => {
      void load();
    }, 500);

    socket.on('training:updated', refreshData);
    socket.on('candidate:new', refreshData);
    socket.on('candidate:updated', refreshData);
    socket.on('candidate:decision', refreshData);

    return () => {
      socket.off('training:updated', refreshData);
      socket.off('candidate:new', refreshData);
      socket.off('candidate:updated', refreshData);
      socket.off('candidate:decision', refreshData);
    };
  }, [load]);

  const openEditModal = (r: TrainingRow) => {
    setEdit(r);
    setNewBranch(r.chiNhanh ?? '');
    setNewShift(r.caLam ?? '');
    setStartDate(r.ngayBatDauTraining ?? formatDate(new Date()));
  };

  const saveTrainingInfo = async () => {
    if (!edit) return;
    try {
      await api.patch(`/training/${edit.id}`, {
        chiNhanh: newBranch,
        caLam: newShift,
        ngayBatDauTraining: startDate,
        trangThaiTraining: 'SAP_BAT_DAU',
      });
      toast('success', 'Đã cập nhật thông tin đào tạo & phân ca thành công!');
      setEdit(null);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thao tác thất bại.');
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

  const [scoreModalCandidate, setScoreModalCandidate] = useState<TrainingRow | null>(null);

  const handleUpdateInterviewDecision = async (id: string, decision: 'PASS_PV' | 'PASS_HS' | 'FAIL', note?: string) => {
    try {
      if (decision === 'PASS_PV' || decision === 'PASS_HS') {
        await api.patch(`/candidates/${id}/interview`, {
          hrDecision: decision,
          hrReason: note,
          interviewStatus: 'QUA_PV',
          sendZaloNotice: true,
        });
        await api.patch(`/training/${id}`, { trangThaiTraining: 'BAT_DAU' });
        toast('success', `🎉 Đã cập nhật ứng viên ${decision === 'PASS_HS' ? 'ĐẠT HỒ SƠ' : 'ĐẠT PHỎNG VẤN'} & tự động gửi Zalo thông báo!`);
      } else {
        await api.patch(`/candidates/${id}/interview`, {
          hrDecision: 'FAIL',
          hrReason: note,
          interviewStatus: 'TRUOT_PV',
          sendZaloNotice: true,
        });
        await api.patch(`/training/${id}`, { trangThaiTraining: 'LOAI' });
        toast('error', '❌ Đã cập nhật ứng viên FAIL (Trượt phỏng vấn) & gửi tin cảm ơn Zalo.');
      }
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Cập nhật kết quả phỏng vấn thất bại.');
    }
  };

  const handleScoreSuccess = async (decision: 'PASS_PV' | 'PASS_HS' | 'FAIL', note: string, score: number) => {
    if (!scoreModalCandidate) return;
    await handleUpdateInterviewDecision(scoreModalCandidate.id, decision, note);
  };

  const [bookedInterviews, setBookedInterviews] = useState<{ id: string; tenUv: string; phongVanAt: string }[]>([]);

  const openInterviewEdit = (r: TrainingRow) => {
    if (!isAdmin) return;
    api.get<{ id: string; tenUv: string; phongVanAt: string }[]>('/candidates/booked-interviews')
      .then((data) => setBookedInterviews(data))
      .catch(() => undefined);
    setInterviewEdit(r);
    setIvPhongVanAt(r.phongVanAt ? r.phongVanAt.slice(0, 16) : '');
    setIvGgMeetLink(r.ggMeetLink ?? '');
    setIvResend(true);
  };

  const saveInterviewEdit = async () => {
    if (!isAdmin || !interviewEdit) return;
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
                {visible.map((r) => {
                  const isPendingConfirm = r.trangThaiTraining === 'CHUA_THAM_GIA';
                  const pvRealtimeStatus = getInterviewStatus(r.phongVanAt);
                  const isPassDecision = r.hrDecision === 'PASS_PV' || r.hrDecision === 'PASS_HS';
                  const isInterviewPassed = isPassDecision && r.trangThaiTraining !== 'CHUA_THAM_GIA' && r.trangThaiTraining !== 'LOAI';
                  const isRestLocked = isPendingConfirm || (!isPassDecision && pvRealtimeStatus !== 'DA_PV') || !isInterviewPassed;
                  const isInterviewDone = (isPassDecision || r.hrDecision === 'FAIL' || r.trangThaiTraining === 'LOAI' || r.interviewStatus === 'QUA_PV' || r.interviewStatus === 'TRUOT_PV') && pvRealtimeStatus === 'DA_PV';
                  return (
                    <tr key={r.id} className={cn('hover:bg-brand-50/40 transition-colors', isPendingConfirm && 'bg-rose-50/30')}>
                      <td className="table-td font-mono text-xs font-bold text-brand-600">{r.id}</td>
                      <td className="table-td font-semibold">{r.tenUv}</td>
                      <td className="table-td">{r.sdtZalo}</td>
                      <td className="table-td">
                        {r.chiNhanh && !r.chiNhanh.includes('Có thể làm') ? (
                          <span className="font-medium text-slate-800">{r.chiNhanh}</span>
                        ) : (
                          <button
                            type="button"
                            disabled={isPendingConfirm}
                            className={cn(
                              'text-[11px] font-semibold text-amber-700 bg-amber-100/90 hover:bg-amber-200 px-2.5 py-1 rounded-lg border border-amber-300 flex items-center gap-1 shadow-2xs animate-pulse',
                              isPendingConfirm && 'opacity-40 cursor-not-allowed pointer-events-none'
                            )}
                            onClick={() => openEditModal(r)}
                            title={isPendingConfirm ? 'Chờ ứng viên xác nhận Zalo' : 'Click để chốt chi nhánh làm việc chính thức'}
                          >
                            ⚠️ Chốt chi nhánh
                          </button>
                        )}
                      </td>
                      <td className="table-td">
                        {r.caLam && !r.caLam.includes('Có thể làm') ? (
                          <button className="btn-secondary !px-2.5 !py-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed" disabled={isPendingConfirm} onClick={() => openEditModal(r)}>
                            {r.caLam}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isPendingConfirm}
                            className={cn(
                              'text-[11px] font-semibold text-rose-700 bg-rose-100/90 hover:bg-rose-200 px-2.5 py-1 rounded-lg border border-rose-300 flex items-center gap-1 shadow-2xs animate-pulse',
                              isPendingConfirm && 'opacity-40 cursor-not-allowed pointer-events-none'
                            )}
                            onClick={() => openEditModal(r)}
                            title={isPendingConfirm ? 'Chờ ứng viên xác nhận Zalo' : 'Click để chốt ca làm việc chính thức'}
                          >
                            ⚠️ Chốt ca làm
                          </button>
                        )}
                      </td>
                      {/* Cột Lịch Phỏng Vấn (Hiển thị đẹp, gọn gàng, CHỈ 1 trạng thái duy nhất sau khi HR chốt) */}
                      <td className="table-td">
                        <div className="flex flex-col items-center justify-center gap-1.5 min-w-[200px] mx-auto">
                          {r.phongVanAt ? (
                            <div className="flex items-center justify-center gap-2">
                              <span className="text-xs font-bold text-slate-800">{formatDateTime(r.phongVanAt)}</span>
                              {isAdmin && (
                                <button
                                  className="text-[10px] text-slate-400 hover:text-slate-600 underline disabled:opacity-40"
                                  disabled={isPendingConfirm}
                                  onClick={() => openInterviewEdit(r)}
                                >
                                  Sửa
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Chưa hẹn</span>
                          )}

                          {/* Link Google Meet Trực Tiếp (Vô hiệu hóa sau khi có kết quả PV PASS/FAIL) */}
                          {r.ggMeetLink && (
                            isInterviewDone ? (
                              <span
                                className="inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-xl border border-slate-200 opacity-60 cursor-not-allowed pointer-events-none"
                                title="Phỏng vấn đã kết thúc - Link Google Meet đã bị vô hiệu hóa"
                              >
                                <Video size={13} />
                                <span>🔗 Google Meet (Đã kết thúc)</span>
                              </span>
                            ) : (
                              <a
                                href={r.ggMeetLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center gap-1.5 text-[11px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-xl border border-blue-200 shadow-2xs transition-all"
                                title="Click để vào phòng phỏng vấn Google Meet"
                              >
                                <Video size={13} />
                                <span>🔗 Vào Google Meet</span>
                              </a>
                            )
                          )}

                          {/* Hiển Thị Trạng Thái / Nút Bấm Đơn Nhất */}
                          {isPendingConfirm ? (
                            <span className="text-[10px] font-semibold text-rose-600 italic">⏳ CHỜ UV XÁC NHẬN ZALO</span>
                          ) : r.hrDecision === 'PASS_HS' ? (
                            /* Đã PASS_HS -> Hiển thị thẻ 📄 ĐẠT HỒ SƠ */
                            <div className="flex flex-col items-center gap-1">
                              <div className="inline-flex items-center justify-center gap-1 px-3 py-1 rounded-xl text-xs font-black bg-teal-600 text-white shadow-2xs">
                                <FileCheck size={15} />
                                <span>📄 ĐẠT HỒ SƠ</span>
                              </div>
                              {r.hrReason && (
                                <span className="text-[10px] text-slate-600 bg-teal-50 px-2 py-0.5 rounded-lg border border-teal-200/80 max-w-[200px] truncate" title={`Nhận xét từ HR: ${r.hrReason}`}>
                                  📝 {r.hrReason}
                                </span>
                              )}
                            </div>
                          ) : r.hrDecision === 'PASS_PV' && pvRealtimeStatus !== 'CHUA_PV' ? (
                            /* Đã PASS_PV -> Hiển thị thẻ ✅ ĐẠT PHỎNG VẤN */
                            <div className="flex flex-col items-center gap-1">
                              <div className="inline-flex items-center justify-center gap-1 px-3 py-1 rounded-xl text-xs font-black bg-emerald-600 text-white shadow-2xs">
                                <CheckCircle2 size={15} />
                                <span>✅ ĐẠT PHỎNG VẤN</span>
                              </div>
                              {r.hrReason && (
                                <span className="text-[10px] text-slate-600 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200/80 max-w-[200px] truncate" title={`Nhận xét từ HR: ${r.hrReason}`}>
                                  📝 {r.hrReason}
                                </span>
                              )}
                            </div>
                          ) : r.hrDecision === 'FAIL' || r.trangThaiTraining === 'LOAI' ? (
                            /* Đã FAIL -> Hiển thị thẻ ❌ TRƯỢT (FAIL) */
                            <div className="flex flex-col items-center gap-1">
                              <div className="inline-flex items-center justify-center gap-1 px-3 py-1 rounded-xl text-xs font-black bg-rose-600 text-white shadow-2xs">
                                <XCircle size={15} />
                                <span>❌ TRƯỢT (FAIL)</span>
                              </div>
                              {r.hrReason && (
                                <span className="text-[10px] text-rose-600 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200/80 max-w-[200px] truncate" title={`Nhận xét từ HR: ${r.hrReason}`}>
                                  📝 {r.hrReason}
                                </span>
                              )}
                            </div>
                          ) : pvRealtimeStatus === 'CHUA_PV' ? (
                            <div className="flex flex-col items-center justify-center gap-1">
                              <div className="flex items-center justify-center gap-1.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-amber-500 text-white shadow-2xs">
                                  ⏳ Chưa PV
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setScoreModalCandidate(r)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white !py-0.5 !px-2 text-[10px] font-extrabold shadow-2xs rounded-lg flex items-center gap-0.5 transition-all hover:scale-102 cursor-pointer"
                                title="Mở phiếu chấm điểm phỏng vấn theo bộ tiêu chí CÓ KN / KHÔNG KN"
                              >
                                <FileText size={11} />
                                <span>📝 Bảng điểm PV</span>
                              </button>
                            </div>
                          ) : (
                            /* Đã PV / Đang PV hoặc sẵn sàng chốt -> Cho phép HR chọn PASS PV / PASS HS / FAIL hoặc Mở Bảng điểm */
                            <div className="flex flex-wrap items-center justify-center gap-1 pt-0.5">
                              <button
                                type="button"
                                onClick={() => setScoreModalCandidate(r)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white !py-1 !px-2.5 text-[10px] font-extrabold shadow-2xs rounded-xl flex items-center gap-1 hover:scale-102 transition-all cursor-pointer"
                                title="Mở Phiếu Chấm Điểm Phỏng Vấn Nhanh (Có KN / Không KN)"
                              >
                                <FileText size={12} />
                                <span>📝 Bảng điểm PV</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateInterviewDecision(r.id, 'PASS_PV')}
                                className="btn-success !py-1 !px-2 !text-[10px] font-extrabold shadow-2xs flex items-center gap-0.5 hover:scale-102 cursor-pointer"
                                title="Chấm ĐẠT PHỎNG VẤN cho ứng viên"
                              >
                                <CheckCircle2 size={12} />
                                <span>✅ PASS PV</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateInterviewDecision(r.id, 'PASS_HS')}
                                className="bg-teal-600 hover:bg-teal-700 text-white !py-1 !px-2 !text-[10px] font-extrabold shadow-2xs rounded-xl flex items-center gap-0.5 hover:scale-102 transition-all cursor-pointer"
                                title="Chấm ĐẠT HỒ SƠ cho ứng viên (Đồng thời mở chức năng chốt ca & lịch)"
                              >
                                <FileCheck size={12} />
                                <span>📄 PASS HS</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateInterviewDecision(r.id, 'FAIL')}
                                className="btn-danger !py-1 !px-2 !text-[10px] font-extrabold shadow-2xs flex items-center gap-0.5 hover:scale-102 cursor-pointer"
                                title="Đánh dấu Ứng viên TRƯỢT (FAIL)"
                              >
                                <XCircle size={12} />
                                <span>❌ FAIL</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Cột Ngày Bắt Đầu (Bị khóa cho tới khi PASS) */}
                      <td className="table-td">
                        <button
                          className="btn-secondary !px-2 !py-0.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed mx-auto"
                          disabled={isRestLocked}
                          onClick={() => openEditModal(r)}
                          title={isRestLocked ? 'Khóa thao tác: Vui lòng chờ phỏng vấn kết thúc và HR chốt PASS' : 'Bấm để đổi ngày bắt đầu'}
                        >
                          {formatDate(r.ngayBatDauTraining) || 'Chưa đặt'}
                        </button>
                      </td>

                      {/* Cột Số Ngày (Bị khóa cho tới khi PASS) */}
                      <td className="table-td">
                        <span className={cn('font-bold', isRestLocked ? 'text-slate-400 opacity-50' : 'text-brand-700')}>
                          {r.soNgayDaTraining}/7
                        </span>
                      </td>

                      {/* Cột Trạng Thái (Vô hiệu hóa các bước cũ ngoại trừ ADMIN) */}
                      <td className="table-td">
                        {isPendingConfirm ? (
                          <div className="flex flex-col items-center justify-center gap-0.5">
                            <span className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold bg-rose-600 text-white border border-rose-700 shadow-2xs animate-pulse">
                              ⏳ CHỜ UV XÁC NHẬN ZALO
                            </span>
                            <span className="text-[10px] text-rose-600 font-semibold italic text-center">🔒 Khóa thao tác đến khi UV xác nhận Zalo</span>
                          </div>
                        ) : isRestLocked ? (
                          <div className="flex flex-col items-center justify-center gap-0.5">
                            <span className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold bg-amber-500 text-white border border-amber-600 shadow-2xs">
                              ⏳ {pvRealtimeStatus === 'CHUA_PV' ? 'CHỜ ĐẾN GIỜ PV' : pvRealtimeStatus === 'DANG_PV' ? 'ĐANG PHỎNG VẤN' : 'CHỜ HR CHỐT PASS'}
                            </span>
                            <span className="text-[10px] text-amber-600 font-semibold italic text-center">🔒 Khóa cho tới khi HR chốt PASS</span>
                          </div>
                        ) : (
                          <select
                            className="input !py-1.5 !text-xs font-bold bg-emerald-600 text-white border-emerald-700 rounded-xl shadow-2xs cursor-pointer text-center mx-auto"
                            value={r.trangThaiTraining ?? 'CHUA_THAM_GIA'}
                            onChange={(e) => setConfirmStatus({ row: r, status: e.target.value })}
                          >
                            {STATUS_OPTIONS.map((st, idx) => {
                              const currentIdx = STATUS_OPTIONS.indexOf(r.trangThaiTraining ?? 'CHUA_THAM_GIA');
                              const isPastStatusDisabled = !isAdmin && idx < currentIdx;
                              return (
                                <option
                                  key={st}
                                  value={st}
                                  disabled={isPastStatusDisabled}
                                  className={cn(
                                    'bg-white font-medium text-slate-800',
                                    isPastStatusDisabled && 'text-slate-400 bg-slate-100 italic'
                                  )}
                                >
                                  {trainingStatusLabel[st]?.label ?? st} {isPastStatusDisabled ? '🔒' : ''}
                                </option>
                              );
                            })}
                          </select>
                        )}
                      </td>

                      {/* Cột Thao Tác (Bị khóa cho tới khi PASS) */}
                      <td className="table-td">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            className="btn-primary !px-2.5 !py-1.5 !text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={isRestLocked}
                            onClick={() => openEditModal(r)}
                            title={isRestLocked ? 'Khóa thao tác: Vui lòng chờ phỏng vấn kết thúc và HR chốt PASS' : 'Cập nhật chi nhánh, ca làm & ngày bắt đầu'}
                          >
                            Chốt ca & lịch
                          </button>
                          <button
                            className="btn-secondary !px-2.5 !py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={isRestLocked}
                            onClick={() => navigate(`/shifts`)}
                            title={isRestLocked ? 'Khóa thao tác: Vui lòng chờ phỏng vấn kết thúc và HR chốt PASS' : 'Xem lịch làm việc'}
                          >
                            <CalendarDays size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

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
                placeholder="Hoặc nhập ca làm tùy chỉnh (Ví dụ: Ca sáng + Ca tối)..."
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
          <Field label="Thời gian phỏng vấn (Bắt buộc cách ứng viên khác >= 1 tiếng)">
            <input type="datetime-local" className="input font-semibold" value={ivPhongVanAt} onChange={(e) => setIvPhongVanAt(e.target.value)} />
          </Field>

          {/* Cảnh báo xung đột lịch phỏng vấn */}
          {(() => {
            const ivTimestamp = ivPhongVanAt ? new Date(ivPhongVanAt).getTime() : 0;
            if (!ivTimestamp || Number.isNaN(ivTimestamp)) return null;
            const conflict = bookedInterviews.find((b) => {
              if (b.id === interviewEdit?.id) return false;
              if (!b.phongVanAt) return false;
              return Math.abs(ivTimestamp - new Date(b.phongVanAt).getTime()) / (60 * 1000) < 60;
            });
            if (!conflict) return null;
            return (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 font-medium space-y-1 animate-pulse">
                <div className="font-bold text-rose-800 flex items-center gap-1.5">
                  🔒 XUNG ĐỘT THỜI GIAN (CÁCH NHAU TỐI THIỂU 1 TIẾNG)
                </div>
                <div>
                  Khung giờ này quá gần lịch đã hẹn của <b>Sếp {conflict.tenUv}</b> lúc <b>{formatDateTime(conflict.phongVanAt)}</b>.
                </div>
                <div className="text-[11px] text-rose-600 font-bold">
                  Vui lòng chọn khung giờ khác cách tối thiểu 1 tiếng!
                </div>
              </div>
            );
          })()}

          {/* Khay khung giờ gợi ý (tô đen khung giờ bị trùng) */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-600">Khung giờ gợi ý (Tô đen = Đã có lịch hẹn):</div>
            <div className="flex flex-wrap gap-1.5">
              {(() => {
                let datePrefix = ivPhongVanAt ? ivPhongVanAt.slice(0, 10) : '';
                if (!datePrefix) {
                  const d = new Date();
                  const pad = (n: number) => String(n).padStart(2, '0');
                  datePrefix = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                }
                const standardHours = ['08:00', '09:00', '10:00', '11:00', '13:30', '14:30', '15:30', '16:30', '17:30', '19:00', '20:00'];
                return standardHours.map((timeStr) => {
                  const slotIso = `${datePrefix}T${timeStr}`;
                  const slotTime = new Date(slotIso).getTime();
                  const conflictUser = bookedInterviews.find((b) => {
                    if (b.id === interviewEdit?.id) return false;
                    if (!b.phongVanAt) return false;
                    return Math.abs(slotTime - new Date(b.phongVanAt).getTime()) / (60 * 1000) < 60;
                  });
                  const isConflict = !!conflictUser;
                  return (
                    <button
                      key={timeStr}
                      type="button"
                      disabled={isConflict}
                      className={cn(
                        'px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border',
                        isConflict
                          ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed line-through opacity-60'
                          : ivPhongVanAt === slotIso
                          ? 'bg-brand-600 text-white border-brand-600 shadow-xs'
                          : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                      )}
                      onClick={() => setIvPhongVanAt(slotIso)}
                      title={conflictUser ? `Đã hẹn phỏng vấn với Sếp ${conflictUser.tenUv}` : `Chọn khung giờ ${timeStr}`}
                    >
                      {conflictUser ? `🔒 ${timeStr} (${conflictUser.tenUv})` : timeStr}
                    </button>
                  );
                });
              })()}
            </div>
          </div>

          <Field label="Link Google Meet">
            <input type="url" className="input" value={ivGgMeetLink} onChange={(e) => setIvGgMeetLink(e.target.value)} placeholder="https://meet.google.com/xxx-xxxx-xxx" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={ivResend} onChange={(e) => setIvResend(e.target.checked)} />
            Gửi lại lời mời phỏng vấn qua Zalo sau khi lưu
          </label>
          <button
            className="btn-primary w-full"
            onClick={saveInterviewEdit}
            disabled={(() => {
              const ivTimestamp = ivPhongVanAt ? new Date(ivPhongVanAt).getTime() : 0;
              if (!ivTimestamp || Number.isNaN(ivTimestamp)) return false;
              return bookedInterviews.some((b) => {
                if (b.id === interviewEdit?.id) return false;
                if (!b.phongVanAt) return false;
                return Math.abs(ivTimestamp - new Date(b.phongVanAt).getTime()) / (60 * 1000) < 60;
              });
            })()}
          >
            <Video size={15} /> Lưu lịch phỏng vấn
          </button>
        </div>
      </Modal>

      {scoreModalCandidate && (
        <InterviewScoreModal
          open={!!scoreModalCandidate}
          onClose={() => setScoreModalCandidate(null)}
          candidateId={scoreModalCandidate.id}
          candidateName={scoreModalCandidate.tenUv}
          kinhNghiem={scoreModalCandidate.kinhNghiem}
          onSuccess={handleScoreSuccess}
        />
      )}
    </div>
  );
}