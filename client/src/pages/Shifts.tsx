import { useEffect, useState, useCallback, useMemo } from 'react';
import { RefreshCw, CalendarDays, GraduationCap, Briefcase, Lock, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Skeleton, Badge, Modal, Spinner, Field } from '../components/ui';

import { useToast } from '../stores/Toast';
import { useAuth } from '../stores/auth';
import { getSocket } from '../api/socket';
import { dateKey, weekdayVi, formatDate } from '../utils/date';
import { cn, shiftColor } from '../utils/format';
import { debounce } from '../utils/debounce';

interface RowData {
  candidateId: string;
  tenUv: string;
  sdtZalo?: string;
  chiNhanh: string;
  caLam: string;
  shifts: Record<
    string,
    {
      shifts: string;
      attendanceStatus?: 'ON_TIME' | 'LATE_5P' | 'LATE_30P' | 'LATE_60P' | 'ABSENT' | null;
      checkinTime?: string | null;
      lateMinutes?: number;
      fineAmount?: number;
      reason?: string | null;
      isLocked?: boolean;
    }
  >;
}

const SHIFT_KEYS = ['SANG', 'CHIEU', 'TOI', 'OFF'] as const;

function startOfToday(): string {
  const d = new Date();
  const tzDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return dateKey(tzDate);
}

function getLockedShiftKey(caLam?: string): 'SANG' | 'CHIEU' | 'TOI' | null {
  if (!caLam) return null;
  const str = caLam.toLowerCase();
  if (str.includes('sang') || str.includes('7h')) return 'SANG';
  if (str.includes('chieu') || str.includes('12h') || str.includes('trua')) return 'CHIEU';
  if (str.includes('toi') || str.includes('18h')) return 'TOI';
  return null;
}

export default function Shifts() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [tab, setTab] = useState<'training' | 'employees'>('training');
  const [trainingRows, setTrainingRows] = useState<RowData[]>([]);
  const [employeeRows, setEmployeeRows] = useState<RowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ candidateId: string; tenUv: string; date: string; current: string; caLam?: string } | null>(null);

  // State Modal xem chi tiết chấm công của ô đã bị khóa
  const [viewAttDetail, setViewAttDetail] = useState<{
    candidateId: string;
    tenUv: string;
    date: string;
    chiNhanh: string;
    caLam: string;
    attendanceStatus: string;
    checkinTime: string;
    lateMinutes: number;
    fineAmount: number;
    reason: string;
    isOngoingOrPastNoAtt?: boolean;
  } | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [startDateStr, setStartDateStr] = useState(startOfToday());

  const dates = useMemo(() => {
    const parts = startDateStr.split('-').map(Number);
    const start = new Date(parts[0], parts[1] - 1, parts[2]);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return dateKey(d);
    });
  }, [startDateStr]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const from = dates[0];
      const to = dates[dates.length - 1];
      const data = await api.get<{
        training: RowData[];
        employees: RowData[];
      }>(`/shifts?from=${from}&to=${to}`);

      setTrainingRows(data.training || []);
      setEmployeeRows(data.employees || []);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Không tải được lịch.');
    } finally {
      setLoading(false);
    }
  }, [dates, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const debouncedReload = debounce(() => loadData(), 500);

    const handler = () => debouncedReload();
    socket.on('shift:updated', handler);
    return () => {
      socket.off('shift:updated', handler);
    };
  }, [loadData]);

  const activeRows = tab === 'training' ? trainingRows : employeeRows;

  const toggleSelect = (val: string) => {
    if (val === 'OFF') {
      setSelected(['OFF']);
      return;
    }
    const currentWithoutOff = selected.filter((x) => x !== 'OFF');
    if (currentWithoutOff.includes(val)) {
      const next = currentWithoutOff.filter((x) => x !== val);
      setSelected(next.length ? next : ['OFF']);
    } else {
      setSelected([...currentWithoutOff, val]);
    }
  };

  const handleSave = async () => {
    if (!edit) return;
    setSaving(true);

    try {
      const shiftsVal = selected.length === 0 ? 'OFF' : selected.join('|');

      const updateInState = (rows: RowData[]) =>
        rows.map((r) => {
          if (r.candidateId !== edit.candidateId) return r;
          const currentCell = r.shifts[edit.date] || {};
          return {
            ...r,
            shifts: {
              ...r.shifts,
              [edit.date]: {
                ...currentCell,
                shifts: shiftsVal,
              },
            },
          };
        });

      setTrainingRows(updateInState);
      setEmployeeRows(updateInState);

      await api.post('/shifts', {
        candidateId: edit.candidateId,
        date: edit.date,
        shifts: shiftsVal,
      });

      toast('success', `Đã lưu lịch ngày ${formatDate(edit.date)}`);
      setEdit(null);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Lưu lịch thất bại');
      loadData();
    } finally {
      setSaving(false);
    }
  };

  const shiftBadgeColors: Record<string, string> = {
    SANG: 'bg-amber-100 text-amber-800 border-amber-300',
    CHIEU: 'bg-teal-100 text-teal-800 border-teal-300',
    TOI: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    OFF: 'bg-slate-100 text-slate-600 border-slate-300',
  };

  const isToday = (dStr: string) => dStr === startOfToday();

  // Kiểm tra ca làm việc ở modal xem có bị khóa không
  const isEditModalDisabled = useMemo(() => {
    if (!edit) return false;
    const todayStr = startOfToday();
    if (edit.date < todayStr) return true;
    if (edit.date === todayStr) {
      const normCa = (edit.caLam || '').toLowerCase();
      let startH = 7;
      if (normCa.includes('chieu') || normCa.includes('12h')) startH = 12;
      else if (normCa.includes('toi') || normCa.includes('18h')) startH = 18;

      const currentVnHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).getHours();
      if (currentVnHour >= startH) return true;
    }
    return false;
  }, [edit]);

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-2xs">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <CalendarDays className="text-brand-600" size={24} /> Lịch làm việc
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {formatDate(dates[0])} &rarr; {formatDate(dates[6])} &middot; Click ô chưa đến giờ để đổi ca. Ô đã đến giờ/đã chấm công được khóa tự động bởi AI.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="date"
            value={startDateStr}
            onChange={(e) => e.target.value && setStartDateStr(e.target.value)}
            className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 font-medium focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={() => setStartDateStr(startOfToday())}
            className="text-xs font-semibold text-brand-600 hover:bg-brand-50 px-3 py-2 rounded-xl transition-colors cursor-pointer"
          >
            Hôm nay
          </button>
          <button
            onClick={loadData}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            title="Tải lại dữ liệu"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setTab('training')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 font-semibold text-sm border-b-2 transition-all cursor-pointer',
            tab === 'training'
              ? 'border-brand-600 text-brand-600 bg-brand-50/50 rounded-t-xl'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          )}
        >
          <GraduationCap size={18} />
          <span>Đào tạo 7 ngày</span>
          <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-bold bg-brand-100 text-brand-700">
            {trainingRows.length}
          </span>
        </button>

        <button
          onClick={() => setTab('employees')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 font-semibold text-sm border-b-2 transition-all cursor-pointer',
            tab === 'employees'
              ? 'border-emerald-600 text-emerald-600 bg-emerald-50/50 rounded-t-xl'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          )}
        >
          <Briefcase size={18} />
          <span>Nhân viên chính thức</span>
          <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
            {employeeRows.length}
          </span>
        </button>
      </div>

      {/* Grid Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <Spinner size={32} className="mx-auto text-brand-500" />
            <p className="text-sm text-slate-500 mt-2 font-medium">Đang tải danh sách lịch làm việc...</p>
          </div>
        ) : activeRows.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            Không có dữ liệu trong nhóm này.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs font-bold border-b border-slate-200">
                  <th className="p-3 w-64 border-r border-slate-200">Nhân sự</th>
                  {dates.map((d) => {
                    const today = isToday(d);
                    return (
                      <th
                        key={d}
                        className={cn(
                          'p-2 text-center border-r border-slate-200 min-w-[90px]',
                          today && 'bg-brand-50 text-brand-700 font-extrabold'
                        )}
                      >
                        <div className="text-[11px] opacity-75 uppercase">{weekdayVi(d)}</div>
                        <div className="text-sm">{d.slice(8)}/{d.slice(5, 7)}</div>
                        {today && (
                          <span className="inline-block mt-0.5 text-[9px] bg-brand-600 text-white px-1.5 py-0.2 rounded-full font-black uppercase">
                            Hôm nay
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {activeRows.map((r) => {
                  const lockedKey = getLockedShiftKey(r.caLam);

                  return (
                    <tr key={r.candidateId} className="hover:bg-slate-50/60 transition-colors">
                      {/* Left info column */}
                      <td className="p-3 border-r border-slate-200 align-top">
                        <div className="font-bold text-slate-800 text-sm leading-snug">{r.tenUv}</div>
                        <div className="text-[11px] text-pink-600 font-mono font-bold mt-0.5">{r.candidateId}</div>
                        <div className="text-[11px] text-slate-500 mt-1 truncate max-w-[210px]" title={r.chiNhanh}>
                          • {r.chiNhanh || 'Chưa chọn chi nhánh'}
                        </div>
                        <div className="text-[11px] text-amber-700 font-medium mt-0.5">
                          • Ca làm: <span className="font-bold">{r.caLam || 'Chưa chốt ca'}</span>
                        </div>
                      </td>

                      {/* 7 dates columns */}
                      {dates.map((d) => {
                        const cellObj = r.shifts[d];
                        const shiftsRaw = cellObj?.shifts || '';
                        let shifts = shiftsRaw ? shiftsRaw.split('|').filter(Boolean) : [];

                        if (shifts.length === 0 && lockedKey) {
                          shifts = [lockedKey];
                        }

                        const colors = shifts.map((s) => shiftBadgeColors[s] || 'bg-slate-100 text-slate-600 border-slate-200');
                        const attStatus = cellObj?.attendanceStatus;
                        const checkinTime = cellObj?.checkinTime;

                        // RÀNG BUỘC KHOÁ REALTIME DƯỚI CLIENT:
                        const todayStr = startOfToday();
                        const normCa = (r.caLam || '').toLowerCase();
                        let startH = 7;
                        if (normCa.includes('chieu') || normCa.includes('12h')) startH = 12;
                        else if (normCa.includes('toi') || normCa.includes('18h')) startH = 18;

                        const currentVnHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).getHours();
                        const isPastOrOngoing = d < todayStr || (d === todayStr && currentVnHour >= startH);

                        const isAttendedOrLocked = cellObj?.isLocked || !!attStatus || isPastOrOngoing;

                        let attBadge = null;
                        if (attStatus === 'ON_TIME') {
                          attBadge = (
                            <span className="text-[9px] font-black bg-emerald-600 text-white px-1 py-0.5 rounded shadow-2xs flex items-center gap-0.5 mt-0.5">
                              ✓ ĐÚNG GIỜ
                            </span>
                          );
                        } else if (attStatus === 'LATE_5P') {
                          attBadge = (
                            <span className="text-[9px] font-black bg-amber-600 text-white px-1 py-0.5 rounded shadow-2xs flex items-center gap-0.5 mt-0.5 animate-pulse">
                              ⚠️ TRỄ 5P (30K)
                            </span>
                          );
                        } else if (attStatus === 'LATE_30P') {
                          attBadge = (
                            <span className="text-[9px] font-black bg-rose-600 text-white px-1 py-0.5 rounded shadow-2xs flex items-center gap-0.5 mt-0.5 animate-pulse">
                              ⚠️ TRỄ 30P (50%L)
                            </span>
                          );
                        } else if (attStatus === 'LATE_60P') {
                          attBadge = (
                            <span className="text-[9px] font-black bg-purple-700 text-white px-1 py-0.5 rounded shadow-2xs flex items-center gap-0.5 mt-0.5 animate-pulse">
                              🚨 TRỄ 60P (100%L)
                            </span>
                          );
                        } else if (attStatus === 'ABSENT') {
                          attBadge = (
                            <span className="text-[9px] font-bold bg-slate-500 text-white px-1 py-0.5 rounded opacity-80 mt-0.5">
                              ✖ VẮNG
                            </span>
                          );
                        }

                        return (
                          <td key={d} className="border-r border-slate-100 p-1 text-center">
                            <button
                              onClick={() => {
                                if (isAttendedOrLocked) {
                                  // KHOÁ KHÔNG CHO HR SỬA CA KHI ĐÃ ĐẾN/QUA GIỜ CA HOẶC ĐÃ CHẤM CÔNG
                                  setViewAttDetail({
                                    candidateId: r.candidateId,
                                    tenUv: r.tenUv,
                                    date: d,
                                    chiNhanh: r.chiNhanh,
                                    caLam: r.caLam,
                                    attendanceStatus: attStatus || (isPastOrOngoing && !attStatus ? 'ABSENT' : 'ON_TIME'),
                                    checkinTime: checkinTime || 'Chưa ghi nhận',
                                    lateMinutes: cellObj?.lateMinutes || 0,
                                    fineAmount: cellObj?.fineAmount || 0,
                                    reason: cellObj?.reason || '',
                                    isOngoingOrPastNoAtt: !attStatus && isPastOrOngoing,
                                  });
                                  return;
                                }
                                setEdit({ candidateId: r.candidateId, tenUv: r.tenUv, date: d, current: shifts.join('|'), caLam: r.caLam });
                                setSelected(shifts.length ? shifts : ['OFF']);
                              }}
                              className={cn(
                                'w-full min-h-[38px] p-1 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all hover:ring-2 hover:ring-brand-300 relative group cursor-pointer',
                                shifts.length === 0 && 'bg-slate-50 hover:bg-slate-100',
                                isToday(d) && 'ring-1 ring-brand-300 font-bold',
                                shifts.length === 1 ? colors[0] : 'bg-slate-100',
                                attStatus === 'ON_TIME' && '!bg-emerald-100 border border-emerald-300',
                                attStatus === 'LATE_5P' && '!bg-amber-100 border border-amber-300',
                                attStatus === 'LATE_30P' && '!bg-rose-100 border border-rose-300',
                                attStatus === 'LATE_60P' && '!bg-purple-100 border border-purple-300',
                                attStatus === 'ABSENT' && '!bg-slate-200/80 border border-slate-300',
                                isAttendedOrLocked && 'cursor-default opacity-90'
                              )}
                              title={
                                isAttendedOrLocked
                                  ? `${r.tenUv} – ${formatDate(d)}\n🔒 CA LÀM NÀY ĐÃ ĐẾN/QUA GIỜ HOẶC ĐÃ ĐƯỢC AI CHẤM CÔNG (Lịch đã bị khóa)\nCheck-in: ${checkinTime || 'Chưa nhận'}`
                                  : `${r.tenUv} – ${formatDate(d)}: ${shifts.join(' + ') || 'Chưa xếp'}`
                              }
                            >
                              {/* Biểu tượng khóa cho ca đã bị khóa */}
                              {isAttendedOrLocked && (
                                <span className="absolute top-1 right-1 text-slate-500 opacity-60 group-hover:opacity-100 transition-opacity">
                                  <Lock size={10} />
                                </span>
                              )}

                              {shifts.length > 1 ? (
                                <span className="flex gap-0.5">
                                  {shifts.map((sStr, iIdx) => (
                                    <span key={iIdx} className={cn('w-2.5 h-4 rounded-sm', shiftColor(sStr).bg)} />
                                  ))}
                                </span>
                              ) : (
                                <span className="font-extrabold text-[11px] uppercase tracking-wide">
                                  {shifts[0] || 'CHƯA'}
                                </span>
                              )}

                              {attBadge}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL XEM CHI TIẾT CHẤM CÔNG VÀO CA (Ô BỊ KHÓA) */}
      {viewAttDetail && (
        <Modal
          open={!!viewAttDetail}
          onClose={() => setViewAttDetail(null)}
          title="CHI TIẾT CHẤM CÔNG AI (LỊCH ĐÃ KHÓA)"
        >
          <div className="space-y-4 font-sans text-slate-800">
            <div className="bg-slate-900 text-white p-4 rounded-2xl space-y-2 border border-slate-800 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="font-extrabold text-base text-pink-400">{viewAttDetail.tenUv}</h3>
                <span className="text-[10px] bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Lock size={11} /> LỊCH ĐÃ KHÓA
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Mã UV: <span className="font-mono text-pink-300 font-bold">{viewAttDetail.candidateId}</span>
              </p>
              <p className="text-xs text-slate-300">
                Chi nhánh: <span className="font-semibold text-slate-100">{viewAttDetail.chiNhanh || 'Chưa chốt'}</span>
              </p>
              <p className="text-xs text-slate-300">
                Ca làm đăng ký cố định: <span className="font-bold text-amber-300">{viewAttDetail.caLam || 'Ca SÁNG'}</span>
              </p>
            </div>

            {/* Chi tiết chấm công Realtime */}
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-3">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Clock size={14} className="text-brand-600" /> THÔNG TIN ĐIỂM DANH REALTIME
              </h4>

              <div className="flex items-center justify-between text-xs border-b border-slate-200 pb-2">
                <span className="text-slate-600">Ngày làm việc:</span>
                <span className="font-bold font-mono text-slate-800">{formatDate(viewAttDetail.date)}</span>
              </div>

              <div className="flex items-center justify-between text-xs border-b border-slate-200 pb-2">
                <span className="text-slate-600">Thời gian ghi nhận điểm danh:</span>
                <span className="font-bold font-mono text-brand-700">{viewAttDetail.checkinTime}</span>
              </div>

              {/* Trạng thái vi phạm & Tiền phạt */}
              <div className="p-3 rounded-xl border space-y-1">
                {viewAttDetail.isOngoingOrPastNoAtt ? (
                  <div className="flex items-center gap-2 text-rose-700 font-bold text-xs">
                    <XCircle size={16} />
                    <span>⚠️ QUÁ GIỜ ĐẦU CA NHƯNG CHƯA ĐIỂM DANH (Hệ thống tính Vắng/Trễ)</span>
                  </div>
                ) : viewAttDetail.attendanceStatus === 'ON_TIME' ? (
                  <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs">
                    <CheckCircle2 size={16} />
                    <span>✅ VÀO CA ĐÚNG GIỜ (Mức phạt: 0đ)</span>
                  </div>
                ) : viewAttDetail.attendanceStatus === 'LATE_5P' ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-amber-700 font-bold text-xs">
                      <AlertTriangle size={16} />
                      <span>⚠️ VÀO TRỄ {viewAttDetail.lateMinutes || 5} PHÚT – PHẠT 30.000Đ</span>
                    </div>
                    <p className="text-[11px] text-amber-800/80">
                      Mức phạt theo Quy chế làm việc: <strong>30.000 đ / lần</strong> đã được tự động áp dụng.
                    </p>
                  </div>
                ) : viewAttDetail.attendanceStatus === 'LATE_30P' ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-rose-700 font-bold text-xs">
                      <AlertTriangle size={16} />
                      <span>⚠️ VÀO TRỄ {viewAttDetail.lateMinutes || 30} PHÚT – PHẠT 50% LƯƠNG CA</span>
                    </div>
                    <p className="text-[11px] text-rose-800/80">
                      Mức phạt: <strong>{viewAttDetail.fineAmount ? viewAttDetail.fineAmount.toLocaleString('vi-VN') : '50% Lương ca'}đ</strong>.
                    </p>
                  </div>
                ) : viewAttDetail.attendanceStatus === 'LATE_60P' ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-purple-700 font-bold text-xs">
                      <AlertTriangle size={16} />
                      <span>🚨 VÀO TRỄ ≥ 60 PHÚT ({viewAttDetail.lateMinutes} phút) – PHẠT 100% LƯƠNG CA</span>
                    </div>
                    <p className="text-[11px] text-purple-800/80">
                      Mức phạt: <strong>100% Lương ca ({viewAttDetail.fineAmount ? viewAttDetail.fineAmount.toLocaleString('vi-VN') : 'Toàn bộ'}đ)</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-slate-700 font-bold text-xs">
                    <XCircle size={16} />
                    <span>❌ VẮNG MẶT (Không điểm danh)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Cảnh báo khóa dữ liệu */}
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl text-xs flex items-start gap-2">
              <Lock size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong>Lưu ý dành cho HR:</strong> Ca làm việc ngày <span className="font-bold">{formatDate(viewAttDetail.date)}</span> đã đến/qua giờ bắt đầu ca làm hoặc đã được hệ thống AI tự động chấm công. Theo quy chế bảo mật chấm công, tài khoản HR <strong>không thể chỉnh sửa ca</strong> của ngày này.
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setViewAttDetail(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Chỉnh Sửa Lịch Đổi Ca (Chỉ mở cho các ô tương lai CHƯA ĐẾN GIỜ CA) */}
      {edit && (
        <Modal open={!!edit} onClose={() => setEdit(null)} title={`Xếp lịch ngày ${formatDate(edit.date)}`}>
          <div className="space-y-4">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="font-bold text-slate-800">{edit.tenUv}</div>
              <div className="text-xs text-slate-500">Mã: {edit.candidateId}</div>
              {edit.caLam && (
                <div className="text-xs text-amber-700 font-semibold mt-1">
                  Ca đăng ký chính thức cố định: {edit.caLam}
                </div>
              )}
            </div>

            {isEditModalDisabled && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs flex items-start gap-2">
                <Lock size={16} className="text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong>CẢNH BÁO KHÓA LỊCH:</strong> Ca làm việc ngày <span className="font-bold">{formatDate(edit.date)}</span> đã đến/qua giờ ca làm ({edit.caLam}). Theo quy chế làm việc, tài khoản HR <strong>không thể thay đổi ca</strong> của ngày hôm nay/quá khứ.
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-2">Chọn ca làm việc:</label>
              <div className="grid grid-cols-2 gap-2">
                {SHIFT_KEYS.map((k) => {
                  const isSel = selected.includes(k);
                  const isLockedShift = getLockedShiftKey(edit.caLam) === k;

                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={isEditModalDisabled}
                      onClick={() => !isEditModalDisabled && toggleSelect(k)}
                      className={cn(
                        'p-3 rounded-xl font-bold text-xs border text-left flex items-center justify-between transition-all',
                        isEditModalDisabled ? 'cursor-not-allowed opacity-60 bg-slate-100 border-slate-200 text-slate-400' : 'cursor-pointer',
                        isSel && !isEditModalDisabled
                          ? 'border-brand-600 bg-brand-50 text-brand-700 ring-2 ring-brand-300'
                          : isSel && isEditModalDisabled
                            ? 'border-pink-400 bg-pink-50 text-pink-700 ring-1 ring-pink-300'
                            : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      )}
                    >
                      <span>
                        {k === 'SANG' && '☀️ Ca Sáng (07:00 - 12:00)'}
                        {k === 'CHIEU' && '🌤️ Ca Chiều (12:00 - 18:00)'}
                        {k === 'TOI' && '🌙 Ca Tối (18:00 - 23:00)'}
                        {k === 'OFF' && '☕ Nghỉ OFF'}
                      </span>
                      {isLockedShift && (
                        <span className="text-[9px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-extrabold">
                          Gốc
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEdit(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleSave}
                disabled={saving || isEditModalDisabled}
                className={cn(
                  'px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm',
                  isEditModalDisabled
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-brand-600 hover:bg-brand-700 text-white cursor-pointer'
                )}
              >
                {saving ? <Spinner size={14} /> : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}