import type { Course, DashboardData, DueRowModel, SectionState, UpcomingItem } from '../types';
import { gradePercent, parseDate } from './format';

export const BB = 'https://learn.uark.edu';

export function bbx(): {
  STORAGE_KEYS: { blackboard: string; pearson: string; status: string; prefs: string };
  ITEMS_SCHEMA: number;
  emptyState: () => DashboardData;
  mergeForDashboard: (store: Record<string, unknown>) => DashboardData;
  safeUrl: (u: string) => string | null;
} {
  const api = (globalThis as { BBX?: ReturnType<typeof bbx> }).BBX;
  if (!api) throw new Error('shared/normalize.js failed to load');
  return api;
}

export const itemsSchema = () => {
  try { return bbx().ITEMS_SCHEMA; } catch { return null; }
};

export const safeUrl = (u?: string | null): string | null => {
  if (!u) return null;
  try { return bbx().safeUrl(u); } catch { return null; }
};

export const isVerified = (obj: { verified?: boolean } | null | undefined) => !!obj && obj.verified === true;
export const isLocked = (course: Course) => course.locked === true || course.status === 'Closed';
export const isOpen = (course: Course) => isVerified(course) && !isLocked(course);
export const findCourse = (data: DashboardData, id?: string) => data.courses.find((c) => c.id === id);

export const verifiedFaculty = (course: Course) =>
  Array.isArray(course.faculty) ? course.faculty.filter(isVerified) : [];
export const verifiedUpcoming = (course: Course) =>
  isOpen(course) && Array.isArray(course.upcoming) ? course.upcoming.filter(isVerified) : [];

export function sectionOf(course: Course | null | undefined, name: string): SectionState {
  const s = course && course.sections ? (course.sections[name] || course.sections.details) : null;
  return s || { state: 'not-fetched' };
}

const SOURCE_LABEL: Record<string, string> = {
  'blackboard-api': 'Blackboard API',
  'blackboard-dom': 'Blackboard page (DOM)',
  pearson: 'Pearson MyLab',
};
export const sourceLabel = (s?: string | null) => (s && SOURCE_LABEL[s]) || 'unknown source';

export function stateReason(state?: string): string {
  switch (state) {
    case 'auth': return 'Blackboard session expired during the last sync.';
    case 'forbidden': return 'Blackboard did not allow this read for a student session.';
    case 'not-found': return 'This Blackboard endpoint is not available on learn.uark.edu.';
    case 'error': case 'network': case 'timeout': case 'bad-json': case 'bad-content-type':
      return 'The last attempt to read this from Blackboard failed.';
    default: return 'Not fetched yet. Open Blackboard while signed in to sync.';
  }
}

export function kindOf(secState?: string): string {
  switch (secState) {
    case 'ok': return 'ok';
    case 'forbidden': return 'forbidden';
    case 'auth': case 'session-expired': return 'expired';
    case 'partial': case 'parse-partial': return 'partial';
    case 'error': case 'network': case 'timeout': case 'bad-json': case 'bad-content-type':
    case 'not-found': case 'parse-failed': return 'error';
    default: return 'notsynced';
  }
}

export function gradeClass(str: unknown): string {
  const p = gradePercent(str);
  if (p == null) return 'grade-neutral';
  if (p >= 90) return 'grade-a';
  if (p >= 80) return 'grade-b';
  if (p >= 70) return 'grade-c';
  if (p >= 60) return 'grade-d';
  return 'grade-f';
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/;

function titleCaseCaps(t: string): string {
  let first = true;
  return t.split(/(\s+)/).map((w) => {
    if (/^\s+$/.test(w) || !w) return w;
    const isFirst = first;
    first = false;
    if (/\d/.test(w) || ROMAN.test(w)) return w;
    return w.split(/([-/&])/).map((part, i) => {
      if (!/[A-Z]/.test(part)) return part;
      const lower = part.toLowerCase();
      if (!(isFirst && i === 0) && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join('');
  }).join('');
}

export function shortTitle(c: Course): string {
  let t = typeof c.title === 'string' ? c.title.trim() : '';
  if (!t) return '';
  if (c.code && t.startsWith(`${c.code} - `) && t.length > c.code.length + 3) t = t.slice(c.code.length + 3);
  if (c.bbId && t.endsWith(` (${c.bbId})`) && t.length > c.bbId.length + 3) t = t.slice(0, -(c.bbId.length + 3));
  if (/[A-Z]/.test(t) && !/[a-z]/.test(t)) t = titleCaseCaps(t);
  return t;
}

export function courseLabel(c: Course): string {
  const t = shortTitle(c);
  if (c.code && t && !t.includes(c.code)) return `${c.code} · ${t}`;
  return t || c.code || c.bbId || c.id;
}

export const fullTitle = (c: Course) => [c.title, c.bbId ? `Section id ${c.bbId}` : ''].filter(Boolean).join(' — ');

export const courseUrl = (c: Course, tab = 'outline') => `${BB}/ultra/courses/${encodeURIComponent(c.id)}/${tab}`;

export const TAB_PATHS: Record<string, string> = {
  Content: 'outline', Gradebook: 'grades', Announcements: 'announcements',
  Discussions: 'discussions', Messages: 'messages', Groups: 'groups', Calendar: 'outline',
};

export const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const TABS = ['Content', 'Gradebook', 'Calendar'];

export const byDue = (a: { due?: string }, b: { due?: string }) =>
  (parseDate(a.due)?.getTime() ?? Infinity) - (parseDate(b.due)?.getTime() ?? Infinity);

export const dueTime = (r: DueRowModel) => parseDate(r.u.due)?.getTime() ?? Infinity;

export const DUE_NOTE = '"Past due" means Blackboard recorded no submission for an item whose due date has passed. Times are Central Time. MyLab due dates are not read.';
export const PAST_DUE_FULL = 'Past due · no submission recorded in Blackboard';
export const BAND_LEGEND = 'Bar colour shows the grade band: green 90+, blue 80–89, amber 70–79, orange 60–69, red below 60. Grey when the grade is a letter.';

export function collectDueItems(data: DashboardData): { rows: DueRowModel[]; missing: Course[]; syncedAt: string | null } {
  const current = (data.courses || []).filter((c) => c.current !== false && isOpen(c));
  const rows: DueRowModel[] = [];
  const missing: Course[] = [];
  let syncedAt: string | null = null;
  for (const c of current) {
    const up = verifiedUpcoming(c);
    const sec = sectionOf(c, 'upcoming');
    if (sec.syncedAt && (!syncedAt || sec.syncedAt > syncedAt)) syncedAt = sec.syncedAt;
    if (up.length) up.forEach((u) => rows.push({ u, c }));
    else if (sec.state !== 'ok') missing.push(c);
  }
  return { rows, missing, syncedAt };
}

export function safeColor(c?: string | null, fallback = '#8a8a93'): string {
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback;
}

export const initials = (name?: string) =>
  String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

export const GRADE_STATUS: Record<string, string> = {
  NeedsGrading: 'Awaiting grading', Graded: 'Graded', InProgress: 'In progress',
  Exempt: 'Exempt', NotAttempted: 'Not attempted', Completed: 'Completed',
};

export const gradeStatusText = (s: string) =>
  GRADE_STATUS[s] || String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (x) => x.toUpperCase());

export function sortedGbItems(gb: { items?: UpcomingItem[] | { due?: string; title?: string }[] }) {
  return [...(Array.isArray(gb.items) ? gb.items : [])].sort(byDue);
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const MOD = isMac ? '⌘' : 'Ctrl';

export function hasBothSources(c: Course): boolean {
  return !!(c.pearson && isVerified(c.pearson) && c.pearson.currentGrade && c.gradebook && isVerified(c.gradebook) && c.gradebook.currentGrade);
}
