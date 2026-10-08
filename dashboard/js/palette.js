// palette.js — quick jump (/, Ctrl+K) and the keyboard shortcuts overlay.
// Searches client-side over synced titles only; results are hash routes.
import { icon } from './icons.js';
import { isOpen, isVerified, PEARSON_ITEMS_SCHEMA, parseDate, fmtMonthDay } from './data.js';
import { esc, shortTitle, safeColor } from './views.js';

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const MOD = isMac ? '⌘' : 'Ctrl';

const PAGES = [
  { label: 'Today', href: '#/today', kind: 'Page', hint: 'g t' },
  { label: 'Courses', href: '#/courses', kind: 'Page', hint: 'g c' },
  { label: 'Calendar', href: '#/calendar', kind: 'Page', hint: 'g k' },
  { label: 'Calendar · Month', href: '#/calendar/month', kind: 'Page' },
  { label: 'Grades', href: '#/grades', kind: 'Page', hint: 'g g' },
  { label: 'Diagnostics', href: '#/tools', kind: 'Page' },
];

function buildIndex(data) {
  const out = [];
  for (const c of data.courses || []) {
    if (c.current === false) continue;
    const code = c.code || '';
    const t = shortTitle(c);
    const base = `#/course/${encodeURIComponent(c.id)}`;
    const color = safeColor(c.color);
    out.push({ label: t || code || c.id, sub: code, kind: 'Course', href: base, color, rank: 0 });
    if (!isOpen(c)) continue;
    for (const it of Array.isArray(c.content) ? c.content : []) {
      if (isVerified(it) && it.title) out.push({ label: it.title, sub: code, kind: 'Content', href: `${base}/content`, color, rank: 3 });
    }
    for (const u of Array.isArray(c.upcoming) ? c.upcoming : []) {
      if (!isVerified(u) || !u.title) continue;
      const d = parseDate(u.due);
      out.push({ label: u.title, sub: `${code}${d ? ` · due ${fmtMonthDay(d)}` : ''}`, kind: 'Due', href: `${base}/calendar`, color, rank: 1 });
    }
    const gb = c.gradebook;
    const dueTitles = new Set((Array.isArray(c.upcoming) ? c.upcoming : []).map((u) => u.title));
    if (gb && isVerified(gb) && Array.isArray(gb.items)) {
      for (const it of gb.items) if (it.title && !dueTitles.has(it.title)) out.push({ label: it.title, sub: `${code} · Blackboard grade`, kind: 'Grade', href: `${base}/gradebook`, color, rank: 2 });
    }
    const p = c.pearson;
    if (p && isVerified(p) && Array.isArray(p.items) && p.itemsSchema === PEARSON_ITEMS_SCHEMA) {
      for (const it of p.items) if (it.title) out.push({ label: it.title, sub: `${code} · MyLab`, kind: 'MyLab', href: `${base}/gradebook`, color, rank: 2 });
    }
  }
  return out;
}

function score(item, q) {
  const hay = `${item.label} ${item.sub || ''}`.toLowerCase();
  const l = item.label.toLowerCase();
  if (!q) return item.kind === 'Page' ? 1 : item.kind === 'Course' ? 2 : -1;
  const terms = q.split(/\s+/).filter(Boolean);
  if (!terms.every((t) => hay.includes(t))) return -1;
  let s = 10 - item.rank;
  if (terms.every((t) => l.includes(t))) s += 8;
  for (const t of terms) if (l.split(/[^a-z0-9.]+/).includes(t)) s += 3; // whole-word hit
  if (l.startsWith(q)) s += 20;
  else if (new RegExp(`(^|\\W)${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(l)) s += 10;
  if (item.kind === 'Course' || item.kind === 'Page') s += 6;
  return s;
}

let INDEX = [];
let RESULTS = [];
let ACTIVE = 0;
let OPENER = null;

function ensureDom() {
  let el = document.getElementById('palette');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'palette';
  el.className = 'overlay';
  el.hidden = true;
  el.innerHTML = `<div class="pal" role="dialog" aria-modal="true" aria-label="Quick jump">
    <div class="pal-field">${icon('search', 18)}
      <input id="pal-input" type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Jump to a course, assignment or page…">
      <kbd class="pal-esc">Esc</kbd>
    </div>
    <ul id="pal-list" class="pal-list" role="listbox" aria-label="Results"></ul>
    <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>?</kbd> shortcuts</span></div>
  </div>`;
  document.body.appendChild(el);
  const input = el.querySelector('#pal-input');
  input.addEventListener('input', () => { ACTIVE = 0; renderResults(); });
  input.addEventListener('keydown', onKey);
  el.addEventListener('mousedown', (e) => { if (e.target === el) { e.preventDefault(); closePalette(); } });
  el.querySelector('#pal-list').addEventListener('click', (e) => {
    const li = e.target.closest('[role="option"]');
    if (li) go(+li.dataset.i);
  });
  return el;
}

function renderResults() {
  const el = ensureDom();
  const input = el.querySelector('#pal-input');
  const q = input.value.trim().toLowerCase();
  const all = [...PAGES.map((p) => ({ ...p, rank: 0 })), ...INDEX];
  RESULTS = all.map((it) => ({ it, s: score(it, q) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.it);
  if (ACTIVE >= RESULTS.length) ACTIVE = Math.max(0, RESULTS.length - 1);
  const list = el.querySelector('#pal-list');
  list.innerHTML = RESULTS.length
    ? RESULTS.map((r, i) => `<li id="pal-o-${i}" role="option" data-i="${i}" aria-selected="${i === ACTIVE}" class="${i === ACTIVE ? 'on' : ''}">
        <span class="pal-dot" style="--stripe:${r.color || 'var(--faint)'}"></span>
        <span class="pal-text"><span class="pal-label">${esc(r.label)}</span>${r.sub ? `<span class="pal-sub">${esc(r.sub)}</span>` : ''}</span>
        <span class="pal-kind">${esc(r.kind)}${r.hint ? ` <kbd>${esc(r.hint)}</kbd>` : ''}</span>
      </li>`).join('')
    : `<li class="pal-empty" role="presentation">Nothing in synced data matches “${esc(input.value.trim())}”.</li>`;
  input.setAttribute('aria-activedescendant', RESULTS.length ? `pal-o-${ACTIVE}` : '');
  const on = list.querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

function onKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); ACTIVE = Math.min(RESULTS.length - 1, ACTIVE + 1); renderResults(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); ACTIVE = Math.max(0, ACTIVE - 1); renderResults(); }
  else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); ACTIVE = 0; renderResults(); }
  else if (e.key === 'Enter') { e.preventDefault(); go(ACTIVE); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
  else if (e.key === 'Tab') { e.preventDefault(); } // focus trap: the input is the only stop
}

function go(i) {
  const r = RESULTS[i];
  if (!r) return;
  closePalette({ restore: false });
  if (location.hash === r.href) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = r.href;
}

export function openPalette(data) {
  INDEX = data ? buildIndex(data) : [];
  OPENER = document.activeElement;
  const el = ensureDom();
  el.hidden = false;
  document.body.classList.add('modal-open');
  const input = el.querySelector('#pal-input');
  input.value = '';
  ACTIVE = 0;
  renderResults();
  input.focus();
}
export function closePalette({ restore = true } = {}) {
  const el = document.getElementById('palette');
  if (!el || el.hidden) return;
  el.hidden = true;
  document.body.classList.remove('modal-open');
  if (restore && OPENER && OPENER.focus) OPENER.focus();
}
export const paletteOpen = () => { const el = document.getElementById('palette'); return !!el && !el.hidden; };

// ---------------------------------------------------------------- shortcuts overlay
export function openShortcuts() {
  let el = document.getElementById('shortcuts');
  if (!el) {
    el = document.createElement('div');
    el.id = 'shortcuts';
    el.className = 'overlay';
    const row = (keys, what) => `<div class="sc-row"><dt>${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</dt><dd>${esc(what)}</dd></div>`;
    el.innerHTML = `<div class="pal sc" role="dialog" aria-modal="true" aria-labelledby="sc-title">
      <div class="sc-head"><h2 id="sc-title">Keyboard shortcuts</h2><button class="icon-btn" type="button" data-close-sc aria-label="Close">${icon('close', 18)}</button></div>
      <dl class="sc-list">
        ${row(['/'], 'Quick jump')}${row([MOD, 'K'], 'Quick jump')}
        ${row(['g', 't'], 'Go to Today')}${row(['g', 'c'], 'Go to Courses')}${row(['g', 'k'], 'Go to Calendar')}${row(['g', 'g'], 'Go to Grades')}
        ${row(['['], 'Previous course tab')}${row([']'], 'Next course tab')}
        ${row(['?'], 'Show this list')}${row(['Esc'], 'Close')}
      </dl>
      <p class="muted small">Shortcuts are ignored while you're typing in a field.</p>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('mousedown', (e) => { if (e.target === el || e.target.closest('[data-close-sc]')) { e.preventDefault(); closeShortcuts(); } });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeShortcuts(); }
      if (e.key === 'Tab') e.preventDefault(); // single focus stop (the close button)
    });
  }
  OPENER = document.activeElement;
  el.hidden = false;
  document.body.classList.add('modal-open');
  el.querySelector('[data-close-sc]').focus();
}
export function closeShortcuts() {
  const el = document.getElementById('shortcuts');
  if (!el || el.hidden) return;
  el.hidden = true;
  document.body.classList.remove('modal-open');
  if (OPENER && OPENER.focus) OPENER.focus();
}
export const shortcutsOpen = () => { const el = document.getElementById('shortcuts'); return !!el && !el.hidden; };
