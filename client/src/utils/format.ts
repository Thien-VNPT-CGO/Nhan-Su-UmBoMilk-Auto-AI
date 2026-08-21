export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function shiftColor(shift: string): { bg: string; text: string; label: string } {
  switch (shift) {
    case 'SÁNG':
    case 'SANG':
      return { bg: 'bg-yellow-200', text: 'text-yellow-900', label: 'SÁNG' };
    case 'CHIỀU':
    case 'CHIEU':
      return { bg: 'bg-emerald-200', text: 'text-emerald-900', label: 'CHIỀU' };
    case 'TỐI':
    case 'TOI':
      return { bg: 'bg-indigo-200', text: 'text-indigo-900', label: 'TỐI' };
    case 'OFF':
      return { bg: 'bg-slate-200', text: 'text-slate-600', label: 'OFF' };
    default:
      return { bg: 'bg-slate-100', text: 'text-slate-500', label: shift ?? '' };
  }
}

export const trainingStatusLabel: Record<string, { label: string; cls: string }> = {
  CHUA_THAM_GIA: { label: '⏳ CHỜ UV XÁC NHẬN ZALO', cls: 'bg-rose-600 text-white font-bold border border-rose-700 shadow-xs animate-pulse' },
  SAP_BAT_DAU: { label: '✓ ĐÃ XÁC NHẬN (SẮP BẮT ĐẦU)', cls: 'bg-emerald-600 text-white font-bold border border-emerald-700 shadow-xs' },
  BAT_DAU: { label: 'BẮT ĐẦU', cls: 'bg-amber-100 text-amber-700 font-bold' },
  HOAN_THANH: { label: 'HOÀN THÀNH', cls: 'bg-emerald-100 text-emerald-700 font-bold' },
  KHONG_DU_NGAY: { label: 'KHÔNG ĐỦ NGÀY', cls: 'bg-rose-100 text-rose-700' },
  LOAI: { label: 'LOẠI / TỪ CHỐI', cls: 'bg-red-100 text-red-700' },
  NHAN_VIEN_CHINH_THUC: { label: 'NHÂN VIÊN CHÍNH THỨC', cls: 'bg-violet-100 text-violet-700' },
};



export const decisionLabel: Record<string, { label: string; cls: string }> = {
  PASS: { label: 'ĐẠT (PASS)', cls: 'bg-emerald-100 text-emerald-700' },
  PASS_PV: { label: 'ĐẠT PHỎNG VẤN', cls: 'bg-emerald-100 text-emerald-700' },
  PASS_HS: { label: 'ĐẠT HỒ SƠ', cls: 'bg-teal-100 text-teal-700' },
  FAIL: { label: 'LOẠI (FAIL)', cls: 'bg-rose-100 text-rose-700' },
  REVIEW: { label: 'CẦN XEM LẠI', cls: 'bg-amber-100 text-amber-700' },
};

export const syncStatusStyle: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'ĐANG CHỜ', cls: 'bg-amber-100 text-amber-700' },
  PROCESSING: { label: 'ĐANG XỬ LÝ', cls: 'bg-sky-100 text-sky-700' },
  SYNCED: { label: 'ĐÃ ĐỒNG BỘ', cls: 'bg-emerald-100 text-emerald-700' },
  RETRY: { label: 'THỬ LẠI', cls: 'bg-orange-100 text-orange-700' },
  FAILED: { label: 'LỖI', cls: 'bg-rose-100 text-rose-700' },
  CONFLICT: { label: 'XUNG ĐỘT', cls: 'bg-purple-100 text-purple-700' },
};