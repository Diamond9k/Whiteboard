// app.js — bootstrap + hash router + navigation rail for the extension dashboard.
// Data flow: content scripts -> background -> chrome.storage.local
//            -> loadData() (BBX.mergeForDashboard) -> view renderers -> #view
// No course data lives in this file.
import {
  BB, loadData, onDataChanged, getPrefs, setPrefs, requestSync, clearCache,
  findCourse, parseDate, fmtDateTime, fmtAgo, fmtAgoShort, fmtWhen, isVerified, sourceLabel, fmtFullAgo, fmtMonthDay,
} from './js/data.js';
import { icon } from './js/icons.js';
import {
  esc, coursesPage, coursePage, diagnosticsPage, stubPage, errorPage,
  setTrustContext, sysInfo, chip, kindOf, provReset, provList, TABS, slug,
} from './js/views.js';
import { calendarPage, selectDay } from './js/calendar.js';
import { gradesPage, GRADES_OPEN } from './js/grades.js';
import { todayPage } from './js/today.js';
import { openPalette, paletteOpen, openShortcuts, shortcutsOpen, MOD } from './js/palette.js';

const NAV = [
  { key: 'today', label: 'Today', icon: 'today' },
  { key: 'courses', label: 'Courses', icon: 'courses' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'grades', label: 'Grades', icon: 'grades' },
];
const NAV_QUIET = [{ key: 'tools', label: 'Diagnostics', icon: 'tools' }];
const NAV_EXT = [
  { key: 'institution', label: 'Institution', icon: 'institution', href: `${BB}/ultra/institution-page` },
  { key: 'organizations', label: 'Organizations', icon: 'organizations', href: `${BB}/ultra/organizations` },
  { key: 'messages', label: 'Messages', icon: 'messages', href: `${BB}/ultra/messages` },
];

let DATA = null;
let PREFS = {};
let SHOW_PAST = false;
let NAV_KEY = '';
const $ = (sel) => document.querySelector(sel);

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { page: parts[0] || 'today', parts };
}

// ---------------------------------------------------------------- theme (System / Light / Dark)
function applyTheme(t) {
  const r = document.documentElement;
  if (t === 'light' || t === 'dark') r.dataset.theme = t; else delete r.dataset.theme;
  try { localStorage.setItem('bbx-theme', t || 'system'); } catch { /* storage unavailable */ }
}
try { const t = localStorage.getItem('bbx-theme'); if (t) applyTheme(t); } catch { /* storage unavailable */ }

// ---------------------------------------------------------------- shell extras
function ensureShell() {
  if (!document.querySelector('.skip-link')) {
    const a = document.createElement('a');
    a.className = 'skip-link'; a.href = '#view'; a.textContent = 'Skip to content';
    a.addEventListener('click', (e) => { e.preventDefault(); const h = document.querySelector('#view h1, #view'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); } });
    document.body.prepend(a);
  }
  const v = $('#view'); if (v && !v.hasAttribute('tabindex')) v.setAttribute('tabindex', '-1');
}

// ---------------------------------------------------------------- nav rail / bottom bar
function renderNav(activeKey) {
  const student = DATA && isVerified(DATA.student) ? DATA.student.name : null;
  const ini = student ? student.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() : null;
  const theme = PREFS.theme === 'light' || PREFS.theme === 'dark' ? PREFS.theme : 'system';
  const item = (n) => `
    <a class="nav-item ${n.key === activeKey ? 'active' : ''}" href="#/${n.key}"${n.key === activeKey ? ' aria-current="page"' : ''} title="${esc(n.label)}">
      <span class="nav-icon">${icon(n.icon, 20)}</span><span class="nav-label">${esc(n.label)}</span>
    </a>`;
  const moreActive = NAV_QUIET.some((n) => n.key === activeKey) || NAV_EXT.some((n) => n.key === activeKey);
  const ext = NAV_EXT.map((n) => `
    <a class="nav-item nav-ext ${n.key === activeKey ? 'active' : ''}" href="${esc(n.href)}" target="_blank" rel="noopener" title="${esc(n.label)} — opens in Blackboard"${n.key === activeKey ? ' aria-current="page"' : ''}>
      <span class="nav-icon">${icon(n.icon, 18)}</span><span class="nav-label">${esc(n.label)}<span class="sr-only"> (opens in Blackboard)</span></span><span class="nav-ext-mark" aria-hidden="true">${icon('external', 12)}</span>
    </a>`).join('');
  const tbtn = (key, ic, label) => `<button type="button" role="radio" aria-checked="${theme === key}" data-theme-set="${key}" title="${label} theme" class="${theme === key ? 'on' : ''}">${icon(ic, 15)}<span class="theme-l">${label}</span></button>`;
  const html = `
    <a class="monogram" href="#/today" title="University of Arkansas · Today"><span aria-hidden="true">A</span><span class="sr-only">University of Arkansas — Today</span></a>
    <button class="nav-search" type="button" data-action="search" title="Search (${MOD} K or /)" aria-label="Search courses and items (${MOD} K)">
      <span class="nav-icon">${icon('search', 19)}</span><span class="nav-label">Search</span><kbd>${esc(MOD)} K</kbd>
    </button>
    <div class="nav-items">
      ${NAV.map(item).join('')}
      <button class="nav-item nav-more-btn ${moreActive ? 'active' : ''}" type="button" aria-expanded="false" aria-controls="nav-more" title="More">
        <span class="nav-icon">${icon('more', 20)}</span><span class="nav-label">More</span>
      </button>
    </div>
    <div class="nav-secondary" id="nav-more">
      <div class="sheet-head"><strong>More</strong><button class="icon-btn sheet-close" type="button" aria-label="Close">${icon('close', 18)}</button></div>
      ${NAV_QUIET.map(item).join('')}
      <div class="nav-group" role="group" aria-label="In Blackboard (opens in a new tab)">
        <div class="nav-eyebrow">In Blackboard ${icon('external', 10)}</div>
        ${ext}
        <a class="nav-item nav-ext" href="${BB}/ultra/course" target="_blank" rel="noopener" title="Open Blackboard"><span class="nav-icon">${icon('external', 18)}</span><span class="nav-label">Open Blackboard</span></a>
      </div>
      <div class="theme-seg" role="radiogroup" aria-label="Theme">${tbtn('system', 'monitor', 'System')}${tbtn('light', 'sun', 'Light')}${tbtn('dark', 'moon', 'Dark')}</div>
      ${student ? `<div class="nav-profile" title="${esc(student)}">
        <span class="avatar" aria-hidden="true">${esc(ini)}</span>
        <span class="nav-label">${esc(student)}</span>
      </div>` : ''}
    </div>`;
  const nav = $('#nav');
  if (nav.dataset.sig !== html) { nav.innerHTML = html; nav.dataset.sig = html; }
}

// ---------------------------------------------------------------- sync pill (one per header)
const SYS_SEV = { ok: 0, partial: 1, 'parse-partial': 1, stale: 1, 'session-expired': 2, error: 3, 'parse-failed': 3 };
const SHORT_STATE = { ok: '', stale: 'old', partial: 'partly read', 'parse-partial': 'partly read', 'session-expired': 'sign-in expired', error: 'failed', 'parse-failed': "couldn't read" };
const SRC_MONO = { 'blackboard-api': 'BB', 'blackboard-dom': 'BB page', pearson: 'MyLab' };

function freshnessPill() {
  const bb = sysInfo('blackboard');
  const pe = sysInfo('pearson');
  const sev = (x) => (x.state == null ? -1 : SYS_SEV[x.state] ?? 1);
  const worst = Math.max(sev(bb), sev(pe));
  const tone = worst >= 3 ? 'danger' : worst >= 1 ? 'warn' : worst === 0 ? 'ok' : 'none';
  // Long form prints the clock time and the age ("Blackboard 7:23 PM · 8 min ago"); the phone form keeps
  // the age plus the words that matter ("BB expired 3d").
  const PHONE_FLAG = { 'session-expired': 'expired', error: 'failed', 'parse-failed': "couldn't read" };
  const part = (name, short, x) => {
    if (!x.last && !x.state) return `<span class="fp-part"><span class="fp-l">${name}</span><span class="fp-s">${short}</span> <span class="fp-na">not synced</span><span class="fp-na-s">—</span></span>`;
    const flag = SHORT_STATE[x.state] ? `<span class="fp-flag"> · ${esc(SHORT_STATE[x.state])}</span>` : '';
    const sflag = PHONE_FLAG[x.state] ? `<span class="fp-flag-s">${esc(PHONE_FLAG[x.state])} </span>` : '';
    const clock = x.last ? (fmtAgoShort(x.last).endsWith('d') ? fmtMonthDay(x.last) : fmtWhen(x.last)) : '';
    const age = x.last ? `<span class="fp-age"><span class="fp-clock">${esc(clock)}</span> · ${esc(fmtAgo(x.last))}</span><span class="fp-age-s">${sflag}${esc(fmtAgoShort(x.last))}</span>` : `<span class="fp-age">no successful sync</span><span class="fp-age-s">${sflag}—</span>`;
    return `<span class="fp-part"><span class="fp-l">${name}</span><span class="fp-s">${short}</span> ${age}${flag}</span>`;
  };
  const nothing = !bb.last && !bb.state && !pe.last && !pe.state;
  const label = nothing ? '<span class="fp-part">Nothing synced yet</span>' : `${part('Blackboard', 'BB', bb)}<span class="fp-sep" aria-hidden="true">·</span>${part('MyLab', 'MyLab', pe)}`;
  const describe = (name, x) => `${name} ${x.last ? fmtAgo(x.last) : 'not synced'}${SHORT_STATE[x.state] ? `, ${SHORT_STATE[x.state]}` : ''}`;
  const row = (name, x, link) => {
    const s = x.s;
    const at = parseDate(s.at);
    const kind = x.state === 'ok' ? 'ok' : x.state === 'stale' ? 'stale' : x.state ? kindOf(x.state) : 'notsynced';
    const stText = { ok: 'OK', stale: 'Older than a day', partial: 'Partly read', 'parse-partial': 'Partly read', 'session-expired': 'Sign-in expired', error: 'Last sync failed', 'parse-failed': "Page couldn't be read" }[x.state] || (x.state ? x.state : 'Never synced');
    const lastTxt = x.last
      ? `${esc(fmtDateTime(x.last))} <span class="muted">(${esc(fmtAgo(x.last))})</span>${x.fromRecord ? '<br><span class="muted small">From the newest MyLab record; no sync status was recorded.</span>' : ''}`
      : '<span class="muted">never</span>';
    const detail = x.state === 'parse-partial'
      ? `Partly read: ${s.message || 'part of the results page could not be read.'} Everything else was read normally.`
      : s.message || '';
    return `<div class="fs-row">
      <div class="fs-top"><strong>${name}</strong>${chip(kind, stText)}</div>
      <dl>
        <dt>Last success</dt><dd>${lastTxt}</dd>
        ${s.source ? `<dt>Via</dt><dd>${esc(sourceLabel(s.source))}</dd>` : ''}
        <dt>Last attempt</dt><dd>${at ? esc(fmtFullAgo(at)) : '<span class="muted">—</span>'}</dd>
        ${detail ? `<dt>Detail</dt><dd>${esc(detail)}</dd>` : ''}
      </dl>
      <a class="text-link" href="${link}" target="_blank" rel="noopener">Open ${name}${icon('external', 12)}</a>
    </div>`;
  };
  const prov = provList();
  const provHtml = prov.length ? `<div class="fs-prov"><strong class="fs-h">On this page</strong><ul>${prov.map((p) => {
    const d = parseDate(p.syncedAt);
    const sysLast = p.source === 'pearson' ? pe.last : bb.last;
    const same = d && sysLast && Math.abs(d - sysLast) <= 120000;
    return `<li><span class="fs-mono">${esc(SRC_MONO[p.source] || 'Source')}</span><div><span>${esc(p.label)} · ${esc(sourceLabel(p.source))} · ${d ? `${esc(fmtWhen(d))}${same ? ' <span class="muted">(same as last sync)</span>' : ''}` : 'time unknown'}</span>${p.notes.filter(Boolean).map((n) => `<p class="muted small">${esc(n)}</p>`).join('')}</div></li>`;
  }).join('')}</ul></div>` : '';
  return `<details class="fresh" data-tone="${tone}">
    <summary aria-label="Sync status: ${esc(nothing ? 'nothing synced yet' : `${describe('Blackboard', bb)}; ${describe('MyLab', pe)}`)}. Open details."><i class="fp-dot" aria-hidden="true"></i><span class="fp-label">${label}</span>${icon('chevronDown', 14)}</summary>
    <div class="fresh-pop" role="group" aria-label="Sync details">
      <div class="fs-head"><strong>Sync status</strong><span class="muted small">Each system's last successful sync. Blocks that were read at another time show their own dated stamp.</span></div>
      ${row('Blackboard', bb, `${BB}/ultra/course`)}
      ${row('MyLab', pe, 'https://mylab.pearson.com/')}
      ${provHtml}
      <div class="fs-actions"><button class="btn" data-action="sync" type="button">${icon('sync', 15)}Sync now</button><a class="text-link" href="#/tools">Diagnostics${icon('arrowRight', 13)}</a></div>
      <p class="sync-msg muted small" role="status"></p>
      <p class="muted small">Read-only: nothing here writes to Blackboard or MyLab.</p>
    </div>
  </details>`;
}

/** Actionable global problems only (expired / failed / old data), merged into one wrapping line. */
function renderNotices() {
  const st = (DATA && DATA.status) || {};
  const bb = st.blackboard || {};
  const pe = st.pearson || {};
  const hasCache = DATA && DATA.courses.length > 0;
  const parts = [];
  let tone = 'info';
  const bbLast = sysInfo('blackboard').last;
  const age = (d) => (d ? `from ${esc(fmtDateTime(d))} (${esc(fmtAgo(d))})` : 'from an earlier sync (time unknown)');
  if (bb.state === 'session-expired') {
    tone = 'warn';
    parts.push(`<strong>Blackboard sign-in expired</strong> — ${hasCache ? `showing data ${age(bbLast)}.` : 'nothing cached yet.'} <a href="${BB}/ultra/course" target="_blank" rel="noopener">Sign in to Blackboard ↗</a>`);
  } else if (bb.state === 'error') {
    tone = 'danger';
    parts.push(`<strong>Last Blackboard sync failed</strong>${hasCache ? ` — showing data ${age(bbLast)}` : ''}.${bb.message ? ` ${esc(bb.message)}` : ''} <a href="${BB}/ultra/course" target="_blank" rel="noopener">Open Blackboard ↗</a>`);
  } else if (bbLast && Date.now() - bbLast.getTime() > 864e5) {
    parts.push(`<strong>Blackboard data is ${esc(fmtAgo(bbLast))} old</strong> (last synced ${esc(fmtDateTime(bbLast))}). <a href="${BB}/ultra/course" target="_blank" rel="noopener">Open Blackboard to refresh ↗</a>`);
  }
  const peLast = sysInfo('pearson').last;
  if (pe.state === 'session-expired') {
    if (tone === 'info') tone = 'warn';
    parts.push(`<strong>MyLab sign-in expired</strong> — showing MyLab grades ${age(peLast)}. <a href="https://mylab.pearson.com/" target="_blank" rel="noopener">Open MyLab ↗</a>`);
  } else if (pe.state === 'parse-failed') {
    tone = 'danger';
    parts.push(`<strong>MyLab results page couldn't be read</strong> (its layout may have changed) — earlier MyLab data kept.${pe.message ? ` ${esc(pe.message)}` : ''}`);
  } else if (pe.state === 'parse-partial' && parts.length) {
    parts.push(`<strong>MyLab partly read</strong> — ${esc(pe.message || 'part of the results page could not be read.')}`);
  }
  const html = parts.length
    ? `<div class="notice" data-tone="${tone}">${icon(tone === 'info' ? 'clock' : tone === 'danger' ? 'alert' : 'key', 16)}<p>${parts.join(' <span class="notice-sep">·</span> ')}</p></div>` : '';
  const el = $('#notices');
  if (el.innerHTML !== html) el.innerHTML = html;
}

function renderFooter() {
  const html = `<span>Read-only view of your Blackboard and MyLab data. All times Central (CT).</span><a class="text-link" href="#/tools">Diagnostics</a><button class="link-btn foot-keys" type="button" data-action="shortcuts">${icon('keyboard', 14)}Shortcuts <kbd>?</kbd></button>`;
  const el = $('#provenance');
  if (el.innerHTML !== html) el.innerHTML = html;
}

function render({ focus = false } = {}) {
  const { page, parts } = route();
  const view = $('#view');
  let html;
  let navKey = page;
  provReset();
  try {
    if (!DATA) throw new Error('Data not loaded');
    setTrustContext(DATA.status, DATA);
    const favorites = new Set(Array.isArray(PREFS.favorites) ? PREFS.favorites : []);
    switch (page) {
      case 'today': html = todayPage(DATA); break;
      case 'courses': html = coursesPage(DATA, { layout: PREFS.layout === 'grid' ? 'grid' : 'list', favorites, showPast: SHOW_PAST }); break;
      case 'course': navKey = 'courses'; html = coursePage(DATA, findCourse(DATA, parts[1]), parts[2]); break;
      case 'grades': if (parts[1]) GRADES_OPEN.add(parts[1]); html = gradesPage(DATA); break;
      case 'activity': navKey = 'calendar'; html = calendarPage(DATA, ['recent']); break;
      case 'tools': html = diagnosticsPage(DATA); break;
      case 'calendar': html = calendarPage(DATA, parts.slice(1)); break;
      case 'messages': navKey = 'messages'; html = stubPage('Messages', { text: 'Messages are not pulled into this dashboard.', link: { href: `${BB}/ultra/messages`, label: 'Open Messages in Blackboard' } }); break;
      case 'institution': navKey = 'institution'; html = stubPage('Institution Page', { link: { href: `${BB}/ultra/institution-page`, label: 'Open in Blackboard' } }); break;
      case 'organizations': navKey = 'organizations'; html = stubPage('Organizations', { link: { href: `${BB}/ultra/organizations`, label: 'Open Organizations in Blackboard' } }); break;
      default: navKey = ''; html = stubPage('Page not found', { kind: 'notsynced', heading: 'Nothing at this address', text: 'Use the navigation to pick a page.' });
    }
  } catch (err) {
    console.error(err);
    html = errorPage(err);
  }
  NAV_KEY = navKey;
  renderNav(navKey);
  renderNotices();
  renderFooter();
  view.innerHTML = html;
  const pill = freshnessPill();
  view.querySelectorAll('.fresh-slot').forEach((s) => { s.innerHTML = pill; });
  document.title = `${(view.querySelector('h1') || {}).textContent || 'Dashboard'} · Blackboard`;
  updateTabCue();
  if (focus) { const h = view.querySelector('h1'); if (h) h.focus({ preventScroll: true }); }
}

/** Course tab strip: fade the clipped edge and show a separate "more tabs" button while tabs are hidden to the right. */
function updateTabCue() {
  document.querySelectorAll('.tabwrap').forEach((w) => {
    const bar = w.querySelector('.tabbar');
    if (!bar) return;
    const more = bar.scrollWidth - bar.clientWidth - bar.scrollLeft > 4;
    w.classList.toggle('has-more', more);
    const b = w.querySelector('.tab-more');
    if (b) b.hidden = !more;
  });
}
document.addEventListener('scroll', (e) => { if (e.target && e.target.classList && e.target.classList.contains('tabbar')) updateTabCue(); }, true);
window.addEventListener('resize', updateTabCue);

async function reload({ keepScroll = true } = {}) {
  const y = window.scrollY;
  try {
    DATA = await loadData();
    PREFS = DATA.prefs || (await getPrefs());
  } catch (err) {
    console.error(err);
    DATA = null;
  }
  applyTheme(PREFS.theme || 'system');
  render();
  if (keepScroll) window.scrollTo(0, y);
}

function setMore(open) {
  document.body.classList.toggle('more-open', open);
  const b = document.querySelector('.nav-more-btn');
  if (b) b.setAttribute('aria-expanded', String(open));
}

document.addEventListener('click', async (e) => {
  document.querySelectorAll('details.fresh[open], details.stamp[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  if (e.target.closest('.nav-more-btn')) { setMore(!document.body.classList.contains('more-open')); return; }
  if (e.target.closest('.sheet-close') || (document.body.classList.contains('more-open') && !e.target.closest('#nav-more'))) setMore(false);
  if (e.target.closest('#nav-more a')) setMore(false);
  const th = e.target.closest('[data-theme-set]');
  if (th) {
    const t = th.dataset.themeSet;
    applyTheme(t);
    PREFS = { ...PREFS, theme: t };
    renderNav(NAV_KEY);
    await setPrefs({ theme: t });
    const again = document.querySelector(`[data-theme-set="${t}"]`); if (again) again.focus();
    return;
  }
  const tm = e.target.closest('.tab-more');
  if (tm) { const bar = tm.closest('.tabwrap').querySelector('.tabbar'); if (bar) bar.scrollBy({ left: bar.clientWidth * 0.7, behavior: 'smooth' }); return; }
  const jump = e.target.closest('[data-scroll]');
  if (jump) { e.preventDefault(); const t = document.getElementById(jump.dataset.scroll); if (t) t.scrollIntoView({ block: 'start' }); return; }
  const gt = e.target.closest('[data-gtoggle]');
  if (gt) {
    const id = gt.dataset.gtoggle;
    const open = !GRADES_OPEN.has(id);
    if (open) GRADES_OPEN.add(id); else GRADES_OPEN.delete(id);
    gt.setAttribute('aria-expanded', String(open));
    const panel = document.getElementById(gt.getAttribute('aria-controls'));
    if (panel) panel.hidden = !open;
    const row = gt.closest('.gt-row'); if (row) row.classList.toggle('is-open', open);
    return;
  }
  const day = e.target.closest('[data-day]');
  if (day) {
    const k = day.dataset.day;
    selectDay(k);
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    const b = document.querySelector(`[data-day="${k}"]`); if (b) b.focus({ preventScroll: true });
    return;
  }
  const fav = e.target.closest('[data-fav]');
  if (fav) {
    e.preventDefault(); e.stopPropagation();
    const s = new Set(Array.isArray(PREFS.favorites) ? PREFS.favorites : []);
    s.has(fav.dataset.fav) ? s.delete(fav.dataset.fav) : s.add(fav.dataset.fav);
    await setPrefs({ favorites: [...s] });
    return;
  }
  const lay = e.target.closest('[data-layout]');
  if (lay) { await setPrefs({ layout: lay.dataset.layout }); return; }
  const past = e.target.closest('[data-showpast]');
  if (past) { SHOW_PAST = past.dataset.showpast === '1'; render(); return; }
  const act = e.target.closest('[data-action]');
  if (act && act.dataset.action === 'search') { openPalette(DATA); return; }
  if (act && act.dataset.action === 'shortcuts') { openShortcuts(); return; }
  if (act && act.dataset.action === 'sync') {
    const r = await requestSync();
    const msg = !r ? 'Sync request failed.'
      : r.blackboardTabs + r.pearsonTabs === 0 ? 'No Blackboard or MyLab tab is open — open one while signed in to sync.'
        : `Asked ${r.blackboardTabs ? 'Blackboard' : ''}${r.blackboardTabs && r.pearsonTabs ? ' + ' : ''}${r.pearsonTabs ? 'MyLab' : ''} tab(s) to refresh…`;
    document.querySelectorAll('.sync-msg').forEach((el) => { el.textContent = msg; });
    return;
  }
  if (act && act.dataset.action === 'clear') {
    if (confirm('Remove all cached Blackboard/Pearson data stored by this extension on this computer?')) await clearCache();
  }
});

// ---------------------------------------------------------------- keyboard
let gAt = 0;
document.addEventListener('keydown', (e) => {
  if (paletteOpen() || shortcutsOpen()) return; // their own handlers run
  const t = e.target;
  const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(DATA); return; }
  if (e.key === 'Escape') {
    document.querySelectorAll('details.fresh[open], details.stamp[open]').forEach((d) => { d.open = false; const s = d.querySelector('summary'); if (s && d.contains(document.activeElement)) s.focus(); });
    if (document.body.classList.contains('more-open')) { setMore(false); const b = document.querySelector('.nav-more-btn'); if (b) b.focus(); }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); openPalette(DATA); return; }
  if (e.key === '?') { e.preventDefault(); openShortcuts(); return; }
  if (gAt && Date.now() - gAt < 1200) {
    gAt = 0;
    const map = { t: 'today', c: 'courses', k: 'calendar', g: 'grades' };
    if (map[e.key]) { e.preventDefault(); location.hash = `#/${map[e.key]}`; }
    return;
  }
  if (e.key === 'g') { gAt = Date.now(); return; }
  if (e.key === '[' || e.key === ']') {
    const { page, parts } = route();
    if (page !== 'course' || !parts[1]) return;
    const slugs = TABS.map(slug);
    const cur = Math.max(0, slugs.indexOf(parts[2] || 'content'));
    const nxt = (cur + (e.key === ']' ? 1 : -1) + slugs.length) % slugs.length;
    e.preventDefault();
    location.hash = `#/course/${encodeURIComponent(parts[1])}/${slugs[nxt]}`;
  }
});

document.addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-pearson-map]');
  if (sel && sel.value) {
    const map = { ...(PREFS.pearsonMap || {}), [sel.dataset.pearsonMap]: sel.value };
    await setPrefs({ pearsonMap: map });
  }
});

window.addEventListener('hashchange', () => {
  setMore(false);
  render({ focus: true }); window.scrollTo(0, 0);
});
let pending = null;
onDataChanged(() => { clearTimeout(pending); pending = setTimeout(() => reload(), 150); });

ensureShell();
reload({ keepScroll: false });
