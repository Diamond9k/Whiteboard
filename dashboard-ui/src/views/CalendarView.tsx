import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DueRowModel, ProvEntry } from '../types';
import { Icon } from '../components/Icon';
import { DateChip, DueRow, MissingDueNote, Onboarding, PageHead, StatePanel, StaleMark } from '../components/bits';
import { useDash } from '../context';
import { BB, DUE_NOTE, PAST_DUE_FULL, collectDueItems, courseLabel, dueTime, safeColor } from '../lib/course';
import { fmtDayHeading, fmtDayKey, fmtDueFull, fmtRelDay, parseDate } from '../lib/format';
import { isMaybePast, maybePastLabel, useTrust } from '../lib/trust';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_MS = 864e5;
let SELECTED: string | null = null;

function keyOf(r: DueRowModel) {
  const d = parseDate(r.u.due);
  return d ? fmtDayKey(d) : null;
}

export function Agenda({ rows, showCourse = true, upcomingFirst = false, split = false, recentDays = 14, mode = 'agenda' }: {
  rows: DueRowModel[]; showCourse?: boolean; upcomingFirst?: boolean; split?: boolean; recentDays?: number; mode?: 'agenda' | 'recent';
}) {
  const trust = useTrust();
  const now = new Date();
  const todayKey = fmtDayKey(now);
  const dated = rows.filter((r) => parseDate(r.u.due));
  const undated = rows.filter((r) => !parseDate(r.u.due));
  const group = (list: DueRowModel[]) => {
    const g = new Map<string, DueRowModel[]>();
    for (const r of list) { const k = keyOf(r); if (!k) continue; if (!g.has(k)) g.set(k, []); g.get(k)!.push(r); }
    return g;
  };
  const pastDue = dated.filter((r) => r.u.status === 'overdue' || isMaybePast(trust, r.u)).sort((a, b) => dueTime(b) - dueTime(a));
  const rest = dated.filter((r) => r.u.status !== 'overdue' && !isMaybePast(trust, r.u));
  const upcoming = rest.filter((r) => (keyOf(r) || '') >= todayKey).sort((a, b) => dueTime(a) - dueTime(b));
  const earlier = rest.filter((r) => (keyOf(r) || '') < todayKey).sort((a, b) => dueTime(b) - dueTime(a));
  const cutoff = now.getTime() - recentDays * DAY_MS;
  const recent = earlier.filter((r) => dueTime(r) >= cutoff);
  const older = earlier.filter((r) => dueTime(r) < cutoff);
  const render = (list: DueRowModel[], past = false) => [...group(list)].map(([k, l]) => (
    <DayGroup key={k} k={k} list={l} showCourse={showCourse} todayKey={todayKey} tone={!past ? '' : l.some((r) => r.u.status === 'overdue') ? 'is-overdue' : 'is-maybe'} />
  ));
  const maybeN = pastDue.filter((r) => isMaybePast(trust, r.u)).length;
  const pdTone = pastDue.length && maybeN === pastDue.length ? 'is-maybe' : 'is-danger';
  const pd = pastDue.length ? (
    <section className={`agenda-sec ${pdTone}`}>
      <h2 className={`act-heading ${pdTone}`} title={PAST_DUE_FULL}>Past due <span className="count">{pastDue.length}</span><StaleMark /></h2>
      {maybeN ? <p className="sec-note is-maybe"><Icon name="clock" size={13} /><span>{maybeN} of these {maybeN === 1 ? 'was' : 'were'} not yet due at the last sync, so {maybeN === 1 ? 'its' : 'their'} status is unknown. Nothing is marked missing without a Blackboard record.</span></p> : null}
      {render(pastDue, true)}
    </section>
  ) : null;
  const up = (
    <section className="agenda-sec">
      <h2 className="act-heading">Upcoming <span className="count">{upcoming.length}</span><StaleMark /></h2>
      {upcoming.length ? render(upcoming) : <p className="empty-line">Nothing due from today on in synced data.</p>}
    </section>
  );
  const rc = !recent.length && !split && mode !== 'recent' ? null : (
    <section className="agenda-sec is-recent">
      <h2 className="act-heading">Recently due <span className="count">{recent.length}</span><span className="act-sub">last {recentDays} days</span><StaleMark /></h2>
      {recent.length ? render(recent) : <p className="empty-line">Nothing else was due in the last {recentDays} days.</p>}
    </section>
  );
  const ol = older.length ? (
    <details className="fold">
      <summary><Icon name="chevronRight" size={15} />Older than {recentDays} days <span className="count">{older.length}</span><StaleMark /></summary>
      {render(older)}
    </details>
  ) : null;
  const nd = undated.length ? (
    <section className="agenda-sec">
      <h2 className="act-heading">No due date <span className="count">{undated.length}</span></h2>
      <div className="card list-card due-list">{undated.map((r, i) => <DueRow key={i} u={r.u} course={r.c} mode="day" showCourse={showCourse} />)}</div>
    </section>
  ) : null;
  if (mode === 'recent') {
    return <div className="agenda agenda-wide">{pd}{rc}{ol}<p className="agenda-more"><a className="text-link" href="#/calendar">Upcoming in Agenda<Icon name="arrowRight" size={14} /></a></p></div>;
  }
  const main = upcomingFirst ? <>{up}{pd}</> : <>{pd}{up}</>;
  return split
    ? <div className="agenda agenda-split"><div className="ag-main">{main}{nd}</div><div className="ag-hist">{rc}{ol}</div></div>
    : <div className="agenda">{main}{nd}{rc}{ol}</div>;
}

function DayGroup({ k, list, showCourse, todayKey, tone }: { k: string; list: DueRowModel[]; showCourse: boolean; todayKey: string; tone: string }) {
  const d = parseDate(list[0].u.due);
  const isToday = k === todayKey;
  const t = tone || (isToday ? 'is-today' : '');
  return (
    <div className={`day-group ${t}`}>
      <div className="day-rail" title={d ? fmtDayHeading(d) : ''}>{d ? <DateChip d={d} tone={t} /> : null}<span className="day-rel">{d ? fmtRelDay(d) : ''}</span>{d ? <span className="sr-only">{fmtDayHeading(d)}</span> : null}</div>
      <div className="card list-card due-list">{list.map((r, i) => <DueRow key={i} u={r.u} course={r.c} mode="day" showCourse={showCourse} />)}</div>
    </div>
  );
}

function Seg({ mode }: { mode: string }) {
  const a = (m: string, href: string, ic: string, label: string) => (
    <a href={href} aria-current={mode === m ? 'page' : undefined} className={mode === m ? 'on' : undefined}>{<Icon name={ic} size={15} />}{label}</a>
  );
  return <nav className="seg" aria-label="Calendar view">{a('agenda', '#/calendar', 'list', 'Agenda')}{a('month', '#/calendar/month', 'calendar', 'Month')}{a('recent', '#/calendar/recent', 'clock', 'Recent')}</nav>;
}

export function CalendarPage({ parts }: { parts: string[] }) {
  const { data } = useDash();
  const mode = parts[0] === 'month' ? 'month' : parts[0] === 'recent' ? 'recent' : 'agenda';
  const bbLink = <a className="btn-sec btn-compact" href={`${BB}/ultra/calendar`} target="_blank" rel="noopener"><span>Blackboard<span className="hide-phone"> calendar</span></span><Icon name="external" size={13} /></a>;
  if (!data.courses.length) return <><PageHead title="Calendar" /><Onboarding /></>;
  const { rows, missing, syncedAt } = collectDueItems(data);
  const prov: ProvEntry[] = syncedAt ? [{ label: 'Due dates', source: 'blackboard-api', syncedAt, notes: [DUE_NOTE] }] : [];
  const toolbar = <div className="cal-toolbar"><Seg mode={mode} />{bbLink}</div>;
  if (!rows.length) {
    return (
      <>
        <PageHead title="Calendar" prov={prov} />
        {toolbar}
        <StatePanel kind="notsynced" title="No due dates synced yet" detail="The calendar shows Blackboard due dates (gradebook columns and calendar items)." link={{ href: `${BB}/ultra/calendar`, label: 'Open Calendar in Blackboard' }} />
        <MissingDueNote missing={missing} />
      </>
    );
  }
  return (
    <>
      <PageHead title="Calendar" prov={prov} />
      {toolbar}
      {mode === 'month' ? <MonthView rows={rows} ym={parts[1]} /> : mode === 'recent' ? <Agenda rows={rows} mode="recent" /> : <Agenda rows={rows} split />}
      <MissingDueNote missing={missing} />
    </>
  );
}

function MonthView({ rows, ym }: { rows: DueRowModel[]; ym?: string }) {
  const trust = useTrust();
  const [, bump] = useState(0);
  const now = new Date();
  const todayKey = fmtDayKey(now);
  let [y, m] = todayKey.split('-').map(Number);
  const mm = /^(\d{4})-(\d{2})$/.exec(ym || '');
  if (mm && +mm[2] >= 1 && +mm[2] <= 12) { y = +mm[1]; m = +mm[2]; }
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymKey = (yy: number, mo: number) => `${yy}-${pad(mo)}`;
  const prev = m === 1 ? ymKey(y - 1, 12) : ymKey(y, m - 1);
  const next = m === 12 ? ymKey(y + 1, 1) : ymKey(y, m + 1);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const byDay = new Map<string, DueRowModel[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }
  for (const l of byDay.values()) l.sort((a, b) => dueTime(a) - dueTime(b));
  const monthPrefix = ymKey(y, m);
  const inMonth = (k: string | null) => !!k && k.startsWith(monthPrefix);
  const monthCount = [...byDay.keys()].filter(inMonth).reduce((n, k) => n + (byDay.get(k)?.length || 0), 0);
  let sel = SELECTED && inMonth(SELECTED) ? SELECTED : null;
  if (!sel) {
    const withItems = [...byDay.keys()].filter(inMonth).sort();
    sel = withItems.find((k) => k >= todayKey) || (inMonth(todayKey) ? todayKey : withItems[0]) || `${monthPrefix}-01`;
  }
  const stOf = (r: DueRowModel) => (r.u.status === 'overdue' ? 'is-overdue' : isMaybePast(trust, r.u) ? 'is-maybe' : r.u.status === 'submitted' ? 'is-done' : '');
  let anyMaybe = false;
  const cells: ReactNode[] = [];
  for (let i = 0; i < lead; i++) cells.push(<td key={`p${i}`} className="m-pad" aria-hidden="true" />);
  for (let dd = 1; dd <= days; dd++) {
    const k = `${monthPrefix}-${pad(dd)}`;
    const list = byDay.get(k) || [];
    const isToday = k === todayKey;
    const hasOver = list.some((r) => r.u.status === 'overdue');
    if (list.some((r) => isMaybePast(trust, r.u))) anyMaybe = true;
    const label = `${weekdayLong(y, m, dd)}, ${MONTHS[m - 1]} ${dd}${isToday ? ' (today)' : ''}: ${list.length ? `${list.length} item${list.length === 1 ? '' : 's'} due${hasOver ? ', including past due' : ''}` : 'nothing due'}`;
    cells.push(
      <td key={k} className={`m-cell${isToday ? ' is-today' : ''}${k === sel ? ' is-sel' : ''}${list.length ? ' has-items' : ''}`}>
        <button type="button" className="m-day" aria-pressed={k === sel} aria-label={label} onClick={() => { SELECTED = k; bump((n) => n + 1); }}>
          <span className="m-num">{dd}</span>
          <span className="m-chips" aria-hidden="true">
            {list.slice(0, 2).map((r, i) => {
              const d = parseDate(r.u.due);
              const full = `${r.c.code || courseLabel(r.c)} · ${r.u.title} · ${d ? fmtDueFull(d) : ''}`;
              return <span key={i} className={`mchip ${stOf(r)}`} style={{ ['--stripe' as string]: safeColor(r.c.color) }} title={full}><b>{(r.c.code || '').split(' ')[0]}</b> {r.u.title}</span>;
            })}
            {list.length > 2 ? <span className="mmore">+{list.length - 2} more</span> : null}
          </span>
          <span className="m-dots" aria-hidden="true">{list.map((r, i) => <i key={i} className={`mdot ${stOf(r)}`} style={{ ['--stripe' as string]: safeColor(r.c.color) }} />)}</span>
        </button>
      </td>,
    );
  }
  while (cells.length % 7) cells.push(<td key={`e${cells.length}`} className="m-pad" aria-hidden="true" />);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(<tr key={i}>{cells.slice(i, i + 7)}</tr>);
  const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const selList = byDay.get(sel) || [];
  const [sy, sm, sd] = sel.split('-').map(Number);
  const selHead = `${weekdayLong(sy, sm, sd)}, ${MONTHS[sm - 1].slice(0, 3)} ${sd}`;
  const selDate = new Date(Date.UTC(sy, sm - 1, sd, 18));
  const isCurMonth = inMonth(todayKey);
  return (
    <div className="month">
      <div className="month-head">
        <h2 className="month-title">{MONTHS[m - 1]} <span>{y}</span></h2>
        <span className="month-count">{monthCount} item{monthCount === 1 ? '' : 's'} due<StaleMark /></span>
        <div className="month-nav">
          <a className="icon-btn" href={`#/calendar/month/${prev}`} aria-label="Previous month"><Icon name="chevronLeft" size={18} /></a>
          {isCurMonth ? null : <a className="btn-sec btn-compact" href="#/calendar/month">Today</a>}
          <a className="icon-btn" href={`#/calendar/month/${next}`} aria-label="Next month"><Icon name="chevronRight" size={18} /></a>
        </div>
      </div>
      <div className="month-main">
        <table className="month-grid">
          <thead><tr>{wk.map((d) => <th key={d} scope="col"><span aria-hidden="true">{d[0]}</span><span className="m-wk-l">{d}</span><span className="sr-only">{d}</span></th>)}</tr></thead>
          <tbody>{weeks}</tbody>
        </table>
        <div className="m-legend" aria-label="Legend">
          <span className="ml-i"><i className="mdot" /><span className="mlg-sw" />Due</span>
          <span className="ml-i is-overdue"><i className="mdot is-overdue" /><span className="mlg-sw" />Past due (no submission recorded)</span>
          {anyMaybe ? <span className="ml-i is-maybe"><i className="mdot is-maybe" /><span className="mlg-sw" />{maybePastLabel(trust)}</span> : null}
          <span className="ml-i is-done"><i className="mdot is-done" /><span className="mlg-sw" />Submitted / graded</span>
        </div>
      </div>
      <aside className="month-side" aria-live="polite" aria-label="Selected day">
        <div className="sec-head"><div className="sec-title-wrap"><h3 className="sec-title">{selHead}</h3><p className="sec-sub">{fmtRelDay(selDate)}</p></div></div>
        {selList.length
          ? <div className="card list-card due-list">{selList.map((r, i) => <DueRow key={i} u={r.u} course={r.c} mode="day" />)}</div>
          : <p className="empty-line">Nothing due this day in synced data.</p>}
      </aside>
    </div>
  );
}

function weekdayLong(y: number, m: number, d: number) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
