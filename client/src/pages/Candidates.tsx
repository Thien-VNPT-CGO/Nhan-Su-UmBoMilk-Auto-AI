import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Filter, ChevronLeft, ChevronRight, Users, Eye, RefreshCw,
  CheckCircle2, XCircle, AlertTriangle, BrainCircuit, Trash2,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Badge, Skeleton, EmptyState, Tooltip, Modal } from '../components/ui';
import CandidateDrawer from '../components/CandidateDrawer';
import { useToast } from '../stores/Toast';
import { getSocket } from '../api/socket';
import { cn, trainingStatusLabel, syncStatusStyle } from '../utils/format';
import { formatDateTime } from '../utils/date';

interface CandidateRow {
  id: string;
  thoiGian: string;
  tenUv: string;
  gioiTinh: string | null;
  namSinh: string;
  sdtZalo: string;
  trinhDo: string;
  queQuan: string;
  caLam: string;
  chiNhanh: string;
  kinhNghiem: string;
  tongDiem: number | null;
  aiRecommendation: string | null;
  hrDecision: string | null;
  trangThaiTraining: string | null;
  aiScoredAt: string | null;
  dataVersion: number;
  _count?: { syncJobs: number; conflicts: number };
}

const STATUS_FILTERS = [
  { key: '', label: 'Tất cả' },
  { key: 'SCORED', label: 'Đã chấm' },
  { key: 'PASS', label: 'Đạt' },
  { key: 'FAIL', label: 'Loại' },
  { key: 'REVIEW', label: 'Cần xem lại' },
  { key: 'TRAINING', label: 'Đang đào tạo' },
];

interface DuplicateRow {
  id: string;
  tenUv: string;
  thoiGian: string;
  sdtZalo: string;
  chiNhanh: string;
}

interface DuplicateGroup {
  sdtZalo: string;
  count: number;
  keep: DuplicateRow;
  remove: DuplicateRow[];
}

const SORTS = [
  { key: 'newest', label: 'Mới nhất' },
  { key: 'oldest', label: 'Cũ nhất' },
  { key: 'score_desc', label: 'Điểm cao nhất' },
  { key: 'score_asc', label: 'Điểm thấp nhất' },
];

function decisionBadge(d: string | null) {
  if (d === 'PASS') return <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 size={11} /> ĐẠT</Badge>;
  if (d === 'FAIL') return <Badge className="bg-rose-100 text-rose-700"><XCircle size={11} /> LOẠI</Badge>;
  if (d === 'REVIEW') return <Badge className="bg-amber-100 text-amber-700"><AlertTriangle size={11} /> CẦN XEM LẠI</Badge>;
  return <span className="text-slate-400 text-xs">—</span>;
}

export default function Candidates() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [chiNhanh, setChiNhanh] = useState('');
  const [caLam, setCaLam] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [shiftOptions, setShiftOptions] = useState<string[]>([]);
  const [selected, setSelected] = useState<CandidateRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CandidateRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dups, setDups] = useState<DuplicateGroup[]>([]);
  const [dupOpen, setDupOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const loadDups = useCallback(() => {
    api
      .get<DuplicateGroup[]>('/candidates/duplicates')
      .then(setDups)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadDups();
  }, [loadDups]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({
        search,
        chiNhanh,
        caLam,
        status,
        sort,
        page: String(page),
        pageSize: String(pageSize),
      });
      const data = await api.get<{ rows: CandidateRow[]; total: number }>(`/candidates?${q}`);
      setRows(data.rows);
      setTotal(data.total);
    } catch {
      toast('error', 'Không tải được danh sách ứng viên.');
    } finally {
      setLoading(false);
    }
  }, [search, chiNhanh, caLam, status, sort, page, pageSize, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ chiNhanh: string[]; caLam: string[] }>('/candidates/filters')
      .then((d) => {
        setBranchOptions(d.chiNhanh);
        setShiftOptions(d.caLam);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => {
      void load();
      if (selected) {
        api.get<CandidateRow>(`/candidates/${selected.id}`).then(setSelected).catch(() => undefined);
      }
    };
    const events = ['candidate:new', 'candidate:updated', 'candidate:scored', 'candidate:decision', 'candidate:sync', 'training:updated', 'sync:success'];
    events.forEach((ev) => socket.on(ev, refresh));
    return () => events.forEach((ev) => socket.off(ev, refresh));
  }, [load, selected]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const syncState = useMemo(() => {
    const pending = rows.filter((r) => r._count && r._count.syncJobs > 0).length;
    return pending;
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Ứng viên</h1>
          <p className="text-sm text-slate-500">{total} hồ sơ</p>
        </div>
        <button className="btn-secondary" onClick={() => { void load(); loadDups(); }}>
          <RefreshCw size={15} /> Làm mới
        </button>
      </div>

      {dups.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm text-amber-800">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              Có <b>{dups.reduce((n, g) => n + g.remove.length, 0)}</b> hồ sơ trùng số điện thoại
              (<b>{dups.length}</b> nhóm). Hệ thống chỉ giữ 1 hồ sơ mới nhất mỗi SĐT, các bản trùng sẽ bị loại khỏi web và Google Sheet (cả 3 tab).
            </span>
          </div>
          <button className="btn-secondary !py-1.5 shrink-0" onClick={() => setDupOpen(true)}>
            <AlertTriangle size={14} /> Xem & dọn dẹp
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="card p-3.5 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Tìm theo tên, SĐT, mã UV..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Filter size={15} className="text-slate-400" />
        <select className="input w-auto" value={chiNhanh} onChange={(e) => { setChiNhanh(e.target.value); setPage(1); }}>
          <option value="">Chi nhánh</option>
          {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="input w-auto" value={caLam} onChange={(e) => { setCaLam(e.target.value); setPage(1); }}>
          <option value="">Ca</option>
          {shiftOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          {STATUS_FILTERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className="input w-auto" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50/80">
              <tr>
                <th className="table-th">Mã UV</th>
                <th className="table-th">Thời gian</th>
                <th className="table-th">Tên</th>
                <th className="table-th">Giới tính</th>
                <th className="table-th">Năm sinh</th>
                <th className="table-th">SĐT</th>
                <th className="table-th">Trình độ</th>
                <th className="table-th">Quê quán</th>
                <th className="table-th">Ca</th>
                <th className="table-th">Chi nhánh</th>
                <th className="table-th">Kinh nghiệm</th>
                <th className="table-th">Điểm AI</th>
                <th className="table-th">Gợi ý AI</th>
                <th className="table-th">Quyết định HR</th>
                <th className="table-th">Đào tạo</th>
                <th className="table-th">Đồng bộ</th>
                <th className="table-th">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 16 }).map((_, j) => (
                      <td key={j} className="table-td"><Skeleton className="h-4" /></td>
                    ))}
                  </tr>
                ))}
              {!loading && rows.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-brand-50/40 cursor-pointer transition-colors"
                  onClick={() => setSelected(r)}
                >
                  <td className="table-td font-mono text-xs font-bold text-brand-600">{r.id}</td>
                  <td className="table-td text-xs text-slate-500">{formatDateTime(r.thoiGian)}</td>
                  <td className="table-td font-semibold text-slate-800">{r.tenUv}</td>
                  <td className="table-td text-slate-600">{r.gioiTinh || '—'}</td>
                  <td className="table-td text-slate-600">{r.namSinh}</td>
                  <td className="table-td text-slate-600">{r.sdtZalo}</td>
                  <td className="table-td text-slate-600 max-w-[160px] truncate">{r.trinhDo}</td>
                  <td className="table-td text-slate-600">{r.queQuan}</td>
                  <td className="table-td"><Badge className="bg-brand-50 text-brand-700">{r.caLam}</Badge></td>
                  <td className="table-td text-slate-600">{r.chiNhanh}</td>
                  <td className="table-td text-slate-600 max-w-[160px] truncate">{r.kinhNghiem}</td>
                  <td className="table-td">
                    {r.tongDiem !== null ? (
                      <span className={cn(
                        'inline-flex items-center justify-center w-8 h-8 rounded-xl text-sm font-extrabold',
                        r.tongDiem >= 7 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
                      )}>
                        {r.tongDiem}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="table-td">
                    {r.aiRecommendation ? (
                      r.aiRecommendation === 'PASS'
                        ? <Badge className="bg-emerald-50 text-emerald-600 border border-emerald-100">ĐẠT</Badge>
                        : <Badge className="bg-slate-100 text-slate-500">LOẠI</Badge>
                    ) : r.aiScoredAt ? (
                      <Badge className="bg-sky-50 text-sky-600"><BrainCircuit size={11} /> Đang chấm</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">Chưa chấm</span>
                    )}
                  </td>
                  <td className="table-td">{decisionBadge(r.hrDecision)}</td>
                  <td className="table-td">
                    {r.trangThaiTraining ? (
                      <Badge className={trainingStatusLabel[r.trangThaiTraining]?.cls}>
                        {trainingStatusLabel[r.trangThaiTraining]?.label ?? r.trangThaiTraining}
                      </Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="table-td">
                    {r._count && r._count.conflicts > 0 ? (
                      <Badge className="bg-purple-100 text-purple-700">XUNG ĐỘT</Badge>
                    ) : (
                      <Badge className={syncStatusStyle.SYNCED.cls}>{syncStatusStyle.SYNCED.label}</Badge>
                    )}
                  </td>
                  <td className="table-td">
                    <div className="flex items-center gap-1.5">
                      <Tooltip text="Xem chi tiết">
                        <button
                          className="btn-secondary !px-2.5 !py-1.5"
                          onClick={(e) => { e.stopPropagation(); setSelected(r); }}
                        >
                          <Eye size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip text="Xóa ứng viên">
                        <button
                          className="btn-secondary !px-2.5 !py-1.5 !text-red-500 hover:!bg-red-50"
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(r); }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 && <EmptyState title="Không có ứng viên" hint="Thử thay đổi bộ lọc hoặc chờ hồ sơ mới từ Google Form." />}

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
          <span className="text-xs text-slate-500">Trang {page}/{totalPages} · {total} kết quả</span>
          <div className="flex gap-2">
            <button className="btn-secondary !px-2.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={15} />
            </button>
            <button className="btn-secondary !px-2.5" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      <CandidateDrawer
        candidateId={selected?.id ?? null}
        open={!!selected}
        onClose={() => setSelected(null)}
        onChanged={() => void load()}
      />

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Xóa ứng viên"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Xóa hồ sơ <b className="text-slate-800">{confirmDelete?.tenUv}</b> ({confirmDelete?.id})?
            Dữ liệu liên quan (ca trực, điểm, training...) sẽ bị xóa khỏi hệ thống
            và khỏi Google Sheet. <b>Không thể hoàn tác.</b>
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>Hủy</button>
            <button
              className="btn-danger"
              disabled={deleting}
              onClick={async () => {
                if (!confirmDelete) return;
                setDeleting(true);
                try {
                  await api.delete(`/candidates/${confirmDelete.id}`);
                  toast('success', `Đã xóa ứng viên ${confirmDelete.tenUv}.`);
                  setConfirmDelete(null);
                  void load();
                } catch (e) {
                  toast('error', e instanceof ApiError ? e.message : 'Xóa ứng viên thất bại.');
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? 'Đang xóa...' : 'Xóa'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={dupOpen}
        onClose={() => setDupOpen(false)}
        title="Dữ liệu trùng số điện thoại"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Mỗi SĐT chỉ giữ <b className="text-slate-800">1 hồ sơ mới nhất</b>. Các bản trùng sẽ bị xóa
            khỏi hệ thống và đồng bộ xóa về Google Sheet (LOC_HO_SO_PV, DIEM_UV, HO_SO_NHAN_VIEN_UNG_TUYEN).
          </p>
          {dups.map((g) => (
            <div key={g.sdtZalo} className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="bg-slate-50 px-3.5 py-2 flex items-center justify-between text-sm">
                <span className="font-bold text-slate-700">SĐT {g.sdtZalo}</span>
                <span className="text-xs text-amber-600 font-semibold">{g.remove.length} bản trùng</span>
              </div>
              <div className="divide-y divide-slate-50 text-xs">
                <div className="px-3.5 py-2 flex items-center gap-2 bg-emerald-50/60">
                  <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                  <span className="font-mono text-emerald-700">{g.keep.id}</span>
                  <span className="font-semibold text-slate-700">{g.keep.tenUv}</span>
                  <span className="text-slate-500 ml-auto">GIỮ LẠI · {formatDateTime(g.keep.thoiGian)}</span>
                </div>
                {g.remove.map((r) => (
                  <div key={r.id} className="px-3.5 py-2 flex items-center gap-2">
                    <XCircle size={13} className="text-rose-400 shrink-0" />
                    <span className="font-mono text-slate-500">{r.id}</span>
                    <span className="text-slate-600">{r.tenUv}</span>
                    <span className="text-slate-400 ml-auto">{formatDateTime(r.thoiGian)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary" onClick={() => setDupOpen(false)}>Đóng</button>
            <button
              className="btn-danger"
              disabled={cleaning}
              onClick={async () => {
                setCleaning(true);
                try {
                  const r = await api.post<{ removed: number }>('/candidates/duplicates/cleanup');
                  toast('success', `Đã loại bỏ ${r.removed} hồ sơ trùng. Đang đồng bộ xóa về Google Sheet...`);
                  setDupOpen(false);
                  setDups([]);
                  void load();
                } catch (e) {
                  toast('error', e instanceof ApiError ? e.message : 'Dọn dẹp trùng lặp thất bại.');
                } finally {
                  setCleaning(false);
                }
              }}
            >
              {cleaning ? 'Đang dọn dẹp...' : 'Loại bỏ tất cả bản trùng'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}