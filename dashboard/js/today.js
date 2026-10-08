// today.js — the Today page (default route): what's overdue, what's due today,
// the next 7 days, how each course is going, and MyLab work that was started but
// not finished. Everything is read from the synced data; empty sections say so.
import { icon } from './icons.js';
import {
  isVerified, isOpen, parseDate, fmtDayKey, fmtLongDay, hourCT, PEARSON_ITEMS_SCHEMA, safeUrl,
} from './data.js';
import {
  esc, safeColor, pageHead, onboarding, collectDueItems, dueTime, dueRow, missingDueNote, stamp, statePanel,
  codeEyebrow, titleText, courseLabel, lanesHtml, staleMark, provAdd, DUE_NOTE, gradeCell, pePartialNote, fullTitleAttr,
  isMaybePast, maybePastLabel, bandLegend, bbIsStale,
} from './views.js';

const DAY_MS = 864e5;

function section(id, title, count, body, { tone = '', tools = '', extra = '' } = {}) {
  return `<section class="today-sec ${tone}" id="sec-${id}" aria-labelledby="ts-${id}">
    <div class="sec-head"><h2 class="sec-title" id="ts-${id}">${title}${count != null ? ` <span class="count">${count}</span>` : ''}${extra}</h2>${tools ? `<div class="sec-tools">${tools}</div>` : ''}</div>
    ${body}
  </section>`;
}
const emptyLine = (text) => `<p class="empty-line">${icon('check', 15)}<span>${esc(text)}</span></p>`;

/** Compact code + grade strip (shown near the top on phone). Text-only grades; the strip header prints each source's read time. */
function gradeStrip(current) {
  const bbTimes = [];
  const peTimes = [];
  const rows = current.map((c) => {
    const open = isOpen(c);
    const vals = [];
    if (open) {
      const ml = gradeCell(c, 'mylab');
      const bb = gradeCell(c, 'bb');
      if (ml.value) { vals.push(`<span class="gs-g">${esc(ml.value)}</span><span class="gs-src">MyLab</span>`); peTimes.push(c.pearson.syncedAt); }
      if (bb.value) { vals.push(`<span class="gs-g">${esc(bb.value)}</span><span class="gs-src">BB</span>`); bbTimes.push(c.gradebook.syncedAt); }
      if (!vals.length) {
        if (bb.text) { vals.push(`<span class="gs-none">${esc(bb.text)}</span>`); if (c.gradebook && c.gradebook.syncedAt) bbTimes.push(c.gradebook.syncedAt); }
        else vals.push(c.pearson ? ml.html : bb.html);
      }
    } else vals.push('<span class="gs-none">Not open</span>');
    const inner = `<span class="gs-code">${esc(c.code || courseLabel(c))}</span><span class="gs-vals">${vals.map((v) => `<span class="gs-v">${v}</span>`).join('')}</span>`;
    return open
      ? `<a class="gs-item" href="#/course/${encodeURIComponent(c.id)}/gradebook" style="--stripe:${safeColor(c.color)}" title="${esc(courseLabel(c))} gradebook">${inner}</a>`
      : `<div class="gs-item" style="--stripe:${safeColor(c.color)}">${inner}</div>`;
  }).join('');
  // Oldest read per source, so the printed time never overstates freshness.
  const oldest = (list) => list.filter(Boolean).sort()[0];
  const bbT = oldest(bbTimes);
  const peT = oldest(peTimes);
  const stamps = `${bbT ? stamp('blackboard-api', bbT) : ''}${peT ? stamp('pearson', peT) : ''}`;
  return section('strip', 'Grades', null, `${stamps ? `<div class="gstrip-src">${stamps}</div>` : ''}<div class="card list-card gstrip">${rows}</div>`, {
    tone: 'strip-sec', tools: `<a class="text-link" href="#/grades">All grades${icon('arrowRight', 14)}</a>`,
  });
}

export function todayPage(data) {
  const now = new Date();
  const first = isVerified(data.student) && data.student.name ? String(data.student.name).split(/\s+/)[0] : null;
  const h = hourCT(now);
  const greet = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const eyebrow = esc(fmtLongDay(now));
  if (!data.courses.length) return `${pageHead(first ? `${greet}, ${first}` : 'Today', '', eyebrow)}${onboarding(data)}`;

  const { rows, missing, syncedAt } = collectDueItems(data);
  if (syncedAt) provAdd('Due dates', 'blackboard-api', syncedAt, [DUE_NOTE]);
  const todayKey = fmtDayKey(now);
  const horizon = now.getTime() + 7 * DAY_MS;
  const keyOf = (r) => { const d = parseDate(r.u.due); return d ? fmtDayKey(d) : null; };

  const overdue = rows.filter((r) => r.u.status === 'overdue');
  const maybe = rows.filter((r) => isMaybePast(r.u));
  const pastList = [...overdue, ...maybe].sort((a, b) => dueTime(b) - dueTime(a));
  const today = rows.filter((r) => r.u.status !== 'overdue' && !isMaybePast(r.u) && keyOf(r) === todayKey).sort((a, b) => dueTime(a) - dueTime(b));
  const week = rows.filter((r) => (r.u.status === 'due' || r.u.status === 'submitted') && !isMaybePast(r.u) && keyOf(r) > todayKey && dueTime(r) <= horizon)
    .sort((a, b) => dueTime(a) - dueTime(b));
  const hasDue = rows.length > 0;
  const stale = staleMark();
  const staleNow = bbIsStale();

  // When Blackboard data is stale the hero numbers are muted and carry "as of Oct 4".
  const stat = (n, label, tone, target, extra = '') => `<a class="stat ${staleNow ? 'is-stale' : tone}" href="#sec-${target}" data-scroll="sec-${target}"><span class="stat-n">${n}</span><span class="stat-l">${label}</span>${extra}${stale ? `<span class="stat-stale">${stale}</span>` : ''}</a>`;
  const maybeX = maybe.length ? `<span class="stat-x" title="${esc(maybePastLabel())}">+${maybe.length} may be past due</span>` : '';
  const stats = hasDue
    ? `<div class="stats" aria-label="Summary of synced due dates">
        ${stat(overdue.length, 'Past due', overdue.length ? 'is-danger' : '', 'overdue', maybeX)}
        ${stat(today.length, 'Due today', today.length ? 'is-accent' : '', 'today')}
        ${stat(week.length, 'Next 7 days', '', 'week')}
      </div>`
    : '';

  const list = (rs) => `<div class="card list-card due-list">${rs.map((r) => dueRow(r.u, r.c)).join('')}</div>`;
  let agenda;
  if (!hasDue) {
    agenda = statePanel(missing.length ? 'notsynced' : 'empty', missing.length ? 'No due dates synced yet' : 'No due dates in synced Blackboard data',
      'Due dates come from Blackboard gradebook columns and calendar items. MyLab due dates are not read.');
  } else {
    agenda = [
      section('overdue', 'Past due', pastList.length, pastList.length ? list(pastList) : emptyLine('Nothing past due in synced data'), { tone: overdue.length ? 'is-danger' : maybe.length ? 'is-maybe' : '', extra: stale }),
      section('today', 'Today', today.length, today.length ? list(today) : emptyLine('Nothing due today in synced data')),
      section('week', 'Next 7 days', week.length, week.length ? list(week) : emptyLine('Nothing due in the next 7 days in synced data'),
        { tools: '<a class="text-link" href="#/calendar">Calendar' + icon('arrowRight', 14) + '</a>' }),
    ].join('');
  }

  const current = data.courses.filter((c) => c.current !== false);
  const tiles = current.map((c) => {
    const open = isOpen(c);
    const body = open ? lanesHtml(c, { big: true }) : `<div class="lane-empty"><span class="muted">${c.locked ? "Course isn't open yet" : 'Not synced yet'}</span></div>`;
    const link = open ? `<a class="tile-link" href="#/course/${encodeURIComponent(c.id)}/gradebook" aria-label="${esc(courseLabel(c))} gradebook"></a>` : '';
    return `<article class="grade-tile ${open ? 'is-open' : ''}" style="--stripe:${safeColor(c.color)}">
      ${link}
      <div class="tile-name">${codeEyebrow(c)}<div class="tile-title" title="${fullTitleAttr(c)}">${titleText(c)}</div></div>
      ${body}
    </article>`;
  }).join('');
  const doing = section('doing', 'How you\'re doing', null,
    tiles ? `${bandLegend('is-compact')}<div class="tiles">${tiles}</div>` : statePanel('notsynced', 'No current courses synced'),
    { tools: `<a class="text-link hide-phone" href="#/grades">All grades${icon('arrowRight', 14)}</a>` });

  // "Started on MyLab, not finished": incomplete items from the Pearson results page. No due dates (not read).
  const peRecs = [];
  for (const c of current) if (c.pearson && isVerified(c.pearson)) peRecs.push({ p: c.pearson, c });
  for (const p of data.unmatchedPearson || []) if (isVerified(p)) peRecs.push({ p, c: null });
  const unfinished = [];
  for (const { p, c } of peRecs) {
    if (!Array.isArray(p.items) || p.itemsSchema !== PEARSON_ITEMS_SCHEMA) continue;
    for (const it of p.items) if (it.status === 'incomplete') unfinished.push({ it, p, c });
  }
  let mylabBody;
  if (!peRecs.length) mylabBody = '<p class="empty-line muted-line">No MyLab results synced yet. Open your MyLab Results page while signed in to read them.</p>';
  else if (!unfinished.length) mylabBody = emptyLine('No unfinished MyLab work in synced data');
  else {
    mylabBody = `<div class="card list-card">${unfinished.map(({ it, p, c }) => `
      <div class="ml-row" style="--stripe:${safeColor(c ? c.color : null, '#8a8a93')}">
        <div class="ml-text">
          <div class="due-title">${esc(it.title)}</div>
          <div class="due-meta">${c ? `<a class="due-course" href="#/course/${encodeURIComponent(c.id)}/gradebook">${esc(c.code || courseLabel(c))}</a>` : `<span class="due-course">${esc(p.pearsonCourseTitle || 'MyLab')}</span>`}${it.category ? `<span class="due-kind">${esc(it.category)}</span>` : ''}<span class="due-badge is-warn">Incomplete</span></div>
          <div class="ml-progress">${it.correctTotal ? `<span class="num">${esc(it.correctTotal)}</span> correct so far` : 'Progress not shown'}${it.dateStarted ? ` · started ${esc(it.dateStarted)}` : ''}</div>
        </div>
      </div>`).join('')}</div>`;
  }
  const peTimes = peRecs.map((x) => x.p.syncedAt).filter(Boolean).sort();
  const mylabLink = peRecs.length ? safeUrl(peRecs[0].p.pageUrl) : null;
  const mylabStamp = peRecs.length ? stamp('pearson', peTimes[peTimes.length - 1], { notes: ["MyLab due dates aren't read, so none are shown."] }) : '';
  const mylabFoot = mylabLink ? `<p class="sec-foot"><a class="text-link" href="${esc(mylabLink)}" target="_blank" rel="noopener">Open MyLab results${icon('external', 13)}</a></p>` : '';
  const mylab = section('mylab', 'Unfinished MyLab work', unfinished.length || null, `${peRecs.length ? pePartialNote() : ''}${mylabBody}${mylabFoot}`, { tools: mylabStamp });

  return `${pageHead(first ? `${greet}, ${first}` : 'Today', '', eyebrow)}
    <div class="today-grid">
      <div class="today-main">${stats}${gradeStrip(current)}${agenda}${missingDueNote(missing)}</div>
      <div class="today-side">${doing}${mylab}</div>
    </div>`;
}
