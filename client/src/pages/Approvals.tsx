import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  CheckSquare, Clock, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  Plus, Search, User, ArrowRightLeft, Building2, Calendar, ShieldCheck, FileText, Send
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Spinner, Modal, Field } from '../components/ui';
import { useToast } from '../stores/Toast';
import { useAuth } from '../stores/auth';
import { formatDate } from '../utils/date';
import { cn } from '../utils/format';

interface ShiftSwapItem {
  id: string;
  candidateIdA: string;
  candidateNameA: string;
  sdtA: string;
  chiNhanhA: string;
  caLamA: string;
  dateA: string;

  candidateIdB: string;
  candidateNameB: string;
  sdtB: string;
  chiNhanhB: string;
  caLamB: string;
  dateB: string;

  swapType: string;
  reason: string;
  status: 'PENDING_B' | 'PENDING_MANAGER' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  rejectReason?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
}

interface CandidateOption {
  id: string;
  tenUv: string;
  sdtZalo: string;
  chiNhanh: string;
  caLam: string;
}

export default function Approvals() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isViewer = user?.role === 'VIEWER';

  const [requests, setRequests] = useState<ShiftSwapItem[]>([]);
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // State Modal Tạo đơn đổi ca
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    candidateIdA: '',
    dateA: new Date().toISOString().slice(0, 10),
    caLamA: 'CA_SANG',
    candidateIdB: '',
    dateB: new Date().toISOString().slice(0, 10),
    caLamB: 'CA_CHIEU',
    reason: '',
  });

  // State Modal Từ chối đơn
  const [rejectTarget, setRejectTarget] = useState<ShiftSwapItem | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ data: ShiftSwapItem[] }>(`/approvals?status=${statusFilter}&search=${encodeURIComponent(searchTerm)}`);
      setRequests(r.data || []);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Không tải được danh sách đơn phê duyệt.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchTerm, toast]);

  const loadCandidates = async () => {
    try {
      const r = await api.get<{ data: CandidateOption[] }>('/candidates?limit=100');
      setCandidates(r.data || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadRequests();
    loadCandidates();
  }, [loadRequests]);

  const stats = useMemo(() => {
    const pending = requests.filter((r) => r.status === 'PENDING_MANAGER').length;
    const approved = requests.filter((r) => r.status === 'APPROVED').length;
    const rejected = requests.filter((r) => r.status === 'REJECTED' || r.status === 'CANCELLED').length;
    return { pending, approved, rejected, total: requests.length };
  }, [requests]);

  const handleCreateSubmit = async () => {
    if (!form.candidateIdA || !form.candidateIdB) {
      toast('error', 'Vui lòng chọn đầy đủ Nhân viên A và Nhân viên B!');
      return;
    }
    if (form.candidateIdA === form.candidateIdB) {
      toast('error', 'Không thể chọn cùng 1 nhân sự cho cả 2 vị trí đổi ca!');
      return;
    }
    if (!form.reason.trim()) {
      toast('error', 'Vui lòng nhập lý do hoán đổi ca!');
      return;
    }

    setCreating(true);
    try {
      await api.post('/approvals', form);
      toast('success', 'Đã tạo đơn hoán đổi ca thành công!');
      setCreateModalOpen(false);
      setForm({
        candidateIdA: '',
        dateA: new Date().toISOString().slice(0, 10),
        caLamA: 'CA_SANG',
        candidateIdB: '',
        dateB: new Date().toISOString().slice(0, 10),
        caLamB: 'CA_CHIEU',
        reason: '',
      });
      loadRequests();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Tạo đơn đổi ca thất bại.');
    } finally {
      setCreating(false);
    }
  };

  const handleApprove = async (item: ShiftSwapItem) => {
    if (isViewer) {
      toast('error', '🔒 Tài khoản VIEWER chỉ có quyền xem dữ liệu, không có quyền phê duyệt!');
      return;
    }
    setApprovingId(item.id);
    try {
      await api.post(`/approvals/${item.id}/approve`, {});
      toast('success', `✅ Đã phê duyệt đơn hoán đổi ca thành công! Hệ thống đã tự động swap lịch và gửi tin Zalo tới ${item.candidateNameA} và ${item.candidateNameB}.`);
      loadRequests();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Duyệt đơn thất bại.');
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectTarget) return;
    if (isViewer) {
      toast('error', '🔒 Tài khoản VIEWER chỉ có quyền xem dữ liệu, không có quyền từ chối!');
      return;
    }
    setRejecting(true);
    try {
      await api.post(`/approvals/${rejectTarget.id}/reject`, {
        rejectReason: rejectReasonInput.trim() || 'Quản lý không phê duyệt đơn hoán đổi ca này.',
      });
      toast('error', '❌ Đã từ chối đơn đổi ca và gửi thông báo Zalo lý do tới ứng viên.');
      setRejectTarget(null);
      setRejectReasonInput('');
      loadRequests();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Từ chối thất bại.');
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-2xs dark:bg-slate-800 dark:border-slate-700">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <CheckSquare className="text-brand-600" size={24} /> Phê duyệt nhân viên
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Quản lý và xét duyệt các đơn xin hoán đổi ca làm việc của Nhân viên chính thức & Nhân sự Đào tạo.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {!isViewer && (
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="btn-primary !py-2 !px-4 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              <Plus size={16} /> Tạo đơn hoán đổi ca mới
            </button>
          )}
          <button
            type="button"
            onClick={loadRequests}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer dark:hover:bg-slate-700"
            title="Tải lại dữ liệu"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <div className="text-lg font-black text-slate-800 dark:text-slate-100 leading-none">{stats.pending}</div>
            <div className="text-[11px] text-amber-700 font-bold mt-1">Chờ Quản lý duyệt</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <div className="text-lg font-black text-slate-800 dark:text-slate-100 leading-none">{stats.approved}</div>
            <div className="text-[11px] text-emerald-700 font-bold mt-1">Đã duyệt thành công</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <XCircle size={20} />
          </div>
          <div>
            <div className="text-lg font-black text-slate-800 dark:text-slate-100 leading-none">{stats.rejected}</div>
            <div className="text-[11px] text-rose-700 font-bold mt-1">Đã từ chối / Hủy</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <ArrowRightLeft size={20} />
          </div>
          <div>
            <div className="text-lg font-black text-slate-800 dark:text-slate-100 leading-none">{stats.total}</div>
            <div className="text-[11px] text-brand-700 font-bold mt-1">Tổng số đơn</div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-100 shadow-2xs dark:bg-slate-800 dark:border-slate-700">
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { key: 'ALL', label: 'Tất cả đơn' },
            { key: 'PENDING_MANAGER', label: '⏳ Chờ Quản lý duyệt' },
            { key: 'APPROVED', label: '✅ Đã duyệt' },
            { key: 'REJECTED', label: '❌ Từ chối' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer',
                statusFilter === f.key
                  ? 'bg-brand-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm tên nhân viên, SĐT..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
          />
        </div>
      </div>

      {/* Main Request Cards List */}
      {loading ? (
        <div className="flex items-center justify-center p-12">
          <Spinner size={24} className="text-brand-500" />
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 p-12 text-center rounded-2xl border border-slate-100 dark:border-slate-700 space-y-3">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-400 flex items-center justify-center mx-auto">
            <CheckSquare size={32} />
          </div>
          <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm">Chưa có đơn hoán đổi ca nào</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Các đơn xin hoán đổi ca làm việc được tạo sẽ hiển thị tại đây để Quản lý cửa hàng xét duyệt.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => {
            const isPending = r.status === 'PENDING_MANAGER';
            const isApp = r.status === 'APPROVED';
            const isRej = r.status === 'REJECTED' || r.status === 'CANCELLED';

            return (
              <div
                key={r.id}
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-2xs space-y-4 transition-all hover:border-brand-300"
              >
                {/* Header info */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-black text-pink-600 bg-pink-50 dark:bg-pink-950/40 px-2 py-0.5 rounded-lg border border-pink-200 dark:border-pink-800">
                      {r.id}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      • Tạo lúc: {new Date(r.createdAt).toLocaleString('vi-VN')}
                    </span>
                  </div>

                  <div>
                    {isPending && (
                      <Badge className="bg-amber-100 text-amber-800 font-extrabold border border-amber-300 text-xs px-3 py-1 animate-pulse">
                        ⏳ CHỜ QUẢN LÝ DUYỆT
                      </Badge>
                    )}
                    {isApp && (
                      <Badge className="bg-emerald-100 text-emerald-800 font-extrabold border border-emerald-300 text-xs px-3 py-1">
                        ✅ ĐÃ DUYỆT & ĐỒNG BỘ REALTIME
                      </Badge>
                    )}
                    {isRej && (
                      <Badge className="bg-rose-100 text-rose-800 font-extrabold border border-rose-300 text-xs px-3 py-1">
                        ❌ ĐÃ TỪ CHỐI
                      </Badge>
                    )}
                  </div>
                </div>

                {/* 2 Personnel Info Comparison */}
                <div className="grid md:grid-cols-2 gap-4 relative">
                  {/* Personnel A */}
                  <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 font-extrabold text-xs flex items-center justify-center">
                        A
                      </div>
                      <span className="font-bold text-sm text-slate-800 dark:text-slate-100">{r.candidateNameA}</span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono">Mã NV: {r.candidateIdA} · SĐT: {r.sdtA}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
                      <Building2 size={13} className="text-slate-400" />
                      <span>{r.chiNhanhA}</span>
                    </div>
                    <div className="text-xs text-amber-700 font-bold flex items-center gap-1 pt-1">
                      <Calendar size={13} />
                      <span>Lịch gốc ngày {formatDate(r.dateA)}: <strong>{r.caLamA}</strong></span>
                    </div>
                  </div>

                  {/* Icon Swap */}
                  <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-brand-600 text-white items-center justify-center shadow-md z-10">
                    <ArrowRightLeft size={16} />
                  </div>

                  {/* Personnel B */}
                  <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 font-extrabold text-xs flex items-center justify-center">
                        B
                      </div>
                      <span className="font-bold text-sm text-slate-800 dark:text-slate-100">{r.candidateNameB}</span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono">Mã NV: {r.candidateIdB} · SĐT: {r.sdtB}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1">
                      <Building2 size={13} className="text-slate-400" />
                      <span>{r.chiNhanhB}</span>
                    </div>
                    <div className="text-xs text-teal-700 font-bold flex items-center gap-1 pt-1">
                      <Calendar size={13} />
                      <span>Lịch đổi ngày {formatDate(r.dateB)}: <strong>{r.caLamB}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Reason & Action note */}
                <div className="bg-brand-50/50 dark:bg-slate-900/40 p-3 rounded-xl border border-brand-100 dark:border-slate-700 text-xs space-y-1">
                  <div className="font-bold text-brand-900 dark:text-brand-300 flex items-center gap-1.5">
                    <FileText size={14} /> Lý do hoán đổi ca:
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 italic pl-5">"{r.reason}"</p>
                </div>

                {/* Reject Reason if any */}
                {isRej && r.rejectReason && (
                  <div className="bg-rose-50 dark:bg-rose-950/40 p-3 rounded-xl border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-300">
                    <strong>Lý do từ chối:</strong> {r.rejectReason} (Bởi {r.approvedBy || 'Quản lý'})
                  </div>
                )}

                {/* Approved info if any */}
                {isApp && (
                  <div className="text-[11px] text-emerald-700 font-medium flex items-center gap-1.5">
                    <ShieldCheck size={14} /> Đã được phê duyệt bởi Quản lý <strong>{r.approvedBy || 'Admin'}</strong> lúc {r.approvedAt ? new Date(r.approvedAt).toLocaleString('vi-VN') : ''}.
                  </div>
                )}

                {/* Action Buttons for Store Manager / Admin */}
                {isPending && (
                  <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
                    <button
                      type="button"
                      disabled={isViewer || rejecting}
                      onClick={() => setRejectTarget(r)}
                      className={cn(
                        'px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer',
                        isViewer
                          ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400'
                          : 'bg-white hover:bg-rose-50 text-rose-600 border-rose-200 dark:bg-slate-800'
                      )}
                    >
                      <XCircle size={15} /> Từ chối đơn
                    </button>

                    <button
                      type="button"
                      disabled={isViewer || approvingId === r.id}
                      onClick={() => handleApprove(r)}
                      className={cn(
                        'px-5 py-2 rounded-xl text-xs font-extrabold text-white flex items-center gap-1.5 shadow-md transition-all cursor-pointer',
                        isViewer || approvingId === r.id
                          ? 'opacity-40 cursor-not-allowed bg-slate-500'
                          : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/30 active:scale-95'
                      )}
                    >
                      {approvingId === r.id ? (
                        <>
                          <Spinner size={14} className="text-white" />
                          <span>Đang duyệt...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={16} />
                          <span>✅ PHÊ DUYỆT ĐỔI CA</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL TẠO ĐƠN HOÁN ĐỔI CA MỚI */}
      {createModalOpen && (
        <Modal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          title="TẠO ĐƠN HOÁN ĐỔI CA LÀM VIỆC"
        >
          <div className="space-y-4 font-sans">
            <div className="p-3 bg-brand-50 rounded-xl text-xs text-brand-800 border border-brand-200">
              Đơn tạo mới sẽ được chuyển trực tiếp tới Quản lý cửa hàng để xét duyệt và tự động đổi lịch + gửi Zalo thông báo.
            </div>

            {/* NV A */}
            <div className="space-y-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <label className="text-xs font-extrabold text-slate-700 block uppercase">
                👤 Nhân viên A (Người gửi đơn)
              </label>
              <select
                className="input text-xs"
                value={form.candidateIdA}
                onChange={(e) => {
                  const sel = candidates.find((c) => c.id === e.target.value);
                  setForm({
                    ...form,
                    candidateIdA: e.target.value,
                    caLamA: sel?.caLam ? (sel.caLam.toLowerCase().includes('chieu') ? 'CA_CHIEU' : sel.caLam.toLowerCase().includes('toi') ? 'CA_TOI' : 'CA_SANG') : 'CA_SANG',
                  });
                }}
              >
                <option value="">— Chọn Nhân viên A —</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tenUv} · {c.chiNhanh || 'Chi nhánh'} · Ca gốc: {c.caLam || 'Chưa chốt'}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 block">Ngày làm gốc:</label>
                  <input
                    type="date"
                    className="input text-xs"
                    value={form.dateA}
                    onChange={(e) => setForm({ ...form, dateA: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 block">Ca gốc:</label>
                  <select
                    className="input text-xs"
                    value={form.caLamA}
                    onChange={(e) => setForm({ ...form, caLamA: e.target.value })}
                  >
                    <option value="CA_SANG">Ca Sáng (07:00 - 12:00)</option>
                    <option value="CA_CHIEU">Ca Chiều (12:00 - 18:00)</option>
                    <option value="CA_TOI">Ca Tối (18:00 - 23:00)</option>
                    <option value="OFF">Nghỉ OFF</option>
                  </select>
                </div>
              </div>
            </div>

            {/* NV B */}
            <div className="space-y-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <label className="text-xs font-extrabold text-slate-700 block uppercase">
                🔄 Nhân viên B (Người hoán đổi ca cùng)
              </label>
              <select
                className="input text-xs"
                value={form.candidateIdB}
                onChange={(e) => {
                  const sel = candidates.find((c) => c.id === e.target.value);
                  setForm({
                    ...form,
                    candidateIdB: e.target.value,
                    caLamB: sel?.caLam ? (sel.caLam.toLowerCase().includes('chieu') ? 'CA_CHIEU' : sel.caLam.toLowerCase().includes('toi') ? 'CA_TOI' : 'CA_SANG') : 'CA_SANG',
                  });
                }}
              >
                <option value="">— Chọn Nhân viên B —</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tenUv} · {c.chiNhanh || 'Chi nhánh'} · Ca gốc: {c.caLam || 'Chưa chốt'}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 block">Ngày đổi ca:</label>
                  <input
                    type="date"
                    className="input text-xs"
                    value={form.dateB}
                    onChange={(e) => setForm({ ...form, dateB: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 block">Ca đổi mới:</label>
                  <select
                    className="input text-xs"
                    value={form.caLamB}
                    onChange={(e) => setForm({ ...form, caLamB: e.target.value })}
                  >
                    <option value="CA_SANG">Ca Sáng (07:00 - 12:00)</option>
                    <option value="CA_CHIEU">Ca Chiều (12:00 - 18:00)</option>
                    <option value="CA_TOI">Ca Tối (18:00 - 23:00)</option>
                    <option value="OFF">Nghỉ OFF</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Lý do xin đổi ca *</label>
              <textarea
                rows={2}
                className="input text-xs"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Nhập lý do hoán đổi ca chính đáng (ví dụ: trùng lịch học, bận việc cá nhân...)"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={handleCreateSubmit}
                className="btn-primary text-xs flex items-center gap-1.5"
              >
                {creating ? <Spinner size={14} /> : <Send size={14} />}
                <span>Gửi Đơn Xin Đổi Ca</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL TỪ CHỐI ĐƠN */}
      {rejectTarget && (
        <Modal
          open={!!rejectTarget}
          onClose={() => setRejectTarget(null)}
          title="TỪ CHỐI ĐƠN XIN ĐỔI CA"
        >
          <div className="space-y-4 font-sans text-slate-800">
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs space-y-1">
              <div>Đơn đổi ca của: <strong>{rejectTarget.candidateNameA}</strong> và <strong>{rejectTarget.candidateNameB}</strong></div>
              <div>Hệ thống sẽ gửi tin nhắn Zalo kèm lý do từ chối về cho ứng viên.</div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Lý do từ chối *</label>
              <textarea
                rows={3}
                className="input text-xs"
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
                placeholder="Nhập lý do từ chối (ví dụ: Ca chiều thiếu nhân lực chủ chốt, không đủ người vận hành...)"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="btn-secondary text-xs"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={rejecting}
                onClick={handleRejectConfirm}
                className="btn-danger text-xs flex items-center gap-1.5"
              >
                {rejecting ? <Spinner size={14} /> : <XCircle size={15} />}
                <span>Xác nhận Từ Chối</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
