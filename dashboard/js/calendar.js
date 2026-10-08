// calendar.js — the Calendar page (Agenda | Month | Recent) and the shared agenda list used by
// course Calendar tabs. Every item comes from synced Blackboard upcoming[] data only.
import { icon } from './icons.js';
import { BB, parseDate, fmtDayKey, fmtRelDay, fmtDayHeading, fmtDueFull } from './data.js';
import {
  esc, safeColor, pageHead, onboarding, collectDueItems, dueTime, dueRow, missingDueNote, statePanel, staleMark,
  provAdd, DUE_NOTE, dateChip, isMaybePast, maybePastLabel, PAST_DUE_FULL, courseLabel,
} from './views.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map((m) => m.slice(0, 3));
const DAY_MS = 864e5;
const keyOf = (r) => { const d = parseDate(r.u.due); return d ? fmtDayKey(d) : null; };

/** Day group: the date rail (shared date chip + relative day) beside that day's rows, which show time + CT only. */
function dayGroup(k, list, { showCourse, todayKey, tone = '' }) {
  const d = parseDate(list[0].u.due);
  const isToday = k === todayKey;
  const t = tone || (isToday ? 'is-today' : '');
  return `<div class="day-group ${t}">
    <div class="day-rail" title="${esc(fmtDayHeading(d))}">${dateChip(d, t)}<span class="day-rel">${esc(fmtRelDay(d))}</span><span class="sr-only">${esc(fmtDayHeading(d))}</span></div>
    <div class="card list-card due-list">${list.map((r) => dueRow(r.u, r.c, { mode: 'day', showCourse })).join('')}</div>
  </div>`;
}

/**
 * Agenda. Past due (Blackboard-confirmed, plus "status unknown" items when data is stale) → Upcoming →
 * Recently due (last `recentDays`, expanded, statuses visible) → Older (collapsed). Grouped by CT day.
 * opts: upcomingFirst (course tabs), split (two columns on wide screens: history on the right),
 *       recentDays, mode 'recent' (history only: Past due + Recently due + Older).
 */
export function agendaHtml(rows, { showCourse = true, upcomingFirst = false, split = false, recentDays = 14, mode = 'agenda' } = {}) {
  const now = new Date();
  const todayKey = fmtDayKey(now);
  const dated = rows.filter((r) => parseDate(r.u.due));
  const undated = rows.filter((r) => !parseDate(r.u.due));
  const group = (list) => {
    const g = new Map();
    for (const r of list) { const k = keyOf(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    return g;
  };
  const opts = { showCourse, todayKey };
  const pastDue = dated.filter((r) => r.u.status === 'overdue' || isMaybePast(r.u)).sort((a, b) => dueTime(b) - dueTime(a));
  const rest = dated.filter((r) => r.u.status !== 'overdue' && !isMaybePast(r.u));
  const upcoming = rest.filter((r) => keyOf(r) >= todayKey).sort((a, b) => dueTime(a) - dueTime(b));
  const earlier = rest.filter((r) => keyOf(r) < todayKey).sort((a, b) => dueTime(b) - dueTime(a));
  const cutoff = now.getTime() - recentDays * DAY_MS;
  const recent = earlier.filter((r) => dueTime(r) >= cutoff);
  const older = earlier.filter((r) => dueTime(r) < cutoff);
  const render = (list, past = false) => [...group(list)].map(([k, l]) => dayGroup(k, l, {
    ...opts, tone: !past ? '' : l.some((r) => r.u.status === 'overdue') ? 'is-overdue' : 'is-maybe',
  })).join('');
  const sm = staleMark();
  const maybeN = pastDue.filter((r) => isMaybePast(r.u)).length;

  const pdTone = pastDue.length && maybeN === pastDue.length ? 'is-maybe' : 'is-danger';
  const pd = pastDue.length
    ? `<section class="agenda-sec ${pdTone}"><h2 class="act-heading ${pdTone}" title="${PAST_DUE_FULL}">Past due <span class="count">${pastDue.length}</span>${sm}</h2>${maybeN ? `<p class="sec-note is-maybe">${icon('clock', 13)}<span>${maybeN} of these ${maybeN === 1 ? 'was' : 'were'} not yet due at the last sync, so ${maybeN === 1 ? 'its' : 'their'} status is unknown. Nothing is marked missing without a Blackboard record.</span></p>` : ''}${render(pastDue, true)}</section>` : '';
  const up = `<section class="agenda-sec"><h2 class="act-heading">Upcoming <span class="count">${upcoming.length}</span>${sm}</h2>${upcoming.length ? render(upcoming) : '<p class="empty-line">Nothing due from today on in synced data.</p>'}</section>`;
  const rc = !recent.length && !split && mode !== 'recent' ? '' : `<section class="agenda-sec is-recent"><h2 class="act-heading">Recently due <span class="count">${recent.length}</span><span class="act-sub">last ${recentDays} days</span>${sm}</h2>${recent.length ? render(recent) : `<p class="empty-line">Nothing else was due in the last ${recentDays} days.</p>`}</section>`;
  const ol = older.length
    ? `<details class="fold"><summary>${icon('chevronRight', 15)}Older than ${recentDays} days <span class="count">${older.length}</span>${sm}</summary>${render(older)}</details>` : '';
  const nd = undated.length
    ? `<section class="agenda-sec"><h2 class="act-heading">No due date <span class="count">${undated.length}</span></h2><div class="card list-card due-list">${undated.map((r) => dueRow(r.u, r.c, { mode: 'day', showCourse })).join('')}</div></section>` : '';

  if (mode === 'recent') {
    return `<div class="agenda agenda-wide">${pd}${rc}${ol}<p class="agenda-more"><a class="text-link" href="#/calendar">Upcoming in Agenda${icon('arrowRight', 14)}</a></p></div>`;
  }
  const main = (upcomingFirst ? up + pd : pd + up) + nd;
  const hist = rc + ol;
  return split
    ? `<div class="agenda agenda-split"><div class="ag-main">${main}</div><div class="ag-hist">${hist}</div></div>`
    : `<div class="agenda">${main}${hist}</div>`;
}

const segToggle = (mode) => {
  const a = (m, href, ic, label) => `<a href="${href}" ${mode === m ? 'aria-current="page" class="on"' : ''}>${icon(ic, 15)}${label}</a>`;
  return `<nav class="seg" aria-label="Calendar view">${a('agenda', '#/calendar', 'list', 'Agenda')}${a('month', '#/calendar/month', 'calendar', 'Month')}${a('recent', '#/calendar/recent', 'clock', 'Recent')}</nav>`;
};

/** Selected day in Month view (kept across re-renders; app.js updates it on click). */
let SELECTED = null;
export const selectDay = (k) => { SELECTED = k; };

/** parts: route parts after 'calendar' (['month', 'YYYY-MM'] or ['recent']). */
export function calendarPage(data, parts = []) {
  const mode = parts[0] === 'month' ? 'month' : parts[0] === 'recent' ? 'recent' : 'agenda';
  const bbLink = `<a class="btn-sec btn-compact" href="${BB}/ultra/calendar" target="_blank" rel="noopener"><span>Blackboard<span class="hide-phone"> calendar</span></span>${icon('external', 13)}</a>`;
  if (!data.courses.length) return `${pageHead('Calendar')}${onboarding(data)}`;
  const { rows, missing, syncedAt } = collectDueItems(data);
  if (syncedAt) provAdd('Due dates', 'blackboard-api', syncedAt, [DUE_NOTE]);
  const toolbar = `<div class="cal-toolbar">${segToggle(mode)}${bbLink}</div>`;
  if (!rows.length) {
    return `${pageHead('Calendar')}${toolbar}${statePanel('notsynced', 'No due dates synced yet', 'The calendar shows Blackboard due dates (gradebook columns and calendar items).', { href: `${BB}/ultra/calendar`, label: 'Open Calendar in Blackboard' })}${missingDueNote(missing)}`;
  }
  const body = mode === 'month' ? monthView(rows, parts[1])
    : mode === 'recent' ? agendaHtml(rows, { mode: 'recent' })
      : agendaHtml(rows, { split: true });
  return `${pageHead('Calendar')}${toolbar}${body}${missingDueNote(missing)}`;
}

function monthView(rows, ym) {
  const now = new Date();
  const todayKey = fmtDayKey(now);
  let [y, m] = todayKey.split('-').map(Number);
  const mm = /^(\d{4})-(\d{2})$/.exec(ym || '');
  if (mm && +mm[2] >= 1 && +mm[2] <= 12) { y = +mm[1]; m = +mm[2]; }
  const pad = (n) => String(n).padStart(2, '0');
  const ymKey = (yy, mo) => `${yy}-${pad(mo)}`;
  const prev = m === 1 ? ymKey(y - 1, 12) : ymKey(y, m - 1);
  const next = m === 12 ? ymKey(y + 1, 1) : ymKey(y, m + 1);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const byDay = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(r);
  }
  for (const l of byDay.values()) l.sort((a, b) => dueTime(a) - dueTime(b));
  const inMonth = (k) => k && k.startsWith(ymKey(y, m));
  const monthCount = [...byDay.keys()].filter(inMonth).reduce((n, k) => n + byDay.get(k).length, 0);
  let sel = SELECTED && inMonth(SELECTED) ? SELECTED : null;
  if (!sel) {
    const withItems = [...byDay.keys()].filter(inMonth).sort();
    sel = withItems.find((k) => k >= todayKey) || (inMonth(todayKey) ? todayKey : withItems[0]) || `${ymKey(y, m)}-01`;
  }
  const stOf = (r) => (r.u.status === 'overdue' ? 'is-overdue' : isMaybePast(r.u) ? 'is-maybe' : r.u.status === 'submitted' ? 'is-done' : '');
  let anyMaybe = false;

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<td class="m-pad" aria-hidden="true"></td>');
  for (let dd = 1; dd <= days; dd++) {
    const k = `${ymKey(y, m)}-${pad(dd)}`;
    const list = byDay.get(k) || [];
    const isToday = k === todayKey;
    const hasOver = list.some((r) => r.u.status === 'overdue');
    if (list.some((r) => isMaybePast(r.u))) anyMaybe = true;
    const chips = list.slice(0, 2).map((r) => {
      const d = parseDate(r.u.due);
      const full = `${r.c.code || courseLabel(r.c)} · ${r.u.title} · ${fmtDueFull(d)}`;
      return `<span class="mchip ${stOf(r)}" style="--stripe:${safeColor(r.c.color)}" title="${esc(full)}"><b>${esc((r.c.code || '').split(' ')[0])}</b> ${esc(r.u.title)}</span>`;
    }).join('');
    const more = list.length > 2 ? `<span class="mmore">+${list.length - 2} more</span>` : '';
    const dots = list.map((r) => `<i class="mdot ${stOf(r)}" style="--stripe:${safeColor(r.c.color)}"></i>`).join('');
    const label = `${fmtWeekdayLong(y, m, dd)}, ${MONTHS[m - 1]} ${dd}${isToday ? ' (today)' : ''}: ${list.length ? `${list.length} item${list.length === 1 ? '' : 's'} due${hasOver ? ', including past due' : ''}` : 'nothing due'}`;
    cells.push(`<td class="m-cell${isToday ? ' is-today' : ''}${k === sel ? ' is-sel' : ''}${list.length ? ' has-items' : ''}">
      <button type="button" class="m-day" data-day="${k}" aria-pressed="${k === sel}" aria-label="${esc(label)}">
        <span class="m-num">${dd}</span>
        <span class="m-chips" aria-hidden="true">${chips}${more}</span>
        <span class="m-dots" aria-hidden="true">${dots}</span>
      </button></td>`);
  }
  while (cells.length % 7) cells.push('<td class="m-pad" aria-hidden="true"></td>');
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
  const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<th scope="col"><span aria-hidden="true">${d[0]}</span><span class="m-wk-l">${d}</span><span class="sr-only">${d}</span></th>`).join('');
  const legend = `<div class="m-legend" aria-label="Legend">
    <span class="ml-i"><i class="mdot"></i><span class="mlg-sw"></span>Due</span>
    <span class="ml-i is-overdue"><i class="mdot is-overdue"></i><span class="mlg-sw"></span>Past due (no submission recorded)</span>
    ${anyMaybe ? `<span class="ml-i is-maybe"><i class="mdot is-maybe"></i><span class="mlg-sw"></span>${esc(maybePastLabel())}</span>` : ''}
    <span class="ml-i is-done"><i class="mdot is-done"></i><span class="mlg-sw"></span>Submitted / graded</span>
  </div>`;

  // Selected day's list.
  const selList = byDay.get(sel) || [];
  const [sy, sm, sd] = sel.split('-').map(Number);
  const selHead = `${fmtWeekdayLong(sy, sm, sd)}, ${MON3[sm - 1]} ${sd}`;
  const selDate = new Date(Date.UTC(sy, sm - 1, sd, 18));
  const selRel = fmtRelDay(selDate);
  const selBody = selList.length
    ? `<div class="card list-card due-list">${selList.map((r) => dueRow(r.u, r.c, { mode: 'day' })).join('')}</div>`
    : '<p class="empty-line">Nothing due this day in synced data.</p>';
  const isCurMonth = inMonth(todayKey);
  return `<div class="month">
    <div class="month-head">
      <h2 class="month-title">${MONTHS[m - 1]} <span>${y}</span></h2>
      <span class="month-count">${monthCount} item${monthCount === 1 ? '' : 's'} due${staleMark()}</span>
      <div class="month-nav">
        <a class="icon-btn" href="#/calendar/month/${prev}" aria-label="Previous month">${icon('chevronLeft', 18)}</a>
        ${isCurMonth ? '' : '<a class="btn-sec btn-compact" href="#/calendar/month">Today</a>'}
        <a class="icon-btn" href="#/calendar/month/${next}" aria-label="Next month">${icon('chevronRight', 18)}</a>
      </div>
    </div>
    <div class="month-main">
      <table class="month-grid"><thead><tr>${wk}</tr></thead><tbody>${weeks.join('')}</tbody></table>
      ${legend}
    </div>
    <aside class="month-side" aria-live="polite" aria-label="Selected day">
      <div class="sec-head"><div class="sec-title-wrap"><h3 class="sec-title">${esc(selHead)}</h3><p class="sec-sub">${esc(selRel)}</p></div></div>
      ${selBody}
    </aside>
  </div>`;
}
function fmtWeekdayLong(y, m, d) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Activity route = the Recent view (Past due + Recently due with statuses). */
export const activityPage = (data) => calendarPage(data, ['recent']);
