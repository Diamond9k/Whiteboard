import type { ReactNode } from 'react';
import type { Course, ProvEntry, UpcomingItem } from '../types';
import { Icon } from './Icon';
import { useDash } from '../context';
import {
  BAND_LEGEND, BB, PAST_DUE_FULL, courseLabel, gradeClass, kindOf,
  safeColor, safeUrl, sectionOf, shortTitle, sourceLabel, stateReason,
} from '../lib/course';
import {
  dayDiff, fmtAgo, fmtDateTime, fmtDay, fmtDayKey, fmtDueFull, fmtMonth, fmtMonthDay,
  fmtRelDay, fmtTimeCT, fmtWeekday, fmtWhen, gradePercent, parseDate,
} from '../lib/format';
import { bbIsStale, isMaybePast, maybePastFull, maybePastLabel, staleWhy, sysInfo, useTrust, type SysInfo } from '../lib/trust';

const STATE_META: Record<string, { icon: string | null; label: string }> = {
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

const MATCH_MS = 2 * 60 * 1000;
const STALE_MS = 24 * 3600 * 1000;
const SRC_SHORT: Record<string, string> = { 'blackboard-api': 'BB', 'blackboard-dom': 'BB page', pearson: 'MyLab' };

export function Chip({ kind, text, title }: { kind: string; text?: string; title?: string }) {
  const m = STATE_META[kind] || STATE_META.notsynced;
  return (
    <span className="st" data-state={kind} title={title || undefined}>
      {m.icon ? <Icon name={m.icon} size={13} /> : <i className="st-dot" aria-hidden="true" />}
      <span>{text || m.label}</span>
    </span>
  );
}

export function StatePanel({
  kind, title, detail = '', link, checked,
}: {
  kind: string;
  title: string;
  detail?: string;
  link?: { href: string; label: string } | null;
  checked?: string | null;
}) {
  const m = STATE_META[kind] || STATE_META.notsynced;
  const d = parseDate(checked);
  return (
    <div className="state-panel" data-state={kind}>
      <span className="sp-icon"><Icon name={m.icon || 'info'} size={18} /></span>
      <div className="sp-body">
        <strong>{title}</strong>
        {detail ? <p>{detail}</p> : null}
        {d ? <p className="sp-checked" title={fmtDateTime(d)}>Checked {fmtWhen(d)}</p> : null}
        {link ? (
          <div className="sp-act">
            <a className="btn-sec" href={link.href} target="_blank" rel="noopener">{link.label}<Icon name="external" size={13} /></a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function InlineState({ kind, title, detail = '' }: { kind: string; title: string; detail?: string }) {
  const m = STATE_META[kind] || STATE_META.notsynced;
  return (
    <div className="inline-state" data-state={kind}>
      <Icon name={m.icon || 'info'} size={16} />
      <div><strong>{title}</strong>{detail ? <p>{detail}</p> : null}</div>
    </div>
  );
}

export function SectionPanel({ sec, what, link }: { sec: { state?: string; syncedAt?: string }; what: string; link?: { href: string; label: string } | null }) {
  const kind = kindOf(sec.state);
  if (kind === 'forbidden') {
    return <StatePanel kind="forbidden" title={`${what} isn't shared with student accounts`} detail="Blackboard doesn't let a student session read this, so it can't be shown here. It may still be visible in Blackboard itself." link={link} checked={sec.syncedAt} />;
  }
  if (kind === 'expired') return <StatePanel kind="expired" title={`${what}: Blackboard sign-in expired`} detail={stateReason(sec.state)} link={link} checked={sec.syncedAt} />;
  if (kind === 'error') return <StatePanel kind="error" title={`${what} couldn't be read`} detail={stateReason(sec.state)} link={link} checked={sec.syncedAt} />;
  return <StatePanel kind="notsynced" title={`${what} not synced yet`} detail={stateReason(sec.state)} link={link} />;
}

export function Stamp({
  source, syncedAt, stale = false, notes = [], dotOnly = false,
}: {
  source?: string | null;
  syncedAt?: string | null;
  stale?: boolean;
  notes?: string[];
  dotOnly?: boolean;
}) {
  const trust = useTrust();
  const d = parseDate(syncedAt);
  const isPe = source === 'pearson';
  const sys = isPe ? trust.pe : trust.bb;
  const sysLast = isPe ? trust.peLast : trust.bbLast;
  const sysName = isPe ? 'MyLab' : 'Blackboard';
  const sysBad = ['session-expired', 'error', 'parse-failed'].includes(sys.state || '');
  const matches = !!(d && sysLast && Math.abs(d.getTime() - sysLast.getTime()) <= MATCH_MS);
  const full = `Synced from ${sourceLabel(source)} · ${d ? `${fmtDateTime(d)} (${fmtAgo(d)})` : 'time unknown'}`;
  const lines = [full];
  if (matches) lines.push(`Same read as ${sysName}'s last successful sync.`);
  if (stale) lines.push('Cached — the last refresh of this block failed, so this is the earlier copy.');
  if (sysBad) lines.push(`${sysName}'s latest sync attempt ${sys.state === 'session-expired' ? 'hit an expired sign-in' : 'failed'}; this block may be out of date.`);
  if (isPe && sys.state === 'parse-partial') lines.push(`Latest MyLab read was partial${sys.message ? `: ${sys.message}` : '.'}`);
  for (const n of notes) if (n) lines.push(n);
  const warn = stale || sysBad || (!!d && Date.now() - d.getTime() > STALE_MS);
  const mono = (source && SRC_SHORT[source]) || 'Source';
  const today = d && fmtDayKey(d) === fmtDayKey(new Date());
  const when = !d ? 'time unknown' : warn && !today ? fmtMonthDay(d) : fmtWhen(d);
  let short = dotOnly ? when : `${mono} · ${when}`;
  if (stale) short += ' · cached';
  return (
    <details className={`stamp${warn ? ' is-warn' : ''}`}>
      <summary title={full} aria-label={`Source: ${full}`}>
        {warn ? <Icon name="clock" size={12} /> : <i className="stamp-dot" aria-hidden="true" />}
        <span className="stamp-t">{short}</span>
      </summary>
      <div className="stamp-pop">{lines.map((l) => <p key={l}>{l}</p>)}</div>
    </details>
  );
}

export function StaleMark({ word = 'as of', cls = '' }: { word?: string; cls?: string }) {
  const trust = useTrust();
  if (!bbIsStale(trust) || !trust.bbLast) return null;
  const full = `From ${fmtDateTime(trust.bbLast)} (${fmtAgo(trust.bbLast)}): ${staleWhy(trust)}.`;
  return (
    <span className={`stale-mark ${cls}`} title={full}>
      <Icon name="clock" size={12} />
      <span>{word} {fmtMonthDay(trust.bbLast)}</span>
      <span className="sr-only"> — {full}</span>
    </span>
  );
}

export function BandLegend({ cls = '' }: { cls?: string }) {
  const bands: [string, string][] = [['a', '90+'], ['b', '80s'], ['c', '70s'], ['d', '60s'], ['f', '<60']];
  return (
    <div className={`band-legend ${cls}`} role="note" aria-label={BAND_LEGEND}>
      <span className="bl-k">Grade band</span>
      {bands.map(([k, t]) => <span key={k} className={`bl grade-${k}`}><i aria-hidden="true" />{t}</span>)}
    </div>
  );
}

export function PePartialNote() {
  const trust = useTrust();
  if (trust.pe.state !== 'parse-partial') return null;
  return (
    <p className="partial-note">
      <Icon name="halfdot" size={14} />
      <span><strong>Latest MyLab read was partial.</strong> {trust.pe.message || "Part of the MyLab results page couldn't be read."} Each table below shows when it was read.</span>
    </p>
  );
}

export function SearchButton() {
  const { openSearch } = useDash();
  return <button className="icon-btn search-btn" type="button" onClick={openSearch} aria-label="Search courses and items" title="Search"><Icon name="search" size={20} /></button>;
}

export function PageHead({
  title, eyebrow, extra, pill = true, prov = [],
}: {
  title: string;
  eyebrow?: ReactNode;
  extra?: ReactNode;
  pill?: boolean;
  prov?: ProvEntry[];
}) {
  return (
    <header className="page-head">
      <div className="ph-text">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="page-title" tabIndex={-1}>{title}</h1>
      </div>
      <SearchButton />
      <div className="ph-tools">
        {extra}
        {pill ? <Freshness prov={prov} /> : null}
      </div>
    </header>
  );
}

export function SecHead({ title, tools, tag: Tag = 'h2', sub }: { title: ReactNode; tools?: ReactNode; tag?: 'h2' | 'h3'; sub?: ReactNode }) {
  return (
    <div className="sec-head">
      <div className="sec-title-wrap">
        <Tag className="sec-title">{title}</Tag>
        {sub ? <p className="sec-sub">{sub}</p> : null}
      </div>
      {tools ? <div className="sec-tools">{tools}</div> : null}
    </div>
  );
}

export function DateChip({ d, tone }: { d: Date | null; tone?: string | null }) {
  if (!d) return <div className="dchip is-none" aria-hidden="true"><Icon name="ring" size={16} /></div>;
  const t = tone != null ? tone : dayDiff(d) === 0 ? 'is-today' : '';
  return (
    <div className={`dchip ${t}`} aria-hidden="true">
      <span className="dc-m">{fmtMonth(d)}</span>
      <strong className="dc-d">{fmtDay(d)}</strong>
      <span className="dc-w">{fmtWeekday(d)}</span>
    </div>
  );
}

export function DueBadge({ u }: { u: UpcomingItem }) {
  const trust = useTrust();
  if (isMaybePast(trust, u)) {
    return <span className="due-badge is-maybe" title={maybePastFull(trust)}><Icon name="clock" size={12} />{maybePastLabel(trust)}</span>;
  }
  if (u.status === 'overdue') {
    return <span className="due-badge is-overdue" title={PAST_DUE_FULL}><Icon name="alert" size={12} />Past due<span className="sr-only"> · no submission recorded in Blackboard</span></span>;
  }
  if (u.status === 'submitted') {
    return <span className="due-badge is-done" title="Blackboard has a grade or submission for this"><Icon name="check" size={12} />Submitted / graded</span>;
  }
  if (u.status === 'past') return <span className="due-badge" title="Due date passed; Blackboard returned no grade record either way">Due date passed</span>;
  return null;
}

export function DueRow({ u, course, mode = 'tile', showCourse = true }: { u: UpcomingItem; course?: Course | null; mode?: 'tile' | 'day'; showCourse?: boolean }) {
  const trust = useTrust();
  const d = parseDate(u.due);
  const overdue = u.status === 'overdue';
  const maybe = isMaybePast(trust, u);
  const today = d && dayDiff(d) === 0;
  const tone = overdue ? 'is-overdue' : maybe ? 'is-maybe' : today ? 'is-today' : '';
  return (
    <div className={`due-row ${overdue ? 'is-overdue' : ''} ${maybe ? 'is-maybe' : ''} ${u.status === 'submitted' ? 'is-done' : ''}`} style={{ ['--stripe' as string]: safeColor(course ? course.color : null, 'var(--line)') }}>
      {mode === 'tile' ? <DateChip d={d} tone={tone} /> : null}
      <div className="due-text">
        <div className="due-title">{u.title}</div>
        <div className="due-meta">
          {course && showCourse ? <a className="due-course" href={`#/course/${encodeURIComponent(course.id)}`} title={courseLabel(course)}>{course.code || shortTitle(course) || course.id}</a> : null}
          {!d ? <span className="due-time">Due date not synced</span>
            : mode === 'tile'
              ? <span className="due-time" title={fmtDateTime(d)}>{fmtDueFull(d)}</span>
              : <span className="due-time" title={fmtDueFull(d)}>{fmtTimeCT(d)}</span>}
          {u.eventType ? <span className="due-kind">{u.eventType}</span> : null}
        </div>
        {overdue || maybe || u.status === 'submitted' || u.status === 'past' || isMaybePast(trust, u) ? <div className="due-state"><DueBadge u={u} /></div> : null}
      </div>
      {mode === 'tile' && d ? <span className={`due-rel ${tone}`}>{fmtRelDay(d)}</span> : null}
    </div>
  );
}

export function MissingDueNote({ missing }: { missing: Course[] }) {
  if (!missing.length) return null;
  return (
    <p className="missing-line">
      <Icon name="ring" size={14} />
      <span>Due dates not synced for</span>{' '}
      {missing.map((c) => {
        const s = sectionOf(c, 'upcoming');
        return <a key={c.id} className="due-course" href={`#/course/${encodeURIComponent(c.id)}`} title={`${courseLabel(c)} — ${stateReason(s.state)}`}>{c.code || shortTitle(c) || c.id}</a>;
      })}
    </p>
  );
}

export function GradeFigure({ value, size = 'lg' }: { value: string; size?: 'lg' | 'md' }) {
  const p = gradePercent(value);
  return (
    <span className={`gfig-wrap ${gradeClass(value)}`}>
      <span className={`gfig gfig-${size}`}>{value}</span>
      {p != null ? <span className="gbar" aria-hidden="true" title={BAND_LEGEND}><i style={{ width: `${Math.max(0, Math.min(100, p)).toFixed(1)}%` }} /></span> : null}
    </span>
  );
}

export function Onboarding() {
  const { data, requestSync, syncMsg } = useDash();
  const st = data.status || {};
  const bbDone = !!parseDate(st.blackboard && st.blackboard.lastSuccessAt);
  const peDone = !!parseDate(st.pearson && st.pearson.lastSuccessAt);
  const step = (done: boolean, n: number, body: ReactNode) => (
    <li className={done ? 'done' : ''}>
      <span className="step-mark" aria-hidden="true">{done ? <Icon name="check" size={14} /> : n}</span>
      <div>{body}{done ? <span className="sr-only"> (done)</span> : null}</div>
    </li>
  );
  return (
    <div className="card welcome">
      <h2>Nothing synced yet</h2>
      <p className="muted">This page only shows what the extension has read from your own signed-in sessions. Nothing has been read so far, and no sample data is ever shown.</p>
      <ol className="steps">
        {step(bbDone, 1, <><strong>Sign in to Blackboard</strong> (learn.uark.edu). Courses, gradebook, content and due dates are read from there.</>)}
        {step(peDone, 2, <><strong>For MyLab grades,</strong> open Pearson MyLab and visit the <em>Results</em> page while signed in.</>)}
        {step(false, 3, <><strong>Come back here.</strong> The dashboard updates by itself.</>)}
      </ol>
      <div className="welcome-actions">
        <a className="btn" href={`${BB}/ultra/course`} target="_blank" rel="noopener">Open Blackboard<Icon name="external" size={14} /></a>
        <button className="btn-sec" type="button" onClick={() => { void requestSync(); }} aria-describedby="sync-why"><Icon name="sync" size={15} />Sync now</button>
      </div>
      <p className="muted small sync-why" id="sync-why">Sync now only works once a signed-in Blackboard or MyLab tab is open — sign in first, then come back.</p>
      <p className="sync-msg muted small" role="status">{syncMsg}</p>
      <p className="welcome-hint">Works with Blackboard Ultra and Pearson MyLab. Read-only: nothing is ever written back.</p>
      {data._noStorage ? <p className="muted small">Dev note: chrome.storage is unavailable because this page is not running inside the extension. Load the folder as an unpacked extension.</p> : null}
      {data._storageError ? <p className="muted small">Storage error: {data._storageError}</p> : null}
    </div>
  );
}

export function ExtLink({ href, label, cls = 'ext' }: { href?: string | null; label: string; cls?: string }) {
  const u = safeUrl(href);
  if (!u) return null;
  return <a className={cls} href={u} target="_blank" rel="noopener">{label}<Icon name="external" size={13} /></a>;
}

export function CodeEyebrow({ c }: { c: Course }) {
  if (!c.code) return null;
  return <span className="ccode" title={c.bbId || ''}>{c.code}</span>;
}

export function TitleText({ c }: { c: Course }) {
  const t = shortTitle(c);
  if (t) return <>{t}</>;
  if (c.code) return null;
  return <Chip kind="notsynced" text="Course title not synced" />;
}

const SYS_SEV: Record<string, number> = { ok: 0, partial: 1, 'parse-partial': 1, stale: 1, 'session-expired': 2, error: 3, 'parse-failed': 3 };
const SHORT_STATE: Record<string, string> = { ok: '', stale: 'old', partial: 'partly read', 'parse-partial': 'partly read', 'session-expired': 'sign-in expired', error: 'failed', 'parse-failed': "couldn't read" };
const PHONE_FLAG: Record<string, string> = { 'session-expired': 'expired', error: 'failed', 'parse-failed': "couldn't read" };
const SRC_MONO: Record<string, string> = { 'blackboard-api': 'BB', 'blackboard-dom': 'BB page', pearson: 'MyLab' };

export function Freshness({ prov = [] }: { prov?: ProvEntry[] }) {
  const trust = useTrust();
  const { requestSync, syncMsg } = useDash();
  const bb = sysInfo(trust, 'blackboard');
  const pe = sysInfo(trust, 'pearson');
  const sev = (x: { state: string | null }) => (x.state == null ? -1 : SYS_SEV[x.state] ?? 1);
  const worst = Math.max(sev(bb), sev(pe));
  const tone = worst >= 3 ? 'danger' : worst >= 1 ? 'warn' : worst === 0 ? 'ok' : 'none';
  const nothing = !bb.last && !bb.state && !pe.last && !pe.state;
  const describe = (name: string, x: typeof bb) => `${name} ${x.last ? fmtAgo(x.last) : 'not synced'}${x.state && SHORT_STATE[x.state] ? `, ${SHORT_STATE[x.state]}` : ''}`;
  return (
    <details className="fresh" data-tone={tone}>
      <summary aria-label={`Sync status: ${nothing ? 'nothing synced yet' : `${describe('Blackboard', bb)}; ${describe('MyLab', pe)}`}. Open details.`}>
        <i className="fp-dot" aria-hidden="true" />
        <span className="fp-label">
          {nothing ? <span className="fp-part">Nothing synced yet</span> : <><FreshPart name="Blackboard" short="BB" x={bb} /><span className="fp-sep" aria-hidden="true">·</span><FreshPart name="MyLab" short="MyLab" x={pe} /></>}
        </span>
        <Icon name="chevronDown" size={14} />
      </summary>
      <div className="fresh-pop" role="group" aria-label="Sync details">
        <div className="fs-head"><strong>Sync status</strong><span className="muted small">Each system's last successful sync. Blocks that were read at another time show their own dated stamp.</span></div>
        <FreshRow name="Blackboard" x={bb} link={`${BB}/ultra/course`} />
        <FreshRow name="MyLab" x={pe} link="https://mylab.pearson.com/" />
        {prov.length ? (
          <div className="fs-prov">
            <strong className="fs-h">On this page</strong>
            <ul>
              {prov.map((p) => {
                const d = parseDate(p.syncedAt);
                const sysLast = p.source === 'pearson' ? pe.last : bb.last;
                const same = d && sysLast && Math.abs(d.getTime() - sysLast.getTime()) <= 120000;
                return (
                  <li key={p.label + (p.syncedAt || '')}>
                    <span className="fs-mono">{SRC_MONO[p.source] || 'Source'}</span>
                    <div>
                      <span>{p.label} · {sourceLabel(p.source)} · {d ? <>{fmtWhen(d)}{same ? <span className="muted"> (same as last sync)</span> : null}</> : 'time unknown'}</span>
                      {p.notes.filter(Boolean).map((n) => <p key={n} className="muted small">{n}</p>)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <div className="fs-actions">
          <button className="btn" type="button" onClick={() => { void requestSync(); }}><Icon name="sync" size={15} />Sync now</button>
          <a className="text-link" href="#/tools">Diagnostics<Icon name="arrowRight" size={13} /></a>
        </div>
        <p className="sync-msg muted small" role="status">{syncMsg}</p>
        <p className="muted small">Read-only: nothing here writes to Blackboard or MyLab.</p>
      </div>
    </details>
  );
}

function FreshPart({ name, short, x }: { name: string; short: string; x: { last: Date | null; state: string | null } }) {
  if (!x.last && !x.state) {
    return <span className="fp-part"><span className="fp-l">{name}</span><span className="fp-s">{short}</span> <span className="fp-na">not synced</span><span className="fp-na-s">—</span></span>;
  }
  const flag = x.state && SHORT_STATE[x.state] ? <span className="fp-flag"> · {SHORT_STATE[x.state]}</span> : null;
  const sflag = x.state && PHONE_FLAG[x.state] ? <span className="fp-flag-s">{PHONE_FLAG[x.state]} </span> : null;
  const clock = x.last ? ((fmtAgoShort(x.last) || '').endsWith('d') ? fmtMonthDay(x.last) : fmtWhen(x.last)) : '';
  return (
    <span className="fp-part">
      <span className="fp-l">{name}</span><span className="fp-s">{short}</span>{' '}
      {x.last
        ? <><span className="fp-age"><span className="fp-clock">{clock}</span> · {fmtAgo(x.last)}</span><span className="fp-age-s">{sflag}{fmtAgoShort(x.last)}</span></>
        : <><span className="fp-age">no successful sync</span><span className="fp-age-s">{sflag}—</span></>}
      {flag}
    </span>
  );
}

function fmtAgoShort(d: Date): string | null {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function FreshRow({ name, x, link }: { name: string; x: SysInfo; link: string }) {
  const s = x.s;
  const at = parseDate(s.at);
  const kind = x.state === 'ok' ? 'ok' : x.state === 'stale' ? 'stale' : x.state ? kindOf(x.state) : 'notsynced';
  const stText: Record<string, string> = { ok: 'OK', stale: 'Older than a day', partial: 'Partly read', 'parse-partial': 'Partly read', 'session-expired': 'Sign-in expired', error: 'Last sync failed', 'parse-failed': "Page couldn't be read" };
  const label = (x.state && stText[x.state]) || (x.state ? x.state : 'Never synced');
  const detail = x.state === 'parse-partial'
    ? `Partly read: ${s.message || 'part of the results page could not be read.'} Everything else was read normally.`
    : s.message || '';
  return (
    <div className="fs-row">
      <div className="fs-top"><strong>{name}</strong><Chip kind={kind} text={label} /></div>
      <dl>
        <dt>Last success</dt>
        <dd>
          {x.last ? <>{fmtDateTime(x.last)} <span className="muted">({fmtAgo(x.last)})</span>{x.fromRecord ? <><br /><span className="muted small">From the newest MyLab record; no sync status was recorded.</span></> : null}</> : <span className="muted">never</span>}
        </dd>
        {s.source ? <><dt>Via</dt><dd>{sourceLabel(s.source)}</dd></> : null}
        <dt>Last attempt</dt>
        <dd>{at ? fmtFull(at) : <span className="muted">—</span>}</dd>
        {detail ? <><dt>Detail</dt><dd>{detail}</dd></> : null}
      </dl>
      <a className="text-link" href={link} target="_blank" rel="noopener">Open {name}<Icon name="external" size={12} /></a>
    </div>
  );
}

function fmtFull(d: Date) {
  return <>{fmtDateTime(d)} ({fmtAgo(d)})</>;
}
