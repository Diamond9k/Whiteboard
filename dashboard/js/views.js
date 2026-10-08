// views.js — shared view helpers + the Courses, Course, Diagnostics and stub renderers.
// Each renderer returns an HTML string built ONLY from the data object passed in.
// Missing / unfetched data => an explicit state (not synced / couldn't be read /
// not shared), and every block keeps its source + synced-at time one tap away.
import { icon } from './icons.js';
import {
  BB, isVerified, isLocked, isOpen, verifiedFaculty, verifiedUpcoming, sectionOf, sourceLabel, stateReason,
  gradePercent, parseProgress, parseDate, fmtDue, fmtMonth, fmtDay, fmtDayKey, fmtDateTime, fmtAgo, safeUrl,
  PEARSON_ITEMS_SCHEMA, fmtRelDay, dayDiff, fmtTime, fmtWhen, fmtMonthDay, fmtWeekday, fmtDueFull, fmtTimeCT, fmtFullAgo,
} from './data.js';
import { agendaHtml } from './calendar.js';

// ---------------------------------------------------------------- helpers

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const safeColor = (c, fallback = '#8a8a93') => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback);
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
const STALE_MS = 24 * 3600 * 1000;
const MATCH_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------- trust context
// app.js hands over DATA before each render. One timestamp model:
//   system time = status.<sys>.lastSuccessAt (fallbacks: BB _meta.pulled_at, newest MyLab record)
//   block time  = the block's own syncedAt
let TRUST = { bb: {}, pe: {}, bbLast: null, peLast: null, peFromRecord: false };
export function setTrustContext(status, data) {
  const s = status || {};
  const bb = s.blackboard || {};
  const pe = s.pearson || {};
  let bbLast = parseDate(bb.lastSuccessAt);
  if (!bbLast && data && data._meta) bbLast = parseDate(data._meta.pulled_at);
  let peLast = parseDate(pe.lastSuccessAt);
  let peFromRecord = false;
  if (!peLast && data) {
    const times = [];
    for (const c of data.courses || []) if (c.pearson && c.pearson.syncedAt) times.push(c.pearson.syncedAt);
    for (const p of data.unmatchedPearson || []) if (p.syncedAt) times.push(p.syncedAt);
    times.sort();
    peLast = parseDate(times[times.length - 1]);
    peFromRecord = !!peLast;
  }
  TRUST = { bb, pe, bbLast, peLast, peFromRecord };
}
/** { s, last, state, fromRecord } for 'blackboard' | 'pearson' (state 'stale' when ok but >24h old). */
export function sysInfo(key) {
  const isPe = key === 'pearson';
  const s = isPe ? TRUST.pe : TRUST.bb;
  const last = isPe ? TRUST.peLast : TRUST.bbLast;
  let state = s.state || (last ? 'ok' : null);
  if (state === 'ok' && last && Date.now() - last.getTime() > STALE_MS) state = 'stale';
  return { s, last, state, fromRecord: isPe && TRUST.peFromRecord };
}
/** Blackboard data on screen is old: sign-in expired, last sync failed, or older than 24h. */
export function bbIsStale() {
  const st = TRUST.bb.state;
  return !!TRUST.bbLast && (st === 'session-expired' || st === 'error' || Date.now() - TRUST.bbLast.getTime() > STALE_MS);
}
const staleWhy = () => (TRUST.bb.state === 'session-expired' ? 'Blackboard sign-in expired' : TRUST.bb.state === 'error' ? 'the last Blackboard sync failed' : 'Blackboard data is more than a day old');
/** Quiet "as of Oct 4" marker for blocks built from stale Blackboard data ('' when fresh). */
export function staleMark(cls = '', word = 'as of') {
  if (!bbIsStale()) return '';
  const full = `From ${fmtDateTime(TRUST.bbLast)} (${fmtAgo(TRUST.bbLast)}): ${staleWhy()}.`;
  return `<span class="stale-mark ${cls}" title="${esc(full)}">${icon('clock', 12)}<span>${esc(word)} ${esc(fmtMonthDay(TRUST.bbLast))}</span><span class="sr-only"> — ${esc(full)}</span></span>`;
}
/**
 * Stale-data honesty: when Blackboard data is stale, an item it last reported as "due" whose due
 * time has since passed is shown as "Past due · status unknown since last sync". We never claim it
 * is missing: only a Blackboard grade record can say that (status 'overdue').
 */
export function isMaybePast(u) {
  if (!u || u.status !== 'due' || !bbIsStale()) return false;
  const d = parseDate(u.due);
  return !!d && d.getTime() < Date.now();
}
export const maybePastLabel = () => `Past due · status unknown since last sync (${TRUST.bbLast ? fmtMonthDay(TRUST.bbLast) : 'date unknown'})`;
const maybePastFull = () => `Blackboard last reported this as not yet due (${TRUST.bbLast ? fmtDateTime(TRUST.bbLast) : 'time unknown'}). Its due time has passed since; whether it was submitted is unknown until Blackboard syncs again.`;
/** Visible MyLab partial-read detail ('' unless the latest MyLab read was partial). */
export function pePartialNote() {
  if (TRUST.pe.state !== 'parse-partial') return '';
  return `<p class="partial-note">${icon('halfdot', 14)}<span><strong>Latest MyLab read was partial.</strong> ${esc(TRUST.pe.message || 'Part of the MyLab results page couldn\'t be read.')} Each table below shows when it was read.</span></p>`;
}
/** Compact band legend (shown once per page). */
export function bandLegend(cls = '') {
  const bands = [['a', '90+'], ['b', '80s'], ['c', '70s'], ['d', '60s'], ['f', '<60']];
  return `<div class="band-legend ${cls}" role="note" aria-label="${esc(BAND_LEGEND)}"><span class="bl-k">Grade band</span>${bands.map(([k, t]) => `<span class="bl grade-${k}"><i aria-hidden="true"></i>${t}</span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- page provenance
// Page-level provenance (what the old head stamp said) is listed inside the sync pill's sheet.
let PROV = [];
export const provReset = () => { PROV = []; };
export const provAdd = (label, source, syncedAt, notes = []) => { PROV.push({ label, source, syncedAt, notes }); };
export const provList = () => PROV;

// ---------------------------------------------------------------- state vocabulary
const STATE_META = {
  ok: { icon: null, label: 'OK' },
  stale: { icon: 'clock', label: 'Cached copy' },
  partial: { icon: 'halfdot', label: 'Partly read' },
  expired: { icon: 'key', label: 'Sign-in expired' },
  error: { icon: 'alert', label: 'Last read failed' },
  forbidden: { icon: 'lock', label: 'Not shared with student accounts' },
  notsynced: { icon: 'ring', label: 'Not synced yet' },
  empty: { icon: null, label: 'Nothing posted' },
  elsewhere: { icon: 'external', label: 'Lives in Blackboard' },
};

export function kindOf(secState) {
  switch (secState) {
    case 'ok': return 'ok';
    case 'forbidden': return 'forbidden';
    case 'auth': case 'session-expired': return 'expired';
    case 'partial': case 'parse-partial': return 'partial';
    case 'error': case 'network': case 'timeout': case 'bad-json': case 'bad-content-type': case 'not-found': case 'parse-failed': return 'error';
    default: return 'notsynced';
  }
}

export function chip(kind, text, title) {
  const m = STATE_META[kind] || STATE_META.notsynced;
  const t = title ? ` title="${esc(title)}"` : '';
  return `<span class="st" data-state="${kind}"${t}>${m.icon ? icon(m.icon, 13) : '<i class="st-dot" aria-hidden="true"></i>'}<span>${esc(text || m.label)}</span></span>`;
}

const extBtn = (href, label, cls = 'btn-sec') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}${icon('external', 13)}</a>`;

/** A solid state panel. `checked` = ISO time the state was read (shown as "Checked …"). */
export function statePanel(kind, title, detail = '', link = null, checked = null) {
  const m = STATE_META[kind] || STATE_META.notsynced;
  const a = link ? `<div class="sp-act">${extBtn(link.href, link.label)}</div>` : '';
  const d = parseDate(checked);
  const ck = d ? `<p class="sp-checked" title="${esc(fmtDateTime(d))}">Checked ${esc(fmtWhen(d))}</p>` : '';
  return `<div class="state-panel" data-state="${kind}"><span class="sp-icon">${icon(m.icon || 'info', 18)}</span><div class="sp-body"><strong>${esc(title)}</strong>${detail ? `<p>${esc(detail)}</p>` : ''}${ck}${a}</div></div>`;
}
/** Flat state line for use inside a card (no nested panel). */
export function inlineState(kind, title, detail = '') {
  const m = STATE_META[kind] || STATE_META.notsynced;
  return `<div class="inline-state" data-state="${kind}">${icon(m.icon || 'info', 16)}<div><strong>${esc(title)}</strong>${detail ? `<p>${esc(detail)}</p>` : ''}</div></div>`;
}
export const notSynced = (title = 'Not synced yet', detail = '', link = null) => statePanel('notsynced', title, detail, link);

function sectionPanel(sec, what, link) {
  const kind = kindOf(sec.state);
  if (kind === 'forbidden') {
    return statePanel('forbidden', `${what} isn't shared with student accounts`, 'Blackboard doesn\'t let a student session read this, so it can\'t be shown here. It may still be visible in Blackboard itself.', link, sec.syncedAt);
  }
  if (kind === 'expired') return statePanel('expired', `${what}: Blackboard sign-in expired`, stateReason(sec.state), link, sec.syncedAt);
  if (kind === 'error') return statePanel('error', `${what} couldn't be read`, stateReason(sec.state), link, sec.syncedAt);
  return statePanel('notsynced', `${what} not synced yet`, stateReason(sec.state), link);
}

// ---------------------------------------------------------------- provenance stamp
const SRC_SHORT = { 'blackboard-api': 'BB', 'blackboard-dom': 'BB page', pearson: 'MyLab' };

/**
 * Source stamp. When the block's time equals its system's last successful sync (±2 min) it shows
 * only the source monogram + a dot; otherwise the dated time ("BB · Oct 4, 6:56 PM").
 * The expanded text always gives the exact time. dotOnly: render just the dot (lanes already labelled).
 */
export function stamp(source, syncedAt, { stale = false, notes = [], dotOnly = false } = {}) {
  const d = parseDate(syncedAt);
  const isPe = source === 'pearson';
  const sys = isPe ? TRUST.pe : TRUST.bb;
  const sysLast = isPe ? TRUST.peLast : TRUST.bbLast;
  const sysName = isPe ? 'MyLab' : 'Blackboard';
  const sysBad = ['session-expired', 'error', 'parse-failed'].includes(sys.state);
  const matches = !!(d && sysLast && Math.abs(d.getTime() - sysLast.getTime()) <= MATCH_MS);
  const full = `Synced from ${sourceLabel(source)} · ${d ? `${fmtDateTime(d)} (${fmtAgo(d)})` : 'time unknown'}`;
  const lines = [full];
  if (matches) lines.push(`Same read as ${sysName}'s last successful sync.`);
  if (stale) lines.push('Cached — the last refresh of this block failed, so this is the earlier copy.');
  if (sysBad) lines.push(`${sysName}'s latest sync attempt ${sys.state === 'session-expired' ? 'hit an expired sign-in' : 'failed'}; this block may be out of date.`);
  if (isPe && sys.state === 'parse-partial') lines.push(`Latest MyLab read was partial${sys.message ? `: ${sys.message}` : '.'}`);
  for (const n of notes) if (n) lines.push(n);
  const warn = stale || sysBad || (!!d && Date.now() - d.getTime() > STALE_MS);
  const mono = SRC_SHORT[source] || 'Source';
  // Always printed: "BB · 7:23 PM", "BB · Oct 4, 7:23 PM"; stale ones print the date beside the clock ("◷ BB · Oct 4").
  const today = d && fmtDayKey(d) === fmtDayKey(new Date());
  const when = !d ? 'time unknown' : warn && !today ? fmtMonthDay(d) : fmtWhen(d);
  let short = dotOnly ? when : `${mono} · ${when}`;
  if (stale) short += ' · cached';
  const mark = warn ? icon('clock', 12) : '<i class="stamp-dot" aria-hidden="true"></i>';
  return `<details class="stamp${warn ? ' is-warn' : ''}"><summary title="${esc(full)}" aria-label="Source: ${esc(full)}">${mark}<span class="stamp-t">${esc(short)}</span></summary><div class="stamp-pop">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div></details>`;
}

const extLink = (href, label, cls = 'ext') => {
  const u = safeUrl(href);
  return u ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}${icon('external', 13)}</a>` : '';
};

export const searchBtn = () => `<button class="icon-btn search-btn" type="button" data-action="search" aria-label="Search courses and items" title="Search">${icon('search', 20)}</button>`;

/** Page head. `.fresh-slot` is filled by app.js with the sync pill (omitted on pages that pull nothing). */
export const pageHead = (title, extra = '', eyebrow = '', { pill = true } = {}) =>
  `<header class="page-head"><div class="ph-text">${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1 class="page-title" tabindex="-1">${esc(title)}</h1></div>${searchBtn()}<div class="ph-tools">${extra}${pill ? '<span class="fresh-slot"></span>' : ''}</div></header>`;

const secHead = (title, tools = '', tag = 'h2', sub = '') =>
  `<div class="sec-head"><div class="sec-title-wrap"><${tag} class="sec-title">${title}</${tag}>${sub ? `<p class="sec-sub">${sub}</p>` : ''}</div>${tools ? `<div class="sec-tools">${tools}</div>` : ''}</div>`;
export { secHead };

export function gradeClass(str) {
  const p = gradePercent(str);
  if (p == null) return 'grade-neutral';
  if (p >= 90) return 'grade-a';
  if (p >= 80) return 'grade-b';
  if (p >= 70) return 'grade-c';
  if (p >= 60) return 'grade-d';
  return 'grade-f';
}
export const BAND_LEGEND = 'Bar colour shows the grade band: green 90+, blue 80–89, amber 70–79, orange 60–69, red below 60. Grey when the grade is a letter.';

// ---------------------------------------------------------------- course titles (display only)
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/;
function titleCaseCaps(t) {
  let first = true;
  return t.split(/(\s+)/).map((w) => {
    if (/^\s+$/.test(w) || !w) return w;
    const isFirst = first; first = false;
    if (/\d/.test(w) || ROMAN.test(w)) return w;
    return w.split(/([-/&])/).map((part, i) => {
      if (!/[A-Z]/.test(part)) return part;
      const lower = part.toLowerCase();
      if (!(isFirst && i === 0) && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join('');
  }).join('');
}
export function shortTitle(c) {
  let t = typeof c.title === 'string' ? c.title.trim() : '';
  if (!t) return '';
  if (c.code && t.startsWith(`${c.code} - `) && t.length > c.code.length + 3) t = t.slice(c.code.length + 3);
  if (c.bbId && t.endsWith(` (${c.bbId})`) && t.length > c.bbId.length + 3) t = t.slice(0, -(c.bbId.length + 3));
  if (/[A-Z]/.test(t) && !/[a-z]/.test(t)) t = titleCaseCaps(t);
  return t;
}
export function courseLabel(c) {
  const t = shortTitle(c);
  if (c.code && t && !t.includes(c.code)) return `${c.code} · ${t}`;
  return t || c.code || c.bbId || c.id;
}
export const fullTitleAttr = (c) => esc([c.title, c.bbId ? `Section id ${c.bbId}` : ''].filter(Boolean).join(' — '));
export const codeEyebrow = (c) => (c.code ? `<span class="ccode" title="${esc(c.bbId || '')}">${esc(c.code)}</span>` : '');
export const titleText = (c) => {
  const t = shortTitle(c);
  return t ? esc(t) : (c.code ? '' : chip('notsynced', 'Course title not synced'));
};

export const courseUrl = (c, tab = 'outline') => `${BB}/ultra/courses/${encodeURIComponent(c.id)}/${tab}`;
const TAB_PATHS = { Content: 'outline', Gradebook: 'grades', Announcements: 'announcements', Discussions: 'discussions', Messages: 'messages', Groups: 'groups', Calendar: 'outline' };

// ---------------------------------------------------------------- EMPTY STATE

export function onboarding(data) {
  const st = data.status || {};
  const bbDone = !!parseDate(st.blackboard && st.blackboard.lastSuccessAt);
  const peDone = !!parseDate(st.pearson && st.pearson.lastSuccessAt);
  const devNote = data._noStorage
    ? '<p class="muted small">Dev note: chrome.storage is unavailable because this page is not running inside the extension. Load the folder as an unpacked extension.</p>' : '';
  const errNote = data._storageError ? `<p class="muted small">Storage error: ${esc(data._storageError)}</p>` : '';
  const step = (done, n, html) => `<li class="${done ? 'done' : ''}"><span class="step-mark" aria-hidden="true">${done ? icon('check', 14) : n}</span><div>${html}${done ? ' <span class="sr-only">(done)</span>' : ''}</div></li>`;
  return `<div class="card welcome">
    <h2>Nothing synced yet</h2>
    <p class="muted">This page only shows what the extension has read from your own signed-in sessions. Nothing has been read so far, and no sample data is ever shown.</p>
    <ol class="steps">
      ${step(bbDone, 1, '<strong>Sign in to Blackboard</strong> (learn.uark.edu). Courses, gradebook, content and due dates are read from there.')}
      ${step(peDone, 2, '<strong>For MyLab grades,</strong> open Pearson MyLab and visit the <em>Results</em> page while signed in.')}
      ${step(false, 3, '<strong>Come back here.</strong> The dashboard updates by itself.')}
    </ol>
    <div class="welcome-actions">
      <a class="btn" href="${BB}/ultra/course" target="_blank" rel="noopener">Open Blackboard${icon('external', 14)}</a>
      <button class="btn-sec" type="button" data-action="sync" aria-describedby="sync-why">${icon('sync', 15)}Sync now</button>
    </div>
    <p class="muted small sync-why" id="sync-why">Sync now only works once a signed-in Blackboard or MyLab tab is open — sign in first, then come back.</p>
    <p class="sync-msg muted small" role="status"></p>
    <p class="welcome-hint">Works with Blackboard Ultra and Pearson MyLab. Read-only: nothing is ever written back.</p>
    ${devNote}${errNote}
  </div>`;
}

// ---------------------------------------------------------------- COURSES

export function coursesPage(data, { layout, favorites, showPast }) {
  const toggle = `
    <div class="view-toggle" role="group" aria-label="Layout">
      <button class="${layout === 'list' ? 'on' : ''}" data-layout="list" aria-label="List view" aria-pressed="${layout === 'list'}" title="List view">${icon('list', 18)}</button>
      <button class="${layout === 'grid' ? 'on' : ''}" data-layout="grid" aria-label="Grid view" aria-pressed="${layout === 'grid'}" title="Grid view">${icon('grid', 18)}</button>
    </div>`;
  if (!data.courses.length) return `${pageHead('Courses', '')}${onboarding(data)}`;
  const src = data._meta && data._meta.source;
  if (data._meta && data._meta.pulled_at) provAdd('Course list', src, data._meta.pulled_at);

  const groups = new Map();
  const past = [];
  for (const c of data.courses) {
    if (c.current === false) { past.push(c); continue; }
    const k = c.termName || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const termStart = (name) => {
    const t = Object.values(data.terms || {}).find((x) => x.name === name);
    return t && t.start ? Date.parse(t.start) : -Infinity;
  };
  const order = [...groups.keys()].sort((a, b) => termStart(b) - termStart(a));
  const favFirst = (list) => [...list].sort((a, b) => (favorites.has(b.id) ? 1 : 0) - (favorites.has(a.id) ? 1 : 0));
  const head = layout === 'list'
    ? '<div class="cl-head" aria-hidden="true"><span>Course</span><span>Next due</span><span>MyLab</span><span>Blackboard</span><span></span></div>' : '';
  const block = (title, list) => `
    <h2 class="term-heading">${title ? esc(title) : chip('notsynced', 'Term not synced')}<span class="count">${list.length}</span></h2>
    <div class="course-list ${layout === 'grid' ? 'grid' : 'list'}">${head}${favFirst(list).map((c) => courseCard(c, favorites.has(c.id))).join('')}</div>`;
  const pastBlock = past.length
    ? (showPast
      ? block('Past terms', past) + '<p><button class="link-btn" data-showpast="0">Hide past terms</button></p>'
      : `<p><button class="link-btn" data-showpast="1">${icon('chevronDown', 15)}Show ${past.length} course${past.length === 1 ? '' : 's'} from past terms</button></p>`)
    : '';
  return `
    ${pageHead('Courses', toggle)}
    <section>
      ${order.map((k) => block(k, groups.get(k))).join('') || statePanel('notsynced', 'No current courses synced')}
      ${pastBlock}
    </section>`;
}

export const byDue = (a, b) => (parseDate(a.due)?.getTime() ?? Infinity) - (parseDate(b.due)?.getTime() ?? Infinity);

/** Instructor line: names, or an honest reason. */
function instructorHtml(c) {
  const fac = verifiedFaculty(c);
  const facSec = sectionOf(c, 'faculty');
  if (fac.length) return `<span class="cc-instr">${icon('user', 13)}<span>${esc(fac.map((f) => f.name).join(', '))}</span></span>`;
  if (facSec.state === 'ok' && !c.facultyUnnamed) return '<span class="cc-instr muted">No instructor listed</span>';
  // One visible label for every "no name" case; the reason lives in the tooltip + screen-reader text.
  const why = c.facultyUnnamed
    ? `Blackboard listed ${c.facultyUnnamed} instructor${c.facultyUnnamed === 1 ? '' : 's'} but returned no name.`
    : kindOf(facSec.state) === 'forbidden' ? "Blackboard doesn't share the faculty list with student accounts."
      : stateReason(facSec.state);
  return `<span class="cc-instr muted" title="${esc(why)}">${icon('user', 13)}<span>Instructor not yet synced<span class="sr-only"> — ${esc(why)}</span></span></span>`;
}

/** Compact overall grade for one source (course list / strip). Returns { html, value }. */
export function gradeCell(c, which) {
  const dash = (why) => `<span class="gc-none" title="${esc(why)}">—<span class="sr-only"> (${esc(why)})</span></span>`;
  if (which === 'mylab') {
    const p = c.pearson;
    if (!p || !isVerified(p)) return { html: dash('No MyLab results synced for this course'), value: null };
    const st = stamp('pearson', p.syncedAt, { dotOnly: true, notes: [p.matchedBy ? `Matched to this course by ${p.matchedBy}.` : ''] });
    if (!p.currentGrade) return { html: dash('MyLab overall score not read'), value: null, st };
    return { html: `<span class="gc-val ${gradeClass(p.currentGrade)}">${esc(p.currentGrade)}</span>`, value: p.currentGrade, st };
  }
  const gb = c.gradebook;
  const sec = sectionOf(c, 'gradebook');
  if (!gb || !isVerified(gb)) {
    const k = kindOf(sec.state);
    if (k === 'forbidden') return { html: `<span class="gc-lock" title="Gradebook isn't shared with student accounts">${icon('lock', 13)}<span>Not shared</span></span>`, value: null };
    return { html: dash(k === 'error' ? "Gradebook couldn't be read" : k === 'expired' ? 'Sign-in expired' : 'Gradebook not synced yet'), value: null };
  }
  const st = stamp(gb.source, gb.syncedAt, { stale: sec.stale, dotOnly: true });
  if (gb.empty) return { html: dash('No grades posted in Blackboard'), value: null, text: 'No grades posted', st };
  if (!gb.currentGrade) return { html: dash(gb.overallAmbiguous ? 'Several total columns; none picked' : 'No overall grade shown in Blackboard'), value: null, text: gb.overallAmbiguous ? 'Overall not picked' : 'No overall grade shown', st };
  return { html: `<span class="gc-val ${gradeClass(gb.currentGrade)}">${esc(gb.currentGrade)}</span>`, value: gb.currentGrade, st };
}

function courseCard(c, fav) {
  const open = isOpen(c);
  const status = !isVerified(c)
    ? chip('notsynced')
    : isLocked(c)
      ? `<span class="status closed">${icon('lock', 13)}${esc(c.status || 'Closed')}</span>`
      : c.status === 'Open'
        ? '<span class="status open"><i class="dot" aria-hidden="true"></i>Open</span>'
        : '<span class="status muted" title="Blackboard did not report availability">Availability not reported</span>';
  const lockedMsg = isLocked(c)
    ? `<div class="locked-msg">${icon('lock', 15)}<div><strong>You're enrolled, but this course isn't open yet.</strong>${c.note ? `<p>${esc(c.note)}</p>` : ''}</div></div>` : '';
  const pe = c.pearson ? '<span class="mono-tag" title="MyLab results are synced for this course">MyLab</span>' : '';
  let next = '<span class="muted">—</span>';
  if (open) {
    const up = verifiedUpcoming(c);
    const overdue = up.filter((u) => u.status === 'overdue').length;
    const maybe = up.filter(isMaybePast).length;
    const nxt = up.filter((u) => u.status === 'due' && !isMaybePast(u)).sort(byDue)[0];
    const upSec = sectionOf(c, 'upcoming');
    const flags = [];
    if (overdue) flags.push(`<span class="cc-overdue" title="${PAST_DUE_FULL}">${icon('alert', 13)}${overdue} past due</span>`);
    if (maybe) flags.push(`<span class="cc-maybe" title="${esc(maybePastLabel())}">${icon('clock', 13)}${maybe} may be past due</span>`);
    let line;
    if (nxt) { const d = parseDate(nxt.due); line = `<span class="cc-nextdue"><span class="cc-next-t">${esc(nxt.title)}</span><span class="cc-next-r" title="${esc(fmtDueFull(d))}">${esc(fmtRelDay(d))} · ${esc(fmtDueFull(d))}</span></span>`; }
    else if (upSec.state === 'ok') line = '<span class="muted">Nothing upcoming</span>';
    else line = `<span class="muted" title="${esc(stateReason(upSec.state))}">Due dates not synced</span>`;
    next = `${flags.length ? `<span class="cc-flags">${flags.join('')}</span>` : ''}${line}`;
  }
  const title = titleText(c);
  const name = open
    ? `<a class="cc-link" href="#/course/${encodeURIComponent(c.id)}" title="${fullTitleAttr(c)}">${title || esc(c.code || '')}</a>`
    : `<span title="${fullTitleAttr(c)}">${title || esc(c.code || '')}</span>`;
  const ml = gradeCell(c, 'mylab');
  const bb = gradeCell(c, 'bb');
  const gcell = (key, label, g) => `<div class="cc-g cc-g-${key}"><span class="cc-gl">${label}</span><span class="cc-gv">${g.html}</span>${g.st ? `<span class="cc-gs">${g.st}</span>` : ''}</div>`;
  const grades = open
    ? `${gcell('pe', 'MyLab', ml)}${gcell('bb', 'Blackboard', bb)}`
    : '<div class="cc-g cc-g-pe"></div><div class="cc-g cc-g-bb"></div>';
  return `
    <div class="course-card ${open ? 'is-open' : 'is-locked'}" style="--stripe:${safeColor(c.color)}">
      <div class="cc-main">
        ${codeEyebrow(c)}
        <h3 class="cc-title">${name}</h3>
        <div class="cc-meta">${status}${instructorHtml(c)}${pe}</div>
        ${lockedMsg}
      </div>
      ${open ? `<div class="cc-next"><span class="cc-gl">Next due</span><div class="cc-next-v">${next}</div></div>` : '<div class="cc-next cc-next-empty"></div>'}
      ${grades}
      <button class="fav ${fav ? 'on' : ''}" data-fav="${esc(c.id)}" aria-label="${fav ? 'Remove' : 'Add'} ${esc(courseLabel(c))} ${fav ? 'from' : 'to'} favorites" title="${fav ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${fav}">${icon('star', 18)}</button>
    </div>`;
}

// ---------------------------------------------------------------- COURSE PAGE

export const TABS = ['Content', 'Gradebook', 'Calendar'];
const EXT_TABS = ['Announcements', 'Discussions', 'Messages', 'Groups'];
const ACTIONS = [
  { label: 'Roster', subtitle: 'Everyone in your course', path: 'outline' },
  { label: 'Attendance', subtitle: 'Your attendance record', path: 'outline' },
  { label: 'Books & Tools', subtitle: 'Course & institution tools', path: 'outline' },
  { label: 'Launch Class', subtitle: 'Class Collaborate', path: 'outline' },
];
const actionIcon = (label) =>
  /roster/i.test(label) ? 'roster' : /attend/i.test(label) ? 'attendance' : /book|tool/i.test(label) ? 'books' : /class|launch/i.test(label) ? 'video' : 'info';

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function coursePage(data, course, tabSlug) {
  if (!course) {
    return `${pageHead('Course not found', '', '', { pill: false })}${statePanel('notsynced', 'This course is not in the synced data', 'Return to Courses and pick a course from the list.')}<p class="after-panel"><a class="btn" href="#/courses">Back to Courses</a></p>`;
  }
  if (!isOpen(course)) {
    return `${pageHead(courseLabel(course), '', codeEyebrow(course))}
      <div class="card locked-page"><span class="sp-icon">${icon('lock', 18)}</span><div><h2>This course isn't open yet</h2>
      <p>${esc(course.note || 'Course content has not been synced from Blackboard.')}</p>
      <div class="actions-row"><a class="btn" href="#/courses">Back to Courses</a> ${extLink(course.home, 'Open in Blackboard', 'btn-sec')}</div></div></div>`;
  }
  const allTabs = [...TABS, ...EXT_TABS];
  const active = allTabs.find((t) => slug(t) === tabSlug) || TABS[0];
  const base = `#/course/${encodeURIComponent(course.id)}`;
  const tabBar = TABS.map((t) => `<a class="tab ${t === active ? 'active' : ''}" href="${base}/${slug(t)}"${t === active ? ' aria-current="page"' : ''}>${esc(t)}</a>`).join('')
    + '<span class="tab-sep" aria-hidden="true"></span>'
    + EXT_TABS.map((t) => `<a class="tab tab-ext" href="${esc(courseUrl(course, TAB_PATHS[t]))}" target="_blank" rel="noopener" title="${esc(t)} — opens in Blackboard">${esc(t)}${icon('external', 12)}<span class="sr-only"> (opens in Blackboard)</span></a>`).join('');

  let body;
  switch (active) {
    case 'Content': body = contentTab(course); break;
    case 'Gradebook': body = gradebookTab(course); break;
    case 'Calendar': body = courseCalendarTab(course); break;
    default: body = genericTab(course, active);
  }
  const statusChip = course.status === 'Open' ? '<span class="status open"><i class="dot" aria-hidden="true"></i>Open</span>' : '';
  const t = shortTitle(course);
  return `
    <div class="course-page" style="--course:${safeColor(course.color, '#9D2235')}">
      <div class="course-topbar">
        <nav class="crumbs" aria-label="Breadcrumb"><a class="crumb-back" href="#/courses" aria-label="Back to Courses">${icon('chevronLeft', 18)}</a><a href="#/courses">Courses</a><span class="crumb-sep" aria-hidden="true">/</span><span aria-current="page">${esc(course.code || t || 'Course')}</span></nav>
        ${statusChip}
        <span class="spacer"></span>
        <span class="fresh-slot"></span>
        ${searchBtn()}
      </div>
      <div class="course-wrap">
        <div class="hero">
          <div class="hero-text">
            ${course.code ? `<div class="hero-code" title="${esc(course.bbId || '')}">${esc(course.code)}${course.termName ? ` · ${esc(course.termName)}` : ''}</div>` : ''}
            <h1 class="hero-title" tabindex="-1" title="${fullTitleAttr(course)}">${t ? esc(t) : esc(course.code || 'Course')}</h1>
          </div>
          <a class="hero-btn" href="${esc(courseUrl(course, TAB_PATHS[active] || 'outline'))}" target="_blank" rel="noopener"><span><span class="hide-phone">Open in </span>Blackboard</span>${icon('external', 13)}</a>
        </div>
        <div class="tabwrap"><nav class="tabbar" aria-label="Course sections">${tabBar}</nav><button type="button" class="tab-more" hidden aria-label="Scroll to more course tabs" title="More tabs">${icon('chevronRight', 16)}</button></div>
        <div class="course-inner">${body}</div>
      </div>
    </div>`;
}

function contentTab(course) {
  const sec = sectionOf(course, 'content');
  const items = Array.isArray(course.content) ? course.content : null;
  const noProgress = items && items.length && items.every((i) => !i.progress);
  const st = items ? stamp(sec.source || course.source, sec.syncedAt, { stale: sec.stale, notes: [noProgress ? "Progress isn't exposed by the Blackboard API, so no progress rings are shown." : '', "Items aren't links: Blackboard's API doesn't return their addresses. Open the course in Blackboard to use them."] }) : '';
  if (!items) {
    // Nothing to list: the main column carries the state + this course's due dates.
    return `
      <div class="course-cols no-content">
        <section class="col-main">
          ${sectionPanel(sec, 'Course content', { href: courseUrl(course), label: 'Open course in Blackboard' })}
          ${courseDueBlock(course)}
        </section>
        <aside class="col-side">${facultyPanel(course)}${actionsPanel(course)}</aside>
      </div>`;
  }
  const list = items.length
    ? `<div class="card list-card">${items.map(contentItem).join('')}</div>`
    : statePanel('empty', 'Blackboard returned no top-level content items', 'The course outline may be empty or hidden from students.');
  return `
    <div class="course-cols">
      <aside class="col-due" aria-label="Due in this course">${dueSoonPanel(course)}</aside>
      <section class="col-main">
        ${secHead(`Course content${items.length ? ` <span class="count">${items.length}</span>` : ''}`, st)}
        ${list}
      </section>
      <aside class="col-side">${facultyPanel(course)}${actionsPanel(course)}</aside>
    </div>`;
}

function progressCircle(p) {
  if (p === 'complete') return '<span class="prog prog-complete" title="Complete">' + icon('checkCircle', 20) + '<span class="sr-only">Complete</span></span>';
  if (p === 'started') return '<span class="prog prog-started" title="Started">' + icon('halfdot', 20) + '<span class="sr-only">Started</span></span>';
  if (p === 'none') return '<span class="prog prog-none" title="Not started">' + icon('generic', 20) + '<span class="sr-only">Not started</span></span>';
  return '';
}
function segBar(text) {
  const pr = parseProgress(text);
  if (!pr) return '';
  const filled = pr.ratio >= 1 ? 3 : pr.ratio > 0 ? Math.max(1, Math.floor(pr.ratio * 3)) : 0;
  const cls = pr.kind.startsWith('complet') ? 'seg-complete' : 'seg-started';
  return `<span class="segbar ${cls}" aria-hidden="true">${[0, 1, 2].map((i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('')}</span>`;
}

const TYPE_LABEL = { document: 'Document', link: 'Link', folder: 'Folder', module: 'Learning module', generic: 'Item' };
function contentItem(item) {
  if (!isVerified(item)) {
    return `<div class="content-item"><span class="ci-icon">${icon('generic')}</span><div class="ci-text">${chip('notsynced', 'Item not synced from Blackboard')}</div></div>`;
  }
  const type = ['document', 'link', 'folder', 'module'].includes(item.type) ? item.type : 'generic';
  const meta = item.progressText
    ? `<div class="ci-progress">${type === 'module' ? segBar(item.progressText) : ''}<span>${esc(item.progressText)}</span></div>` : '';
  return `
    <div class="content-item">
      <span class="ci-icon ci-${type}" title="${esc(TYPE_LABEL[type])}" aria-hidden="true">${icon(type, 18)}</span>
      <div class="ci-text">
        <div class="ci-title"><span class="sr-only">${esc(TYPE_LABEL[type])}: </span>${esc(item.title)}</div>
        ${item.desc ? `<div class="ci-desc">${esc(item.desc)}</div>` : ''}
        ${meta}
      </div>
      ${progressCircle(item.progress)}
    </div>`;
}

/** "Due in this course" (side card): the next 3 upcoming (status due) items. */
function dueSoonPanel(course) {
  const sec = sectionOf(course, 'upcoming');
  const up = verifiedUpcoming(course);
  const next = up.filter((u) => u.status === 'due' && !isMaybePast(u)).sort(byDue).slice(0, 3);
  const overdue = up.filter((u) => u.status === 'overdue').length;
  const maybe = up.filter(isMaybePast).length;
  let body;
  if (next.length) body = `<div class="mini-due">${next.map((u) => miniDue(u)).join('')}</div>`;
  else if (Array.isArray(course.upcoming) && sec.state === 'ok') body = '<p class="muted small empty-line">Nothing upcoming in Blackboard for this course.</p>';
  else body = inlineState(kindOf(sec.state), 'Due dates not synced', stateReason(sec.state));
  const calHref = `#/course/${encodeURIComponent(course.id)}/calendar`;
  const od = (overdue ? `<p class="od-line" title="${PAST_DUE_FULL}">${icon('alert', 14)}${overdue} past due · <a class="text-link" href="${calHref}">see all</a></p>` : '')
    + (maybe ? `<p class="od-line is-maybe" title="${esc(maybePastFull())}">${icon('clock', 14)}<span>${maybe} ${esc(maybePastLabel().replace(/^Past due/, maybe === 1 ? 'item past due' : 'items past due'))}</span></p>` : '');
  return `<div class="card side-card">
    ${secHead('Due in this course', Array.isArray(course.upcoming) ? `${stamp(sec.source || 'blackboard-api', sec.syncedAt, { stale: sec.stale })}` : '', 'h3')}
    ${od}${body}
    <a class="side-more" href="#/course/${encodeURIComponent(course.id)}/calendar">All dates${icon('arrowRight', 14)}</a>
  </div>`;
}
function miniDue(u) {
  const d = parseDate(u.due);
  return `<div class="mini-row">
    ${dateChip(d)}
    <div class="mini-text"><div class="mini-title">${esc(u.title)}</div><div class="mini-when">${d ? `<strong>${esc(fmtRelDay(d))}</strong> · ${esc(fmtDueFull(d))}` : 'Due date not synced'}</div></div>
  </div>`;
}

/**
 * The one date component (Today rows, agenda day rail, course side card, month day panel):
 * month / day numeral / weekday, all CT. tone: '' | 'is-today' | 'is-overdue' | 'is-maybe'.
 */
export function dateChip(d, tone = null) {
  if (!d) return `<div class="dchip is-none" aria-hidden="true">${icon('ring', 16)}</div>`;
  const t = tone != null ? tone : dayDiff(d) === 0 ? 'is-today' : '';
  return `<div class="dchip ${t}" aria-hidden="true"><span class="dc-m">${esc(fmtMonth(d))}</span><strong class="dc-d">${esc(fmtDay(d))}</strong><span class="dc-w">${esc(fmtWeekday(d))}</span></div>`;
}
/** Full due list for a course whose content can't be shown (fills the main column). */
function courseDueBlock(course) {
  const sec = sectionOf(course, 'upcoming');
  const up = verifiedUpcoming(course);
  const st = Array.isArray(course.upcoming) ? `${stamp(sec.source || 'blackboard-api', sec.syncedAt, { stale: sec.stale })}` : '';
  let body;
  if (up.length) body = agendaHtml(up.map((u) => ({ u, c: course })), { showCourse: false, upcomingFirst: true });
  else if (Array.isArray(course.upcoming) && sec.state === 'ok') body = '<p class="empty-line">Nothing due in Blackboard for this course.</p>';
  else body = sectionPanel(sec, 'Due dates', null);
  return `<div class="due-block">${secHead('Due in this course', st)}${body}</div>`;
}

function facultyPanel(course) {
  const sec = sectionOf(course, 'faculty');
  const all = Array.isArray(course.faculty) ? course.faculty : null;
  let rows;
  let st = '';
  if (all && all.length) {
    rows = all.map((f) => isVerified(f)
      ? `<div class="fac-row"><span class="avatar sm" aria-hidden="true">${esc(initials(f.name))}</span><div class="fac-name">${esc(f.name)}<span class="pill-role">${esc(f.role || 'Instructor')}</span></div><a class="icon-btn" href="${esc(courseUrl(course, 'messages'))}" target="_blank" rel="noopener" title="Message in Blackboard" aria-label="Message ${esc(f.name)} in Blackboard">${icon('messages', 18)}</a></div>`
      : `<div class="fac-row">${chip('notsynced', 'Faculty member not synced')}</div>`).join('');
    if (course.facultyUnnamed > 0) rows += `<div class="fac-row muted small">${course.facultyUnnamed} more instructor${course.facultyUnnamed === 1 ? '' : 's'} listed, but Blackboard returned no name.</div>`;
    st = stamp(all[0].source || sec.source, sec.syncedAt || course.syncedAt, { stale: sec.stale });
  } else if (all && course.facultyUnnamed > 0) {
    rows = inlineState('notsynced', 'Instructor name not returned', `Blackboard listed ${course.facultyUnnamed} instructor${course.facultyUnnamed === 1 ? '' : 's'} for this course but did not return a name.`);
    st = stamp(sec.source || course.source, sec.syncedAt || course.syncedAt, { stale: sec.stale });
  } else if (all && sec.state === 'ok') {
    rows = '<p class="muted small empty-line">Blackboard listed no instructors for this course.</p>';
    st = stamp(sec.source || course.source, sec.syncedAt || course.syncedAt, { stale: sec.stale });
  } else {
    const k = kindOf(sec.state);
    rows = k === 'forbidden'
      ? inlineState('forbidden', "Faculty list isn't shared with student accounts", 'It may still be visible in Blackboard itself.')
      : inlineState(k, k === 'error' ? "Faculty couldn't be read" : 'Instructor not yet synced', stateReason(sec.state));
    if (sec.syncedAt && k !== 'notsynced') st = stamp(sec.source || course.source, sec.syncedAt, { notes: ['Time the restriction was checked.'] });
  }
  return `<div class="card side-card">${secHead('Course faculty', st, 'h3')}${rows}</div>`;
}

function actionsPanel(course) {
  const rows = ACTIONS.map((a) => `
    <a class="action-row" href="${esc(courseUrl(course, a.path))}" target="_blank" rel="noopener" title="Opens in Blackboard">
      <span class="action-icon">${icon(actionIcon(a.label), 18)}</span>
      <div class="action-text"><div class="action-label">${esc(a.label)}</div><div class="action-sub">${esc(a.subtitle)}</div></div>
      <span class="action-go" aria-hidden="true">${icon('external', 14)}</span>
    </a>`).join('');
  return `<div class="card side-card">${secHead('In Blackboard', '', 'h3', 'Standard Blackboard actions — these open the course in Blackboard.')}${rows}</div>`;
}

// ---------------------------------------------------------------- GRADES (lanes)

function gradeLanes(c) {
  const lanes = [];
  const p = c.pearson;
  if (p && isVerified(p)) {
    const missing = Array.isArray(p.parseMissing) ? p.parseMissing : [];
    const peSys = TRUST.pe.state === 'parse-partial' ? 'partial' : null;
    lanes.push({
      key: 'mylab', label: 'MyLab',
      value: p.currentGrade || null,
      sub: p.overallPoints || null,
      text: p.currentGrade ? null : (missing.includes('overall') ? "Overall score couldn't be read" : 'Overall score not synced'),
      kind: p.currentGrade ? (peSys || 'ok') : (missing.includes('overall') ? 'partial' : 'notsynced'),
      stampHtml: stamp('pearson', p.syncedAt, { dotOnly: true, notes: [p.matchedBy ? `Matched to this course by ${p.matchedBy}.` : ''] }),
    });
  }
  const gb = c.gradebook;
  const sec = sectionOf(c, 'gradebook');
  if (gb && isVerified(gb)) {
    const st = stamp(gb.source, gb.syncedAt, { stale: sec.stale, dotOnly: true });
    if (gb.empty) lanes.push({ key: 'bb', label: 'Blackboard', value: null, text: 'No grades posted', kind: 'empty', stampHtml: st });
    else if (gb.currentGrade) lanes.push({ key: 'bb', label: 'Blackboard', value: gb.currentGrade, sub: gb.overallColumn || null, kind: sec.state === 'partial' ? 'partial' : 'ok', stampHtml: st });
    else lanes.push({ key: 'bb', label: 'Blackboard', value: null, text: gb.overallAmbiguous ? 'Overall not picked (several total columns)' : 'No overall grade shown', kind: 'empty', stampHtml: st });
  } else {
    const kind = kindOf(sec.state);
    lanes.push({ key: 'bb', label: 'Blackboard', value: null, text: kind === 'forbidden' ? 'Not shared with student accounts' : kind === 'error' ? "Couldn't be read" : kind === 'expired' ? 'Sign-in expired' : 'Not synced yet', kind, stampHtml: '' });
  }
  return lanes.sort((a, b) => (b.value ? 1 : 0) - (a.value ? 1 : 0));
}
/** Both systems report an overall grade for this course (only then is "never combined" worth saying). */
export const hasBothSources = (c) => !!(c.pearson && isVerified(c.pearson) && c.pearson.currentGrade && c.gradebook && isVerified(c.gradebook) && c.gradebook.currentGrade);

export function gradeFigure(value, size = 'lg') {
  const p = gradePercent(value);
  const bar = p != null ? `<span class="gbar" aria-hidden="true" title="${esc(BAND_LEGEND)}"><i style="width:${Math.max(0, Math.min(100, p)).toFixed(1)}%"></i></span>` : '';
  return `<span class="gfig-wrap ${gradeClass(value)}"><span class="gfig gfig-${size}">${esc(value)}</span>${bar}</span>`;
}

function laneHtml(l, { big = false } = {}) {
  const head = `<div class="lane-head"><span class="lane-label">${esc(l.label)}</span><span class="lane-meta">${l.kind === 'partial' ? chip('partial', 'Partly read', TRUST.pe.message || '') : ''}${l.stampHtml || ''}</span></div>`;
  const body = l.value
    ? `<div class="lane-val">${gradeFigure(l.value, big ? 'lg' : 'md')}</div>${l.sub ? `<div class="lane-sub">${esc(l.sub)}</div>` : ''}`
    : `<div class="lane-empty">${l.kind === 'empty' ? `<span class="muted">${esc(l.text)}</span>` : chip(l.kind, l.text)}</div>`;
  return `<div class="lane lane-${l.key}${l.value ? ' has-value' : ''}">${head}${body}</div>`;
}
export function lanesHtml(c, opts = {}) {
  const lanes = gradeLanes(c);
  const n = lanes.length + (opts.extra ? 1 : 0);
  return `<div class="lanes lanes-${n}">${lanes.map((l) => laneHtml(l, { big: opts.big !== false })).join('')}${opts.extra || ''}</div>`;
}

// Raw Blackboard grade status enums -> words.
const GRADE_STATUS = { NeedsGrading: 'Awaiting grading', Graded: 'Graded', InProgress: 'In progress', Exempt: 'Exempt', NotAttempted: 'Not attempted', Completed: 'Completed' };
export const gradeStatusText = (s) => GRADE_STATUS[s] || String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (x) => x.toUpperCase());
export const sortedGbItems = (gb) => [...(Array.isArray(gb.items) ? gb.items : [])].sort(byDue);

/** Blackboard gradebook item table (stacks into row cards on phone). */
export function bbItemsTable(gb) {
  const items = sortedGbItems(gb);
  if (!items.length) return '';
  const rows = items.map((it) => {
    const d = parseDate(it.due);
    return `<tr><th scope="row" class="cell-title">${esc(it.title)}</th><td class="cell-kv nowrap nolabel" data-label="Due">${d ? `<span title="${esc(fmtDateTime(d))}">${esc(fmtDueFull(d))}</span>` : '<span class="muted">No due date</span>'}</td><td class="cell-kv nolabel cell-status" data-label="Status">${itemStatus(it)}</td><td class="num cell-key" data-label="Grade">${pillGrade(it)}</td></tr>`;
  }).join('');
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="Blackboard gradebook items"><table class="data-table stack-table bb-items"><thead><tr><th scope="col">Item</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col" class="num">Grade</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
/** Grade pill tinted by grade band (legend shown once per page). */
export function pillGrade(it) {
  if (it.grade) return `<span class="pill-grade ${gradeClass(it.grade)}" title="${esc(BAND_LEGEND)}">${esc(it.grade)}</span>`;
  return it.possible != null ? `<span class="muted">— / ${esc(it.possible)}</span>` : '<span class="muted">—</span>';
}
/** Visible Blackboard grade status for an item ("Graded", "Awaiting grading", …); '—' when Blackboard returned none. */
export function itemStatus(it) {
  if (!it.status) return '<span class="muted" title="Blackboard returned no grade record for this item">—</span>';
  const tone = it.status === 'Graded' || it.status === 'Completed' ? 'is-ok' : it.status === 'NeedsGrading' || it.status === 'InProgress' ? 'is-warn' : '';
  return `<span class="item-st ${tone}">${esc(gradeStatusText(it.status))}</span>`;
}
/** Counts of Blackboard items by state (only what the gradebook returned). */
function itemSummary(gb) {
  const items = Array.isArray(gb.items) ? gb.items : [];
  if (!items.length) return '';
  const graded = items.filter((i) => i.grade).length;
  const waiting = items.filter((i) => !i.grade && (i.status === 'NeedsGrading' || i.status === 'InProgress')).length;
  const none = items.length - graded - waiting;
  const row = (n, t, cls = '') => `<li class="${cls}"><b>${n}</b><span>${t}</span></li>`;
  return `<div class="lane lane-sum"><div class="lane-head"><span class="lane-label">Blackboard items</span><span class="lane-meta">${stamp(gb.source, gb.syncedAt, { dotOnly: true })}</span></div>
    <ul class="sum-list">${row(graded, 'graded')}${waiting ? row(waiting, 'awaiting grading', 'is-warn') : ''}${row(none, 'no grade yet', 'is-muted')}</ul></div>`;
}

function bbGradebookBlock(course) {
  const gb = course.gradebook;
  const sec = sectionOf(course, 'gradebook');
  if (!gb || !isVerified(gb)) {
    return sectionPanel(sec, 'Blackboard gradebook', { href: courseUrl(course, 'grades'), label: 'Open gradebook in Blackboard' });
  }
  if (gb.empty) {
    const where = course.pearson ? ' Grades for this course live in MyLab (above).' : '';
    return `<p class="muted empty-line">Blackboard returned an empty gradebook for this course.${esc(where)}</p>`;
  }
  const itemsNote = gb.itemsSynced === false ? chip('partial', 'Your individual grades were not returned by Blackboard') : '';
  const label = gb.overallColumn ? `<p class="muted small block-note">Overall column: ${esc(gb.overallColumn)} · items sorted by due date, undated last</p>` : '';
  return `${label}${bbItemsTable(gb)}${itemsNote}`;
}

const fmtPct = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${n}%` : null);

function pearsonItemsTable(items) {
  const dash = '<span class="muted">—</span>';
  const cell = (v) => (v ? esc(v) : dash);
  const correctCell = (it) => {
    if (!it.correctTotal) return dash;
    const star = it.asterisk ? '<sup class="star" title="Late submission, as marked by MyLab">*</sup><span class="sr-only"> (late submission, as marked by MyLab)</span>' : '';
    return `${esc(it.correctTotal)}${star}`;
  };
  const scoreCell = (it) => {
    if (it.status === 'incomplete') return '<span class="tag-incomplete">Incomplete</span>';
    const pct = fmtPct(it.scorePercent);
    const tag = it.status === 'omitted' ? ' <span class="tag-omitted" title="Omitted on Pearson — does not count toward the grade">omitted</span>' : '';
    return `${pct ? esc(pct) : dash}${tag}`;
  };
  const dates = (it) => {
    const parts = [it.dateStarted ? `Started ${esc(it.dateStarted)}` : '', it.dateWorked ? `Worked ${esc(it.dateWorked)}` : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : '<span class="muted">Not started</span>';
  };
  const rows = items.map((it) => `<tr class="${it.status === 'omitted' ? 'row-omitted' : ''}">
      <th scope="row" class="cell-title">${esc(it.title)}</th><td class="cell-kv" data-label="Category">${cell(it.category)}</td><td class="num cell-kv" data-label="Correct">${correctCell(it)}</td><td class="num cell-key" data-label="Score">${scoreCell(it)}</td>
      <td class="nowrap cell-kv" data-label="Time">${cell(it.timeSpent)}</td><td class="nowrap cell-kv wide-only" data-label="Started">${cell(it.dateStarted)}</td><td class="nowrap cell-kv wide-only" data-label="Worked">${cell(it.dateWorked)}</td><td class="cell-kv phone-only cell-span nolabel">${dates(it)}</td></tr>`).join('');
  const foot = items.some((it) => it.asterisk) ? '<p class="footnote"><span aria-hidden="true">*</span> Late submission, as marked by MyLab.</p>' : '';
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="MyLab assignments"><table class="data-table pearson-items stack-table"><thead><tr><th scope="col">Assignment</th><th scope="col">Category</th><th scope="col" class="num">Correct/Total</th><th scope="col" class="num">Score</th><th scope="col">Time spent</th><th scope="col">Date started</th><th scope="col">Date worked</th></tr></thead><tbody>${rows}</tbody></table></div>${foot}`;
}

/**
 * When the latest MyLab read was partial, say when this part was read: "From earlier read · Oct 3"
 * for a part carried forward (staleParts), otherwise the record's own read time.
 */
export function partCaption(p, part, label) {
  const sp = Array.isArray(p.staleParts) ? p.staleParts.find((x) => x.part === part) : null;
  if (sp) {
    const d = parseDate(sp.syncedAt);
    return `<p class="part-cap is-stale" title="${esc(`The latest MyLab page didn't show the ${label.toLowerCase()}, so this is the copy read ${d ? fmtDateTime(d) : 'earlier (time unknown)'}.`)}">${icon('clock', 12)}<span>${esc(label)} · From earlier read · ${d ? esc(fmtMonthDay(d)) : 'time unknown'}</span></p>`;
  }
  if (TRUST.pe.state !== 'parse-partial') return '';
  const d = parseDate(p.syncedAt);
  return `<p class="part-cap" title="${d ? esc(fmtDateTime(d)) : ''}">${icon('clock', 12)}<span>${esc(label)} · Read ${d ? esc(fmtWhen(d)) : 'time unknown'}</span></p>`;
}

export function categoryTable(p) {
  const cats = Array.isArray(p.categories) ? p.categories : [];
  const dash = '<span class="muted">—</span>';
  if (cats.length) {
    const row = (c, tag = 'tr') => `<${tag === 'tr' ? 'tr' : 'tr class="row-total"'}><th scope="row" class="cell-title">${esc(c.name)}</th><td class="num cell-key" data-label="Average">${c.average ? esc(c.average) : dash}</td><td class="num cell-kv nolabel" data-label="Points earned">${c.earned ? esc(c.earned) : dash}${c.weight ? ` <span class="muted small">of ${esc(c.weight)}</span>` : ''}</td></tr>`;
    return `${partCaption(p, 'categories', 'Category table')}<div class="table-scroll breakdown-wrap"><table class="data-table breakdown stack-table"><thead><tr><th scope="col">Category</th><th scope="col" class="num">Average</th><th scope="col" class="num">Points earned</th></tr></thead><tbody>${cats.map((c) => row(c)).join('')}</tbody>${p.categoryTotal ? `<tfoot>${row({ ...p.categoryTotal, name: p.categoryTotal.name || 'Total' }, 'total')}</tfoot>` : ''}</table></div>`;
  }
  if (p.breakdown && typeof p.breakdown === 'object' && Object.keys(p.breakdown).length) {
    return `<table class="data-table breakdown"><tbody>${Object.entries(p.breakdown).map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td class="num">${esc(v)}</td></tr>`).join('')}</tbody></table>`;
  }
  return '';
}

export const matchedLine = (p) => (p && p.matchedBy ? `<p class="matched-line">${icon('link', 13)}<span>Matched by ${esc(p.matchedBy)}</span></p>` : '');

const PEARSON_PART = { overall: 'Overall score', categories: 'Category breakdown', items: 'Assignment list' };
export function pearsonBlock(p, { compact = false } = {}) {
  if (!p || !isVerified(p)) return '';
  const missing = Array.isArray(p.parseMissing) ? p.parseMissing : [];
  const provider = `<div class="gb-provider">${esc(p.provider || 'Pearson MyLab')}${p.pearsonCourseTitle ? ` · ${esc(p.pearsonCourseTitle)}` : ''}</div>`;
  const bd = categoryTable(p);
  const allItems = Array.isArray(p.items) ? p.items : [];
  const legacyItems = allItems.length > 0 && p.itemsSchema !== PEARSON_ITEMS_SCHEMA;
  const items = legacyItems ? [] : allItems;
  const table = !compact && items.length ? `<h4 class="sub-head">Assignments <span class="count">${items.length}</span></h4>${partCaption(p, 'items', 'Assignment list')}${pearsonItemsTable(items)}` : '';
  const notes = [];
  if (legacyItems) notes.push(chip('partial', 'Assignment list was cached by an older version that misread its columns — open the Pearson Results page again to re-sync it'));
  else if (!items.length) notes.push(missing.includes('items') ? chip('partial', "Assignment list couldn't be read from the Pearson page") : chip('notsynced', 'Individual MyLab items not found on the synced page'));
  else if (compact) notes.push(`<p class="muted small">${items.length} MyLab item${items.length === 1 ? '' : 's'} synced</p>`);
  missing.filter((k) => k !== 'items' && k !== 'overall').forEach((k) => notes.push(chip('partial', `${PEARSON_PART[k] || k} couldn't be read from the Pearson page`)));
  const stale = Array.isArray(p.staleParts) && p.staleParts.some((x) => x.part === 'overall')
    ? chip('stale', "Overall score: from an earlier read (the latest page didn't show it)") : '';
  const link = extLink(p.pageUrl || 'https://mylab.pearson.com/', 'Open in Pearson MyLab', 'btn-sec');
  return `${provider}${matchedLine(p)}${pePartialNote()}${bd}${table}<div class="note-stack">${notes.join('')}${stale}</div><div class="actions-row">${link}</div>`;
}

function gradebookTab(course) {
  const pe = course.pearson && isVerified(course.pearson)
    ? `<section class="card gb-card">${secHead('MyLab', stamp('pearson', course.pearson.syncedAt, { notes: [course.pearson.matchedBy ? `Matched to this course by ${course.pearson.matchedBy}.` : ''] }))}${pearsonBlock(course.pearson)}</section>` : '';
  const gb = course.gradebook;
  const sec = sectionOf(course, 'gradebook');
  const bbStamp = gb && isVerified(gb) ? stamp(gb.source, gb.syncedAt, { stale: sec.stale }) : '';
  const both = !!(course.pearson && isVerified(course.pearson));
  const sum = gb && isVerified(gb) && !gb.empty ? itemSummary(gb) : '';
  return `<div class="tab-panel">
    <section class="card lane-card" aria-label="Overall grades">${secHead('Overall', both ? '<span class="side-note">Shown side by side; never combined</span>' : '')}${lanesHtml(course, { extra: sum })}<div class="card-foot">${bandLegend()}</div></section>
    ${pe}
    <section class="card gb-card">${secHead('Blackboard gradebook', bbStamp)}${bbGradebookBlock(course)}</section>
  </div>`;
}

function courseCalendarTab(course) {
  const up = verifiedUpcoming(course);
  const sec = sectionOf(course, 'upcoming');
  let body;
  if (up.length) body = agendaHtml(up.map((u) => ({ u, c: course })), { showCourse: false, upcomingFirst: true, split: true, recentDays: 30 });
  else if (Array.isArray(course.upcoming) && sec.state === 'ok') body = statePanel('empty', 'No due dates found in Blackboard for this course', 'MyLab-hosted assignments only show here if Blackboard has a gradebook due date for them.');
  else body = sectionPanel(sec, 'Course calendar', { href: courseUrl(course), label: 'Open course in Blackboard' });
  const st = Array.isArray(course.upcoming) ? `${stamp('blackboard-api', sec.syncedAt, { stale: sec.stale, notes: [DUE_NOTE] })}` : '';
  return `<div class="tab-panel tab-cal">${secHead('Due dates', st, 'h2', 'Upcoming first; past items keep the status Blackboard reported.')}${body}</div>`;
}

function genericTab(course, name) {
  return `<div class="tab-panel">${statePanel('elsewhere', `${name} live in Blackboard`, 'This dashboard does not pull this tab.', { href: courseUrl(course, TAB_PATHS[name] || 'outline'), label: `Open ${name} in Blackboard` })}</div>`;
}

// ---------------------------------------------------------------- DUE ROWS

export const PAST_DUE_FULL = 'Past due · no submission recorded in Blackboard';
export function dueBadge(u) {
  if (isMaybePast(u)) return `<span class="due-badge is-maybe" title="${esc(maybePastFull())}">${icon('clock', 12)}${esc(maybePastLabel())}</span>`;
  if (u.status === 'overdue') return `<span class="due-badge is-overdue" title="${PAST_DUE_FULL}">${icon('alert', 12)}Past due<span class="sr-only"> · no submission recorded in Blackboard</span></span>`;
  if (u.status === 'submitted') return `<span class="due-badge is-done" title="Blackboard has a grade or submission for this">${icon('check', 12)}Submitted / graded</span>`;
  if (u.status === 'past') return '<span class="due-badge" title="Due date passed; Blackboard returned no grade record either way">Due date passed</span>';
  return '';
}

/**
 * One due item. mode 'tile' = date tile + relative label (Today);
 * mode 'day' = time only (rendered under a day heading that carries the date).
 */
export function dueRow(u, course, { mode = 'tile', showCourse = true } = {}) {
  const d = parseDate(u.due);
  const overdue = u.status === 'overdue';
  const maybe = isMaybePast(u);
  const today = d && dayDiff(d) === 0;
  const tone = overdue ? 'is-overdue' : maybe ? 'is-maybe' : today ? 'is-today' : '';
  const chipHtml = mode === 'tile' ? dateChip(d, tone) : '';
  // Canonical due text: the full date + CT on the row (tile mode), or the time + CT under a day rail that carries the date.
  const when = !d ? '<span class="due-time">Due date not synced</span>'
    : mode === 'tile'
      ? `<span class="due-time" title="${esc(fmtDateTime(d))}">${esc(fmtDueFull(d))}</span>`
      : `<span class="due-time" title="${esc(fmtDueFull(d))}">${esc(fmtTimeCT(d))}</span>`;
  const courseChip = course && showCourse ? `<a class="due-course" href="#/course/${encodeURIComponent(course.id)}" title="${esc(courseLabel(course))}">${esc(course.code || shortTitle(course) || course.id)}</a>` : '';
  const kind = u.eventType ? `<span class="due-kind">${esc(u.eventType)}</span>` : '';
  const rel = mode === 'tile' && d ? `<span class="due-rel ${tone}">${esc(fmtRelDay(d))}</span>` : '';
  const badge = dueBadge(u);
  return `<div class="due-row ${overdue ? 'is-overdue' : ''} ${maybe ? 'is-maybe' : ''} ${u.status === 'submitted' ? 'is-done' : ''}" style="--stripe:${safeColor(course ? course.color : null, 'var(--line)')}">
    ${chipHtml}
    <div class="due-text">
      <div class="due-title">${esc(u.title)}</div>
      <div class="due-meta">${courseChip}${when}${kind}</div>
      ${badge ? `<div class="due-state">${badge}</div>` : ''}
    </div>
    ${rel}
  </div>`;
}

export function collectDueItems(data) {
  const current = (data.courses || []).filter((c) => c.current !== false && isOpen(c));
  const rows = [];
  const missing = [];
  let syncedAt = null;
  for (const c of current) {
    const up = verifiedUpcoming(c);
    const sec = sectionOf(c, 'upcoming');
    if (sec.syncedAt && (!syncedAt || sec.syncedAt > syncedAt)) syncedAt = sec.syncedAt;
    if (up.length) up.forEach((u) => rows.push({ u, c }));
    else if (sec.state !== 'ok') missing.push(c);
  }
  return { rows, missing, syncedAt };
}
export const dueTime = (r) => parseDate(r.u.due)?.getTime() ?? Infinity;
export const missingDueNote = (missing) => (missing.length
  ? `<p class="missing-line">${icon('ring', 14)}<span>Due dates not synced for</span> ${missing.map((c) => {
    const s = sectionOf(c, 'upcoming');
    return `<a class="due-course" href="#/course/${encodeURIComponent(c.id)}" title="${esc(`${courseLabel(c)} — ${stateReason(s.state)}`)}">${esc(c.code || shortTitle(c) || c.id)}</a>`;
  }).join(' ')}</p>` : '');
export const DUE_NOTE = '"Past due" means Blackboard recorded no submission for an item whose due date has passed. Times are Central Time. MyLab due dates are not read.';

// ---------------------------------------------------------------- DIAGNOSTICS (Tools)

const SYS_KIND = (s) => (!s || !s.state ? 'notsynced' : s.state === 'ok' ? 'ok' : kindOf(s.state));
const SYS_TEXT = (s) => {
  if (!s || !s.state) return 'Never synced';
  const map = { ok: 'OK', 'session-expired': 'Sign-in expired', error: 'Failed', partial: 'Partly read', 'parse-partial': 'Partly read', 'parse-failed': "Couldn't read page" };
  return map[s.state] || s.state;
};
const SEC_TEXT = { ok: 'OK', partial: 'Partly read', forbidden: 'Not shared', auth: 'Sign-in expired', 'not-found': 'Not available', 'not-fetched': 'Not synced', error: 'Failed', network: 'Failed', timeout: 'Failed', 'bad-json': 'Failed', 'bad-content-type': 'Failed' };

export function diagnosticsPage(data) {
  const st = data.status || {};
  const dash = '<span class="muted">—</span>';
  const sys = (name, key, link) => {
    const s = st[key] || {};
    const last = parseDate(s.lastSuccessAt);
    const at = parseDate(s.at);
    return `<tr><th scope="row" class="cell-title">${esc(name)}</th><td class="cell-key" data-label="State">${chip(SYS_KIND(s), SYS_TEXT(s))}</td>
      <td class="cell-kv cell-span" data-label="Last success">${last ? `<span class="full-ts">${esc(fmtFullAgo(last))}</span>` : dash}</td><td class="cell-kv${s.source ? '' : ' is-na'}" data-label="Source">${s.source ? esc(sourceLabel(s.source)) : dash}</td>
      <td class="cell-kv cell-span${at ? '' : ' is-na'}" data-label="Last attempt">${at ? `<span class="full-ts">${esc(fmtFullAgo(at))}</span>` : dash}</td><td class="small cell-kv cell-span${s.message ? '' : ' is-na'}" data-label="Message">${s.message ? esc(s.message) : dash}</td>
      <td class="cell-kv cell-open nolabel" data-label="Open"><a class="text-link nowrap" href="${link}" target="_blank" rel="noopener">Open<span class="sr-only"> ${esc(name)}</span>${icon('external', 12)}</a></td></tr>`;
  };
  const SECS = ['faculty', 'content', 'gradebook', 'upcoming'];
  const LABELS = { faculty: 'Faculty', content: 'Content', gradebook: 'Gradebook', upcoming: 'Due dates' };
  const srcs = [...new Set(data.courses.map((c) => c.source))];
  const oneSource = srcs.length === 1;
  const courseRows = data.courses.map((c) => {
    const secs = c.sections || {};
    const pastTerm = c.current === false;
    const cell = (k) => {
      const s = secs[k] || secs.details;
      if (!s) return dash;
      const t = parseDate(s.syncedAt);
      const tip = [t ? `Read ${fmtDateTime(t)}` : '', s.lastError ? `Last error: ${s.lastError}` : '', s.stale ? 'Stale: showing the earlier copy' : '', pastTerm && s.state === 'not-fetched' ? 'Course is from a past term; its details were not read.' : ''].filter(Boolean).join(' · ');
      return `${chip(s.state === 'ok' ? 'ok' : kindOf(s.state), SEC_TEXT[s.state] || s.state, tip)}${s.stale ? chip('stale', 'stale') : ''}`;
    };
    const times = Object.values(secs).map((s) => s && s.syncedAt).filter(Boolean).sort();
    const read = parseDate(times[times.length - 1]);
    return `<tr><th scope="row" class="cell-title"><span title="${esc(courseLabel(c))}">${esc(c.code || c.id)}</span>${pastTerm ? '<span class="item-status">Past term · details not read</span>' : ''}</th>${oneSource ? '' : `<td class="small cell-kv" data-label="Source">${esc(sourceLabel(c.source))}</td>`}${SECS.map((k) => `<td class="cell-kv" data-label="${LABELS[k]}">${cell(k)}</td>`).join('')}<td class="cell-kv" data-label="MyLab">${c.pearson ? chip('ok', 'Linked') : dash}</td><td class="nowrap cell-kv" data-label="Read">${read ? `<span title="${esc(fmtDateTime(read))}">${esc(fmtWhen(read))}</span>` : dash}</td></tr>`;
  }).join('');
  const current = data.courses.filter((c) => c.current !== false);
  const full = current.filter((c) => SECS.every((k) => (c.sections || {})[k] && c.sections[k].state === 'ok')).length;
  const restricted = current.filter((c) => SECS.some((k) => (c.sections || {})[k] && c.sections[k].state === 'forbidden')).map((c) => c.code || c.id);
  const unsynced = current.filter((c) => !(c.sections || {}).faculty && (c.sections || {}).details).map((c) => c.code || c.id);
  const summary = current.length
    ? `<p class="lede">${full} of ${current.length} current course${current.length === 1 ? '' : 's'} fully read${restricted.length ? ` · ${esc(restricted.join(', '))} restricted by Blackboard` : ''}${unsynced.length ? ` · ${esc(unsynced.join(', '))} not synced in detail` : ''}.</p>` : '';
  return `${pageHead('Diagnostics')}
    ${summary}
    <section class="card">
      ${secHead('Sync status')}
      <div class="table-scroll" tabindex="0" role="region" aria-label="Sync status"><table class="data-table diag stack-table"><thead><tr><th scope="col">System</th><th scope="col">State</th><th scope="col">Last success</th><th scope="col">Source</th><th scope="col">Last attempt</th><th scope="col">Message</th><th scope="col"><span class="sr-only">Link</span></th></tr></thead>
      <tbody>${sys('Blackboard', 'blackboard', `${BB}/ultra/course`)}${sys('Pearson MyLab', 'pearson', 'https://mylab.pearson.com/')}</tbody></table></div>
      <div class="actions-row"><button class="btn" data-action="sync">${icon('sync', 15)}Sync now (open tabs)</button> <button class="btn-sec" data-action="clear">Clear cached data</button><span class="sync-msg muted small" role="status"></span></div>
      <p class="muted small block-note">Sync only works through an open, signed-in Blackboard or Pearson tab. "Clear cached data" removes everything this extension stored on this computer; it does not touch Blackboard or Pearson.</p>
    </section>
    <section class="card">
      ${secHead('Per-course sections', '', 'h2', `${oneSource && srcs[0] ? `All read from ${esc(sourceLabel(srcs[0]))}. ` : ''}Read shows the latest read for each course; each state's tooltip has its own read time. Times are Central (CT).`)}
      ${data.courses.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Per-course sections"><table class="data-table diag stack-table diag-courses"><thead><tr><th scope="col">Course</th>${oneSource ? '' : '<th scope="col">Source</th>'}<th scope="col">Faculty</th><th scope="col">Content</th><th scope="col">Gradebook</th><th scope="col">Due dates</th><th scope="col">MyLab</th><th scope="col">Read</th></tr></thead><tbody>${courseRows}</tbody></table></div>` : statePanel('notsynced', 'No courses synced yet')}
    </section>`;
}

// ---------------------------------------------------------------- STUBS

export function stubPage(title, { text, link, kind = 'elsewhere', heading } = {}) {
  const act = link ? `<a class="btn" href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.label)}${icon('external', 14)}</a>` : '';
  return `${pageHead(title, act, '', { pill: false })}${statePanel(kind, heading || 'This lives in Blackboard', text || 'This dashboard does not pull this page.', null)}`;
}

export function errorPage(err) {
  return `${pageHead('Could not render cached data', '', '', { pill: false })}
    <div class="card error-card">${icon('alert', 22)}<div>
      <p><strong>${esc(err && err.message ? err.message : String(err))}</strong></p>
      <p>The dashboard only renders data stored by the extension's content scripts. Try reloading this page, or open the Diagnostics page.</p>
    </div></div>`;
}
