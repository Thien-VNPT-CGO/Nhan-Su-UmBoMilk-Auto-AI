import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrainCircuit, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Star, TrendingUp, Video, FileCheck } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Skeleton, EmptyState, Modal, Field } from '../components/ui';
import { useToast } from '../stores/Toast';
import { getSocket } from '../api/socket';
import { formatDateTime } from '../utils/date';
import { debounce } from '../utils/debounce';
import { cn } from '../utils/format';

interface Row {
  id: string;
  tenUv: string;
  thoiGian: string;
  sdtZalo: string;
  chiNhanh: string;
  caLam: string;
  kenhBietTin: string | null;
  tongDiem: number | null;
  xepLoai: string | null;
  aiRecommendation: string | null;
  aiScoredAt: string | null;
  aiNote: string | null;
  hrDecision: string | null;
  dataVersion: number;
}

function decisionBadge(d: string | null) {
  if (d === 'PASS_PV') return <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 size={11} /> HOÀN THÀNH PV</Badge>;
  if (d === 'PASS_HS') return <Badge className="bg-teal-100 text-teal-700"><FileCheck size={11} /> ĐẠT HS</Badge>;
  if (d === 'PASS') return <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 size={11} /> ĐẠT</Badge>;
  if (d === 'FAIL') return <Badge className="bg-rose-100 text-rose-700"><XCircle size={11} /> LOẠI</Badge>;
  if (d === 'REVIEW') return <Badge className="bg-amber-100 text-amber-700"><AlertTriangle size={11} /> CẦN XEM LẠI</Badge>;
  return <span className="text-slate-400 text-xs">—</span>;
}

function xepLoaiBadge(x: string | null) {
  if (x === 'XUAT_SAC') return <Badge className="bg-amber-100 text-amber-700 border border-amber-200"><Star size={11} /> XUẤT SẮC</Badge>;
  if (x === 'GIOI') return <Badge className="bg-sky-100 text-sky-700"><TrendingUp size={11} /> GIỎI</Badge>;
  if (x === 'DAT') return <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 size={11} /> ĐẠT</Badge>;
  return null;
}

function isReferralChannel(v: string | null): boolean {
  if (!v) return false;
  const n = v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  return ['gioi thieu', 'ban be', 'nguoi quen'].some((k) => n.includes(k));
}

function scoreCellStyle(diem: number | null): string {
  if (diem === null) return 'bg-slate-100 text-slate-600';
  if (diem >= 12) return 'bg-amber-100 text-amber-700 border border-amber-200'; // Xuất Sắc
  if (diem >= 10) return 'bg-sky-100 text-sky-700'; // Giỏi
  if (diem >= 8) return 'bg-emerald-100 text-emerald-700'; // Đạt
  return 'bg-slate-100 text-slate-600';
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
      const data = await api.get<{ rows: Row[] }>('/candidates?pageSize=100&sort=priority');
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
    const refresh = debounce(() => void load(), 300);
    const events = ['candidate:new', 'candidate:updated', 'candidate:update', 'candidate:scored', 'candidate:decision', 'candidate:deleted', 'training:updated'];
    events.forEach((ev) => socket.on(ev, refresh));
    return () => {
      events.forEach((ev) => socket.off(ev, refresh));
      refresh.cancel();
    };
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

  const decide = async (id: string, decision: 'PASS' | 'FAIL' | 'REVIEW', phongVanAt?: string, ggMeetLink?: string) => {
    try {
      const res = await api.patch<{ zalo: { ok: boolean; provider: string } | null }>(`/candidates/${id}/decision`, {
        decision,
        phongVanAt,
        ggMeetLink,
      });
      toast('success', `Đã ${decision}.${res.zalo?.ok ? '' : ' ⚠ Không gửi được tin Zalo (kiểm tra cấu hình OA).'}`);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thất bại.');
    }
  };

  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [phongVanAt, setPhongVanAt] = useState('');
  const [ggMeetLink, setGgMeetLink] = useState('');
  const [sending, setSending] = useState(false);
  const [branchMeetLinks, setBranchMeetLinks] = useState<Record<string, string>>({});
  const [calendarEnabled, setCalendarEnabled] = useState(false);

  useEffect(() => {
    api
      .get<{ settings: { interview?: { branchMeetLinks?: Record<string, string> }; googleCalendar?: { enabled?: boolean; refreshToken?: string } } }>('/settings')
      .then((d) => {
        setBranchMeetLinks(d.settings.interview?.branchMeetLinks ?? {});
        setCalendarEnabled(!!d.settings.googleCalendar?.enabled && !!d.settings.googleCalendar?.refreshToken);
      })
      .catch(() => undefined);
  }, []);

  const toLocalInput = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const QUICK_TIMES = [
    { label: '+1 giờ', get: () => new Date(Date.now() + 60 * 60_000) },
    { label: '+3 giờ', get: () => new Date(Date.now() + 3 * 60 * 60_000) },
    { label: 'Hôm nay 14:00', get: () => { const d = new Date(); d.setHours(14, 0, 0, 0); return d; } },
    { label: 'Hôm nay 15:30', get: () => { const d = new Date(); d.setHours(15, 30, 0, 0); return d; } },
    { label: 'Mai 9:00', get: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
    { label: 'Mai 14:00', get: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(14, 0, 0, 0); return d; } },
  ];

  const openInterview = (id: string) => {
    const row = rows.find((r) => r.id === id);
    setInterviewId(id);
    setPhongVanAt('');
    // Calendar bật → để trống để server tự tạo link Meet; chưa có Calendar → prefill link mặc định chi nhánh
    setGgMeetLink(calendarEnabled ? '' : (row ? branchMeetLinks[row.chiNhanh] ?? '' : ''));
  };

  const submitInterview = async () => {
    if (!interviewId) return;
    if (!phongVanAt) {
      toast('error', 'Chọn thời gian phỏng vấn.');
      return;
    }
    setSending(true);
    try {
      await decide(interviewId, 'PASS', phongVanAt, ggMeetLink.trim() || undefined);
      setInterviewId(null);
    } finally {
      setSending(false);
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

      <div className="flex flex-wrap items-center gap-2 text-xs rounded-xl bg-slate-50 px-4 py-2.5 dark:bg-slate-800/60">
        <span className="font-bold text-slate-600 dark:text-slate-300">Khung AI chấm điểm:</span>
        <Badge className="bg-emerald-100 text-emerald-700">8–9 điểm: Đạt</Badge>
        <Badge className="bg-sky-100 text-sky-700">10–11 điểm: Giỏi</Badge>
        <Badge className="bg-amber-100 text-amber-700 border border-amber-200">≥12 điểm: Xuất Sắc</Badge>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500 dark:text-slate-400">Chọn "Bạn Bè, Người quen giới thiệu" → AI chấm <b className="text-rose-600">LOẠI</b> dù điểm cao</span>
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
                  <th className="table-th">Kênh biết tin</th>
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
                      {isReferralChannel(r.kenhBietTin) ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-slate-600">Bạn bè / người quen giới thiệu</span>
                          <Badge className="bg-rose-100 text-rose-700"><XCircle size={11} /> AI CHẤM LOẠI</Badge>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">{r.kenhBietTin ? 'Quảng cáo FB/Tiktok/Instagram...' : '—'}</span>
                      )}
                    </td>
                    <td className="table-td">
                      <span className={cn(
                        'inline-flex items-center justify-center w-8 h-8 rounded-xl text-sm font-extrabold',
                        scoreCellStyle(r.tongDiem),
                      )}>
                        {r.tongDiem ?? '—'}
                      </span>
                    </td>
                    <td className="table-td">
                      {r.xepLoai ? (
                        xepLoaiBadge(r.xepLoai)
                      ) : (
                        <>
                          {r.aiRecommendation === 'PASS' && <Badge className="bg-emerald-100 text-emerald-700">ĐẠT</Badge>}
                          {r.aiRecommendation === 'FAIL' && isReferralChannel(r.kenhBietTin) && (
                            <Badge className="bg-rose-100 text-rose-700"><XCircle size={11} /> LOẠI (GIỚI THIỆU)</Badge>
                          )}
                          {r.aiRecommendation === 'FAIL' && !isReferralChannel(r.kenhBietTin) && (
                            <Badge className="bg-slate-100 text-slate-500">LOẠI</Badge>
                          )}
                        </>
                      )}
                      {!r.aiScoredAt && <Badge className="bg-amber-100 text-amber-700">Chưa chấm</Badge>}
                    </td>
                    <td className="table-td">{decisionBadge(r.hrDecision)}</td>
                    <td className="table-td">
                      <div className="flex items-center gap-1.5">
                        <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => score(r.id)} disabled={busyId === r.id}>
                          {busyId === r.id ? <RefreshCw size={13} className="animate-spin" /> : <BrainCircuit size={13} />}
                          {r.aiScoredAt ? 'Chấm lại' : 'Chấm'}
                        </button>
                        {r.aiScoredAt && (
                          <>
                            <button className="btn-success !px-2.5 !py-1.5" onClick={() => openInterview(r.id)} title="Chấm ĐẠT + hẹn phỏng vấn"><CheckCircle2 size={13} /></button>
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

      <Modal open={!!interviewId} onClose={() => setInterviewId(null)} title={`Chấm ĐẠT & hẹn phỏng vấn – ${rows.find((r) => r.id === interviewId)?.tenUv ?? ''}`}>
        <div className="space-y-4">
          <Field label="Thời gian phỏng vấn">
            <input type="datetime-local" className="input" value={phongVanAt} onChange={(e) => setPhongVanAt(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TIMES.map((q) => (
              <button key={q.label} className="btn-secondary !px-2.5 !py-1 !text-[11px]" onClick={() => setPhongVanAt(toLocalInput(q.get()))}>
                {q.label}
              </button>
            ))}
          </div>
          <Field label={`Link Google Meet ${calendarEnabled ? '(để trống = hệ thống tự tạo link mới qua Google Calendar)' : ''}`}>
            <input type="url" className="input" value={ggMeetLink} onChange={(e) => setGgMeetLink(e.target.value)} placeholder="https://meet.google.com/xxx-xxxx-xxx" />
          </Field>
          <p className="text-[11px] text-slate-400">
            {calendarEnabled
              ? 'Hệ thống tự tạo sự kiện + link Google Meet mới rồi gửi cho ứng viên qua Zalo. Nhập link tay sẽ ưu tiên dùng link đó.'
              : 'Để trống → hệ thống dùng link GG Meet mặc định của chi nhánh (nếu đã cấu hình tại Cài đặt → Phỏng vấn & Meet), hoặc tự tạo khi đã kết nối Google Calendar.'}
          </p>
          <button className="btn-success w-full" onClick={submitInterview} disabled={sending}>
            <Video size={15} /> {sending ? 'Đang gửi...' : 'Xác nhận ĐẠT & gửi lời mời phỏng vấn'}
          </button>
        </div>
      </Modal>
    </div>
  );
}