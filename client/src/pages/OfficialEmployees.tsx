import { useState, useEffect, useRef } from 'react';
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
  Download,
  Upload,
  FileSpreadsheet,
  FileText,
  AlertCircle,
  X,
  Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
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

  // Delete Modal State
  const [deleteItem, setDeleteItem] = useState<OfficialEmployeeItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteItem) return;
    setDeleting(true);
    try {
      await api.delete('/official-employees/' + encodeURIComponent(deleteItem.id));
      toast('success', `Đã xóa thành công nhân viên ${deleteItem.tenUv} (${deleteItem.id})`);
      setDeleteItem(null);
      loadData();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Xóa nhân viên thất bại');
    } finally {
      setDeleting(false);
    }
  };

  // Import File States
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<
    {
      tenUv: string;
      sdtZalo: string;
      chiNhanh: string;
      caLam: string;
      namSinh?: string;
      trinhDo?: string;
      queQuan?: string;
      kinhNghiem?: string;
      linkFb?: string;
      ngayChinhThuc?: string;
    }[]
  >([]);
  const [importResult, setImportResult] = useState<{
    insertedCount: number;
    updatedCount: number;
    totalProcessed: number;
    errors: { row: number; name: string; error: string }[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 1. Tải File Excel Mẫu Chuẩn Cho Nhân Viên Chính Thức
  const handleDownloadSampleExcel = () => {
    const sampleData = [
      {
        'Họ và tên *': 'Nguyễn Văn An',
        'Số điện thoại Zalo *': '0987654321',
        'Chi nhánh *': 'Chi nhánh Quận 1',
        'Ca làm việc *': 'SÁNG',
        'Năm sinh': '2002',
        'Trình độ học vấn': 'Đại học',
        'Quê quán': 'TP.HCM',
        'Kinh nghiệm': 'Đã từng làm nhân viên thu ngân 1 năm',
        'Link Facebook': 'https://facebook.com/nguyenvanan',
        'Ngày bắt đầu làm': '25/08/2026',
      },
      {
        'Họ và tên *': 'Trần Thị Bình',
        'Số điện thoại Zalo *': '0912345678',
        'Chi nhánh *': 'Chi nhánh Tân Bình',
        'Ca làm việc *': 'CHIỀU',
        'Năm sinh': '2001',
        'Trình độ học vấn': 'Cao đẳng',
        'Quê quán': 'Đồng Nai',
        'Kinh nghiệm': 'Nhân viên pha chế trà sữa',
        'Link Facebook': '',
        'Ngày bắt đầu làm': '25/08/2026',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    worksheet['!cols'] = [
      { wch: 22 },
      { wch: 18 },
      { wch: 22 },
      { wch: 15 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 35 },
      { wch: 30 },
      { wch: 18 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'DS_NhanVien_ChinhThuc');
    XLSX.writeFile(workbook, 'Mau_Import_Nhan_Vien_Chinh_Thuc_UmboMilk.xlsx');
    toast('success', '📥 Đã tải xuống File Excel Mẫu thành công!');
  };

  // 2. Đọc & Parse File Excel / CSV Upload
  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true, dateNF: 'yyyy-mm-dd' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false, dateNF: 'yyyy-mm-dd' });

        if (!rawData || rawData.length === 0) {
          toast('error', 'File Excel không có dữ liệu!');
          return;
        }

        const parsed = rawData.map((row) => {
          const tenUv = row['Họ và tên *'] || row['Họ và tên'] || row['tenUv'] || row['Ho va ten'] || '';
          const sdtZalo = row['Số điện thoại Zalo *'] || row['Số điện thoại Zalo'] || row['sdtZalo'] || row['So dien thoai'] || '';
          const chiNhanh = row['Chi nhánh *'] || row['Chi nhánh'] || row['chiNhanh'] || row['Chi nhanh'] || '';
          const caLam = row['Ca làm việc *'] || row['Ca làm việc'] || row['caLam'] || row['Ca lam'] || '';

          return {
            tenUv: String(tenUv || '').trim(),
            sdtZalo: String(sdtZalo || '').trim(),
            chiNhanh: String(chiNhanh || '').trim(),
            caLam: String(caLam || '').trim(),
            namSinh: String(row['Năm sinh'] || row['namSinh'] || '').trim(),
            trinhDo: String(row['Trình độ học vấn'] || row['trinhDo'] || '').trim(),
            queQuan: String(row['Quê quán'] || row['queQuan'] || '').trim(),
            kinhNghiem: String(row['Kinh nghiệm'] || row['kinhNghiem'] || '').trim(),
            linkFb: String(row['Link Facebook'] || row['linkFb'] || '').trim(),
            ngayChinhThuc: String(row['Ngày bắt đầu làm'] || row['ngayChinhThuc'] || '').trim(),
          };
        });

        setImportPreview(parsed);
        toast('success', `Đã đọc thành công ${parsed.length} dòng dữ liệu từ file Excel!`);
      } catch (err) {
        toast('error', 'Lỗi đọc file Excel/CSV. Vui lòng kiểm tra định dạng file!');
      }
    };
    reader.readAsBinaryString(file);
  };

  // 3. Thực hiện Import Danh sách vào Hệ thống
  const handleExecuteImport = async () => {
    if (importPreview.length === 0) {
      toast('error', 'Vui lòng chọn file Excel có dữ liệu trước!');
      return;
    }

    setImporting(true);
    try {
      const res = await api.post<{
        insertedCount: number;
        updatedCount: number;
        totalProcessed: number;
        errors: { row: number; name: string; error: string }[];
      }>('/official-employees/import', { employees: importPreview });

      if (res) {
        setImportResult(res);
        toast('success', `🎉 Import thành công ${res.insertedCount} NV mới + ${res.updatedCount} NV cập nhật!`);
        void loadData();
      }
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Import thất bại.');
    } finally {
      setImporting(false);
    }
  };

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

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleDownloadSampleExcel}
            className="btn-secondary flex items-center gap-1.5 text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200 cursor-pointer"
            title="Tải xuống File mẫu Excel gồm đầy đủ các trường của Nhân viên chính thức"
          >
            <Download size={14} />
            <span>📥 TẢI FILE EXCEL MẪU</span>
          </button>

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="btn-primary flex items-center gap-1.5 text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white cursor-pointer shadow-sm"
            title="Import tất cả Nhân viên chính thức từ file Excel/CSV vào hệ thống web"
          >
            <Upload size={14} />
            <span>📤 IMPORT DANH SÁCH NHÂN VIÊN</span>
          </button>

          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="btn-secondary flex items-center gap-2 text-xs cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Làm mới</span>
          </button>
        </div>
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
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openEdit(r)}
                          className="btn-secondary !py-1 !px-2 text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <Edit2 size={12} /> Sửa
                        </button>
                        <button
                          onClick={() => setDeleteItem(r)}
                          className="btn-danger !py-1 !px-2 text-xs flex items-center gap-1 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-900/60 rounded-lg border border-rose-200 dark:border-rose-800 transition-colors cursor-pointer"
                          title="Xóa nhân viên chính thức"
                        >
                          <Trash2 size={12} /> Xóa
                        </button>
                      </div>
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

      {/* Import Modal */}
      <Modal
        open={importModalOpen}
        onClose={() => {
          setImportModalOpen(false);
          setImportPreview([]);
          setImportResult(null);
        }}
        title="📤 IMPORT DANH SÁCH NHÂN VIÊN CHÍNH THỨC TỪ EXCEL"
      >
        <div className="space-y-4 max-w-2xl font-sans">
          <div className="bg-slate-50 dark:bg-slate-800/80 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <FileSpreadsheet size={16} className="text-emerald-500" />
                <span>1. Chọn File Excel / CSV cần Import *</span>
              </span>

              <button
                type="button"
                onClick={handleDownloadSampleExcel}
                className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Download size={13} />
                <span>Tải File Mẫu (.xlsx)</span>
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileSelected}
              className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-emerald-100 file:text-emerald-700 hover:file:bg-emerald-200 cursor-pointer"
            />
          </div>

          {/* Table Preview Dữ liệu đọc được */}
          {importPreview.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-200">
                  📋 XEM TRƯỚC DỮ LIỆU FILE ({importPreview.length} nhân sự):
                </span>
                <span className="text-[11px] text-slate-500">Hiển thị tối đa 5 dòng mẫu</span>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl max-h-48">
                <table className="w-full text-[11px] text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold sticky top-0">
                    <tr>
                      <th className="p-2 border-b">STT</th>
                      <th className="p-2 border-b">Họ và tên</th>
                      <th className="p-2 border-b">SĐT Zalo</th>
                      <th className="p-2 border-b">Chi nhánh</th>
                      <th className="p-2 border-b">Ca làm</th>
                      <th className="p-2 border-b">Kiểm tra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                    {importPreview.slice(0, 5).map((row, idx) => {
                      const isValid = row.tenUv && row.sdtZalo && row.chiNhanh && row.caLam;
                      return (
                        <tr key={idx}>
                          <td className="p-2 font-mono">{idx + 1}</td>
                          <td className="p-2 font-bold text-slate-900 dark:text-white">{row.tenUv || '—'}</td>
                          <td className="p-2 font-mono">{row.sdtZalo || '—'}</td>
                          <td className="p-2">{row.chiNhanh || '—'}</td>
                          <td className="p-2 font-bold text-amber-600">{row.caLam || '—'}</td>
                          <td className="p-2">
                            {isValid ? (
                              <span className="text-emerald-600 font-bold">✓ Hợp lệ</span>
                            ) : (
                              <span className="text-rose-600 font-bold">⚠️ Thiếu tin</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {importPreview.length > 5 && (
                <p className="text-[11px] text-slate-400 italic text-center">
                  ...và còn {importPreview.length - 5} nhân sự khác trong file
                </p>
              )}

              <button
                type="button"
                disabled={importing}
                onClick={handleExecuteImport}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:opacity-95 text-white font-black text-xs rounded-xl shadow-lg flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all mt-3"
              >
                {importing ? (
                  <>
                    <Spinner size={16} className="text-white" />
                    <span>ĐANG IMPORT TẤT CẢ NHÂN VIÊN...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>🚀 TỰ ĐỘNG IMPORT TẤT CẢ {importPreview.length} NHÂN VIÊN VÀO HỆ THỐNG</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Báo cáo kết quả Import */}
          {importResult && (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/50 p-4 rounded-2xl space-y-2 text-xs font-sans">
              <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 text-sm">
                <CheckCircle2 size={18} />
                <span>KẾT QUẢ IMPORT HOÀN TẤT:</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center py-2">
                <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-emerald-200">
                  <div className="text-slate-500 text-[10px]">TỔNG SỐ DÒNG</div>
                  <div className="font-black text-slate-900 dark:text-white text-base">{importResult.totalProcessed}</div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-emerald-200">
                  <div className="text-emerald-600 text-[10px]">THÊM MỚI</div>
                  <div className="font-black text-emerald-600 text-base">+{importResult.insertedCount}</div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-emerald-200">
                  <div className="text-blue-600 text-[10px]">CẬP NHẬT</div>
                  <div className="font-black text-blue-600 text-base">+{importResult.updatedCount}</div>
                </div>
              </div>

              {importResult.errors && importResult.errors.length > 0 && (
                <div className="mt-2 pt-2 border-t border-emerald-200 text-rose-700 dark:text-rose-400 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <AlertTriangle size={14} />
                    <span>Danh sách dòng bị bỏ qua ({importResult.errors.length} dòng):</span>
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-0.5 font-mono text-[11px]">
                    {importResult.errors.map((err, i) => (
                      <div key={i}>
                        Dòng {err.row} ({err.name || 'Không tên'}): {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Modal xác nhận Xóa nhân viên */}
      {deleteItem && (
        <Modal open={!!deleteItem} onClose={() => setDeleteItem(null)} title="🗑️ Xác Nhận Xóa Nhân Viên">
          <div className="space-y-4 p-2">
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 flex items-start gap-3 text-rose-800 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-300">
              <AlertTriangle size={20} className="shrink-0 text-rose-600 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold">Bạn có chắc chắn muốn xóa nhân viên này khỏi hệ thống?</p>
                <p className="mt-1">Hành động này sẽ xóa vĩnh viễn hồ sơ, lịch ca làm việc và mã truy cập điểm danh Portal của nhân viên.</p>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1 text-xs dark:bg-slate-900 dark:border-slate-800">
              <div>• Mã NV: <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{deleteItem.id}</span></div>
              <div>• Nhân viên: <span className="font-bold text-slate-800 dark:text-slate-200">{deleteItem.tenUv}</span></div>
              <div>• SĐT Zalo: <span className="font-medium text-slate-700 dark:text-slate-300">{deleteItem.sdtZalo}</span></div>
              <div>• Chi nhánh: <span className="font-medium text-slate-700 dark:text-slate-300">{deleteItem.chiNhanh}</span></div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteItem(null)}
                className="btn-secondary !py-1.5 !px-3 text-xs cursor-pointer"
                disabled={deleting}
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleDelete}
                className="btn-primary bg-rose-600 hover:bg-rose-700 text-white !py-1.5 !px-3 text-xs flex items-center gap-1.5 cursor-pointer"
                disabled={deleting}
              >
                {deleting ? <Spinner size={14} /> : <Trash2 size={14} />}
                <span>Xác Nhận Xóa</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
