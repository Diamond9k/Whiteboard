const CHICAGO = "America/Chicago";

export function chicagoParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    weekday: get("weekday"),
  };
}

export function chicagoDayNumber(date: Date): number {
  const p = chicagoParts(date);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
}

/** Whole Chicago calendar days from now to the instant. Null if the instant is invalid. */
export function dayDelta(iso: string, now: Date): number | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return Math.round((chicagoDayNumber(t) - chicagoDayNumber(now)) / 86400000);
}

export function greeting(now = new Date()): string {
  const hour = Number(chicagoParts(now).hour);
  if (Number.isNaN(hour)) return "Hello";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function formatDayHeading(now = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    weekday: "long",
    month: "long",
    day: "numeric",
  })
    .format(now)
    .toUpperCase();
}

export function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${date} · ${time} CT`;
}

export function formatStampTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatFullStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${text} CT`;
}

export function ageLabel(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const seconds = Math.round((now - t) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);
  const suffix = future ? "from now" : "ago";
  if (abs < 60) return future ? "moments from now" : "just now";
  const minutes = Math.round(abs / 60);
  if (minutes < 60) return `${minutes} min ${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ${suffix}`;
  const days = Math.round(hours / 24);
  return `${days} d ${suffix}`;
}

export function relativeDay(iso: string, now: Date): string {
  const delta = dayDelta(iso, now);
  if (delta === null) return "";
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  if (delta > 1 && delta < 14) return `in ${delta} days`;
  if (delta < -1 && delta > -14) return `${Math.abs(delta)} days ago`;
  return formatDue(iso).split(" · ")[0] ?? "";
}

export function dateChip(iso: string): { month: string; day: string; weekday: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const month = new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO, month: "short" }).format(d).toUpperCase();
  const day = new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO, day: "numeric" }).format(d);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO, weekday: "short" }).format(d);
  return { month, day, weekday };
}

export function monthKey(date: Date): string {
  const p = chicagoParts(date);
  return `${p.year}-${p.month}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return monthKey(new Date());
  const next = new Date(Date.UTC(y, m - 1 + delta, 1));
  const year = next.getUTCFullYear();
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function monthTitle(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/** Chicago calendar days of a month grid, Sunday-first, including leading and trailing days. */
export function monthGrid(key: string): { isoDay: string; inMonth: boolean; label: string }[] {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return [];
  const firstUtc = new Date(Date.UTC(y, m - 1, 1));
  const weekday = firstUtc.getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: { isoDay: string; inMonth: boolean; label: string }[] = [];
  for (let i = 0; i < weekday; i++) {
    const d = new Date(Date.UTC(y, m - 1, 1 - (weekday - i)));
    cells.push({ isoDay: d.toISOString().slice(0, 10), inMonth: false, label: String(d.getUTCDate()) });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(y, m - 1, day));
    cells.push({ isoDay: d.toISOString().slice(0, 10), inMonth: true, label: String(day) });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    const [yy, mm, dd] = last.isoDay.split("-").map(Number);
    const d = new Date(Date.UTC(yy, mm - 1, dd + 1));
    cells.push({ isoDay: d.toISOString().slice(0, 10), inMonth: false, label: String(d.getUTCDate()) });
  }
  return cells;
}

export function chicagoDayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = chicagoParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}
