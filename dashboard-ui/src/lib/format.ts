const TZ = 'America/Chicago';
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts });

export function parseDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const fmtDateTime = (d: Date) =>
  fmt({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) + ' CT';
export const fmtMonth = (d: Date) => fmt({ month: 'short' }).format(d).toUpperCase();
export const fmtDay = (d: Date) => fmt({ day: 'numeric' }).format(d);
export const fmtDayKey = (d: Date) =>
  fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$1-$2');
export const fmtDayHeading = (d: Date) => fmt({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
export const fmtTime = (d: Date) => fmt({ hour: 'numeric', minute: '2-digit' }).format(d);
export const fmtLongDay = (d: Date) => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(d);
export const fmtMonthDay = (d: Date) => fmt({ month: 'short', day: 'numeric' }).format(d);
export const fmtWeekday = (d: Date) => fmt({ weekday: 'short' }).format(d);
export const fmtTimeCT = (d: Date) => fmtTime(d) + ' CT';
export const hourCT = (d = new Date()) => Number(fmt({ hour: 'numeric', hourCycle: 'h23' }).format(d));

export function fmtAgo(d: Date | null): string {
  if (!d) return 'never';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function fmtAgoShort(d: Date | null): string | null {
  if (!d) return null;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function dayDiff(d: Date, now = new Date()): number {
  const k = (x: Date) => {
    const [y, m, dd] = fmtDayKey(x).split('-').map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((k(d) - k(now)) / 864e5);
}

export function fmtRelDay(d: Date, now = new Date()): string {
  const n = dayDiff(d, now);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 1 ? `in ${n} days` : `${-n} days ago`;
}

export function fmtWhen(d: Date, now = new Date()): string {
  if (fmtDayKey(d) === fmtDayKey(now)) return fmtTime(d);
  const sameYear = fmt({ year: 'numeric' }).format(d) === fmt({ year: 'numeric' }).format(now);
  return fmt({ month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(d) + ', ' + fmtTime(d);
}

export function fmtDueFull(d: Date, now = new Date()): string {
  const sameYear = fmt({ year: 'numeric' }).format(d) === fmt({ year: 'numeric' }).format(now);
  return fmt({ weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(d) + ' · ' + fmtTime(d) + ' CT';
}

export const fmtFullAgo = (d: Date) => `${fmtDateTime(d)} (${fmtAgo(d)})`;

export function gradePercent(str: unknown): number | null {
  if (typeof str !== 'string') return null;
  const pct = str.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (pct) return parseFloat(pct[1]);
  const frac = str.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac && parseFloat(frac[2]) > 0) return (parseFloat(frac[1]) / parseFloat(frac[2])) * 100;
  return null;
}

export function parseProgress(text: unknown): { done: number; total: number; ratio: number; kind: string } | null {
  if (typeof text !== 'string') return null;
  const m = text.match(/(\d+)\s+of\s+(\d+)\s*(\w+)?/i);
  if (!m || +m[2] === 0) return null;
  return { done: +m[1], total: +m[2], ratio: +m[1] / +m[2], kind: (m[3] || '').toLowerCase() };
}
