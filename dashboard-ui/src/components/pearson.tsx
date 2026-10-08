import type { ReactNode } from 'react';
import type { Course, GradeItem, Gradebook, PearsonRecord } from '../types';
import { Icon } from './Icon';
import { Chip, GradeFigure, PePartialNote, SecHead, Stamp, SectionPanel, BandLegend } from './bits';
import {
  BAND_LEGEND, courseUrl, gradeClass, gradeStatusText, isVerified, itemsSchema, kindOf, safeUrl, sectionOf, sortedGbItems,
} from '../lib/course';
import { fmtDateTime, fmtDueFull, fmtMonthDay, fmtWhen, parseDate } from '../lib/format';
import { useTrust } from '../lib/trust';

interface Lane {
  key: string;
  label: string;
  value: string | null;
  sub?: string | null;
  text?: string | null;
  kind: string;
  stamp: boolean;
  source?: string | null;
  syncedAt?: string | null;
  stale?: boolean;
  notes?: string[];
}

function gradeLanes(c: Course): Lane[] {
  const lanes: Lane[] = [];
  const p = c.pearson;
  if (p && isVerified(p)) {
    const missing = Array.isArray(p.parseMissing) ? p.parseMissing : [];
    lanes.push({
      key: 'mylab', label: 'MyLab',
      value: p.currentGrade || null,
      sub: p.overallPoints || null,
      text: p.currentGrade ? null : (missing.includes('overall') ? "Overall score couldn't be read" : 'Overall score not synced'),
      kind: p.currentGrade ? 'ok' : (missing.includes('overall') ? 'partial' : 'notsynced'),
      stamp: true, source: 'pearson', syncedAt: p.syncedAt,
      notes: [p.matchedBy ? `Matched to this course by ${p.matchedBy}.` : ''],
    });
  }
  const gb = c.gradebook;
  const sec = sectionOf(c, 'gradebook');
  if (gb && isVerified(gb)) {
    if (gb.empty) lanes.push({ key: 'bb', label: 'Blackboard', value: null, text: 'No grades posted', kind: 'empty', stamp: true, source: gb.source, syncedAt: gb.syncedAt, stale: sec.stale });
    else if (gb.currentGrade) lanes.push({ key: 'bb', label: 'Blackboard', value: gb.currentGrade, sub: gb.overallColumn || null, kind: sec.state === 'partial' ? 'partial' : 'ok', stamp: true, source: gb.source, syncedAt: gb.syncedAt, stale: sec.stale });
    else lanes.push({ key: 'bb', label: 'Blackboard', value: null, text: gb.overallAmbiguous ? 'Overall not picked (several total columns)' : 'No overall grade shown', kind: 'empty', stamp: true, source: gb.source, syncedAt: gb.syncedAt, stale: sec.stale });
  } else {
    const kind = kindOf(sec.state);
    lanes.push({
      key: 'bb', label: 'Blackboard', value: null, stamp: false, kind,
      text: kind === 'forbidden' ? 'Not shared with student accounts' : kind === 'error' ? "Couldn't be read" : kind === 'expired' ? 'Sign-in expired' : 'Not synced yet',
    });
  }
  return lanes.sort((a, b) => (b.value ? 1 : 0) - (a.value ? 1 : 0));
}

function LaneView({ l, big }: { l: Lane; big: boolean }) {
  const trust = useTrust();
  return (
    <div className={`lane lane-${l.key}${l.value ? ' has-value' : ''}`}>
      <div className="lane-head">
        <span className="lane-label">{l.label}</span>
        <span className="lane-meta">
          {l.kind === 'partial' ? <Chip kind="partial" text="Partly read" title={trust.pe.message || ''} /> : null}
          {l.stamp ? <Stamp source={l.source} syncedAt={l.syncedAt} stale={l.stale} notes={l.notes} dotOnly /> : null}
        </span>
      </div>
      {l.value
        ? <><div className="lane-val"><GradeFigure value={l.value} size={big ? 'lg' : 'md'} /></div>{l.sub ? <div className="lane-sub">{l.sub}</div> : null}</>
        : <div className="lane-empty">{l.kind === 'empty' ? <span className="muted">{l.text}</span> : <Chip kind={l.kind} text={l.text || undefined} />}</div>}
    </div>
  );
}

export function Lanes({ c, big = true, extra }: { c: Course; big?: boolean; extra?: ReactNode }) {
  const trust = useTrust();
  const lanes = gradeLanes(c).map((l) => (
    l.key === 'mylab' && l.value && trust.pe.state === 'parse-partial' ? { ...l, kind: 'partial' } : l
  ));
  const n = lanes.length + (extra ? 1 : 0);
  return <div className={`lanes lanes-${n}`}>{lanes.map((l) => <LaneView key={l.key} l={l} big={big} />)}{extra}</div>;
}

function ItemSummary({ gb }: { gb: Gradebook }) {
  const items = Array.isArray(gb.items) ? gb.items : [];
  if (!items.length) return null;
  const graded = items.filter((i) => i.grade).length;
  const waiting = items.filter((i) => !i.grade && (i.status === 'NeedsGrading' || i.status === 'InProgress')).length;
  const none = items.length - graded - waiting;
  const row = (n: number, t: string, cls = '') => <li className={cls}><b>{n}</b><span>{t}</span></li>;
  return (
    <div className="lane lane-sum">
      <div className="lane-head">
        <span className="lane-label">Blackboard items</span>
        <span className="lane-meta"><Stamp source={gb.source} syncedAt={gb.syncedAt} dotOnly /></span>
      </div>
      <ul className="sum-list">{row(graded, 'graded')}{waiting ? row(waiting, 'awaiting grading', 'is-warn') : null}{row(none, 'no grade yet', 'is-muted')}</ul>
    </div>
  );
}

export function PillGrade({ it }: { it: GradeItem }) {
  if (it.grade) return <span className={`pill-grade ${gradeClass(it.grade)}`} title={BAND_LEGEND}>{it.grade}</span>;
  return it.possible != null ? <span className="muted">— / {it.possible}</span> : <span className="muted">—</span>;
}

export function ItemStatus({ it }: { it: GradeItem }) {
  if (!it.status) return <span className="muted" title="Blackboard returned no grade record for this item">—</span>;
  const tone = it.status === 'Graded' || it.status === 'Completed' ? 'is-ok' : it.status === 'NeedsGrading' || it.status === 'InProgress' ? 'is-warn' : '';
  return <span className={`item-st ${tone}`}>{gradeStatusText(it.status)}</span>;
}

export function BbItemsTable({ gb }: { gb: Gradebook }) {
  const items = sortedGbItems(gb) as GradeItem[];
  if (!items.length) return null;
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Blackboard gradebook items">
      <table className="data-table stack-table bb-items">
        <thead><tr><th scope="col">Item</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col" className="num">Grade</th></tr></thead>
        <tbody>
          {items.map((it, i) => {
            const d = parseDate(it.due);
            return (
              <tr key={`${it.title}-${i}`}>
                <th scope="row" className="cell-title">{it.title}</th>
                <td className="cell-kv nowrap nolabel" data-label="Due">{d ? <span title={fmtDateTime(d)}>{fmtDueFull(d)}</span> : <span className="muted">No due date</span>}</td>
                <td className="cell-kv nolabel cell-status" data-label="Status"><ItemStatus it={it} /></td>
                <td className="num cell-key" data-label="Grade"><PillGrade it={it} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PartCaption({ p, part, label }: { p: PearsonRecord; part: string; label: string }) {
  const trust = useTrust();
  const sp = Array.isArray(p.staleParts) ? p.staleParts.find((x) => x.part === part) : null;
  if (sp) {
    const d = parseDate(sp.syncedAt);
    const title = `The latest MyLab page didn't show the ${label.toLowerCase()}, so this is the copy read ${d ? fmtDateTime(d) : 'earlier (time unknown)'}.`;
    return <p className="part-cap is-stale" title={title}><Icon name="clock" size={12} /><span>{label} · From earlier read · {d ? fmtMonthDay(d) : 'time unknown'}</span></p>;
  }
  if (trust.pe.state !== 'parse-partial') return null;
  const d = parseDate(p.syncedAt);
  return <p className="part-cap" title={d ? fmtDateTime(d) : ''}><Icon name="clock" size={12} /><span>{label} · Read {d ? fmtWhen(d) : 'time unknown'}</span></p>;
}

export function CategoryTable({ p }: { p: PearsonRecord }) {
  const cats = Array.isArray(p.categories) ? p.categories : [];
  const dash = <span className="muted">—</span>;
  if (cats.length) {
    const row = (c: { name?: string; average?: string; earned?: string; weight?: string }, total = false, key?: string) => (
      <tr key={key} className={total ? 'row-total' : undefined}>
        <th scope="row" className="cell-title">{c.name}</th>
        <td className="num cell-key" data-label="Average">{c.average || dash}</td>
        <td className="num cell-kv nolabel" data-label="Points earned">{c.earned || dash}{c.weight ? <> <span className="muted small">of {c.weight}</span></> : null}</td>
      </tr>
    );
    return (
      <>
        <PartCaption p={p} part="categories" label="Category table" />
        <div className="table-scroll breakdown-wrap">
          <table className="data-table breakdown stack-table">
            <thead><tr><th scope="col">Category</th><th scope="col" className="num">Average</th><th scope="col" className="num">Points earned</th></tr></thead>
            <tbody>{cats.map((c, i) => row(c, false, `${c.name}-${i}`))}</tbody>
            {p.categoryTotal ? <tfoot>{row({ ...p.categoryTotal, name: p.categoryTotal.name || 'Total' }, true)}</tfoot> : null}
          </table>
        </div>
      </>
    );
  }
  if (p.breakdown && typeof p.breakdown === 'object' && Object.keys(p.breakdown).length) {
    return (
      <table className="data-table breakdown">
        <tbody>
          {Object.entries(p.breakdown).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td className="num">{v}</td></tr>)}
        </tbody>
      </table>
    );
  }
  return null;
}

const fmtPct = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? `${n}%` : null);

function PearsonItemsTable({ items }: { items: NonNullable<PearsonRecord['items']> }) {
  const dash = <span className="muted">—</span>;
  const cell = (v?: string) => (v ? v : dash);
  return (
    <>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="MyLab assignments">
        <table className="data-table pearson-items stack-table">
          <thead>
            <tr>
              <th scope="col">Assignment</th><th scope="col">Category</th><th scope="col" className="num">Correct/Total</th>
              <th scope="col" className="num">Score</th><th scope="col">Time spent</th><th scope="col">Date started</th><th scope="col">Date worked</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const dates = [it.dateStarted ? `Started ${it.dateStarted}` : '', it.dateWorked ? `Worked ${it.dateWorked}` : ''].filter(Boolean);
              return (
                <tr key={`${it.title}-${i}`} className={it.status === 'omitted' ? 'row-omitted' : undefined}>
                  <th scope="row" className="cell-title">{it.title}</th>
                  <td className="cell-kv" data-label="Category">{cell(it.category)}</td>
                  <td className="num cell-kv" data-label="Correct">
                    {it.correctTotal ? <>{it.correctTotal}{it.asterisk ? <><sup className="star" title="Late submission, as marked by MyLab">*</sup><span className="sr-only"> (late submission, as marked by MyLab)</span></> : null}</> : dash}
                  </td>
                  <td className="num cell-key" data-label="Score">
                    {it.status === 'incomplete'
                      ? <span className="tag-incomplete">Incomplete</span>
                      : <>{fmtPct(it.scorePercent) || dash}{it.status === 'omitted' ? <span className="tag-omitted" title="Omitted on Pearson — does not count toward the grade"> omitted</span> : null}</>}
                  </td>
                  <td className="nowrap cell-kv" data-label="Time">{cell(it.timeSpent)}</td>
                  <td className="nowrap cell-kv wide-only" data-label="Started">{cell(it.dateStarted)}</td>
                  <td className="nowrap cell-kv wide-only" data-label="Worked">{cell(it.dateWorked)}</td>
                  <td className="cell-kv phone-only cell-span nolabel">{dates.length ? dates.join(' · ') : <span className="muted">Not started</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.some((it) => it.asterisk) ? <p className="footnote"><span aria-hidden="true">*</span> Late submission, as marked by MyLab.</p> : null}
    </>
  );
}

const PEARSON_PART: Record<string, string> = { overall: 'Overall score', categories: 'Category breakdown', items: 'Assignment list' };

export function MatchedLine({ p }: { p: PearsonRecord }) {
  if (!p.matchedBy) return null;
  return <p className="matched-line"><Icon name="link" size={13} /><span>Matched by {p.matchedBy}</span></p>;
}

export function PearsonBlock({ p, compact = false }: { p: PearsonRecord; compact?: boolean }) {
  if (!p || !isVerified(p)) return null;
  const missing = Array.isArray(p.parseMissing) ? p.parseMissing : [];
  const allItems = Array.isArray(p.items) ? p.items : [];
  const schema = itemsSchema();
  const legacyItems = allItems.length > 0 && p.itemsSchema !== schema;
  const items = legacyItems ? [] : allItems;
  const link = safeUrl(p.pageUrl || 'https://mylab.pearson.com/');
  const staleOverall = Array.isArray(p.staleParts) && p.staleParts.some((x) => x.part === 'overall');
  return (
    <>
      <div className="gb-provider">{p.provider || 'Pearson MyLab'}{p.pearsonCourseTitle ? ` · ${p.pearsonCourseTitle}` : ''}</div>
      <MatchedLine p={p} />
      <PePartialNote />
      <CategoryTable p={p} />
      {!compact && items.length ? (
        <>
          <h4 className="sub-head">Assignments <span className="count">{items.length}</span></h4>
          <PartCaption p={p} part="items" label="Assignment list" />
          <PearsonItemsTable items={items} />
        </>
      ) : null}
      <div className="note-stack">
        {legacyItems ? <Chip kind="partial" text="Assignment list was cached by an older version that misread its columns — open the Pearson Results page again to re-sync it" /> : null}
        {!legacyItems && !items.length ? <Chip kind={missing.includes('items') ? 'partial' : 'notsynced'} text={missing.includes('items') ? "Assignment list couldn't be read from the Pearson page" : 'Individual MyLab items not found on the synced page'} /> : null}
        {!legacyItems && compact && items.length ? <p className="muted small">{items.length} MyLab item{items.length === 1 ? '' : 's'} synced</p> : null}
        {missing.filter((k) => k !== 'items' && k !== 'overall').map((k) => <Chip key={k} kind="partial" text={`${PEARSON_PART[k] || k} couldn't be read from the Pearson page`} />)}
        {staleOverall ? <Chip kind="stale" text="Overall score: from an earlier read (the latest page didn't show it)" /> : null}
      </div>
      {link ? <div className="actions-row"><a className="btn-sec" href={link} target="_blank" rel="noopener">Open in Pearson MyLab<Icon name="external" size={13} /></a></div> : null}
    </>
  );
}

export function OverallCard({ course }: { course: Course }) {
  const gb = course.gradebook;
  const both = !!(course.pearson && isVerified(course.pearson));
  const sum = gb && isVerified(gb) && !gb.empty ? <ItemSummary gb={gb} /> : null;
  return (
    <section className="card lane-card" aria-label="Overall grades">
      <SecHead title="Overall" tools={both ? <span className="side-note">Shown side by side; never combined</span> : null} />
      <Lanes c={course} extra={sum} />
      <div className="card-foot"><BandLegend /></div>
    </section>
  );
}

export function BbGradebookBlock({ course }: { course: Course }) {
  const gb = course.gradebook;
  const sec = sectionOf(course, 'gradebook');
  if (!gb || !isVerified(gb)) {
    return <SectionPanel sec={sec} what="Blackboard gradebook" link={{ href: courseUrl(course, 'grades'), label: 'Open gradebook in Blackboard' }} />;
  }
  if (gb.empty) {
    return <p className="muted empty-line">Blackboard returned an empty gradebook for this course.{course.pearson ? ' Grades for this course live in MyLab (above).' : ''}</p>;
  }
  return (
    <>
      {gb.overallColumn ? <p className="muted small block-note">Overall column: {gb.overallColumn} · items sorted by due date, undated last</p> : null}
      <BbItemsTable gb={gb} />
      {gb.itemsSynced === false ? <Chip kind="partial" text="Your individual grades were not returned by Blackboard" /> : null}
    </>
  );
}

export function GradebookTab({ course }: { course: Course }) {
  const pe = course.pearson && isVerified(course.pearson) ? course.pearson : null;
  const gb = course.gradebook;
  const sec = sectionOf(course, 'gradebook');
  return (
    <div className="tab-panel">
      <OverallCard course={course} />
      {pe ? (
        <section className="card gb-card">
          <SecHead title="MyLab" tools={<Stamp source="pearson" syncedAt={pe.syncedAt} notes={[pe.matchedBy ? `Matched to this course by ${pe.matchedBy}.` : '']} />} />
          <PearsonBlock p={pe} />
        </section>
      ) : null}
      <section className="card gb-card">
        <SecHead title="Blackboard gradebook" tools={gb && isVerified(gb) ? <Stamp source={gb.source} syncedAt={gb.syncedAt} stale={sec.stale} /> : null} />
        <BbGradebookBlock course={course} />
      </section>
    </div>
  );
}
