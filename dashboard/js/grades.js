// grades.js — the Grades page: one row per course (MyLab | Blackboard, never combined),
// each expandable to the MyLab category breakdown, the match line and Blackboard items.
import { icon } from './icons.js';
import { isVerified, isOpen, isLocked, sectionOf, parseDate, fmtDateTime, fmtDueFull, fmtWhen, PEARSON_ITEMS_SCHEMA, safeUrl, gradePercent } from './data.js';
import {
  esc, safeColor, pageHead, onboarding, inlineState, chip, kindOf, stamp, codeEyebrow, titleText, fullTitleAttr,
  courseUrl, gradeClass, categoryTable, matchedLine, pePartialNote, sortedGbItems, staleMark, pearsonBlock,
  bandLegend, bbItemsTable,
} from './views.js';

/** Expanded rows survive re-renders (app.js toggles membership). */
export const GRADES_OPEN = new Set();

function figure(value) {
  const p = gradePercent(value);
  const bar = p != null ? `<span class="gbar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, p)).toFixed(1)}%"></i></span>` : '';
  return `<span class="gfig-wrap ${gradeClass(value)}"><span class="gfig gfig-md">${esc(value)}</span>${bar}</span>`;
}

/** Cell = phone label + printed source stamp + value. */
const cellHtml = (label, st, body) => `<span class="gt-lab" aria-hidden="true">${label}</span>${st ? `<span class="gt-st">${st}</span>` : ''}<div class="gt-v">${body}</div>`;
function peCell(c) {
  const p = c.pearson;
  if (!p || !isVerified(p)) return cellHtml('MyLab', '', '<span class="gt-none">No MyLab results</span>');
  const st = stamp('pearson', p.syncedAt, { dotOnly: true, notes: [p.matchedBy ? `Matched to this course by ${p.matchedBy}.` : ''] });
  if (!p.currentGrade) {
    const missing = Array.isArray(p.parseMissing) && p.parseMissing.includes('overall');
    return cellHtml('MyLab', st, chip(missing ? 'partial' : 'notsynced', missing ? "Overall couldn't be read" : 'Overall not synced'));
  }
  return cellHtml('MyLab', st, `<div class="gt-fig">${figure(p.currentGrade)}${p.overallPoints ? `<span class="gt-sub">${esc(p.overallPoints)}</span>` : ''}</div>`);
}
function bbCell(c) {
  const gb = c.gradebook;
  const sec = sectionOf(c, 'gradebook');
  if (!gb || !isVerified(gb)) {
    const k = kindOf(sec.state);
    const ck = parseDate(sec.syncedAt);
    return cellHtml('Blackboard', ck ? `<span class="checked-t" title="${esc(fmtDateTime(ck))}">Checked ${esc(fmtWhen(ck).replace(/, \d.*$/, ''))}</span>` : '', chip(k, k === 'forbidden' ? 'Not shared' : k === 'error' ? "Couldn't be read" : k === 'expired' ? 'Sign-in expired' : 'Not synced yet',
      k === 'forbidden' ? "Blackboard doesn't let a student session read this gradebook." : ''));
  }
  const st = stamp(gb.source, gb.syncedAt, { stale: sec.stale, dotOnly: true });
  if (gb.empty) return cellHtml('Blackboard', st, '<span class="gt-none">No grades posted</span>');
  if (!gb.currentGrade) return cellHtml('Blackboard', st, `<span class="gt-none">${gb.overallAmbiguous ? 'Overall not picked' : 'No overall grade shown'}</span>`);
  return cellHtml('Blackboard', st, `<div class="gt-fig">${figure(gb.currentGrade)}${gb.overallColumn ? `<span class="gt-sub">${esc(gb.overallColumn)}</span>` : ''}</div>`);
}
function counts(c) {
  const gb = c.gradebook;
  const n = gb && isVerified(gb) && Array.isArray(gb.items) ? gb.items.length : null;
  const pn = c.pearson && isVerified(c.pearson) && Array.isArray(c.pearson.items) && c.pearson.itemsSchema === PEARSON_ITEMS_SCHEMA ? c.pearson.items.length : null;
  const parts = [];
  if (pn != null) parts.push(`<span><b>${pn}</b> MyLab</span>`);
  if (n != null) parts.push(`<span><b>${n}</b> Blackboard</span>`);
  return parts.length ? parts.join('') : '<span class="muted">—</span>';
}

function detail(c) {
  const p = c.pearson && isVerified(c.pearson) ? c.pearson : null;
  const gb = c.gradebook && isVerified(c.gradebook) ? c.gradebook : null;
  const sec = sectionOf(c, 'gradebook');
  let peHtml = '';
  if (p) {
    const items = Array.isArray(p.items) && p.itemsSchema === PEARSON_ITEMS_SCHEMA ? p.items : [];
    const inc = items.filter((x) => x.status === 'incomplete').length;
    peHtml = `<div class="gx-col">
      <h3 class="gx-h">MyLab</h3>
      ${matchedLine(p)}${pePartialNote()}
      ${categoryTable(p) || '<p class="muted small">Category breakdown not in synced data.</p>'}
      <p class="muted small gx-note">${items.length} assignment${items.length === 1 ? '' : 's'} synced${inc ? ` · ${inc} started, not finished` : ''}</p>
      <div class="actions-row">${safeUrl(p.pageUrl) ? `<a class="text-link" href="${esc(safeUrl(p.pageUrl))}" target="_blank" rel="noopener">Open in MyLab${icon('external', 13)}</a>` : ''}</div>
    </div>`;
  }
  let bbHtml;
  const k = kindOf(sec.state);
  if (gb && !gb.empty) {
    bbHtml = Array.isArray(gb.items) && gb.items.length ? bbItemsTable(gb) : '<p class="muted small">No gradebook items.</p>';
  } else if (gb && gb.empty) {
    bbHtml = `<p class="muted small">Blackboard returned an empty gradebook${p ? '; this course grades in MyLab' : ''}.</p>`;
  } else {
    bbHtml = inlineState(k, k === 'forbidden' ? "Gradebook isn't shared with student accounts" : k === 'error' ? "Gradebook couldn't be read" : 'Gradebook not synced yet',
      k === 'forbidden' ? 'It may still be visible in Blackboard itself.' : '');
  }
  const bbLinks = gb
    ? `<a class="text-link" href="#/course/${encodeURIComponent(c.id)}/gradebook">Course gradebook${icon('arrowRight', 13)}</a>`
    : `<a class="text-link" href="${esc(courseUrl(c, 'grades'))}" target="_blank" rel="noopener">Open in Blackboard${icon('external', 13)}</a>`;
  return `<div class="gx-grid ${p ? 'has-pe' : ''}">${peHtml}<div class="gx-col"><h3 class="gx-h">Blackboard</h3>${bbHtml}<div class="actions-row">${bbLinks}</div></div></div>`;
}

export function gradesPage(data) {
  const visible = data.courses.filter((c) => c.current !== false);
  if (!visible.length && !data.unmatchedPearson.length) return `${pageHead('Grades')}${onboarding(data)}`;
  const rows = visible.map((c) => {
    const open = isOpen(c);
    const id = `gx-${esc(c.id)}`;
    const expanded = open && GRADES_OPEN.has(c.id);
    const name = `<span class="gt-name">${codeEyebrow(c)}<span class="gt-title" title="${fullTitleAttr(c)}">${titleText(c)}</span></span>`;
    if (!open) {
      return `<div class="gt-row is-closed" role="listitem" style="--stripe:${safeColor(c.color)}">
        <div class="gt-sum"><div class="gt-course">${name}</div><div class="gt-closed">${chip('notsynced', isLocked(c) ? "Course isn't open yet" : 'Not synced yet', c.note || '')}</div></div></div>`;
    }
    return `<div class="gt-row${expanded ? ' is-open' : ''}" role="listitem" style="--stripe:${safeColor(c.color)}">
      <div class="gt-sum">
        <div class="gt-course"><button class="gt-toggle" type="button" data-gtoggle="${esc(c.id)}" aria-expanded="${expanded}" aria-controls="${id}">${name}<span class="sr-only"> — show details</span></button></div>
        <div class="gt-cell" data-label="MyLab">${peCell(c)}</div>
        <div class="gt-cell" data-label="Blackboard">${bbCell(c)}</div>
        <div class="gt-cell gt-count" data-label="Items synced">${counts(c)}</div>
        <span class="gt-chev" aria-hidden="true">${icon('chevronDown', 16)}</span>
      </div>
      <div class="gt-detail" id="${id}"${expanded ? '' : ' hidden'}>${detail(c)}</div>
    </div>`;
  }).join('');
  const legend = bandLegend();
  return `${pageHead('Grades')}
    <div class="grades-intro"><p class="lede">MyLab and Blackboard grades side by side, as each system reports them — never combined.${staleMark()}</p>${legend}</div>
    <div class="gtable">
      <div class="gt-head" aria-hidden="true"><span>Course</span><span>MyLab</span><span>Blackboard</span><span>Items synced</span><span></span></div>
      <div role="list" aria-label="Courses">${rows}</div>
    </div>
    ${unmatchedPearson(data)}`;
}

function unmatchedPearson(data) {
  if (!data.unmatchedPearson.length) return '';
  const opts = data.courses.filter((c) => c.current !== false && c.code)
    .map((c) => `<option value="${esc(c.id)}">${esc(c.code)}</option>`).join('');
  const rows = data.unmatchedPearson.map((p) => `
    <div class="card grade-card" style="--stripe:#8a8a93">
      <div class="gc-head"><div class="gc-name"><span class="ccode">MyLab course</span><h3 class="gc-title">${esc(p.pearsonCourseTitle || p.key)}</h3></div>
        <label class="map-select">Show under
          <select data-pearson-map="${esc(p.key)}"><option value="">— choose course —</option>${opts}</select>
        </label>
      </div>
      <div class="lanes"><div class="lane"><div class="lane-head"><span class="lane-label">MyLab</span>${stamp('pearson', p.syncedAt)}</div>${p.currentGrade ? `<div class="lane-val">${figure(p.currentGrade)}</div>${p.overallPoints ? `<div class="lane-sub">${esc(p.overallPoints)}</div>` : ''}` : `<div class="lane-empty">${chip('notsynced', 'Overall score not synced')}</div>`}</div></div>
      ${pearsonBlock(p, { compact: true })}
    </div>`).join('');
  return `<h2 class="act-heading gap-top">MyLab results not matched to a course</h2>
    <p class="muted small">The MyLab course title didn't contain a recognisable course code or a keyword unique to one course, so it isn't attached anywhere automatically.</p>
    <div class="grade-grid">${rows}</div>`;
}
