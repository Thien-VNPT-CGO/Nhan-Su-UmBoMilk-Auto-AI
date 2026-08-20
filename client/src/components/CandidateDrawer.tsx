import { useEffect, useState } from 'react';
import {
  User, BrainCircuit, ThumbsUp, GraduationCap, ClipboardCheck, MessageCircle,
  ScrollText, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Send, Briefcase, CalendarDays, Video, Pencil, Search,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Drawer, Tabs, Badge, Spinner, ConfirmDialog, Field, Skeleton, Modal } from './ui';
import { useToast } from '../stores/Toast';
import { cn, trainingStatusLabel, syncStatusStyle, decisionLabel } from '../utils/format';
import { formatDateTime, formatDate } from '../utils/date';

interface CandidateDetail {
  id: string;
  thoiGian: string;
  tenUv: string;
  namSinh: string;
  trinhDo: string;
  queQuan: string;
  sdtZalo: string;
  zaloUserId: string | null;
  caLam: string;
  chiNhanh: string;
  kinhNghiem: string;
  xuLy: string;
  linkFb: string;
  kenhBietTin: string | null;
  aiScore: Record<string, unknown> | null;
  tongDiem: number | null;
  aiRecommendation: string | null;
  aiNote: string | null;
  aiConfidence: number | null;
  aiScoredAt: string | null;
  hrDecision: string | null;
  hrUser: string | null;
  hrReason: string | null;
  hrDecisionAt: string | null;
  phongVanAt: string | null;
  ggMeetLink: string | null;
  interviewStatus: string | null;
  ngayBatDauTraining: string | null;
  trangThaiTraining: string | null;
  soNgayDaTraining: number;
  dataVersion: number;
  updatedBy: string | null;
  updatedAt: string;
  shifts: { date: string; shifts: string; note: string | null }[];
  attendanceEvents: { id: string; date: string; shift: string; checkinAt: string; method: string; valid: boolean; reason: string | null; trainingDay: number | null }[];
  conflicts: { id: string; field: string; webValue: string; sheetValue: string }[];
  zaloMessages: { id: string; content: string; status: string; createdAt: string }[];
}

const TABS = [
  { key: 'profile', label: 'Hồ sơ' },
  { key: 'score', label: 'Điểm AI' },
  { key: 'decision', label: 'Quyết định HR' },
  { key: 'training', label: 'Đào tạo' },
  { key: 'attendance', label: 'Chấm công' },
  { key: 'zalo', label: 'Zalo' },
  { key: 'audit', label: 'Nhật ký' },
  { key: 'sync', label: 'Lịch sử đồng bộ' },
];

export default function CandidateDrawer({
  candidateId,
  open,
  onClose,
  onChanged,
}: {
  candidateId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [c, setC] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('profile');
  const [confirm, setConfirm] = useState<null | 'PASS' | 'FAIL' | 'REVIEW'>(null);
  const [reason, setReason] = useState('');
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [interviewEditMode, setInterviewEditMode] = useState(false);
  const [interviewResend, setInterviewResend] = useState(true);
  const [phongVanAt, setPhongVanAt] = useState('');
  const [ggMeetLink, setGgMeetLink] = useState('');
  const [branchMeetLinks, setBranchMeetLinks] = useState<Record<string, string>>({});
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [auditRows, setAuditRows] = useState<unknown[]>([]);
  const [syncRows, setSyncRows] = useState<unknown[]>([]);
  const [zaloUserIdDraft, setZaloUserIdDraft] = useState('');
  const [zaloUserIdEditing, setZaloUserIdEditing] = useState(false);
  const [zaloUserIdSaving, setZaloUserIdSaving] = useState(false);

  useEffect(() => {
    if (!candidateId || !open) return;
    setTab('profile');
    setReason('');
    setPhongVanAt('');
    setGgMeetLink('');
    setLoading(true);
    api
      .get<CandidateDetail>(`/candidates/${candidateId}`)
      .then((d) => setC(d))
      .catch((e) => toast('error', e instanceof ApiError ? e.message : 'Lỗi tải chi tiết.'))
      .finally(() => setLoading(false));
  }, [candidateId, open, toast]);

  // Khi mở hồ sơ ứng viên chưa có Zalo User ID → tự động thử tra cứu ngầm 1 lần
  useEffect(() => {
    if (!c || c.zaloUserId) return;
    api
      .post<{ zaloUserId?: string }>(`/candidates/${c.id}/resolve-zalo-user-id`, {})
      .then((res) => {
        if (res?.zaloUserId) {
          setC((prev) => (prev ? { ...prev, zaloUserId: res.zaloUserId! } : prev));
          onChanged();
        }
      })
      .catch(() => undefined);
  }, [c?.id, c?.zaloUserId]);

  useEffect(() => {
    if (!candidateId || !open || !c) return;
    if (tab === 'audit') {
      api.get<{ rows: unknown[] }>(`/audit?entityId=${candidateId}&limit=30`).then((d) => setAuditRows(d.rows)).catch(() => undefined);
    }
    if (tab === 'sync') {
      api.get<{ rows: unknown[] }>(`/sync?limit=30`).then((d) => setSyncRows(d.rows)).catch(() => undefined);
    }
  }, [tab, candidateId, open, c]);

  useEffect(() => {
    api
      .get<{ settings: { interview?: { branchMeetLinks?: Record<string, string> }; googleCalendar?: { enabled?: boolean; refreshToken?: string } } }>('/settings')
      .then((d) => {
        setBranchMeetLinks(d.settings.interview?.branchMeetLinks ?? {});
        setCalendarEnabled(!!d.settings.googleCalendar?.enabled && !!d.settings.googleCalendar?.refreshToken);
      })
      .catch(() => undefined);
  }, []);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast('success', msg);
      const d = await api.get<CandidateDetail>(`/candidates/${candidateId!}`);
      setC(d);
      onChanged();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    }
  };

  const score = () =>
    act(() => api.post(`/candidates/${candidateId}/score`, {}), 'AI đã chấm xong hồ sơ.');

  const [resolvingZaloId, setResolvingZaloId] = useState(false);

  const resolveZaloUserId = async (silent = false) => {
    if (!c) return;
    setResolvingZaloId(true);
    try {
      const res = await api.post<{ zaloUserId?: string }>(`/candidates/${c.id}/resolve-zalo-user-id`, {});
      if (res?.zaloUserId) {
        if (!silent) toast('success', `Đã tìm thấy Zalo User ID: ${res.zaloUserId}`);
        const d = await api.get<CandidateDetail>(`/candidates/${candidateId}`);
        setC(d);
        onChanged();
      } else {
        if (!silent) toast('error', 'Zalo chưa trả về ID cho SĐT này. Nhờ ứng viên nhắn 1 tin cho OA.');
      }
    } catch (e) {
      if (!silent) toast('error', e instanceof ApiError ? e.message : 'Tra cứu Zalo User ID thất bại.');
    } finally {
      setResolvingZaloId(false);
    }
  };

  const saveZaloUserId = async () => {
    if (!c) return;
    setZaloUserIdSaving(true);
    try {
      await api.patch(`/candidates/${c.id}`, { patch: { zaloUserId: zaloUserIdDraft.trim() }, version: c.dataVersion });
      toast('success', 'Đã lưu Zalo User ID.');
      setZaloUserIdEditing(false);
      const d = await api.get<CandidateDetail>(`/candidates/${candidateId}`);
      setC(d);
      onChanged();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Lưu Zalo User ID thất bại.');
    } finally {
      setZaloUserIdSaving(false);
    }
  };

  const decide = (decision: 'PASS' | 'FAIL' | 'REVIEW', phongVanAt?: string, ggMeetLink?: string) =>
    act(
      () => api.patch(`/candidates/${candidateId}/decision`, { decision, reason: reason || undefined, phongVanAt, ggMeetLink }),
      'Đã lưu quyết định HR.',
    );

  const openInterviewModal = () => {
    setInterviewEditMode(false);
    setInterviewResend(true);
    setPhongVanAt('');
    // Calendar bật → để trống để server tự tạo link Meet; chưa có Calendar → prefill link mặc định chi nhánh
    setGgMeetLink(calendarEnabled ? '' : (c ? branchMeetLinks[c.chiNhanh] ?? '' : ''));
    setInterviewOpen(true);
  };

  const openEditInterviewModal = () => {
    setInterviewEditMode(true);
    setInterviewResend(false);
    setPhongVanAt(c?.phongVanAt ? c.phongVanAt.slice(0, 16) : '');
    setGgMeetLink(c?.ggMeetLink ?? '');
    setInterviewOpen(true);
  };

  const submitInterview = async () => {
    if (!phongVanAt) {
      toast('error', 'Chọn thời gian phỏng vấn.');
      return;
    }
    try {
      if (interviewEditMode) {
        const res = await api.patch<{ zalo: { ok: boolean; provider: string } | null }>(`/candidates/${candidateId}/interview`, {
          phongVanAt,
          ggMeetLink: ggMeetLink.trim() || undefined,
          resend: interviewResend,
        });
        const d = await api.get<CandidateDetail>(`/candidates/${candidateId!}`);
        setC(d);
        onChanged();
        if (interviewResend) {
          if (res?.zalo?.ok) {
            toast('success', 'Đã sửa lịch phỏng vấn & gửi lại lời mời qua Zalo.');
          } else {
            toast('error', 'Đã sửa lịch phỏng vấn. (Tin Zalo chưa gửi được do ứng viên chưa kết nối Zalo OA)');
          }
        } else {
          toast('success', 'Đã sửa lịch phỏng vấn.');
        }
      } else {
        const res = await api.patch<{ zalo: { ok: boolean; provider: string } | null }>(`/candidates/${candidateId}/decision`, {
          decision: 'PASS',
          reason: reason || undefined,
          phongVanAt,
          ggMeetLink: ggMeetLink.trim() || undefined,
        });
        const d = await api.get<CandidateDetail>(`/candidates/${candidateId!}`);
        setC(d);
        onChanged();
        if (res?.zalo?.ok) {
          toast('success', 'Đã lưu quyết định HR & gửi lời mời phỏng vấn qua Zalo.');
        } else {
          toast('error', 'Đã lưu quyết định ĐẠT & hẹn lịch. (Chưa gửi được tin Zalo do ứng viên chưa kết nối Zalo OA)');
        }
      }

    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    } finally {
      setInterviewOpen(false);
    }
  };


  const setInterviewStatus = (status: string) =>
    act(
      () => api.patch(`/candidates/${candidateId}/interview`, { interviewStatus: status }),
      'Đã cập nhật trạng thái phỏng vấn.',
    );

  const resendInterview = () =>
    act(() => api.post(`/training/${candidateId}/interview-notify`, {}), 'Đã gửi lại lời mời phỏng vấn qua Zalo.');

  const notifyZalo = () =>
    act(() => api.post(`/zalo/send`, { candidateId }), 'Đã gửi thông báo Zalo.');

  const confirmEmployee = () =>
    act(() => api.post(`/training/${candidateId}/employee`, {}), 'Đã xác nhận nhân viên chính thức.');

  const startTraining = () => {
    const d = prompt('Ngày bắt đầu đào tạo (dd/MM/yyyy):', formatDate(new Date()));
    if (!d) return;
    const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) {
      toast('error', 'Sai định dạng ngày. Dùng dd/MM/yyyy.');
      return;
    }
    act(
      () => api.post(`/candidates/${candidateId}/training/start`, { ngayBatDau: `${m[3]}-${m[2]}-${m[1]}T00:00:00` }),
      'Đã thiết lập ngày bắt đầu đào tạo.',
    );
  };

  const aiScore = c?.aiScore as Record<string, unknown> | null | undefined;
  const scoreRows = [
    { label: 'Họ tên', key: 'p_hoTen' },
    { label: 'Năm sinh', key: 'p_namSinh' },
    { label: 'Quê quán', key: 'p_queQuan' },
    { label: 'SĐT', key: 'p_sdt' },
    { label: 'Trình độ', key: 'p_trinhDo' },
    { label: 'Kinh nghiệm', key: 'p_kinhNghiem' },
    { label: 'Xử lý tình huống', key: 'p_xuLy' },
    { label: 'Facebook', key: 'p_linkFb' },
    { label: 'Kênh biết tin', key: 'p_kenhBietTin' },
  ];

  return (
    <Drawer open={open} onClose={onClose} title={c ? `${c.id} – ${c.tenUv}` : 'Chi tiết ứng viên'} width="max-w-3xl">
      {loading || !c ? (
        <div className="p-5 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : (
        <>
          {/* Header info */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
            <Badge className="bg-brand-50 text-brand-700 font-mono">{c.id}</Badge>
            <Badge className="bg-slate-100 text-slate-600">Phiên bản {c.dataVersion}</Badge>
            <Badge className="bg-slate-100 text-slate-600">{c.chiNhanh}</Badge>
            <Badge className="bg-brand-50 text-brand-700">{c.caLam}</Badge>
            {c.hrDecision === 'PASS' && <Badge className="bg-emerald-100 text-emerald-700">{decisionLabel.PASS.label}</Badge>}
            {c.trangThaiTraining && (
              <Badge className={trainingStatusLabel[c.trangThaiTraining]?.cls}>
                {trainingStatusLabel[c.trangThaiTraining]?.label}
              </Badge>
            )}
            <div className="flex-1" />
            <span className="text-[11px] text-slate-400">Cập nhật: {formatDateTime(c.updatedAt)} · {c.updatedBy ?? ''}</span>
          </div>

          <Tabs tabs={TABS} active={tab} onChange={setTab} />

          <div className="p-5">
            {tab === 'profile' && (
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-3.5">
                  <div className="rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Họ tên</div>
                    <div className="text-base font-semibold text-slate-900 mt-0.5">{c.tenUv || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Năm sinh</div>
                    <div className="text-sm font-medium text-slate-800 mt-0.5">{c.namSinh || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Trình độ</div>
                    <div className="text-sm text-slate-800 mt-0.5">{c.trinhDo || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Quê quán</div>
                    <div className="text-sm text-slate-800 mt-0.5">{c.queQuan || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">SĐT / Zalo</div>
                    <div className="text-sm font-semibold text-brand-700 mt-0.5 flex items-center gap-2">
                      <a href={`tel:${c.sdtZalo}`} className="hover:underline">{c.sdtZalo || '—'}</a>
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Ca mong muốn</div>
                    <div className="text-sm text-slate-800 mt-0.5">{c.caLam || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Chi nhánh</div>
                    <div className="text-sm font-medium text-slate-800 mt-0.5">{c.chiNhanh || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Kinh nghiệm</div>
                    <div className="text-sm text-slate-800 mt-0.5 whitespace-pre-wrap">{c.kinhNghiem || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Xử lý tình huống</div>
                    <div className="text-sm text-slate-800 mt-0.5 whitespace-pre-wrap">{c.xuLy || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Link Facebook</div>
                    {c.linkFb && c.linkFb.startsWith('http') ? (
                      <a
                        href={c.linkFb}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-brand-600 hover:text-brand-700 font-medium hover:underline mt-0.5 inline-flex items-center gap-1 break-all"
                      >
                        {c.linkFb} ↗
                      </a>
                    ) : (
                      <div className="text-sm text-slate-800 mt-0.5 break-all">{c.linkFb || '—'}</div>
                    )}
                  </div>
                  <div className="sm:col-span-2 rounded-xl bg-slate-50/80 hover:bg-slate-100/60 p-4 border border-slate-100 transition-colors">
                    <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Kênh biết tin</div>
                    <div className="text-sm text-slate-800 mt-0.5">{c.kenhBietTin || '—'}</div>
                  </div>
                </div>

                {/* Card Zalo User ID tối ưu cao cấp */}
                <div className={cn(
                  'rounded-xl p-4 transition-all border',
                  c.zaloUserId
                    ? 'bg-emerald-50/30 border-emerald-200/80'
                    : 'bg-amber-50/40 border-amber-200/80'
                )}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold tracking-wider text-slate-600 uppercase">ZALO USER ID</span>
                      {c.zaloUserId ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full">
                          ✓ ĐÃ KẾT NỐI ZALO OA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-full">
                          ⚠️ CHƯA KẾT NỐI ZALO OA
                        </span>
                      )}
                    </div>
                    {!zaloUserIdEditing && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-xs text-brand-700 hover:text-brand-800 bg-white hover:bg-brand-50 border border-brand-200 font-medium px-2.5 py-1 rounded-lg transition-colors shadow-sm"
                          onClick={() => resolveZaloUserId(false)}
                          disabled={resolvingZaloId}
                          title="Tự động lấy Zalo User ID từ SĐT ứng viên"
                        >
                          {resolvingZaloId ? <Spinner size={12} /> : <Search size={13} />}
                          {resolvingZaloId ? 'Đang lấy ID...' : 'Tự lấy ID'}
                        </button>
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 bg-white border border-slate-200 font-medium px-2 py-1 rounded-lg transition-colors shadow-sm"
                          onClick={() => {
                            setZaloUserIdDraft(c.zaloUserId ?? '');
                            setZaloUserIdEditing(true);
                          }}
                        >
                          <Pencil size={13} /> Sửa
                        </button>
                      </div>
                    )}
                  </div>

                  {zaloUserIdEditing ? (
                    <div className="flex gap-2 mt-2">
                      <input
                        className="input flex-1 font-mono text-sm"
                        value={zaloUserIdDraft}
                        onChange={(e) => setZaloUserIdDraft(e.target.value)}
                        placeholder="Ví dụ: 2567163371161972101"
                      />
                      <button className="btn-primary px-3 text-xs" onClick={saveZaloUserId} disabled={zaloUserIdSaving}>
                        {zaloUserIdSaving ? <Spinner size={14} /> : 'Lưu'}
                      </button>
                      <button className="btn-secondary px-3 text-xs" onClick={() => setZaloUserIdEditing(false)}>Hủy</button>
                    </div>
                  ) : (
                    <div className="mt-1">
                      <div className="text-base font-mono font-semibold text-slate-800 tracking-wide select-all break-all">
                        {c.zaloUserId ?? '—'}
                      </div>
                      {!c.zaloUserId && (
                        <p className="text-[11px] text-amber-700 mt-1.5 font-medium">
                          Chưa có — Ứng viên chỉ cần nhắn 1 tin hoặc bấm Quan tâm Zalo OA, hệ thống sẽ tự động kết nối.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-xl bg-slate-50/80 p-3.5 border border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">THỜI GIAN NHẬN HỒ SƠ</span>
                  <span className="font-mono text-slate-700 font-medium">{formatDateTime(c.thoiGian)}</span>
                </div>
              </div>
            )}


            {tab === 'score' && (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    'w-16 h-16 rounded-2xl flex flex-col items-center justify-center text-white',
                    (c.tongDiem ?? 0) >= 7 ? 'bg-emerald-500' : 'bg-slate-400',
                  )}>
                    <span className="text-2xl font-extrabold leading-none">{c.tongDiem ?? '—'}</span>
                    <span className="text-[9px] font-semibold opacity-80">/ 9</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800">Gợi ý AI:</span>
                      {c.aiRecommendation ? (
                        <Badge className={c.aiRecommendation === 'PASS' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                          {decisionLabel[c.aiRecommendation]?.label ?? c.aiRecommendation}
                        </Badge>
                      ) : <Badge className="bg-slate-100 text-slate-400">Chưa chấm</Badge>}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Confidence: {c.aiConfidence !== null ? `${Math.round((c.aiConfidence ?? 0) * 100)}%` : '—'}
                      {c.aiScoredAt && ` · ${formatDateTime(c.aiScoredAt)}`}
                    </p>
                  </div>
                  <button className="btn-primary" onClick={score} disabled={!!c.aiScoredAt}>
                    <BrainCircuit size={15} /> {c.aiScoredAt ? 'Chấm lại' : 'Chấm hồ sơ'}
                  </button>
                </div>

                <div className="grid sm:grid-cols-2 gap-2.5">
                  {scoreRows.map((r) => (
                    <div key={r.key} className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5">
                      <span className="text-xs font-semibold text-slate-500">{r.label}</span>
                      <span className={cn(
                        'w-7 h-7 rounded-lg flex items-center justify-center text-sm font-extrabold',
                        Number(aiScore?.[r.key] ?? 0) > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400',
                      )}>
                        {String(aiScore?.[r.key] ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>

                {aiScore && (
                  <div className="rounded-xl bg-slate-50 p-4">
                    <div className="label">Phân tích chi tiết</div>
                    {Object.entries(aiScore.chi_tiet as Record<string, { diem: number; nhanXet: string }> ?? {}).map(([k, v]) => (
                      <div key={k} className="flex gap-2 py-1 text-sm">
                        <span className="w-28 shrink-0 font-semibold text-slate-600">{k}</span>
                        <span className="text-slate-500 flex-1">{v.nhanXet}</span>
                        <span className="font-bold text-slate-700 w-6 text-right">+{v.diem}</span>
                      </div>
                    ))}
                    {c.aiNote && <p className="mt-2 text-sm text-slate-600">💡 {c.aiNote}</p>}
                  </div>
                )}
              </div>
            )}

            {tab === 'decision' && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2.5">
                  <button className="btn-success !py-3" onClick={openInterviewModal}>
                    <CheckCircle2 size={16} /> Đạt
                  </button>
                  <button className="btn-danger !py-3" onClick={() => setConfirm('FAIL')}>
                    <XCircle size={16} /> Loại
                  </button>
                  <button className="btn-secondary !py-3" onClick={() => setConfirm('REVIEW')}>
                    <AlertTriangle size={16} /> Cần xem lại
                  </button>
                </div>
                <Field label="Ghi chú / lý do (hiển thị cho HR khác)">
                  <textarea className="input min-h-[80px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Ứng viên có kinh nghiệm F&B 2 năm..." />
                </Field>
                {c.hrDecision === 'PASS' && c.phongVanAt && (
                  <div className="rounded-xl bg-emerald-50 p-3.5 text-sm space-y-1.5">
                    <div className="font-bold text-emerald-700">Lịch phỏng vấn đã hẹn</div>
                    <div className="flex items-center gap-2">
                      <CalendarDays size={14} className="text-emerald-600" />
                      <b>{formatDateTime(c.phongVanAt)}</b>
                    </div>
                    <div className="flex items-center gap-2">
                      <Video size={14} className="text-emerald-600" />
                      <a className="text-emerald-700 underline break-all" href={c.ggMeetLink ?? '#'} target="_blank" rel="noreferrer">{c.ggMeetLink}</a>
                    </div>
                    <div className="flex gap-1.5 pt-1">
                      <button className="btn-secondary !px-2.5 !py-1.5 !text-xs" onClick={openEditInterviewModal}>
                        <CalendarDays size={13} /> Sửa lịch
                      </button>
                      <button className="btn-secondary !px-2.5 !py-1.5 !text-xs" onClick={resendInterview}>
                        <Send size={13} /> Gửi lại lời mời (Zalo)
                      </button>
                    </div>
                  </div>
                )}
                {c.hrDecision === 'PASS' && c.phongVanAt && (
                  <div className="rounded-xl bg-slate-50 p-3.5 text-sm space-y-2">
                    <div className="font-bold text-slate-700">Kết quả phỏng vấn</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        className={cn('btn !px-2.5 !py-1.5 !text-xs', c.interviewStatus === 'DA_PV' ? 'btn-primary' : 'btn-secondary')}
                        onClick={() => setInterviewStatus('DA_PV')}
                      >
                        Đã phỏng vấn
                      </button>
                      <button
                        className={cn('btn !px-2.5 !py-1.5 !text-xs', c.interviewStatus === 'QUA_PV' ? 'btn-success' : 'btn-secondary')}
                        onClick={() => setInterviewStatus('QUA_PV')}
                      >
                        Qua PV
                      </button>
                      <button
                        className={cn('btn !px-2.5 !py-1.5 !text-xs', c.interviewStatus === 'TRUOT_PV' ? 'btn-danger' : 'btn-secondary')}
                        onClick={() => setInterviewStatus('TRUOT_PV')}
                      >
                        Trượt PV
                      </button>
                      <button
                        className={cn('btn !px-2.5 !py-1.5 !text-xs', c.interviewStatus === 'VANG' ? 'btn-danger' : 'btn-secondary')}
                        onClick={() => setInterviewStatus('VANG')}
                      >
                        Vắng
                      </button>
                    </div>
                  </div>
                )}
                {c.hrDecision && (
                  <div className="rounded-xl bg-slate-50 p-3.5 text-sm space-y-1">
                    <div>Quyết định hiện tại: <b>{decisionLabel[c.hrDecision]?.label ?? c.hrDecision}</b> bởi <b>{c.hrUser ?? ''}</b></div>
                    <div className="text-xs text-slate-500">Lúc {formatDateTime(c.hrDecisionAt)}</div>
                    {c.hrReason && <div className="text-xs text-slate-500">Lý do: {c.hrReason}</div>}
                  </div>
                )}
              </div>
            )}

            {tab === 'training' && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-3 items-center">
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <div className="label">Ngày bắt đầu</div>
                    <div className="text-sm font-bold">{formatDate(c.ngayBatDauTraining) || 'Chưa đặt'}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <div className="label">Số ngày đã training</div>
                    <div className="text-sm font-bold">{c.soNgayDaTraining}/7</div>
                  </div>
                  <div className="flex-1" />
                  {c.trangThaiTraining === 'HOAN_THANH' && (
                    <button className="btn-primary" onClick={confirmEmployee}>
                      <Briefcase size={15} /> Nhận việc chính thức
                    </button>
                  )}
                  <button className="btn-primary" onClick={startTraining}>
                    <GraduationCap size={15} /> Đặt ngày bắt đầu
                  </button>
                  <button className="btn-secondary" onClick={notifyZalo}>
                    <Send size={15} /> Thông báo Zalo
                  </button>
                </div>

                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="label mb-2">Lịch đã xếp ({c.shifts.length} ngày)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.shifts.slice(0, 40).map((s) => (
                      <span key={s.date} className="rounded-lg bg-white border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600">
                        {formatDate(s.date)}: <span className="text-brand-600">{s.shifts.split('|').join(' + ')}</span>
                      </span>
                    ))}
                    {c.shifts.length === 0 && <span className="text-xs text-slate-400">Chưa có lịch. Xếp ca tại trang Lịch làm việc.</span>}
                  </div>
                </div>
              </div>
            )}

            {tab === 'attendance' && (
              <div className="space-y-2">
                {c.attendanceEvents.length === 0 && <p className="text-sm text-slate-400">Chưa có lịch sử điểm danh.</p>}
                {c.attendanceEvents.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-2.5">
                    <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center', a.valid ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600')}>
                      {a.valid ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-slate-800">{formatDate(a.date)} · {a.shift}</div>
                      <div className="text-[11px] text-slate-500">
                        {formatDateTime(a.checkinAt)} · {a.method}
                        {a.reason && a.reason !== 'VALID' && ` · ${a.reason}`}
                        {a.trainingDay && ` · Đào tạo ngày ${a.trainingDay}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'zalo' && (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <button className="btn-primary" onClick={notifyZalo}>
                    <MessageCircle size={15} /> Gửi thông báo đào tạo
                  </button>
                </div>
                {c.zaloMessages.length === 0 && <p className="text-sm text-slate-400">Chưa có tin nhắn nào.</p>}
                {c.zaloMessages.map((m) => (
                  <div key={m.id} className="rounded-xl bg-slate-50 p-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge className={m.status === 'SENT' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}>
                        {m.status}
                      </Badge>
                      <span className="text-[11px] text-slate-400">{formatDateTime(m.createdAt)}</span>
                    </div>
                    <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans">{m.content}</pre>
                  </div>
                ))}
              </div>
            )}

            {tab === 'audit' && (
              <div className="space-y-1.5">
                {auditRows.length === 0 && <p className="text-sm text-slate-400">Không có nhật ký.</p>}
                {auditRows.map((a) => {
                  const row = a as { id: string; user: string; action: string; time: string; oldValue: string | null; newValue: string | null; version: number | null };
                  return (
                    <div key={row.id} className="rounded-xl bg-slate-50 px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <b className="text-slate-700">{row.user}</b>
                        <Badge className="bg-slate-200 text-slate-600">{row.action}</Badge>
                        {row.version !== null && <span className="text-slate-400">v{row.version}</span>}
                        <span className="ml-auto text-slate-400">{formatDateTime(row.time)}</span>
                      </div>
                      {(row.oldValue || row.newValue) && (
                        <div className="mt-1 text-slate-500 truncate">
                          {row.oldValue} → {row.newValue}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'sync' && (
              <div className="space-y-1.5">
                {syncRows.filter((s) => (s as { entityId: string }).entityId === c.id).length === 0 && (
                  <p className="text-sm text-slate-400">Không có job đồng bộ.</p>
                )}
                {syncRows
                  .filter((s) => (s as { entityId: string }).entityId === c.id)
                  .map((s) => {
                    const row = s as { id: string; entity: string; operation: string; field: string | null; oldValue: string | null; newValue: string | null; version: number; status: string; retryCount: number; createdAt: string; lastError: string | null };
                    return (
                      <div key={row.id} className="rounded-xl bg-slate-50 px-4 py-2.5 text-xs space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-brand-600">{row.id}</span>
                          <Badge className={syncStatusStyle[row.status]?.cls}>{syncStatusStyle[row.status]?.label}</Badge>
                          {row.retryCount > 0 && <span className="text-slate-400">retry ×{row.retryCount}</span>}
                          <span className="ml-auto text-slate-400">{formatDateTime(row.createdAt)}</span>
                        </div>
                        <div className="text-slate-500">
                          {row.operation} · {row.field ?? row.entity}
                          {row.field && row.oldValue !== null && ` · ${row.oldValue} → ${row.newValue}`}
                        </div>
                        {row.lastError && <div className="text-rose-500 truncate">⚠ {row.lastError}</div>}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={`Xác nhận ${confirm ?? ''}`}
        message={c ? `Quyết định ${confirm === 'FAIL' ? 'LOẠI' : 'CẦN XEM LẠI'} cho ${c.tenUv} (${c.id})? Quyết định sẽ đồng bộ realtime xuống Google Sheet.` : ''}
        confirmLabel="Xác nhận"
        danger={confirm === 'FAIL'}
        onConfirm={() => confirm && decide(confirm)}
      />

      <Modal open={interviewOpen} onClose={() => setInterviewOpen(false)} title={`${interviewEditMode ? 'Sửa lịch phỏng vấn' : 'Chấm ĐẠT & hẹn phỏng vấn'} – ${c?.tenUv ?? ''}`}>
        <div className="space-y-4">
          <Field label="Thời gian phỏng vấn">
            <input type="datetime-local" className="input" value={phongVanAt} onChange={(e) => setPhongVanAt(e.target.value)} />
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
                <button key={q.label} className="btn-secondary !px-2.5 !py-1 !text-[11px]" onClick={() => setPhongVanAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)}>
                  {q.label}
                </button>
              );
            })}
          </div>
          <Field label="Link Google Meet (để trống = hệ thống tự quyết định)">
            <input type="url" className="input" value={ggMeetLink} onChange={(e) => setGgMeetLink(e.target.value)} placeholder="https://meet.google.com/xxx-xxxx-xxx" />
          </Field>
          <p className="text-[11px] text-slate-400">
            {calendarEnabled
              ? 'Để trống → hệ thống tự tạo sự kiện + link Google Meet mới. Nhập link tay sẽ ưu tiên dùng link đó.'
              : 'Để trống → hệ thống dùng link GG Meet mặc định của chi nhánh (Cài đặt → Phỏng vấn & Meet).'}
          </p>
          {interviewEditMode && (
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={interviewResend} onChange={(e) => setInterviewResend(e.target.checked)} />
              Gửi lại lời mời phỏng vấn qua Zalo sau khi lưu
            </label>
          )}
          <button className="btn-success w-full" onClick={submitInterview}>
            <Video size={15} /> {interviewEditMode ? 'Lưu lịch phỏng vấn' : 'Xác nhận ĐẠT & gửi lời mời phỏng vấn'}
          </button>
        </div>
      </Modal>
    </Drawer>
  );
}