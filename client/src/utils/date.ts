const TZ = 'Asia/Ho_Chi_Minh';

export function formatDateTime(date?: string | number | Date | null): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} – ${get('hour')}:${get('minute')}:${get('second')}`;
}

export function formatDate(date?: string | number | Date | null): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}`;
}

export function dateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date).replace(/\//g, '-');
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

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}