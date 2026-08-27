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
  PASS_PV_WAITING: { label: '🎉 HOÀN THÀNH PV (Chờ chốt ca & lịch)', cls: 'bg-emerald-600 text-white font-bold border border-emerald-700 shadow-xs' },
  PASS_HS_WAITING: { label: '📄 ĐẠT HỒ SƠ (Chờ chốt ca & lịch)', cls: 'bg-teal-600 text-white font-bold border border-teal-700 shadow-xs' },
  SAP_BAT_DAU: { label: '⚡ SẮP BẮT ĐẦU TRAINING (0/7 ngày)', cls: 'bg-indigo-600 text-white font-bold border border-indigo-700 shadow-xs' },
  BAT_DAU: { label: '🟢 ĐANG TRAINING', cls: 'bg-amber-500 text-white font-bold' },
  HOAN_THANH: { label: '🏆 HOÀN THÀNH TRAINING (7/7 ngày)', cls: 'bg-emerald-600 text-white font-bold' },
  HOAN_THANH_7_NGAY: { label: '🔒 ĐỦ 7 NGÀY TRAINING (Chờ Test)', cls: 'bg-teal-600 text-white font-bold' },
  TEST_DAU_RA_LAN_1: { label: '📋 TEST ĐẦU RA LẦN 1', cls: 'bg-indigo-600 text-white font-bold' },
  TEST_DAU_RA_LAN_2: { label: '🔄 TEST ĐẦU RA LẦN 2 (Nợ câu hỏi < 1đ)', cls: 'bg-purple-600 text-white font-bold' },
  DANH_GIA_CUA_HANG: { label: '⭐ ĐÁNH GIÁ CỬA HÀNG', cls: 'bg-cyan-600 text-white font-bold' },
  DAU_CHINH_THUC: { label: '🎉 ĐẬU CHÍNH THỨC (Auto 30p nâng NV)', cls: 'bg-emerald-600 text-white font-extrabold shadow-sm' },
  KHONG_DU_NGAY: { label: '❌ KHÔNG ĐỦ NGÀY', cls: 'bg-rose-100 text-rose-700' },
  LOAI: { label: '❌ LOẠI / HỦY (Vắng mặt / Không đủ ngày)', cls: 'bg-red-600 text-white font-bold' },
  NHAN_VIEN_CHINH_THUC: { label: '🎓 NHÂN VIÊN CHÍNH THỨC', cls: 'bg-violet-600 text-white font-bold' },
};

/** Tính toán nhãn và kiểu hiển thị Trạng thái Đào tạo realtime đồng bộ 100% giữa Tab Ứng Viên và Tab Nhân Viên Training. */
export function getTrainingStatusInfo(r: {
  trangThaiTraining?: string | null;
  hrDecision?: string | null;
  phongVanAt?: string | Date | null;
  ngayBatDauTraining?: string | Date | null;
  soNgayDaTraining?: number;
}): { label: string; cls: string } {
  const trangThai = r.trangThaiTraining ?? 'CHUA_THAM_GIA';
  const isPendingConfirm = trangThai === 'CHUA_THAM_GIA';
  const isPassPv = r.hrDecision === 'PASS_PV';
  const isPassHs = r.hrDecision === 'PASS_HS';
  const isHsLocked = !isPassHs;

  if (isPendingConfirm) {
    return { label: '⏳ CHỜ UV XÁC NHẬN ZALO', cls: 'bg-rose-600 text-white font-bold border border-rose-700 shadow-2xs animate-pulse' };
  }
  if (isPassPv && !isPassHs) {
    return { label: '🎉 HOÀN THÀNH PV (Chờ chốt ca & lịch)', cls: 'bg-emerald-600 text-white font-bold border border-emerald-700 shadow-2xs' };
  }
  if (isPassHs && !r.ngayBatDauTraining) {
    return { label: '📄 ĐẠT HỒ SƠ (Chờ HR bấm Chốt ca & lịch)', cls: 'bg-teal-600 text-white font-bold border border-teal-700 shadow-2xs' };
  }
  if (isHsLocked) {
    const pvTime = r.phongVanAt ? new Date(r.phongVanAt).getTime() : 0;
    const now = Date.now();
    const pvEndTime = pvTime + 30 * 60 * 1000;
    if (pvTime > 0 && now >= pvTime && now <= pvEndTime) {
      return { label: '🎥 ĐANG PHỎNG VẤN', cls: 'bg-amber-500 text-white font-bold border border-amber-600 shadow-2xs animate-pulse' };
    }
    if (pvTime > 0 && now > pvEndTime) {
      return { label: '⏳ CHỜ HR CHỐT PASS', cls: 'bg-amber-500 text-white font-bold border border-amber-600 shadow-2xs' };
    }
    return { label: '⏳ CHỜ ĐẾN GIỜ PV', cls: 'bg-amber-500 text-white font-bold border border-amber-600 shadow-2xs' };
  }

  const days = r.soNgayDaTraining ?? 0;
  if (trangThai === 'SAP_BAT_DAU') {
    return { label: `⚡ SẮP BẮT ĐẦU TRAINING (${days}/7 ngày)`, cls: 'bg-indigo-600 text-white font-bold border border-indigo-700 shadow-2xs' };
  }
  if (trangThai === 'BAT_DAU') {
    return { label: `🟢 ĐANG TRAINING (${days}/7 ngày)`, cls: 'bg-amber-500 text-white font-bold shadow-2xs' };
  }

  return trainingStatusLabel[trangThai] ?? { label: trangThai, cls: 'bg-slate-100 text-slate-700' };
}



export const decisionLabel: Record<string, { label: string; cls: string }> = {
  PASS: { label: 'ĐẠT (PASS)', cls: 'bg-emerald-100 text-emerald-700' },
  PASS_PV: { label: 'HOÀN THÀNH PV', cls: 'bg-emerald-100 text-emerald-700' },
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