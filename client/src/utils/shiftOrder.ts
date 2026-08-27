/**
 * Helper quy định thứ tự ưu tiên ca làm việc:
 * 1: Ca SÁNG
 * 2: Ca CHIỀU
 * 3: Ca TỐI
 * 4: Khác / OFF
 */
export const getShiftOrderRank = (caLam?: string | null): number => {
  if (!caLam) return 4;
  const u = caLam.toUpperCase().trim();
  if (u.includes('SÁNG') || u.includes('SANG') || u.includes('07H')) return 1;
  if (u.includes('CHIỀU') || u.includes('CHIEU') || u.includes('12H')) return 2;
  if (u.includes('TỐI') || u.includes('TOI') || u.includes('18H')) return 3;
  return 4;
};
