import { useState, useEffect } from 'react';
import {
  UserCheck,
  Search,
  RefreshCw,
  MessageCircle,
  MapPin,
  Clock,
  AlertTriangle,
  Coins,
  CheckCircle2,
  Filter,
  Edit2,
  Save,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Tooltip, Modal, Spinner } from '../components/ui';
import { useToast } from '../stores/Toast';

interface OfficialEmployeeItem {
  id: string;
  tenUv: string;
  sdtZalo: string;
  chiNhanh: string;
  caLam: string;
  ngayChinhThuc: string;
  tongSoCaDaLam: number;
  tongSoCaTre: number;
  tongTienPhat: number;
  lichSuDiemDanhMoiNhat: string;
  trangThai: string;
  dataVersion: number;
  updatedAt: string;
}

interface SummaryStats {
  totalEmployees: number;
  totalShifts: number;
  totalLate: number;
  totalFine: number;
}

export function OfficialEmployees() {
  const { toast } = useToast();
  const [items, setItems] = useState<OfficialEmployeeItem[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [shifts, setShifts] = useState<string[]>([]);
  const [summary, setSummary] = useState<SummaryStats>({
    totalEmployees: 0,
    totalShifts: 0,
    totalLate: 0,
    totalFine: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [chiNhanhFilter, setChiNhanhFilter] = useState('ALL');
  const [caLamFilter, setCaLamFilter] = useState('ALL');

  // Edit Modal State
  const [editItem, setEditItem] = useState<OfficialEmployeeItem | null>(null);
  const [editBranch, setEditBranch] = useState('');
  const [editShift, setEditShift] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (search) queryParams.set('search', search);
      if (chiNhanhFilter !== 'ALL') queryParams.set('chiNhanh', chiNhanhFilter);
      if (caLamFilter !== 'ALL') queryParams.set('caLam', caLamFilter);

      const res = await api.get<{
        items: OfficialEmployeeItem[];
        branches: string[];
        shifts: string[];
        summary: SummaryStats;
      }>(`/official-employees?${queryParams.toString()}`);

      if (res) {
        setItems(res.items ?? []);
        setBranches(res.branches ?? []);
        setShifts(res.shifts ?? []);
        if (res.summary) setSummary(res.summary);
      }
    } catch (e: unknown) {
      toast(
        'error',
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Không thể tải danh sách nhân viên chính thức.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      void loadData();
    }, 300);
    return () => clearTimeout(t);
  }, [search, chiNhanhFilter, caLamFilter]);

  const openEdit = (emp: OfficialEmployeeItem) => {
    setEditItem(emp);
    setEditBranch(emp.chiNhanh);
    setEditShift(emp.caLam);
  };

  const handleSaveEdit = async () => {
    if (!editItem) return;
    setSavingEdit(true);
    try {
      await api.patch<{ success: boolean }>(`/candidates/${editItem.id}`, {
        version: editItem.dataVersion,
        patch: {
          chiNhanh: editBranch,
          caLam: editShift,
        },
      });
      toast('success', `Đã cập nhật Chi nhánh & Ca làm cho ${editItem.tenUv}`);
      setEditItem(null);
      void loadData();
    } catch (e: unknown) {
      toast('error', e instanceof ApiError ? e.message : 'Lỗi khi cập nhật thông tin nhân viên.');
    } finally {
      setSavingEdit(false);
    }
  };

  const shiftBadgeStyle = (shift: string) => {
    switch (shift?.toUpperCase()) {
      case 'SÁNG':
      case 'SANG':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300';
      case 'CHIỀU':
      case 'CHIEU':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300';
      case 'TỐI':
      case 'TOI':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300';
      default:
        return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <UserCheck className="text-emerald-600 dark:text-emerald-400" size={28} />
            Nhân Viên Chính Thức
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Quản lý hồ sơ công tác & điểm danh ca làm hàng ngày của nhân viên chính thức
          </p>
        </div>

        <button
          onClick={() => void loadData()}
          disabled={loading}
          className="btn-secondary flex items-center gap-2 text-xs"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Làm mới
        </button>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Nhân Viên Chính Thức
            </span>
            <div className="rounded-xl bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
              <UserCheck size={20} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
            {summary.totalEmployees} <span className="text-xs font-normal text-slate-500">nhân sự</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Tổng Ca Đã Làm
            </span>
            <div className="rounded-xl bg-blue-100 p-2 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
              <Clock size={20} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
            {summary.totalShifts} <span className="text-xs font-normal text-slate-500">ca</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Số Ca Đi Trễ (≥5ph)
            </span>
            <div className="rounded-xl bg-amber-100 p-2 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
              <AlertTriangle size={20} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-extrabold text-amber-600 dark:text-amber-400">
            {summary.totalLate} <span className="text-xs font-normal text-slate-500">lượt</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Tổng Tiền Phạt (VNĐ)
            </span>
            <div className="rounded-xl bg-rose-100 p-2 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400">
              <Coins size={20} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-extrabold text-rose-600 dark:text-rose-400">
            {summary.totalFine.toLocaleString('vi-VN')} <span className="text-xs font-normal text-slate-500">đ</span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Tìm theo Mã NV, Tên, Số điện thoại Zalo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-slate-400 shrink-0" />
          <select
            value={chiNhanhFilter}
            onChange={(e) => setChiNhanhFilter(e.target.value)}
            className="input-field text-xs !py-2 max-w-[200px]"
          >
            <option value="ALL">Tất cả chi nhánh ({branches.length})</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <select
            value={caLamFilter}
            onChange={(e) => setCaLamFilter(e.target.value)}
            className="input-field text-xs !py-2"
          >
            <option value="ALL">Tất cả ca làm</option>
            <option value="SÁNG">Ca SÁNG</option>
            <option value="CHIỀU">Ca CHIỀU</option>
            <option value="TỐI">Ca TỐI</option>
            {shifts
              .filter((s) => !['SÁNG', 'CHIỀU', 'TỐI', 'SANG', 'CHIEU', 'TOI'].includes(s.toUpperCase()))
              .map((s) => (
                <option key={s} value={s}>
                  Ca {s}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="table-main">
            <thead>
              <tr className="table-header">
                <th className="table-th">MÃ NV</th>
                <th className="table-th">HỌ VÀ TÊN</th>
                <th className="table-th">SĐT ZALO</th>
                <th className="table-th">CHI NHÁNH</th>
                <th className="table-th">CA LÀM</th>
                <th className="table-th">NGÀY CHÍNH THỨC</th>
                <th className="table-th text-center">CA ĐÃ LÀM</th>
                <th className="table-th text-center">CA TRỄ</th>
                <th className="table-th text-right">TIỀN PHẠT</th>
                <th className="table-th">ĐIỂM DANH GẦN NHẤT</th>
                <th className="table-th text-center">TRẠNG THÁI</th>
                <th className="table-th text-center">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400">
                    <RefreshCw className="mx-auto mb-2 animate-spin" size={24} />
                    Đang tải dữ liệu nhân viên chính thức...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400">
                    <UserCheck className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={36} />
                    Chưa có nhân viên chính thức nào khớp với bộ lọc.
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="table-tr">
                    <td className="table-td font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {r.id}
                    </td>
                    <td className="table-td font-semibold text-slate-800 dark:text-slate-200">
                      {r.tenUv}
                    </td>
                    <td className="table-td font-mono">
                      <div className="flex items-center gap-1.5">
                        <span>{r.sdtZalo}</span>
                        <a
                          href={`https://zalo.me/${r.sdtZalo}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-500 hover:text-blue-700"
                        >
                          <Tooltip text="Mở chat Zalo">
                            <MessageCircle size={14} />
                          </Tooltip>
                        </a>
                      </div>
                    </td>
                    <td className="table-td text-xs text-slate-600 dark:text-slate-400">
                      <div className="flex items-center gap-1">
                        <MapPin size={12} className="text-slate-400 shrink-0" />
                        <span className="truncate max-w-[180px] font-medium">{r.chiNhanh || '—'}</span>
                      </div>
                    </td>
                    <td className="table-td">
                      <Badge className={shiftBadgeStyle(r.caLam)}>{r.caLam || '—'}</Badge>
                    </td>
                    <td className="table-td text-xs text-slate-600 dark:text-slate-400">
                      {r.ngayChinhThuc || '—'}
                    </td>
                    <td className="table-td text-center">
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
                        {r.tongSoCaDaLam} ca
                      </Badge>
                    </td>
                    <td className="table-td text-center">
                      {r.tongSoCaTre > 0 ? (
                        <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300 font-bold">
                          {r.tongSoCaTre} ca
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">0</span>
                      )}
                    </td>
                    <td className="table-td text-right font-mono font-bold text-xs">
                      {r.tongTienPhat > 0 ? (
                        <span className="text-rose-600 dark:text-rose-400">
                          {r.tongTienPhat.toLocaleString('vi-VN')}đ
                        </span>
                      ) : (
                        <span className="text-slate-400">0đ</span>
                      )}
                    </td>
                    <td className="table-td text-xs font-mono text-slate-600 dark:text-slate-400">
                      {r.lichSuDiemDanhMoiNhat || 'Chưa điểm danh'}
                    </td>
                    <td className="table-td text-center">
                      <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30 flex items-center gap-1 justify-center">
                        <CheckCircle2 size={12} />
                        ĐANG LÀM VIỆC
                      </Badge>
                    </td>
                    <td className="table-td text-center">
                      <button
                        onClick={() => openEdit(r)}
                        className="btn-secondary !py-1 !px-2 text-xs flex items-center gap-1 mx-auto"
                      >
                        <Edit2 size={12} /> Sửa
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Branch & Shift Modal */}
      <Modal
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title={`✏️ Cập Nhật Thông Tin – ${editItem?.tenUv ?? ''}`}
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1 dark:bg-slate-800 dark:text-slate-300">
            <div>
              <span className="font-bold">Mã NV:</span> {editItem?.id}
            </div>
            <div>
              <span className="font-bold">SĐT Zalo:</span> {editItem?.sdtZalo}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Chi nhánh làm việc chính thức:
            </label>
            <input
              type="text"
              value={editBranch}
              onChange={(e) => setEditBranch(e.target.value)}
              className="input-field text-xs"
              placeholder="VD: CN1: 130 Vạn Kiếp, Phường 3, Quận Bình Thạnh"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Ca làm việc chính thức:
            </label>
            <select
              value={editShift}
              onChange={(e) => setEditShift(e.target.value)}
              className="input-field text-xs"
            >
              <option value="SÁNG">Ca SÁNG (07h00 - 12h00)</option>
              <option value="CHIỀU">Ca CHIỀU (12h00 - 18h00)</option>
              <option value="TỐI">Ca TỐI (18h00 - 22h00)</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button className="btn-secondary text-xs" onClick={() => setEditItem(null)}>
              Hủy
            </button>
            <button
              className="btn-primary text-xs flex items-center gap-1 font-bold"
              onClick={() => void handleSaveEdit()}
              disabled={savingEdit}
            >
              {savingEdit ? <Spinner size={14} /> : <Save size={14} />}
              Lưu & Đồng Bộ Realtime
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
