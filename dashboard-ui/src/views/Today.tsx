import type { ReactNode } from 'react';
import type { Course, PearsonRecord, ProvEntry } from '../types';
import { Icon } from '../components/Icon';
import {
  BandLegend, CodeEyebrow, DueRow, MissingDueNote, Onboarding, PageHead, PePartialNote, Stamp, StatePanel, StaleMark, TitleText,
} from '../components/bits';
import { Lanes } from '../components/pearson';
import { useDash } from '../context';
import {
  DUE_NOTE, collectDueItems, courseLabel, dueTime, fullTitle, isOpen, isVerified, itemsSchema, safeColor, safeUrl,
} from '../lib/course';
import { fmtDayKey, fmtLongDay, hourCT, parseDate } from '../lib/format';
import { bbIsStale, isMaybePast, maybePastLabel, useTrust } from '../lib/trust';

const DAY_MS = 864e5;

function Section({ id, title, count, tone = '', tools, extra, children }: {
  id: string; title: string; count?: number | null; tone?: string; tools?: ReactNode; extra?: ReactNode; children: ReactNode;
}) {
  return (
    <section className={`today-sec ${tone}`} id={`sec-${id}`} aria-labelledby={`ts-${id}`}>
      <div className="sec-head">
        <h2 className="sec-title" id={`ts-${id}`}>{title}{count != null ? <> <span className="count">{count}</span></> : null}{extra}</h2>
        {tools ? <div className="sec-tools">{tools}</div> : null}
      </div>
      {children}
    </section>
  );
}

function emptyLine(text: string) {
  return <p className="empty-line"><Icon name="check" size={15} /><span>{text}</span></p>;
}

function gradeBits(c: Course): { value: string | null; text?: string; src?: string }[] {
  const out: { value: string | null; text?: string; src?: string }[] = [];
  const p = c.pearson;
  const gb = c.gradebook;
  if (p && isVerified(p) && p.currentGrade) out.push({ value: p.currentGrade, src: 'MyLab' });
  if (gb && isVerified(gb) && gb.currentGrade) out.push({ value: gb.currentGrade, src: 'BB' });
  if (!out.length && gb && isVerified(gb)) {
    if (gb.empty) return [{ value: null, text: 'No grades posted' }];
    if (!gb.currentGrade) return [{ value: null, text: gb.overallAmbiguous ? 'Overall not picked' : 'No overall grade shown' }];
  }
  return out;
}

function GradeStrip({ current }: { current: Course[] }) {
  const bbTimes: string[] = [];
  const peTimes: string[] = [];
  const rows = current.map((c) => {
    const open = isOpen(c);
    const bits = open ? gradeBits(c) : [];
    if (open && c.pearson && isVerified(c.pearson) && c.pearson.currentGrade && c.pearson.syncedAt) peTimes.push(c.pearson.syncedAt);
    if (open && c.gradebook && isVerified(c.gradebook) && c.gradebook.syncedAt && (c.gradebook.currentGrade || c.gradebook.empty || !c.gradebook.currentGrade)) bbTimes.push(c.gradebook.syncedAt);
    const vals = !open
      ? [<span key="c" className="gs-none">Not open</span>]
      : bits.length
        ? bits.map((b, i) => b.value
          ? <span key={i}><span className="gs-g">{b.value}</span><span className="gs-src">{b.src}</span></span>
          : <span key={i} className="gs-none">{b.text}</span>)
        : [<span key="n" className="gs-none">—</span>];
    const inner = (
      <>
        <span className="gs-code">{c.code || courseLabel(c)}</span>
        <span className="gs-vals">{vals.map((v, i) => <span className="gs-v" key={i}>{v}</span>)}</span>
      </>
    );
    const style = { ['--stripe' as string]: safeColor(c.color) };
    return open
      ? <a key={c.id} className="gs-item" href={`#/course/${encodeURIComponent(c.id)}/gradebook`} style={style} title={`${courseLabel(c)} gradebook`}>{inner}</a>
      : <div key={c.id} className="gs-item" style={style}>{inner}</div>;
  });
  const oldest = (list: string[]) => list.filter(Boolean).sort()[0];
  const bbT = oldest(bbTimes);
  const peT = oldest(peTimes);
  return (
    <Section id="strip" title="Grades" tone="strip-sec" tools={<a className="text-link" href="#/grades">All grades<Icon name="arrowRight" size={14} /></a>}>
      {(bbT || peT) ? <div className="gstrip-src">{bbT ? <Stamp source="blackboard-api" syncedAt={bbT} /> : null}{peT ? <Stamp source="pearson" syncedAt={peT} /> : null}</div> : null}
      <div className="card list-card gstrip">{rows}</div>
    </Section>
  );
}

export function TodayPage() {
  const { data } = useDash();
  const trust = useTrust();
  const now = new Date();
  const first = isVerified(data.student) && data.student?.name ? String(data.student.name).split(/\s+/)[0] : null;
  const h = hourCT(now);
  const greet = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const title = first ? `${greet}, ${first}` : 'Today';
  if (!data.courses.length) return <><PageHead title={title} eyebrow={fmtLongDay(now)} /><Onboarding /></>;

  const { rows, missing, syncedAt } = collectDueItems(data);
  const prov: ProvEntry[] = syncedAt ? [{ label: 'Due dates', source: 'blackboard-api', syncedAt, notes: [DUE_NOTE] }] : [];
  const todayKey = fmtDayKey(now);
  const horizon = now.getTime() + 7 * DAY_MS;
  const keyOf = (r: { u: { due?: string } }) => { const d = parseDate(r.u.due); return d ? fmtDayKey(d) : null; };
  const overdue = rows.filter((r) => r.u.status === 'overdue');
  const maybe = rows.filter((r) => isMaybePast(trust, r.u));
  const pastList = [...overdue, ...maybe].sort((a, b) => dueTime(b) - dueTime(a));
  const today = rows.filter((r) => r.u.status !== 'overdue' && !isMaybePast(trust, r.u) && keyOf(r) === todayKey).sort((a, b) => dueTime(a) - dueTime(b));
  const week = rows.filter((r) => (r.u.status === 'due' || r.u.status === 'submitted') && !isMaybePast(trust, r.u) && (keyOf(r) || '') > todayKey && dueTime(r) <= horizon)
    .sort((a, b) => dueTime(a) - dueTime(b));
  const hasDue = rows.length > 0;
  const staleNow = bbIsStale(trust);
  const stat = (n: number, label: string, tone: string, target: string, extra?: ReactNode) => (
    <a className={`stat ${staleNow ? 'is-stale' : tone}`} href={`#sec-${target}`} onClick={(e) => { e.preventDefault(); document.getElementById(`sec-${target}`)?.scrollIntoView({ block: 'start' }); }}>
      <span className="stat-n">{n}</span>
      <span className="stat-l">{label}</span>
      {extra}
      {staleNow ? <span className="stat-stale"><StaleMark /></span> : null}
    </a>
  );
  const list = (rs: typeof rows) => (
    <div className="card list-card due-list">{rs.map((r, i) => <DueRow key={`${r.c.id}-${r.u.title}-${i}`} u={r.u} course={r.c} />)}</div>
  );
  const current = data.courses.filter((c) => c.current !== false);

  return (
    <>
      <PageHead title={title} eyebrow={fmtLongDay(now)} prov={prov} />
      <div className="today-grid">
        <div className="today-main">
          {hasDue ? (
            <div className="stats" aria-label="Summary of synced due dates">
              {stat(overdue.length, 'Past due', overdue.length ? 'is-danger' : '', 'overdue', maybe.length ? <span className="stat-x" title={maybePastLabel(trust)}>+{maybe.length} may be past due</span> : null)}
              {stat(today.length, 'Due today', today.length ? 'is-accent' : '', 'today')}
              {stat(week.length, 'Next 7 days', '', 'week')}
            </div>
          ) : null}
          <GradeStrip current={current} />
          {!hasDue ? (
            <StatePanel kind={missing.length ? 'notsynced' : 'empty'} title={missing.length ? 'No due dates synced yet' : 'No due dates in synced Blackboard data'} detail="Due dates come from Blackboard gradebook columns and calendar items. MyLab due dates are not read." />
          ) : (
            <>
              <Section id="overdue" title="Past due" count={pastList.length} tone={overdue.length ? 'is-danger' : maybe.length ? 'is-maybe' : ''} extra={<StaleMark />}>
                {pastList.length ? list(pastList) : emptyLine('Nothing past due in synced data')}
              </Section>
              <Section id="today" title="Today" count={today.length}>{today.length ? list(today) : emptyLine('Nothing due today in synced data')}</Section>
              <Section id="week" title="Next 7 days" count={week.length} tools={<a className="text-link" href="#/calendar">Calendar<Icon name="arrowRight" size={14} /></a>}>
                {week.length ? list(week) : emptyLine('Nothing due in the next 7 days in synced data')}
              </Section>
            </>
          )}
          <MissingDueNote missing={missing} />
        </div>
        <div className="today-side">
          <Doing current={current} />
          <Unfinished current={current} unmatched={data.unmatchedPearson || []} />
        </div>
      </div>
    </>
  );
}

function Doing({ current }: { current: Course[] }) {
  return (
    <Section id="doing" title="How you're doing" tools={<a className="text-link hide-phone" href="#/grades">All grades<Icon name="arrowRight" size={14} /></a>}>
      {current.length ? (
        <>
          <BandLegend cls="is-compact" />
          <div className="tiles">
            {current.map((c) => {
              const open = isOpen(c);
              return (
                <article key={c.id} className={`grade-tile ${open ? 'is-open' : ''}`} style={{ ['--stripe' as string]: safeColor(c.color) }}>
                  {open ? <a className="tile-link" href={`#/course/${encodeURIComponent(c.id)}/gradebook`} aria-label={`${courseLabel(c)} gradebook`} /> : null}
                  <div className="tile-name"><CodeEyebrow c={c} /><div className="tile-title" title={fullTitle(c)}><TitleText c={c} /></div></div>
                  {open ? <Lanes c={c} big /> : <div className="lane-empty"><span className="muted">{c.locked ? "Course isn't open yet" : 'Not synced yet'}</span></div>}
                </article>
              );
            })}
          </div>
        </>
      ) : <StatePanel kind="notsynced" title="No current courses synced" />}
    </Section>
  );
}

function Unfinished({ current, unmatched }: { current: Course[]; unmatched: PearsonRecord[] }) {
  const schema = itemsSchema();
  const peRecs: { p: PearsonRecord; c: Course | null }[] = [];
  for (const c of current) if (c.pearson && isVerified(c.pearson)) peRecs.push({ p: c.pearson, c });
  for (const p of unmatched) if (isVerified(p)) peRecs.push({ p, c: null });
  const unfinished = [];
  for (const rec of peRecs) {
    if (!Array.isArray(rec.p.items) || rec.p.itemsSchema !== schema) continue;
    for (const it of rec.p.items) if (it.status === 'incomplete') unfinished.push({ it, ...rec });
  }
  const peTimes = peRecs.map((x) => x.p.syncedAt).filter((t): t is string => !!t).sort();
  const mylabLink = peRecs.length ? safeUrl(peRecs[0].p.pageUrl) : null;
  return (
    <Section id="mylab" title="Unfinished MyLab work" count={unfinished.length || null} tools={peRecs.length ? <Stamp source="pearson" syncedAt={peTimes[peTimes.length - 1]} notes={["MyLab due dates aren't read, so none are shown."]} /> : null}>
      {peRecs.length ? <PePartialNote /> : null}
      {!peRecs.length ? <p className="empty-line muted-line">No MyLab results synced yet. Open your MyLab Results page while signed in to read them.</p>
        : !unfinished.length ? emptyLine('No unfinished MyLab work in synced data')
          : (
            <div className="card list-card">
              {unfinished.map(({ it, p, c }, i) => (
                <div key={`${it.title}-${i}`} className="ml-row" style={{ ['--stripe' as string]: safeColor(c ? c.color : null, '#8a8a93') }}>
                  <div className="ml-text">
                    <div className="due-title">{it.title}</div>
                    <div className="due-meta">
                      {c ? <a className="due-course" href={`#/course/${encodeURIComponent(c.id)}/gradebook`}>{c.code || courseLabel(c)}</a> : <span className="due-course">{p.pearsonCourseTitle || 'MyLab'}</span>}
                      {it.category ? <span className="due-kind">{it.category}</span> : null}
                      <span className="due-badge is-warn">Incomplete</span>
                    </div>
                    <div className="ml-progress">{it.correctTotal ? <><span className="num">{it.correctTotal}</span> correct so far</> : 'Progress not shown'}{it.dateStarted ? ` · started ${it.dateStarted}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
      {mylabLink ? <p className="sec-foot"><a className="text-link" href={mylabLink} target="_blank" rel="noopener">Open MyLab results<Icon name="external" size={13} /></a></p> : null}
    </Section>
  );
}
