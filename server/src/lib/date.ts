import { env } from '../config/env';

export const TZ = env.timezone;

export function toTz(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(', ', ' ');
}

export function dateKey(date: Date = new Date()): string {
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return d.replace(/\//g, '-');
}

export function formatDateTime(date: Date | string | number | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} – ${get('hour')}:${get('minute')}:${get('second')}`;
}

export function formatDate(date: Date | string | number | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}`;
}

export function weekdayVi(date: Date | string | number = new Date()): string {
  const d = typeof date === 'object' ? date : new Date(date);
  const map = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const idx = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d)
      .replace(/Sun/, '0').replace(/Mon/, '1').replace(/Tue/, '2').replace(/Wed/, '3')
      .replace(/Thu/, '4').replace(/Fri/, '5').replace(/Sat/, '6'),
  );
  return map[idx] ?? '';
}

export function parseLocalPhanVanAt(s: string | Date | null | undefined): Date | undefined {
  if (!s) return undefined;
  if (s instanceof Date) return s;
  let str = String(s).trim();
  if (!str) return undefined;
  if (/Z|[+-]\d{2}:\d{2}$/.test(str)) {
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  str = str.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(str)) {
    if (str.length === 16) str += ':00';
    str += '+07:00'; // Ép chuẩn múi giờ Việt Nam (GMT+7)
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseInputDateTime(s: string): Date {
  // accepts dd/MM/yyyy – HH:mm:ss or ISO
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*[–-]?\s*(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+07:00`;
    return new Date(iso);
  }
  return parseLocalPhanVanAt(s) ?? new Date(s);
}


export function normalizeDateKey(s: string): string {
  // dd/MM/yyyy -> yyyy-MM-dd ; yyyy-MM-dd passthrough
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function getScheduleTimeWindows(now: Date = new Date()): {
  isEmployeeWindow: boolean;
  isHrWindow: boolean;
  employeeWindowMessage: string;
  hrWindowMessage: string;
  nextWeekMonday: string;
  nextWeekSunday: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const getPart = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdayStr = getPart('weekday');
  const hour = parseInt(getPart('hour'), 10) || 0;
  const minute = parseInt(getPart('minute'), 10) || 0;
  const timeNum = hour * 100 + minute;

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[weekdayStr] ?? 0;

  // Khung 1: Nhân viên đăng ký OFF (Thứ 6 12:00 -> Thứ 7 15:00)
  const isEmployeeWindow =
    (dayOfWeek === 5 && timeNum >= 1200) ||
    (dayOfWeek === 6 && timeNum <= 1500);

  // Khung 2: HR AI Xếp Lịch Tuần (Sau 15:00 Thứ 7 -> hết Chủ Nhật 23:59)
  const isHrWindow =
    (dayOfWeek === 6 && timeNum > 1500) ||
    (dayOfWeek === 0);

  const employeeWindowMessage = isEmployeeWindow
    ? '✅ Khung giờ đăng ký OFF tuần sau đang MỞ (Mở từ 12h00 T6 đến 15h00 T7)'
    : '🔒 Khung giờ đăng ký OFF tuần sau CHỈ MỞ từ 12h00 Thứ 6 đến 15h00 Thứ 7 hàng tuần';

  const hrWindowMessage = isHrWindow
    ? '✅ Nút AI Xếp Lịch Tuần đang MỞ (Sau 15h00 T7 đến hết Chủ Nhật)'
    : '🔒 Nút AI Xếp Lịch Tuần CHỈ MỞ sau 15h00 Thứ 7 (khi nhân viên đã hoàn tất đăng ký OFF)';

  const todayStr = dateKey(now);
  const [y, m, d] = todayStr.split('-').map(Number);
  const tzDate = new Date(y, m - 1, d);

  const daysToNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMondayDate = new Date(tzDate);
  nextMondayDate.setDate(nextMondayDate.getDate() + daysToNextMonday);

  const nextSundayDate = new Date(nextMondayDate);
  nextSundayDate.setDate(nextSundayDate.getDate() + 6);

  return {
    isEmployeeWindow,
    isHrWindow,
    employeeWindowMessage,
    hrWindowMessage,
    nextWeekMonday: dateKey(nextMondayDate),
    nextWeekSunday: dateKey(nextSundayDate),
  };
}
