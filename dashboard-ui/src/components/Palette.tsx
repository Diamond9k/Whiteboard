import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardData } from '../types';
import { Icon } from './Icon';
import { isOpen, isVerified, itemsSchema, MOD, safeColor, shortTitle } from '../lib/course';
import { fmtMonthDay, parseDate } from '../lib/format';

interface Hit {
  label: string;
  href: string;
  kind: string;
  sub?: string;
  hint?: string;
  color?: string;
  rank: number;
}

const PAGES: Hit[] = [
  { label: 'Today', href: '#/today', kind: 'Page', hint: 'g t', rank: 0 },
  { label: 'Courses', href: '#/courses', kind: 'Page', hint: 'g c', rank: 0 },
  { label: 'Calendar', href: '#/calendar', kind: 'Page', hint: 'g k', rank: 0 },
  { label: 'Calendar · Month', href: '#/calendar/month', kind: 'Page', rank: 0 },
  { label: 'Grades', href: '#/grades', kind: 'Page', hint: 'g g', rank: 0 },
  { label: 'Diagnostics', href: '#/tools', kind: 'Page', rank: 0 },
];

function buildIndex(data: DashboardData | null): Hit[] {
  const out: Hit[] = [];
  const schema = itemsSchema();
  for (const c of data?.courses || []) {
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
    if (p && isVerified(p) && Array.isArray(p.items) && p.itemsSchema === schema) {
      for (const it of p.items) if (it.title) out.push({ label: it.title, sub: `${code} · MyLab`, kind: 'MyLab', href: `${base}/gradebook`, color, rank: 2 });
    }
  }
  return out;
}

function score(item: Hit, q: string): number {
  const hay = `${item.label} ${item.sub || ''}`.toLowerCase();
  const l = item.label.toLowerCase();
  if (!q) return item.kind === 'Page' ? 1 : item.kind === 'Course' ? 2 : -1;
  const terms = q.split(/\s+/).filter(Boolean);
  if (!terms.every((t) => hay.includes(t))) return -1;
  let s = 10 - item.rank;
  if (terms.every((t) => l.includes(t))) s += 8;
  for (const t of terms) if (l.split(/[^a-z0-9.]+/).includes(t)) s += 3;
  if (l.startsWith(q)) s += 20;
  else if (new RegExp(`(^|\\W)${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(l)) s += 10;
  if (item.kind === 'Course' || item.kind === 'Page') s += 6;
  return s;
}

export function Palette({ open, data, onClose }: { open: boolean; data: DashboardData | null; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const index = useMemo(() => buildIndex(data), [data]);
  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return [...PAGES, ...index].map((it) => ({ it, s: score(it, query) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.it);
  }, [q, index]);
  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    const t = window.setTimeout(() => input.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);
  useEffect(() => { if (active >= results.length) setActive(Math.max(0, results.length - 1)); }, [results.length, active]);
  if (!open) return null;
  const go = (i: number) => {
    const r = results[i];
    if (!r) return;
    onClose();
    if (location.hash === r.href) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = r.href;
  };
  return (
    <div id="palette" className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Quick jump">
        <div className="pal-field">
          <Icon name="search" size={18} />
          <input
            ref={input}
            id="pal-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-autocomplete="list"
            aria-activedescendant={results.length ? `pal-o-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="Jump to a course, assignment or page…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((n) => Math.min(results.length - 1, n + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((n) => Math.max(0, n - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); go(active); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
              else if (e.key === 'Tab') e.preventDefault();
            }}
          />
          <kbd className="pal-esc">Esc</kbd>
        </div>
        <ul id="pal-list" className="pal-list" role="listbox" aria-label="Results">
          {results.length ? results.map((r, i) => (
            <li key={`${r.kind}-${r.href}-${r.label}-${i}`} id={`pal-o-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); go(i); }}>
              <span className="pal-dot" style={{ ['--stripe' as string]: r.color || 'var(--faint)' }} />
              <span className="pal-text"><span className="pal-label">{r.label}</span>{r.sub ? <span className="pal-sub">{r.sub}</span> : null}</span>
              <span className="pal-kind">{r.kind}{r.hint ? <> <kbd>{r.hint}</kbd></> : null}</span>
            </li>
          )) : <li className="pal-empty" role="presentation">Nothing in synced data matches “{q.trim()}”.</li>}
        </ul>
        <div className="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>?</kbd> shortcuts</span></div>
      </div>
    </div>
  );
}

export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) btn.current?.focus(); }, [open]);
  if (!open) return null;
  const row = (keys: string[], what: string) => (
    <div className="sc-row" key={what + keys.join()}><dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt><dd>{what}</dd></div>
  );
  return (
    <div id="shortcuts" className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}>
      <div className="pal sc" role="dialog" aria-modal="true" aria-labelledby="sc-title" onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        if (e.key === 'Tab') e.preventDefault();
      }}>
        <div className="sc-head"><h2 id="sc-title">Keyboard shortcuts</h2><button ref={btn} className="icon-btn" type="button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <dl className="sc-list">
          {row(['/'], 'Quick jump')}
          {row([MOD, 'K'], 'Quick jump')}
          {row(['g', 't'], 'Go to Today')}
          {row(['g', 'c'], 'Go to Courses')}
          {row(['g', 'k'], 'Go to Calendar')}
          {row(['g', 'g'], 'Go to Grades')}
          {row(['['], 'Previous course tab')}
          {row([']'], 'Next course tab')}
          {row(['?'], 'Show this list')}
          {row(['Esc'], 'Close')}
        </dl>
        <p className="muted small">Shortcuts are ignored while you're typing in a field.</p>
      </div>
    </div>
  );
}
