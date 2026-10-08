// data.js — the ONLY place the dashboard gets course data.
// Reads what the content scripts stored in chrome.storage.local and merges it
// with shared/normalize.js (globalThis.BBX). Nothing here invents or fills in
// values: helpers only read, format, or report that something is not synced.

const BBX = globalThis.BBX;
const TZ = 'America/Chicago';
export const BB = 'https://learn.uark.edu';
/** Pearson assignment-list schema written by the current parser (older caches are not rendered). */
export const PEARSON_ITEMS_SCHEMA = BBX ? BBX.ITEMS_SCHEMA : null;

export const hasChromeStorage = () =>
  typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

/** Load + merge cached data. Never throws: worst case is the empty "Not yet synced" state. */
export async function loadData() {
  if (!BBX) throw new Error('shared/normalize.js failed to load');
  if (!hasChromeStorage()) {
    const d = BBX.emptyState();
    d._noStorage = true; // opened outside the extension (e.g. file://) — dev only
    return d;
  }
  try {
    const store = await chrome.storage.local.get(Object.values(BBX.STORAGE_KEYS));
    const data = BBX.mergeForDashboard(store);
    data.prefs = store[BBX.STORAGE_KEYS.prefs] || {};
    return data;
  } catch (err) {
    console.error('[BBX] storage read failed', err);
    const d = BBX.emptyState();
    d._storageError = String(err && err.message ? err.message : err);
    return d;
  }
}

export function onDataChanged(cb) {
  if (!hasChromeStorage() || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local') cb(changes); });
}

// ---- UI preferences (layout, favourites, Pearson->course mapping). Not course data.
export async function getPrefs() {
  if (!hasChromeStorage()) return {};
  try { return (await chrome.storage.local.get(BBX.STORAGE_KEYS.prefs))[BBX.STORAGE_KEYS.prefs] || {}; } catch { return {}; }
}
export async function setPrefs(patch) {
  if (!hasChromeStorage()) return;
  const cur = await getPrefs();
  await chrome.storage.local.set({ [BBX.STORAGE_KEYS.prefs]: { ...cur, ...patch } });
}

/** Ask the background to poke open Blackboard/Pearson tabs. */
export function requestSync() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'bbx:requestSync' }, (r) => resolve(chrome.runtime.lastError ? null : r));
    } catch { resolve(null); }
  });
}
export function clearCache() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'bbx:clearCache' }, (r) => resolve(chrome.runtime.lastError ? null : r));
    } catch { resolve(null); }
  });
}

/** A record is trustworthy only when it explicitly says verified:true. */
export const isVerified = (obj) => !!obj && obj.verified === true;

/** Locked only when Blackboard explicitly said so. Unknown availability is NOT "locked". */
export const isLocked = (course) => course.locked === true || course.status === 'Closed';
export const isOpen = (course) => isVerified(course) && !isLocked(course);
export const findCourse = (data, id) => data.courses.find((c) => c.id === id);

export const verifiedFaculty = (course) =>
  Array.isArray(course.faculty) ? course.faculty.filter(isVerified) : [];
export const verifiedUpcoming = (course) =>
  isOpen(course) && Array.isArray(course.upcoming) ? course.upcoming.filter(isVerified) : [];

/** Section state for a course part: 'ok' | 'partial' | 'auth' | 'forbidden' | 'not-found' | 'error' | 'not-fetched'. */
export function sectionOf(course, name) {
  const s = course && course.sections ? (course.sections[name] || course.sections.details) : null;
  return s || { state: 'not-fetched' };
}

export const SOURCE_LABEL = {
  'blackboard-api': 'Blackboard API',
  'blackboard-dom': 'Blackboard page (DOM)',
  pearson: 'Pearson MyLab',
};
export const sourceLabel = (s) => SOURCE_LABEL[s] || 'unknown source';

/** Human reason for a non-ok section state (no guessing about the data itself). */
export function stateReason(state) {
  switch (state) {
    case 'auth': return 'Blackboard session expired during the last sync.';
    case 'forbidden': return 'Blackboard did not allow this read for a student session.';
    case 'not-found': return 'This Blackboard endpoint is not available on learn.uark.edu.';
    case 'error': case 'network': case 'timeout': case 'bad-json': case 'bad-content-type': return 'The last attempt to read this from Blackboard failed.';
    default: return 'Not fetched yet. Open Blackboard while signed in to sync.';
  }
}

/** Grade % for colour coding only. Supports "NN.NN%" and "A / B". */
export function gradePercent(str) {
  if (typeof str !== 'string') return null;
  const pct = str.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (pct) return parseFloat(pct[1]);
  const frac = str.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac && parseFloat(frac[2]) > 0) return (parseFloat(frac[1]) / parseFloat(frac[2])) * 100;
  return null;
}

export function parseProgress(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/(\d+)\s+of\s+(\d+)\s*(\w+)?/i);
  if (!m || +m[2] === 0) return null;
  return { done: +m[1], total: +m[2], ratio: +m[1] / +m[2], kind: (m[3] || '').toLowerCase() };
}

/** Only https links to Blackboard / Pearson are ever rendered as hrefs. */
export const safeUrl = (u) => (BBX ? BBX.safeUrl(u) : null);

// ---- Dates (always America/Chicago)
const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts });
export function parseDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}
export const fmtDateTime = (d) => fmt({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) + ' CT';
export const fmtDue = (d) => fmt({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) + ' CT';
export const fmtMonth = (d) => fmt({ month: 'short' }).format(d).toUpperCase();
export const fmtDay = (d) => fmt({ day: 'numeric' }).format(d);
/** Calendar-day key in America/Chicago, "YYYY-MM-DD" (for grouping). */
export const fmtDayKey = (d) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$1-$2');
/** "Wed, Oct 7, 2026" in America/Chicago. */
export const fmtDayHeading = (d) => fmt({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
export function fmtAgo(d) {
  if (!d) return 'never';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// ---- Display-only formatting helpers (added for the redesign; pure, no data logic).
/** "6:15 PM" in America/Chicago. */
export const fmtTime = (d) => fmt({ hour: 'numeric', minute: '2-digit' }).format(d);
/** Compact stamp time: the clock time when d is today (CT), otherwise "Oct 4". */
export const fmtStamp = (d, now = new Date()) =>
  (fmtDayKey(d) === fmtDayKey(now) ? fmtTime(d) : fmt({ month: 'short', day: 'numeric' }).format(d));
/** Whole calendar days from `now` to `d` in America/Chicago: 0 = today, 1 = tomorrow, -1 = yesterday. */
export function dayDiff(d, now = new Date()) {
  const k = (x) => { const [y, m, dd] = fmtDayKey(x).split('-').map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.round((k(d) - k(now)) / 864e5);
}
/** "Today", "Tomorrow", "in 3 days", "Yesterday", "3 days ago" (calendar days, CT). */
export function fmtRelDay(d, now = new Date()) {
  const n = dayDiff(d, now);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 1 ? `in ${n} days` : `${-n} days ago`;
}
/** "Wednesday, October 7" in America/Chicago. */
export const fmtLongDay = (d) => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(d);
/** "Thu 11:59 PM" in America/Chicago. */
export const fmtDueShort = (d) => fmt({ weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d).replace(',', '');
/** Hour of day (0-23) in America/Chicago, for a time-of-day greeting. */
export const hourCT = (d = new Date()) => Number(fmt({ hour: 'numeric', hourCycle: 'h23' }).format(d));
/** "Sat, Oct 10" in America/Chicago. */
export const fmtDayShort = (d) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(d);

// ---- Round 2 display helpers (pure formatting, no data logic).
/** "6:56 PM" when d is today (CT); "Oct 4, 6:56 PM" otherwise (year added when it differs). */
export function fmtWhen(d, now = new Date()) {
  if (fmtDayKey(d) === fmtDayKey(now)) return fmtTime(d);
  const sameYear = fmt({ year: 'numeric' }).format(d) === fmt({ year: 'numeric' }).format(now);
  return fmt({ month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(d) + ', ' + fmtTime(d);
}
/** Compact age for tight spaces: "now", "8m", "3h", "3d". */
export function fmtAgoShort(d) {
  if (!d) return null;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
/** "Oct 4" in America/Chicago. */
export const fmtMonthDay = (d) => fmt({ month: 'short', day: 'numeric' }).format(d);
/** Weekday short name (CT). */
export const fmtWeekday = (d) => fmt({ weekday: 'short' }).format(d);

// ---- Round 3 display helpers (pure formatting, no data logic).
/** Canonical due format: "Thu, Oct 8 · 11:59 PM CT" (year added when it differs from now). */
export function fmtDueFull(d, now = new Date()) {
  const sameYear = fmt({ year: 'numeric' }).format(d) === fmt({ year: 'numeric' }).format(now);
  return fmt({ weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(d) + ' · ' + fmtTime(d) + ' CT';
}
/** "11:59 PM CT". */
export const fmtTimeCT = (d) => fmtTime(d) + ' CT';
/** "Oct 7, 2026, 7:23 PM CT (8 min ago)". */
export const fmtFullAgo = (d) => `${fmtDateTime(d)} (${fmtAgo(d)})`;
