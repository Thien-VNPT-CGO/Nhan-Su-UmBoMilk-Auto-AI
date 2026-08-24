import { useEffect, useState, useCallback, useMemo } from 'react';
import { RefreshCw, CalendarDays, GraduationCap, Briefcase } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Skeleton, Badge, Modal, Spinner, Field } from '../components/ui';

import { useToast } from '../stores/Toast';
import { useAuth } from '../stores/auth';
import { getSocket } from '../api/socket';
import { dateKey, addDays, weekdayVi } from '../utils/date';
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
      attendanceStatus?: 'ON_TIME' | 'LATE' | 'ABSENT' | null;
      checkinTime?: string | null;
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

function getCellShiftKey(shiftStr: string): 'SANG' | 'CHIEU' | 'TOI' | null {
  if (!shiftStr) return null;
  const str = shiftStr.toLowerCase();
  if (str.includes('sang') || str.includes('7h')) return 'SANG';
  if (str.includes('chieu') || str.includes('12h') || str.includes('trua') || str.includes('chi')) return 'CHIEU';
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
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editInfo, setEditInfo] = useState<{ candidateId: string; tenUv: string; chiNhanh: string; caLam: string } | null>(null);
  const [branchDraft, setBranchDraft] = useState('');
  const [shiftDraft, setShiftDraft] = useState('');

  const saveBranchAndShift = async () => {
    if (!editInfo) return;
    try {
      await api.patch(`/training/${editInfo.candidateId}`, {
        chiNhanh: branchDraft.trim() || undefined,
        caLam: shiftDraft.trim() || undefined,
      });
      toast('success', 'Đã cập nhật Chi nhánh & Ca làm chính thức!');

      const newLockedKey = getLockedShiftKey(shiftDraft);
      const existingRow = [...trainingRows, ...employeeRows].find(
        (r) => r.candidateId === editInfo.candidateId
      );
      if (existingRow && newLockedKey) {
        const scheduledShiftsList = Object.entries(existingRow.shifts || {})
          .map(([date, cell]) => ({ date, shifts: cell.shifts }))
          .filter((s) => s.shifts && s.shifts.trim() !== '' && s.shifts !== 'OFF');
        const mismatches = scheduledShiftsList.filter((item) => {
          const cellKey = getCellShiftKey(item.shifts);
          return cellKey !== null && cellKey !== newLockedKey;
        });
        if (mismatches.length > 0) {
          toast(
            'error',
            `⚠️ Đã chốt ca! Lưu ý: Có ${mismatches.length} ca đã xếp trước đó khác với ca chốt mới. Nút Zalo đã bị khóa đến khi chỉnh lại ca.`
          );
        }
      }

      setEditInfo(null);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Thao tác thất bại.');
    }
  };

  const handleSendAttendanceNoticeAndOpenZalo = async (r: RowData) => {
    const origin = window.location.origin;
    const checkinUrl = `${origin}/public/attendance/${r.candidateId}`;
    const nameGreeting = r.tenUv ? `ứng viên ${r.tenUv}` : 'bạn';

    const msg = [
      '🐮 [UMBO MILK] – THÔNG BÁO LỊCH ĐIỂM DANH & LỊCH LÀM VIỆC 📋',
      '',
      `Chào ${nameGreeting} ❤️`,
      'UMBO MILK xin gửi bạn link web điểm danh hàng ngày và thông tin lịch làm việc của bạn như sau:',
      '',
      '📌 THÔNG TIN NHẬN CA:',
      `• 🏢 Chi nhánh chính thức: ${r.chiNhanh || 'Theo phân công'}`,
      `• ⏱️ Ca làm việc chính thức: ${r.caLam || 'Theo ca chốt'}`,
      '',
      '🔗 ĐƯỜNG DẪN ĐIỂM DANH HÀNG NGÀY TRÊN WEB:',
      checkinUrl,
      '',
      '📌 HƯỚNG DẪN ĐIỂM DANH MỖI CA:',
      '1. Truy cập link trên trước giờ ca làm 30 phút.',
      '2. Chụp 1 tấm ảnh cửa hàng + nhập chữ "ĐIỂM DANH UBM".',
      '3. Bấm Gửi để hệ thống tự động ghi nhận điểm danh.',
      '⚠️ Lưu ý: Điểm danh trễ từ 5 phút trở lên hệ thống sẽ tự động phạt 50.000đ.',
      '',
      'UMBO MILK chúc bạn có những ngày làm việc hiệu quả và thuận lợi! ✨',
    ].join('\n');

    let copied = false;
    try {
      await navigator.clipboard.writeText(msg);
      copied = true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = msg;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }

    if (copied) {
      toast('success', '📋 Đã tạo & sao chép Lịch Điểm Danh! Hãy bấm Ctrl + V trên Zalo để gửi cho ứng viên.');
    } else {
      toast('error', '⚠️ Vui lòng sao chép thủ công nội dung gửi Zalo.');
    }

    const cleanPhone = (r.sdtZalo || '').replace(/\D/g, '');
    const zaloUrl = cleanPhone ? `https://zalo.me/${cleanPhone}` : 'https://chat.zalo.me';
    window.open(zaloUrl, '_blank');
  };


  const today = startOfToday();
  const endDate = '2026-12-31';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ training: RowData[]; employees: RowData[] }>(`/shifts?from=${today}&to=${endDate}`);
      setTrainingRows(data.training);
      setEmployeeRows(data.employees);
    } catch {
      toast('error', 'Không tải được lịch làm việc.');
    } finally {
      setLoading(false);
    }
  }, [today, endDate, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    const refresh = debounce(() => void load(), 300);
    const events = ['shift:updated', 'candidate:decision', 'candidate:updated', 'candidate:new', 'candidate:deleted', 'training:updated'];
    events.forEach((ev) => socket.on(ev, refresh));
    return () => {
      events.forEach((ev) => socket.off(ev, refresh));
      refresh.cancel();
    };
  }, [load]);

  const dates = useMemo(() => {
    const list: string[] = [];
    let cur = new Date(`${today}T00:00:00`);
    const end = new Date('2026-12-31T00:00:00');
    while (cur <= end) {
      list.push(dateKey(cur));
      cur = addDays(cur, 1);
    }
    return list;
  }, [today]);

  const save = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      await api.put(`/shifts/${edit.candidateId}/${edit.date}`, { shifts: selected.length ? selected : ['OFF'] });
      toast('success', 'Đã lưu ca.');
      setEdit(null);
      void load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Lưu ca thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const toggleShift = (k: string) => {
    setSelected((s) => {
      if (k === 'OFF') return ['OFF'];
      const withoutOff = s.filter((x) => x !== 'OFF');
      return withoutOff.includes(k) ? withoutOff.filter((x) => x !== k) : [...withoutOff, k];
    });
  };

  const isToday = (d: string) => d === today;
  const rows = tab === 'training' ? trainingRows : employeeRows;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Lịch làm việc</h1>
          <p className="text-sm text-slate-500">
            {today} → 31/12/2026 · click ô để đổi ca
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['SÁNG', 'CHIỀU', 'TỐI', 'OFF'] as const).map((s) => {
            const c = shiftColor(s);
            return <Badge key={s} className={c.bg + ' ' + c.text}>{c.label}</Badge>;
          })}
          <button className="btn-secondary" onClick={() => void load()}><RefreshCw size={15} /> Làm mới</button>
        </div>
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={() => setTab('training')}
          className={cn(
            'rounded-xl px-4 py-2 text-sm font-bold transition-all flex items-center gap-1.5',
            tab === 'training' ? 'bg-brand-500 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200',
          )}
        >
          <GraduationCap size={15} /> Đào tạo 7 ngày
          <Badge className={tab === 'training' ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-600'}>{trainingRows.length}</Badge>
        </button>
        <button
          onClick={() => setTab('employees')}
          className={cn(
            'rounded-xl px-4 py-2 text-sm font-bold transition-all flex items-center gap-1.5',
            tab === 'employees' ? 'bg-violet-600 text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200',
          )}
        >
          <Briefcase size={15} /> Nhân viên chính thức
          <Badge className={tab === 'employees' ? 'bg-white/20 text-white' : 'bg-violet-50 text-violet-600'}>{employeeRows.length}</Badge>
        </button>
      </div>

      {tab === 'training' && (
        <p className="text-xs text-slate-500">
          <b>TH1 – Đào tạo:</b> xếp ca cho <b>7 ngày bất kỳ</b> trong quá trình training. Người đủ 7 ngày sẽ tự chuyển HOÀN THÀNH.
        </p>
      )}
      {tab === 'employees' && (
        <p className="text-xs text-slate-500">
          <b>TH2 – Nhân viên chính thức:</b> đã hoàn thành training và được xác nhận nhận việc — xếp ca làm việc bình thường (SÁNG / CHIỀU / TỐI / OFF).
        </p>
      )}

      {loading ? (
        <Skeleton className="h-96" />
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">
          {tab === 'training'
            ? 'Chưa có nhân sự đào tạo. Duyệt ĐẠT ứng viên tại trang Ứng viên.'
            : 'Chưa có nhân viên chính thức. Xác nhận nhận việc tại trang Đào tạo khi nhân sự hoàn thành 7 ngày.'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="table-th sticky left-0 bg-slate-50 z-20 min-w-[180px] border-r border-slate-100">
                    <div className="flex items-center gap-1.5"><CalendarDays size={13} /> Nhân sự / Ngày</div>
                  </th>
                  {dates.map((d) => {
                    const dt = new Date(`${d}T00:00:00`);
                    return (
                      <th
                        key={d}
                        className={cn(
                          'min-w-[84px] text-center px-1 py-2 border-r border-slate-100',
                          isToday(d) && 'bg-brand-50 text-brand-700',
                        )}
                      >
                        <div className="text-[10px] font-semibold uppercase text-slate-400">{weekdayVi(dt).replace('Thứ ', 'T')}</div>
                        <div className="text-xs font-bold">{d.slice(8, 10)}/{d.slice(5, 7)}</div>
                        {isToday(d) && <div className="text-[9px] font-extrabold text-brand-500">HÔM NAY</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.candidateId} className="hover:bg-brand-50/30">
                    <td className="sticky left-0 bg-white z-10 min-w-[200px] px-3 py-2 border-r border-slate-100">
                      <div className="font-semibold text-slate-800 text-sm">{r.tenUv}</div>
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        <span className="text-[10px] font-mono text-brand-600 font-bold">{r.candidateId}</span>
                        {r.chiNhanh && !r.chiNhanh.includes('Có thể làm') ? (
                          <span className="text-[10px] text-slate-500 font-medium">· {r.chiNhanh}</span>
                        ) : (
                          <button
                            type="button"
                            className="text-[9px] font-bold text-amber-700 bg-amber-100/90 hover:bg-amber-200 px-1.5 py-0.5 rounded border border-amber-300 animate-pulse"
                            onClick={() => {
                              setEditInfo({ candidateId: r.candidateId, tenUv: r.tenUv, chiNhanh: r.chiNhanh, caLam: r.caLam });
                              setBranchDraft(r.chiNhanh || '');
                              setShiftDraft(r.caLam || '');
                            }}
                          >
                            ⚠️ Chốt chi nhánh
                          </button>
                        )}
                        {r.caLam && !r.caLam.includes('Có thể làm') ? (
                          <span className="text-[10px] text-slate-400">· {r.caLam}</span>
                        ) : (
                          <button
                            type="button"
                            className="text-[9px] font-bold text-rose-700 bg-rose-100/90 hover:bg-rose-200 px-1.5 py-0.5 rounded border border-rose-300 animate-pulse"
                            onClick={() => {
                              setEditInfo({ candidateId: r.candidateId, tenUv: r.tenUv, chiNhanh: r.chiNhanh, caLam: r.caLam });
                              setBranchDraft(r.chiNhanh || '');
                              setShiftDraft(r.caLam || '');
                            }}
                          >
                            ⚠️ Chốt ca
                          </button>
                        )}
                      </div>
                      {(() => {
                        const lockedKey = getLockedShiftKey(r.caLam);
                        const scheduledShiftsList = Object.entries(r.shifts || {})
                          .map(([date, cell]) => ({ date, shifts: cell.shifts }))
                          .filter((s) => s.shifts && s.shifts.trim() !== '' && s.shifts !== 'OFF');
                        const scheduledCount = scheduledShiftsList.length;

                        const mismatchedShifts = scheduledShiftsList.filter((item) => {
                          if (!lockedKey) return false;
                          const cellKey = getCellShiftKey(item.shifts);
                          return cellKey !== null && cellKey !== lockedKey;
                        });
                        const hasMismatch = lockedKey !== null && mismatchedShifts.length > 0;

                        if (hasMismatch) {
                          return (
                            <div className="mt-1.5 space-y-1">
                              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-[9px] font-bold px-1.5 py-1 rounded text-center leading-tight">
                                ⚠️ Lệch {mismatchedShifts.length} ca đã xếp khác ca chốt ({r.caLam || 'Chưa chốt'})
                              </div>
                              <button
                                type="button"
                                disabled
                                className="w-full bg-rose-100 border border-rose-300 text-rose-700 text-[10px] font-extrabold px-2 py-1 rounded-lg flex items-center justify-center gap-1 cursor-not-allowed text-center opacity-90"
                                title="Không thể gửi Zalo do ca xếp bị lệch với ca làm chính thức. Vui lòng xếp lại ca hoặc nhờ Admin điều chỉnh!"
                              >
                                <span>⚠️ Ca xếp lệch ca chốt (Khóa Zalo)</span>
                              </button>
                            </div>
                          );
                        }

                        if (scheduledCount < 7) {
                          return (
                            <div
                              className="mt-1.5 w-full bg-slate-100 border border-slate-200 text-slate-400 text-[10px] font-bold px-2 py-1 rounded-lg flex items-center justify-center gap-1 select-none cursor-not-allowed"
                              title="Cần xếp đủ tối thiểu 7 ngày ca làm việc để hiển thị nút gửi Zalo"
                            >
                              <span>⏳ Chưa đủ ca ({scheduledCount}/7 ngày)</span>
                            </div>
                          );
                        }

                        return (
                          <button
                            type="button"
                            onClick={() => handleSendAttendanceNoticeAndOpenZalo(r)}
                            className="mt-1.5 w-full bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-extrabold px-2 py-1 rounded-lg flex items-center justify-center gap-1 shadow-2xs transition-all hover:scale-102 cursor-pointer animate-pulse"
                            title="Click để tự động tạo tin nhắn Zalo kèm link điểm danh web & mở Zalo gửi cho ứng viên"
                          >
                            <span>💬 Mở App Zalo gửi Lịch điểm danh</span>
                          </button>
                        );
                      })()}
                    </td>

                    {dates.map((d) => {
                      const cell = r.shifts?.[d];
                      const shifts = cell ? cell.shifts.split('|').filter(Boolean) : [];
                      const colors = shifts.map((s) => shiftColor(s).bg);
                      const attStatus = cell?.attendanceStatus;
                      const checkinTime = cell?.checkinTime;

                      let attBadge = null;
                      if (attStatus === 'ON_TIME') {
                        attBadge = (
                          <span className="text-[9px] font-black bg-emerald-600 text-white px-1 py-0.5 rounded shadow-2xs flex items-center gap-0.5 mt-0.5">
                            ✓ ĐÚNG GIỜ
                          </span>
                        );
                      } else if (attStatus === 'LATE') {
                        attBadge = (
                          <span className="text-[9px] font-black bg-rose-600 text-white px-1 py-0.5 rounded shadow-2xs flex items-center gap-0.5 mt-0.5 animate-pulse">
                            ⚠️ TRỄ (50K)
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
                        <td key={d} className="border-r border-slate-50 p-1 text-center">
                          <button
                            onClick={() => {
                              setEdit({ candidateId: r.candidateId, tenUv: r.tenUv, date: d, current: shifts.join('|'), caLam: r.caLam });
                              setSelected(shifts.length ? shifts : ['OFF']);
                            }}
                            className={cn(
                              'w-full min-h-[38px] p-1 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all hover:ring-2 hover:ring-brand-300',
                              shifts.length === 0 && 'bg-slate-50 hover:bg-slate-100',
                              isToday(d) && 'ring-1 ring-brand-300 font-bold',
                              shifts.length === 1 ? colors[0] : 'bg-slate-100',
                              attStatus === 'ON_TIME' && '!bg-emerald-100 border border-emerald-300',
                              attStatus === 'LATE' && '!bg-rose-100 border border-rose-300',
                              attStatus === 'ABSENT' && '!bg-slate-200/80 border border-slate-300'
                            )}
                            title={`${r.tenUv} – ${d}: ${shifts.join(' + ') || 'Chưa xếp'}${
                              checkinTime ? `\nĐiểm danh lúc: ${checkinTime}` : ''
                            }`}
                          >
                            {shifts.length > 1 ? (
                              <span className="flex gap-0.5">
                                {shifts.map((s, i) => (
                                  <span key={i} className={cn('w-2.5 h-4 rounded-sm', shiftColor(s).bg)} />
                                ))}
                              </span>
                            ) : shifts.length === 1 ? (
                              <span className={cn('text-[10px] font-extrabold', shiftColor(shifts[0]).text)}>
                                {shifts[0] === 'OFF' ? 'OFF' : shifts[0].slice(0, 3)}
                              </span>
                            ) : null}

                            {attBadge}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? `${edit.tenUv} – ${edit.date.slice(8, 10)}/${edit.date.slice(5, 7)}/${edit.date.slice(0, 4)}` : ''}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEdit(null)}>Hủy</button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving && <Spinner size={14} />} Lưu ca
            </button>
          </>
        }
      >
        {(() => {
          const lockedKey = getLockedShiftKey(edit?.caLam);
          return (
            <div className="space-y-4">
              {!isAdmin && lockedKey && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
                  <p className="font-bold flex items-center gap-1">
                    🔒 Ca làm chính thức đã chốt: <span className="font-extrabold text-amber-950 uppercase">{lockedKey === 'SANG' ? 'Ca Sáng (07h00 - 12h00)' : lockedKey === 'CHIEU' ? 'Ca Chiều (12h00 - 18h00)' : 'Ca Tối (18h00 - 23h00)'}</span>
                  </p>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Tài khoản HR chỉ được chọn ca <strong>{lockedKey === 'SANG' ? 'Ca Sáng' : lockedKey === 'CHIEU' ? 'Ca Chiều' : 'Ca Tối'}</strong> hoặc <strong>OFF</strong>. Nếu ứng viên có nhu cầu hoán đổi ca làm khác, vui lòng liên hệ <strong>Admin</strong> để hỗ trợ đổi ca.
                  </p>
                </div>
              )}

              {isAdmin && (
                <div className="rounded-xl bg-purple-50 border border-purple-200 p-2.5 text-xs text-purple-900 font-semibold flex items-center gap-1.5">
                  <span>👑 <strong>Tài khoản Admin:</strong> Được phép hoán đổi tất cả các ca theo yêu cầu ứng viên.</span>
                </div>
              )}

              <p className="text-xs text-slate-500">Chọn ca làm việc cho ngày {edit?.date.slice(8, 10)}/{edit?.date.slice(5, 7)}:</p>
              <div className="grid grid-cols-2 gap-2.5">
                {SHIFT_KEYS.map((k) => {
                  const c = shiftColor(k);
                  const active = selected.includes(k);
                  const isLockedForHR = !isAdmin && lockedKey !== null && k !== lockedKey && k !== 'OFF';
                  return (
                    <button
                      key={k}
                      disabled={isLockedForHR}
                      onClick={() => toggleShift(k)}
                      title={isLockedForHR ? `🔒 Ca chốt là ${lockedKey}. Chỉ Admin mới có quyền đổi ca.` : undefined}
                      className={cn(
                        'rounded-xl border-2 px-4 py-3 text-sm font-bold transition-all relative',
                        active ? c.bg + ' ' + c.text + ' border-transparent' : 'bg-white border-slate-200 text-slate-500',
                        isLockedForHR && 'opacity-40 cursor-not-allowed bg-slate-100 border-slate-200 text-slate-400 hover:border-slate-200'
                      )}
                    >
                      {c.label} {isLockedForHR && '🔒'}
                    </button>
                  );
                })}
              </div>
              <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
                Hiện tại: <b>{edit?.current.replace(/\|/g, ' + ') || 'Chưa xếp'}</b>
                {selected.length === 0 && <span className="ml-2 text-amber-600">→ sẽ lưu OFF</span>}
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!editInfo} onClose={() => setEditInfo(null)} title={`Chốt Chi Nhánh & Ca Làm Chính Thức – ${editInfo?.tenUv ?? ''}`}>
        <div className="space-y-4">
          <Field label="Chi nhánh làm việc chính thức">
            <input
              className="input text-xs font-medium"
              placeholder="Nhập chi nhánh chính thức (VD: CN1: 130 Vạn Kiếp, Phường 3, Quận Bình Thạnh)..."
              value={branchDraft}
              onChange={(e) => setBranchDraft(e.target.value)}
            />
          </Field>
          <Field label="Ca làm việc chính thức">
            <input
              className="input text-xs font-medium"
              placeholder="Nhập ca làm chính thức (VD: Ca sáng: 7h00 - 12h00)..."
              value={shiftDraft}
              onChange={(e) => setShiftDraft(e.target.value)}
            />
          </Field>
          <button className="btn-primary w-full !py-3 text-xs font-bold" onClick={saveBranchAndShift}>
            Lưu Chi Nhánh & Ca Làm Chính Thức
          </button>
        </div>
      </Modal>
    </div>
  );

}