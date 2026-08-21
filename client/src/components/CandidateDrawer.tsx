import { useEffect, useState, useRef, useCallback, useMemo } from 'react';


import {
  User, BrainCircuit, ThumbsUp, GraduationCap, ClipboardCheck, MessageCircle,
  ScrollText, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Send, Briefcase, CalendarDays, Video, Pencil, Search,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { getSocket } from '../api/socket';

import { Drawer, Tabs, Badge, Spinner, ConfirmDialog, Field, Skeleton, Modal } from './ui';
import { useToast } from '../stores/Toast';
import { useAuth } from '../stores/auth';
import { cn, trainingStatusLabel, syncStatusStyle, decisionLabel } from '../utils/format';
import { formatDateTime, formatDate, toLocalDatetimeInput } from '../utils/date';


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
  zaloMessages: { id: string; content: string; status: string; createdAt: string; direction?: string }[];

}

const TABS = [
  { key: 'profile', label: 'Hồ sơ' },
  { key: 'score', label: 'Điểm AI' },
  { key: 'decision', label: 'Quyết định HR' },
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
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
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
  const [chatText, setChatText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const sendLiveChat = async (customContent?: string) => {
    const textToSend = (customContent || chatText).trim();
    if (!textToSend) {
      toast('error', 'Nhập nội dung tin nhắn.');
      return;
    }
    if (!c?.id) return;
    setSendingChat(true);
    try {
      await api.post('/zalo/chat', { candidateId: c.id, content: textToSend });
      toast('success', 'Đã gửi tin nhắn Zalo!');
      setChatText('');
      const updated = await api.get<CandidateDetail>(`/candidates/${c.id}`);
      setC(updated);
      onChanged();
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Gửi tin Zalo thất bại.');
    } finally {
      setSendingChat(false);
    }
  };


  const [bookedInterviews, setBookedInterviews] = useState<{ id: string; tenUv: string; phongVanAt: string }[]>([]);

  const loadBookedInterviews = useCallback(async () => {
    try {
      const data = await api.get<{ id: string; tenUv: string; phongVanAt: string }[]>('/candidates/booked-interviews');
      setBookedInterviews(data);
    } catch {
      // ignore
    }
  }, []);



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

  // Lắng nghe Socket real-time & Polling ngầm 3.5s cho tin nhắn Zalo khi mở tab 'zalo'

  useEffect(() => {
    if (!candidateId || !open || tab !== 'zalo') return;

    const refreshZaloMessages = () => {
      api
        .get<CandidateDetail>(`/candidates/${candidateId}`)
        .then((updated) => {
          setC((prev) => {
            if (!prev) return updated;
            if (JSON.stringify(prev.zaloMessages) !== JSON.stringify(updated.zaloMessages)) {
              setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
              return updated;
            }
            return prev;
          });
        })
        .catch(() => undefined);
    };

    const socket = getSocket();
    const handleSocketEvent = (data: { candidateId?: string }) => {
      if (!data?.candidateId || data.candidateId === candidateId) {
        refreshZaloMessages();
      }
    };

    socket.on('zalo:incoming', handleSocketEvent);
    socket.on('zalo:status', handleSocketEvent);
    socket.on('zalo:message', handleSocketEvent);

    const timer = setInterval(refreshZaloMessages, 3500);

    return () => {
      socket.off('zalo:incoming', handleSocketEvent);
      socket.off('zalo:status', handleSocketEvent);
      socket.off('zalo:message', handleSocketEvent);
      clearInterval(timer);
    };
  }, [candidateId, open, tab]);

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
        if (!silent) toast('success', `🎉 Đã tự động tìm thấy & gán Zalo User ID: ${res.zaloUserId}`);
        const d = await api.get<CandidateDetail>(`/candidates/${candidateId}`);
        setC(d);
        onChanged();
      } else {
        if (!silent) {
          toast('error', 'Đã tự động quét Zalo OA nhưng chưa thấy tương tác. Nhờ ứng viên bấm "Quan tâm" hoặc nhắn 1 tin (VD: Hello) tới Zalo OA!');
        }
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
    void loadBookedInterviews();
    setInterviewEditMode(false);
    setInterviewResend(true);
    setPhongVanAt('');
    setGgMeetLink(calendarEnabled ? '' : (c ? branchMeetLinks[c.chiNhanh] ?? '' : ''));
    setInterviewOpen(true);
  };

  const openEditInterviewModal = () => {
    if (!isAdmin) return;
    void loadBookedInterviews();
    setInterviewEditMode(true);
    setInterviewResend(false);
    setPhongVanAt(c?.phongVanAt ? toLocalDatetimeInput(c.phongVanAt) : '');
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
        if (!isAdmin) return;
        await api.patch(`/candidates/${candidateId}/interview`, {
          phongVanAt,
          ggMeetLink: ggMeetLink.trim() || undefined,
        });
        const d = await api.get<CandidateDetail>(`/candidates/${candidateId!}`);
        setC(d);
        onChanged();
        toast('success', 'Đã lưu lịch phỏng vấn mới! Bấm nút "Mở App Zalo" để gửi thông báo.');
      } else {
        await api.patch(`/candidates/${candidateId}/decision`, {
          decision: 'PASS',
          reason: reason || undefined,
          phongVanAt,
          ggMeetLink: ggMeetLink.trim() || undefined,
        });
        const d = await api.get<CandidateDetail>(`/candidates/${candidateId!}`);
        setC(d);
        onChanged();
        toast('success', '🎉 Đã hẹn lịch phỏng vấn thành công! Hãy bấm nút màu xanh "Mở App Zalo gửi Thư Mời PV" để gửi tin nhắn cho ứng viên.');
      }
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    } finally {
      setInterviewOpen(false);
    }
  };

  const handleOpenZaloInvite = async () => {
    if (!c || !c.sdtZalo) {
      toast('error', 'Chưa có SĐT Zalo của ứng viên.');
      return;
    }

    const pvTimeStr = c.phongVanAt ? formatDateTime(c.phongVanAt) : 'Theo lịch đã hẹn';
    const nameGreeting = c.tenUv?.trim()
      ? (c.tenUv.trim().toLowerCase().startsWith('sếp') ? c.tenUv.trim() : `Sếp ${c.tenUv.trim()}`)
      : 'bạn';

    const confirmUrl = `${window.location.origin}/confirm-pv/${c.id}`;

    const inviteContent = [
      '🐮 [UMBO MILK] – THƯ MỜI PHỎNG VẤN 📋',
      '',
      `Chào ${nameGreeting} ❤️`,
      'Chúc mừng bạn đã vượt qua vòng lọc hồ sơ ứng tuyển của UMBO MILK!',
      '',
      '📌 THÔNG TIN PHỎNG VẤN:',
      `• ⏰ Thời gian: ${pvTimeStr}`,
      `• 📍 Hình thức: Phỏng vấn Online qua Google Meet`,
      `• 🔗 Link Google Meet: ${c.ggMeetLink || 'https://meet.google.com'}`,
      `• 🏢 Chi nhánh ứng tuyển: ${c.chiNhanh || ''}`,
      `• ⏱️ Ca làm việc đăng ký: ${c.caLam || ''}`,
      '',
      '👉 VUI LÒNG BẤM LINK DƯỚI ĐÂY ĐỂ XÁC NHẬN THAM GIA PHỎNG VẤN 1-CLICK:',
      `🔗 ${confirmUrl}`,
      '',
      'UMBO MILK rất mong được gặp bạn! ✨',
    ].join('\n');

    // 1. Sao chép nội dung thư mời vào Clipboard để HR bấm Ctrl+V dán ngay
    try {
      await navigator.clipboard.writeText(inviteContent);
    } catch {
      /* ignore clipboard error */
    }

    // 2. Lưu vết tin nhắn vào DB history
    api.post('/zalo/chat', { candidateId: c.id, content: inviteContent }).catch(() => undefined);

    // 3. Mở Zalo Cá Nhân trực tiếp với SĐT ứng viên
    window.open(`https://zalo.me/${c.sdtZalo}`, '_blank', 'noopener,noreferrer');

    // 4. Thông báo hướng dẫn HR
    toast('success', '📋 Đã sao chép Thư Mời PV & Mở Zalo! Bạn chỉ cần nhấn Dán (Ctrl+V) trong khung chat Zalo để gửi.');
  };

  const confirmTrainingParticipation = () =>
    act(
      () => api.patch(`/training/${candidateId}`, { trangThaiTraining: 'SAP_BAT_DAU' }),
      '🎉 Đã ghi nhận ứng viên xác nhận tham gia! Hồ sơ đã được chuyển sang tab Nhân viên Training.',
    );

  const setInterviewStatus = (status: string) =>
    act(
      () => api.patch(`/candidates/${candidateId}/interview`, { interviewStatus: status }),
      'Đã cập nhật trạng thái phỏng vấn.',
    );

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

  const selectedTimestamp = useMemo(() => {
    if (!phongVanAt) return 0;
    let str = phongVanAt.trim();
    if (!str) return 0;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) {
      str += ':00+07:00';
    }
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }, [phongVanAt]);

  const timeConflict = useMemo(() => {
    if (!selectedTimestamp) return null;
    return bookedInterviews.find((b) => {
      if (b.id === c?.id) return false;
      if (!b.phongVanAt) return false;
      const bTime = new Date(b.phongVanAt).getTime();
      return Math.abs(selectedTimestamp - bTime) / (60 * 1000) < 60;
    });
  }, [selectedTimestamp, bookedInterviews, c?.id]);

  const availableSlots = useMemo(() => {
    let datePrefix = phongVanAt ? phongVanAt.slice(0, 10) : '';
    if (!datePrefix || !/^\d{4}-\d{2}-\d{2}$/.test(datePrefix)) {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      datePrefix = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    const standardHours = [
      '08:00', '09:00', '10:00', '11:00',
      '13:30', '14:30', '15:30', '16:30',
      '17:30', '19:00', '20:00'
    ];

    return standardHours.map((timeStr) => {
      const slotIso = `${datePrefix}T${timeStr}`;
      const slotTime = new Date(`${slotIso}:00+07:00`).getTime();

      const conflictUser = bookedInterviews.find((b) => {
        if (b.id === c?.id) return false;
        if (!b.phongVanAt) return false;
        return Math.abs(slotTime - new Date(b.phongVanAt).getTime()) / (60 * 1000) < 60;
      });

      return {
        timeStr,
        iso: slotIso,
        conflictUser: conflictUser ? conflictUser.tenUv : null,
      };
    });
  }, [phongVanAt, bookedInterviews, c?.id]);

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
                      {c.hrDecision === 'PASS' || c.hrDecision === 'FAIL' ? (
                        <span className="text-slate-400 text-xs italic opacity-80 cursor-not-allowed">(Link Google Meet đã vô hiệu hóa sau PV)</span>
                      ) : (
                        <a className="text-emerald-700 underline break-all" href={c.ggMeetLink ?? '#'} target="_blank" rel="noreferrer">{c.ggMeetLink}</a>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1.5">
                      <button
                        type="button"
                        onClick={handleOpenZaloInvite}
                        className="btn-primary !px-3 !py-1.5 !text-xs font-bold bg-[#0068ff] hover:bg-[#0052cc] text-white flex items-center gap-1.5 shadow-xs rounded-xl"
                        title="Sao chép nội dung Thư Mời PV & Mở Zalo nhắn 1-1 với ứng viên"
                      >
                        <span>💬 Mở App Zalo gửi Thư Mời PV</span>
                      </button>
                      {isAdmin && (
                        <button className="btn-secondary !px-2.5 !py-1.5 !text-xs" onClick={openEditInterviewModal}>
                          <CalendarDays size={13} /> Sửa lịch
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {c.hrDecision === 'PASS' && (
                  <div className="rounded-xl bg-slate-50/90 p-4 border border-slate-200/80 space-y-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Trạng thái xác nhận tham gia</div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge className={trainingStatusLabel[c.trangThaiTraining ?? 'CHUA_THAM_GIA']?.cls}>
                        {trainingStatusLabel[c.trangThaiTraining ?? 'CHUA_THAM_GIA']?.label ?? c.trangThaiTraining}
                      </Badge>
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
          <Field label="Thời gian phỏng vấn (Bắt buộc cách ứng viên khác >= 1 tiếng)">
            <input type="datetime-local" className="input font-semibold" value={phongVanAt} onChange={(e) => setPhongVanAt(e.target.value)} />
          </Field>

          {timeConflict && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 font-medium space-y-1 animate-pulse">
              <div className="font-bold text-rose-800 flex items-center gap-1.5">
                🔒 XUNG ĐỘT THỜI GIAN (CÁCH NHAU TỐI THIỂU 1 TIẾNG)
              </div>
              <div>
                Khung giờ này quá gần lịch đã hẹn của <b>Sếp {timeConflict.tenUv}</b> lúc <b>{formatDateTime(timeConflict.phongVanAt)}</b>.
              </div>
              <div className="text-[11px] text-rose-600 font-bold">
                Vui lòng chọn khung giờ khác cách tối thiểu 1 tiếng!
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-600">Khung giờ gợi ý (Tô đen = Đã có lịch hẹn):</div>
            <div className="flex flex-wrap gap-1.5">
              {availableSlots.map((slot) => (
                <button
                  key={slot.timeStr}
                  type="button"
                  disabled={!!slot.conflictUser}
                  className={cn(
                    'px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all border',
                    slot.conflictUser
                      ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed line-through opacity-60'
                      : phongVanAt === slot.iso
                      ? 'bg-brand-600 text-white border-brand-600 shadow-xs'
                      : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                  )}
                  onClick={() => setPhongVanAt(slot.iso)}
                  title={slot.conflictUser ? `Đã hẹn phỏng vấn với Sếp ${slot.conflictUser}` : `Chọn khung giờ ${slot.timeStr}`}
                >
                  {slot.conflictUser ? `🔒 ${slot.timeStr} (${slot.conflictUser})` : slot.timeStr}
                </button>
              ))}
            </div>
          </div>

          <Field label="Link Google Meet (để trống = hệ thống tự tạo)">
            <input type="url" className="input" value={ggMeetLink} onChange={(e) => setGgMeetLink(e.target.value)} placeholder="https://meet.google.com/xxx-xxxx-xxx" />
          </Field>
          <p className="text-[11px] text-slate-400">
            {calendarEnabled
              ? 'Để trống → hệ thống tự tạo sự kiện + link Google Meet mới. Nhập link tay sẽ ưu tiên dùng link đó.'
              : 'Để trống → hệ thống dùng link GG Meet mặc định của chi nhánh (Cài đặt → Phỏng vấn & Meet).'}
          </p>
          <button className="btn-success w-full" onClick={submitInterview} disabled={!!timeConflict}>
            <Video size={15} /> {interviewEditMode ? 'Lưu lịch phỏng vấn' : 'Xác nhận ĐẠT & Hẹn lịch phỏng vấn'}
          </button>
        </div>
      </Modal>
    </Drawer>
  );
}