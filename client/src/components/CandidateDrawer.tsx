import { useEffect, useState } from 'react';
import {
  User, BrainCircuit, ThumbsUp, GraduationCap, ClipboardCheck, MessageCircle,
  ScrollText, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Send, Briefcase,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Drawer, Tabs, Badge, Spinner, ConfirmDialog, Field, Skeleton } from './ui';
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
  caLam: string;
  chiNhanh: string;
  kinhNghiem: string;
  xuLy: string;
  linkFb: string;
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
  const [auditRows, setAuditRows] = useState<unknown[]>([]);
  const [syncRows, setSyncRows] = useState<unknown[]>([]);

  useEffect(() => {
    if (!candidateId || !open) return;
    setTab('profile');
    setReason('');
    setLoading(true);
    api
      .get<CandidateDetail>(`/candidates/${candidateId}`)
      .then((d) => setC(d))
      .catch((e) => toast('error', e instanceof ApiError ? e.message : 'Lỗi tải chi tiết.'))
      .finally(() => setLoading(false));
  }, [candidateId, open, toast]);

  useEffect(() => {
    if (!candidateId || !open || !c) return;
    if (tab === 'audit') {
      api.get<{ rows: unknown[] }>(`/audit?entityId=${candidateId}&limit=30`).then((d) => setAuditRows(d.rows)).catch(() => undefined);
    }
    if (tab === 'sync') {
      api.get<{ rows: unknown[] }>(`/sync?limit=30`).then((d) => setSyncRows(d.rows)).catch(() => undefined);
    }
  }, [tab, candidateId, open, c]);

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

  const decide = (decision: 'PASS' | 'FAIL' | 'REVIEW') =>
    act(() => api.patch(`/candidates/${candidateId}/decision`, { decision, reason: reason || undefined }), 'Đã lưu quyết định HR.');

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
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  ['Họ tên', c.tenUv], ['Năm sinh', c.namSinh], ['Trình độ', c.trinhDo],
                  ['Quê quán', c.queQuan], ['SĐT / Zalo', c.sdtZalo], ['Ca mong muốn', c.caLam],
                  ['Chi nhánh', c.chiNhanh], ['Kinh nghiệm', c.kinhNghiem],
                  ['Xử lý tình huống', c.xuLy], ['Link Facebook', c.linkFb],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-3.5">
                    <div className="label">{label}</div>
                    <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">{String(value ?? '') || '—'}</div>
                  </div>
                ))}
                <div className="sm:col-span-2 rounded-xl bg-slate-50 p-3.5">
                  <div className="label">Thời gian nhận hồ sơ</div>
                  <div className="text-sm">{formatDateTime(c.thoiGian)}</div>
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
                  <button className="btn-success !py-3" onClick={() => setConfirm('PASS')}>
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
        message={c ? `Quyết định ${confirm === 'PASS' ? 'ĐẠT' : confirm === 'FAIL' ? 'LOẠI' : 'CẦN XEM LẠI'} cho ${c.tenUv} (${c.id})? Quyết định sẽ đồng bộ realtime xuống Google Sheet.` : ''}
        confirmLabel="Xác nhận"
        danger={confirm === 'FAIL'}
        onConfirm={() => confirm && decide(confirm)}
      />
    </Drawer>
  );
}