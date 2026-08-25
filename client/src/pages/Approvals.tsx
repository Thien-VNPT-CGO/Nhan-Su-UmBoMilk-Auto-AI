import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  CheckSquare, Clock, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  Plus, Search, User, ArrowRightLeft, Building2, Calendar, ShieldCheck, FileText, Send, Smartphone, Key, Copy, Check
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

interface DeviceResetTicketItem {
  id: string;
  candidateId: string;
  creatorType: 'EMPLOYEE_SELF' | 'STORE_MANAGER_FOR_EMP';
  createdBy: string;
  reason: string;
  status: 'PENDING_MANAGER' | 'PENDING_IT' | 'APPROVED' | 'REJECTED';
  managerUser?: string | null;
  managerApprovedAt?: string | null;
  itUser?: string | null;
  itApprovedAt?: string | null;
  createdAt: string;
  candidate?: {
    tenUv: string;
    sdtZalo: string;
    chiNhanh: string;
    caLam: string;
  };
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
  const isAdmin = user?.role === 'ADMIN';
  const isViewer = user?.role === 'VIEWER';

  const [mainTab, setMainTab] = useState<'SWAP' | 'DEVICE_RESET' | 'KEY_GEN'>('SWAP');

  // Đổi ca states
  const [requests, setRequests] = useState<ShiftSwapItem[]>([]);
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Reset Thiết bị states
  const [resetTickets, setResetTickets] = useState<DeviceResetTicketItem[]>([]);
  const [loadingReset, setLoadingReset] = useState(false);
  const [proxyModalOpen, setProxyModalOpen] = useState(false);
  const [proxyCandidateId, setProxyCandidateId] = useState('');
  const [proxyReason, setProxyReason] = useState('');
  const [proxySubmitting, setProxySubmitting] = useState(false);
  const [actionTicketId, setActionTicketId] = useState<string | null>(null);

  // Cấp Key states
  const [genCandidateId, setGenCandidateId] = useState('');
  const [genKeyType, setGenKeyType] = useState<'TRAINING' | 'OFFICIAL'>('TRAINING');
  const [genSubmitting, setGenSubmitting] = useState(false);
  const [genResult, setGenResult] = useState<{ key: string; candidateId: string; type: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  const loadResetTickets = useCallback(async () => {
    setLoadingReset(true);
    try {
      const r = await api.get<{ data: DeviceResetTicketItem[] }>('/approvals/device-reset/tickets');
      setResetTickets(r.data || []);
    } catch {
      // ignore
    } finally {
      setLoadingReset(false);
    }
  }, []);

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
    loadResetTickets();
    loadCandidates();
  }, [loadRequests, loadResetTickets]);

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      return (
        r.candidateNameA.toLowerCase().includes(q) ||
        r.candidateNameB.toLowerCase().includes(q) ||
        r.sdtA.includes(q) ||
        r.sdtB.includes(q)
      );
    });
  }, [requests, statusFilter, searchTerm]);

  // Xử lý Quản lý Duyệt Đổi ca
  const handleApprove = async (id: string) => {
    if (isViewer) {
      toast('error', 'Tài khoản Viewer chỉ có quyền xem, không được phê duyệt đơn.');
      return;
    }
    setApprovingId(id);
    try {
      await api.post(`/approvals/${id}/approve`);
      toast('success', 'Đã phê duyệt hoán đổi ca làm thành công! Hệ thống đã tự động gửi tin nhắn Zalo cho cả 2 nhân viên.');
      loadRequests();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Duyệt đơn không thành công.');
    } finally {
      setApprovingId(null);
    }
  };

  // Xử lý Từ chối Đổi ca
  const handleRejectConfirm = async () => {
    if (isViewer) {
      toast('error', 'Tài khoản Viewer chỉ có quyền xem.');
      return;
    }
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      await api.post(`/approvals/${rejectTarget.id}/reject`, { reason: rejectReasonInput });
      toast('success', 'Đã từ chối đơn đổi ca và tự động thông báo Zalo lý do cho ứng viên.');
      setRejectTarget(null);
      setRejectReasonInput('');
      loadRequests();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Từ chối đơn thất bại.');
    } finally {
      setRejecting(false);
    }
  };

  // Xử lý Tạo đơn đổi ca
  const handleCreateSubmit = async () => {
    if (isViewer) {
      toast('error', 'Tài khoản Viewer không được tạo đơn.');
      return;
    }
    if (!form.candidateIdA || !form.candidateIdB || !form.reason.trim()) {
      toast('error', 'Vui lòng điền đầy đủ thông tin nhân viên A, B và lý do đổi ca.');
      return;
    }
    if (form.candidateIdA === form.candidateIdB) {
      toast('error', 'Không thể chọn cùng 1 nhân viên hoán đổi cho chính mình.');
      return;
    }

    setCreating(true);
    try {
      await api.post('/approvals', form);
      toast('success', 'Đã tạo đơn hoán đổi ca làm mới thành công!');
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

  // TH2: Quản lý Cửa hàng tạo phiếu Reset hộ Nhân viên khi mất/hỏng máy
  const handleCreateProxyResetTicket = async () => {
    if (!proxyCandidateId || !proxyReason.trim()) {
      toast('error', 'Vui lòng chọn Nhân viên và nhập lý do đổi máy.');
      return;
    }
    setProxySubmitting(true);
    try {
      await api.post('/approvals/device-reset/create-for-employee', {
        candidateId: proxyCandidateId,
        reason: proxyReason.trim(),
      });
      toast('success', 'Đã tạo phiếu Yêu cầu Reset thiết bị cho nhân viên thành công!');
      setProxyModalOpen(false);
      setProxyCandidateId('');
      setProxyReason('');
      loadResetTickets();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Tạo phiếu thất bại.');
    } finally {
      setProxySubmitting(false);
    }
  };

  // Quản lý cửa hàng xác nhận phiếu TH1
  const handleManagerApproveReset = async (ticketId: string) => {
    setActionTicketId(ticketId);
    try {
      await api.post(`/approvals/device-reset/${ticketId}/manager-approve`);
      toast('success', 'Quản lý cửa hàng đã xác nhận phiếu thành công! Đơn đã chuyển đến IT Admin.');
      loadResetTickets();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Xác nhận thất bại.');
    } finally {
      setActionTicketId(null);
    }
  };

  // IT Admin (admin) bấm DUYỆT RESET THIẾT BỊ -> Gỡ DeviceId + Socket.io Đá LOGOUT máy cũ Realtime!
  const handleITApproveReset = async (ticketId: string) => {
    if (!isAdmin) {
      toast('error', 'Chỉ tài khoản IT Admin (admin) mới có quyền duyệt gỡ thiết bị.');
      return;
    }
    setActionTicketId(ticketId);
    try {
      await api.post(`/approvals/device-reset/${ticketId}/it-approve`);
      toast('success', '⚡ IT ADMIN ĐÃ DUYỆT RESET THIẾT BỊ THÀNH CÔNG! Điện thoại cũ đã lập tức bị đá Logout Realtime và Zalo đã gửi mã mới.');
      loadResetTickets();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Duyệt reset thất bại.');
    } finally {
      setActionTicketId(null);
    }
  };

  // Admin cấp Key Kích hoạt cho Nhân viên
  const handleGenerateKey = async () => {
    if (!isAdmin) {
      toast('error', 'Chỉ tài khoản Admin mới có quyền cấp Key kích hoạt.');
      return;
    }
    if (!genCandidateId) {
      toast('error', 'Vui lòng chọn Nhân viên.');
      return;
    }
    setGenSubmitting(true);
    try {
      const res = await api.post<{ data: { key: string; candidateId: string; type: string } }>('/admin/employee/generate-key', {
        candidateId: genCandidateId,
        type: genKeyType,
      });
      setGenResult(res.data);
      toast('success', `Đã cấp thành công Key ${genKeyType} cho nhân viên!`);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Cấp Key thất bại.');
    } finally {
      setGenSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 font-sans text-slate-800">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <CheckSquare className="text-pink-600" size={24} />
            <h1 className="text-xl font-black text-slate-900 tracking-tight">TRUNG TÂM PHÊ DUYỆT NHÂN VIÊN</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Quản lý phê duyệt hoán đổi ca làm, Reset thiết bị Realtime & Cấp Key kích hoạt nhân sự.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {mainTab === 'SWAP' && (
            <button
              type="button"
              disabled={isViewer}
              onClick={() => setCreateModalOpen(true)}
              className={cn(
                'btn-primary text-xs flex items-center gap-1.5 shadow-md shadow-pink-600/20 cursor-pointer',
                isViewer && 'opacity-50 cursor-not-allowed'
              )}
            >
              <Plus size={16} />
              <span>Tạo đơn hoán đổi ca</span>
            </button>
          )}

          {mainTab === 'DEVICE_RESET' && (
            <button
              type="button"
              disabled={isViewer}
              onClick={() => setProxyModalOpen(true)}
              className={cn(
                'btn-primary text-xs flex items-center gap-1.5 shadow-md shadow-pink-600/20 cursor-pointer bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500',
                isViewer && 'opacity-50 cursor-not-allowed'
              )}
            >
              <Plus size={16} />
              <span>+ Tạo phiếu Reset hộ NV (Khi mất máy)</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Tab Bar */}
      <div className="flex border-b border-slate-200 gap-2 font-bold text-xs">
        <button
          type="button"
          onClick={() => setMainTab('SWAP')}
          className={cn(
            'py-3 px-5 border-b-2 flex items-center gap-2 transition-colors cursor-pointer',
            mainTab === 'SWAP'
              ? 'border-pink-600 text-pink-600 font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          )}
        >
          <ArrowRightLeft size={16} />
          <span>🔄 Phê Duyệt Đổi Ca</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab('DEVICE_RESET')}
          className={cn(
            'py-3 px-5 border-b-2 flex items-center gap-2 transition-colors cursor-pointer',
            mainTab === 'DEVICE_RESET'
              ? 'border-pink-600 text-pink-600 font-extrabold'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          )}
        >
          <Smartphone size={16} />
          <span>📱 Phê Duyệt Reset Thiết Bị ({resetTickets.filter((t) => t.status !== 'APPROVED').length})</span>
        </button>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setMainTab('KEY_GEN')}
            className={cn(
              'py-3 px-5 border-b-2 flex items-center gap-2 transition-colors cursor-pointer',
              mainTab === 'KEY_GEN'
                ? 'border-pink-600 text-pink-600 font-extrabold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            )}
          >
            <Key size={16} />
            <span>🗝️ Cấp Key Kích Hoạt (Admin)</span>
          </button>
        )}
      </div>

      {/* TAB 1: PHÊ DUYỆT ĐỔI CA */}
      {mainTab === 'SWAP' && (
        <div className="space-y-4">
          {/* Requests Grid / Table */}
          {loading ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
              <Spinner size={24} className="mx-auto text-pink-600 mb-2" />
              <p className="text-xs text-slate-500">Đang tải danh sách đơn phê duyệt...</p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
              <FileText size={32} className="mx-auto text-slate-300 mb-2" />
              <h3 className="text-sm font-bold text-slate-700">Chưa có đơn hoán đổi ca nào</h3>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredRequests.map((req) => (
                <div key={req.id} className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono font-bold text-slate-400">Mã đơn: {req.id}</span>
                    <Badge className={req.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : req.status === 'REJECTED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}>
                      {req.status === 'APPROVED' ? 'Đã Phê Duyệt' : req.status === 'REJECTED' ? 'Đã Từ Chối' : '⏳ Chờ QL Duyệt'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-pink-600 block">NV A (Người gửi):</span>
                      <strong className="block text-slate-900">{req.candidateNameA}</strong>
                      <span className="text-slate-500 text-[11px] block">{req.dateA} ({req.caLamA})</span>
                    </div>

                    <div className="space-y-1 border-l border-slate-200 pl-2">
                      <span className="text-[10px] font-bold text-purple-600 block">NV B (Người đổi):</span>
                      <strong className="block text-slate-900">{req.candidateNameB}</strong>
                      <span className="text-slate-500 text-[11px] block">{req.dateB} ({req.caLamB})</span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 italic">
                    Lý do đổi ca: "{req.reason}"
                  </div>

                  {req.status === 'PENDING_MANAGER' && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => {
                          setRejectTarget(req);
                          setRejectReasonInput('');
                        }}
                        className="px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                      >
                        ❌ Từ chối
                      </button>
                      <button
                        type="button"
                        disabled={approvingId === req.id}
                        onClick={() => handleApprove(req.id)}
                        className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1 cursor-pointer"
                      >
                        {approvingId === req.id ? <Spinner size={13} /> : <CheckCircle2 size={14} />}
                        <span>✅ PHÊ DUYỆT</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PHÊ DUYỆT RESET THIẾT BỊ (TH1 & TH2) */}
      {mainTab === 'DEVICE_RESET' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl text-xs text-amber-900 space-y-1">
            <strong className="font-bold block">📱 QUY TRÌNH DUYỆT RESET THIẾT BỊ 2 CẤP:</strong>
            <p>
              • <strong>TH1 (Còn máy cũ)</strong>: Nhân viên tự tạo trên điện thoại cũ $\rightarrow$ Quản lý cửa hàng bấm <em>"Xác nhận & Chuyển IT"</em> $\rightarrow$ IT Admin (`admin`) bấm <em>"Duyệt Reset"</em> $\rightarrow$ ⚡ Máy cũ lập tức bị đá LOGOUT Realtime.
            </p>
            <p>
              • <strong>TH2 (Mất/hỏng máy cũ)</strong>: Quản lý bấm <em>"+ Tạo phiếu Reset hộ NV"</em> $\rightarrow$ IT Admin (`admin`) bấm <em>"Duyệt Reset"</em> $\rightarrow$ ⚡ AI tự gỡ DeviceId cũ & Zalo gửi thông báo cấp máy mới.
            </p>
          </div>

          {loadingReset ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
              <Spinner size={24} className="mx-auto text-pink-600 mb-2" />
              <p className="text-xs text-slate-500">Đang tải danh sách phiếu reset thiết bị...</p>
            </div>
          ) : resetTickets.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
              <Smartphone size={32} className="mx-auto text-slate-300 mb-2" />
              <h3 className="text-sm font-bold text-slate-700">Chưa có phiếu yêu cầu reset thiết bị nào</h3>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {resetTickets.map((t) => (
                <div key={t.id} className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono font-bold text-slate-400">Mã phiếu: {t.id}</span>
                    <Badge className={t.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : t.status === 'REJECTED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}>
                      {t.status === 'APPROVED'
                        ? '✅ Đã IT Duyệt Reset'
                        : t.status === 'PENDING_IT'
                          ? '⏳ Chờ IT Admin Duyệt'
                          : '⏳ Chờ QL Cửa Hàng Duyệt'}
                    </Badge>
                  </div>

                  <div className="text-xs space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div>Mã NV: <strong className="font-mono text-pink-600">{t.candidateId}</strong></div>
                    <div>Họ tên: <strong className="text-slate-900">{t.candidate?.tenUv || 'Nhân viên'}</strong> ({t.candidate?.sdtZalo})</div>
                    <div>Chi nhánh: <span className="text-slate-600">{t.candidate?.chiNhanh || 'Chưa chốt'}</span></div>
                    <div className="text-[11px] text-purple-700 font-bold pt-1">
                      {t.creatorType === 'STORE_MANAGER_FOR_EMP' ? '❌ TH2: Mất/Hỏng máy (QL tạo hộ)' : '📱 TH1: NV tự tạo trên máy cũ'}
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 italic">
                    Lý do đổi máy: "{t.reason}"
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    {t.status === 'PENDING_MANAGER' && (
                      <button
                        type="button"
                        disabled={actionTicketId === t.id}
                        onClick={() => handleManagerApproveReset(t.id)}
                        className="btn-primary text-xs py-1.5 px-3 bg-amber-600 hover:bg-amber-500 cursor-pointer"
                      >
                        {actionTicketId === t.id ? <Spinner size={13} /> : <CheckCircle2 size={14} />}
                        <span>Quản lý Xác nhận & Chuyển IT</span>
                      </button>
                    )}

                    {t.status === 'PENDING_IT' && (
                      <button
                        type="button"
                        disabled={actionTicketId === t.id || !isAdmin}
                        onClick={() => handleITApproveReset(t.id)}
                        className={cn(
                          'btn-primary text-xs py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 cursor-pointer',
                          !isAdmin && 'opacity-50 cursor-not-allowed'
                        )}
                        title={!isAdmin ? 'Chỉ IT Admin (admin) mới có quyền bấm nút này' : ''}
                      >
                        {actionTicketId === t.id ? <Spinner size={13} /> : <ShieldCheck size={14} />}
                        <span>✅ DUYỆT RESET THIẾT BỊ (IT ADMIN)</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CẤP KEY KÍCH HOẠT NHÂN VIÊN (ADMIN) */}
      {mainTab === 'KEY_GEN' && isAdmin && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 max-w-xl mx-auto space-y-4 shadow-sm font-sans">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
            <Key className="text-pink-600" size={20} />
            <h3 className="text-sm font-black text-slate-900">CẤP KEY KÍCH HOẠT CHO NHÂN SỰ</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Chọn Nhân viên *</label>
              <select
                value={genCandidateId}
                onChange={(e) => setGenCandidateId(e.target.value)}
                className="input text-xs"
              >
                <option value="">— Chọn Nhân viên cần cấp Key —</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tenUv} ({c.id}) · {c.chiNhanh || 'Chi nhánh'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Loại Key Kích Hoạt *</label>
              <select
                value={genKeyType}
                onChange={(e) => setGenKeyType(e.target.value as 'TRAINING' | 'OFFICIAL')}
                className="input text-xs"
              >
                <option value="TRAINING">Key Training (Thử việc 7 ngày - Tự hết hạn khi đủ 7 ca)</option>
                <option value="OFFICIAL">Key Nhân Viên Chính Thức (Tự động điểm danh & Tính lương tháng)</option>
              </select>
            </div>

            <button
              type="button"
              disabled={genSubmitting || !genCandidateId}
              onClick={handleGenerateKey}
              className="btn-primary w-full py-3 text-xs font-black flex items-center justify-center gap-2 cursor-pointer"
            >
              {genSubmitting ? <Spinner size={16} /> : <Key size={16} />}
              <span>CẤP KEY KÍCH HOẠT MỚI</span>
            </button>
          </div>

          {genResult && (
            <div className="bg-emerald-50 border border-emerald-300 p-4 rounded-xl space-y-2 text-xs">
              <div className="font-bold text-emerald-800">✅ CẤP KEY THÀNH CÔNG:</div>
              <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-emerald-200 font-mono font-bold text-sm text-slate-900">
                <span>{genResult.key}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(genResult.key)}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs flex items-center gap-1"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
                </button>
              </div>
              <p className="text-[11px] text-emerald-700">
                Gửi Mã NV (<strong className="font-mono">{genResult.candidateId}</strong>) và Mã Key này cho Nhân viên để họ kích hoạt trên điện thoại.
              </p>
            </div>
          )}
        </div>
      )}

      {/* MODAL TẠO PHIẾU RESET HỘ NHÂN VIÊN (TH2: MẤT MÁY) */}
      {proxyModalOpen && (
        <Modal
          open={proxyModalOpen}
          onClose={() => setProxyModalOpen(false)}
          title="TẠO PHIẾU RESET THIẾT BỊ HỘ NHÂN VIÊN (TH2: MẤT/HỎNG MÁY CỦ)"
        >
          <div className="space-y-4 font-sans text-slate-800">
            <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-xl text-xs">
              <strong>Lưu ý:</strong> Chức năng này dành cho Quản lý Cửa hàng tạo hộ khi nhân viên bị mất điện thoại hoặc hỏng máy cũ. Phiếu sẽ được chuyển ngay đến IT Admin để duyệt mở máy mới.
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Chọn Nhân viên *</label>
              <select
                value={proxyCandidateId}
                onChange={(e) => setProxyCandidateId(e.target.value)}
                className="input text-xs"
              >
                <option value="">— Chọn Nhân viên cần Reset —</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tenUv} ({c.id}) · {c.chiNhanh || 'Chi nhánh'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Lý do báo đổi máy *</label>
              <textarea
                rows={3}
                value={proxyReason}
                onChange={(e) => setProxyReason(e.target.value)}
                placeholder="Nhập lý do (ví dụ: Nhân viên báo bị mất điện thoại tại cửa hàng, đã mua máy mới...)"
                className="input text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setProxyModalOpen(false)}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={proxySubmitting || !proxyCandidateId || !proxyReason.trim()}
                onClick={handleCreateProxyResetTicket}
                className="btn-primary text-xs flex items-center gap-1.5 bg-gradient-to-r from-amber-600 to-rose-600"
              >
                {proxySubmitting ? <Spinner size={14} /> : <Send size={14} />}
                <span>Gửi IT Admin Duyệt Reset</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL TẠO ĐƠN ĐỔI CA */}
      {createModalOpen && (
        <Modal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          title="TẠO ĐƠN HOÁN ĐỔI CA LÀM VIỆC"
        >
          <div className="space-y-4 font-sans text-slate-800">
            {/* NV A */}
            <div className="space-y-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <label className="text-xs font-extrabold text-slate-700 block uppercase">
                👤 Nhân viên A (Người xin đổi ca)
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
