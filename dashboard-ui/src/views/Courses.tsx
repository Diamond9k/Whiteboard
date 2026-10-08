import type { Course, ProvEntry } from '../types';
import { Icon } from '../components/Icon';
import { Chip, CodeEyebrow, Onboarding, PageHead, Stamp, StatePanel, TitleText } from '../components/bits';
import { useDash } from '../context';
import {
  PAST_DUE_FULL, byDue, courseLabel, fullTitle, gradeClass, isLocked, isOpen, isVerified, kindOf,
  safeColor, sectionOf, stateReason, verifiedFaculty, verifiedUpcoming,
} from '../lib/course';
import { fmtDueFull, fmtRelDay, parseDate } from '../lib/format';
import { isMaybePast, maybePastLabel, useTrust } from '../lib/trust';

export function CoursesPage() {
  const { data, prefs, showPast, setShowPast, setPrefs } = useDash();
  const layout = prefs.layout === 'grid' ? 'grid' : 'list';
  const favorites = new Set(Array.isArray(prefs.favorites) ? prefs.favorites : []);
  const toggle = (
    <div className="view-toggle" role="group" aria-label="Layout">
      <button className={layout === 'list' ? 'on' : ''} onClick={() => { void setPrefs({ layout: 'list' }); }} aria-label="List view" aria-pressed={layout === 'list'} title="List view" type="button"><Icon name="list" size={18} /></button>
      <button className={layout === 'grid' ? 'on' : ''} onClick={() => { void setPrefs({ layout: 'grid' }); }} aria-label="Grid view" aria-pressed={layout === 'grid'} title="Grid view" type="button"><Icon name="grid" size={18} /></button>
    </div>
  );
  if (!data.courses.length) return <><PageHead title="Courses" extra={null} /><Onboarding /></>;
  const prov: ProvEntry[] = data._meta?.pulled_at ? [{ label: 'Course list', source: data._meta.source || 'blackboard-api', syncedAt: data._meta.pulled_at, notes: [] }] : [];
  const groups = new Map<string, Course[]>();
  const past: Course[] = [];
  for (const c of data.courses) {
    if (c.current === false) { past.push(c); continue; }
    const k = c.termName || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const termStart = (name: string) => {
    const t = Object.values(data.terms || {}).find((x) => x.name === name);
    return t && t.start ? Date.parse(t.start) : -Infinity;
  };
  const order = [...groups.keys()].sort((a, b) => termStart(b) - termStart(a));
  const favFirst = (list: Course[]) => [...list].sort((a, b) => (favorites.has(b.id) ? 1 : 0) - (favorites.has(a.id) ? 1 : 0));
  const head = layout === 'list'
    ? <div className="cl-head" aria-hidden="true"><span>Course</span><span>Next due</span><span>MyLab</span><span>Blackboard</span><span /></div>
    : null;
  const block = (title: string, list: Course[]) => (
    <div key={title || 'term'}>
      <h2 className="term-heading">{title || <Chip kind="notsynced" text="Term not synced" />}<span className="count">{list.length}</span></h2>
      <div className={`course-list ${layout === 'grid' ? 'grid' : 'list'}`}>
        {head}
        {favFirst(list).map((c) => <CourseCard key={c.id} c={c} fav={favorites.has(c.id)} onFav={() => {
          const s = new Set(favorites);
          if (s.has(c.id)) s.delete(c.id); else s.add(c.id);
          void setPrefs({ favorites: [...s] });
        }} />)}
      </div>
    </div>
  );
  return (
    <>
      <PageHead title="Courses" extra={toggle} prov={prov} />
      <section>
        {order.length ? order.map((k) => block(k, groups.get(k)!)) : <StatePanel kind="notsynced" title="No current courses synced" />}
        {past.length ? (showPast
          ? <>{block('Past terms', past)}<p><button className="link-btn" type="button" onClick={() => setShowPast(false)}>Hide past terms</button></p></>
          : <p><button className="link-btn" type="button" onClick={() => setShowPast(true)}><Icon name="chevronDown" size={15} />Show {past.length} course{past.length === 1 ? '' : 's'} from past terms</button></p>
        ) : null}
      </section>
    </>
  );
}

function Instructor({ c }: { c: Course }) {
  const fac = verifiedFaculty(c);
  const facSec = sectionOf(c, 'faculty');
  if (fac.length) return <span className="cc-instr"><Icon name="user" size={13} /><span>{fac.map((f) => f.name).join(', ')}</span></span>;
  if (facSec.state === 'ok' && !c.facultyUnnamed) return <span className="cc-instr muted">No instructor listed</span>;
  const why = c.facultyUnnamed
    ? `Blackboard listed ${c.facultyUnnamed} instructor${c.facultyUnnamed === 1 ? '' : 's'} but returned no name.`
    : kindOf(facSec.state) === 'forbidden' ? "Blackboard doesn't share the faculty list with student accounts."
      : stateReason(facSec.state);
  return <span className="cc-instr muted" title={why}><Icon name="user" size={13} /><span>Instructor not yet synced<span className="sr-only"> — {why}</span></span></span>;
}

function GradeCell({ c, which }: { c: Course; which: 'mylab' | 'bb' }) {
  if (which === 'mylab') {
    const p = c.pearson;
    if (!p || !isVerified(p)) return <Dash why="No MyLab results synced for this course" />;
    if (!p.currentGrade) return <><Dash why="MyLab overall score not read" /><span className="cc-gs"><Stamp source="pearson" syncedAt={p.syncedAt} dotOnly notes={[p.matchedBy ? `Matched to this course by ${p.matchedBy}.` : '']} /></span></>;
    return <><span className={`gc-val ${gradeClass(p.currentGrade)}`}>{p.currentGrade}</span><span className="cc-gs"><Stamp source="pearson" syncedAt={p.syncedAt} dotOnly notes={[p.matchedBy ? `Matched to this course by ${p.matchedBy}.` : '']} /></span></>;
  }
  const gb = c.gradebook;
  const sec = sectionOf(c, 'gradebook');
  if (!gb || !isVerified(gb)) {
    const k = kindOf(sec.state);
    if (k === 'forbidden') return <span className="gc-lock" title="Gradebook isn't shared with student accounts"><Icon name="lock" size={13} /><span>Not shared</span></span>;
    return <Dash why={k === 'error' ? "Gradebook couldn't be read" : k === 'expired' ? 'Sign-in expired' : 'Gradebook not synced yet'} />;
  }
  const st = <span className="cc-gs"><Stamp source={gb.source} syncedAt={gb.syncedAt} stale={sec.stale} dotOnly /></span>;
  if (gb.empty || !gb.currentGrade) return <><Dash why={gb.empty ? 'No grades posted in Blackboard' : gb.overallAmbiguous ? 'Several total columns; none picked' : 'No overall grade shown in Blackboard'} />{st}</>;
  return <><span className={`gc-val ${gradeClass(gb.currentGrade)}`}>{gb.currentGrade}</span>{st}</>;
}

function Dash({ why }: { why: string }) {
  return <span className="gc-none" title={why}>—<span className="sr-only"> ({why})</span></span>;
}

function CourseCard({ c, fav, onFav }: { c: Course; fav: boolean; onFav: () => void }) {
  const trust = useTrust();
  const open = isOpen(c);
  const status = !isVerified(c)
    ? <Chip kind="notsynced" />
    : isLocked(c)
      ? <span className="status closed"><Icon name="lock" size={13} />{c.status || 'Closed'}</span>
      : c.status === 'Open'
        ? <span className="status open"><i className="dot" aria-hidden="true" />Open</span>
        : <span className="status muted" title="Blackboard did not report availability">Availability not reported</span>;
  let next: React.ReactNode = <span className="muted">—</span>;
  if (open) {
    const up = verifiedUpcoming(c);
    const overdue = up.filter((u) => u.status === 'overdue').length;
    const maybe = up.filter((u) => isMaybePast(trust, u)).length;
    const nxt = up.filter((u) => u.status === 'due' && !isMaybePast(trust, u)).sort(byDue)[0];
    const upSec = sectionOf(c, 'upcoming');
    const d = nxt ? parseDate(nxt.due) : null;
    next = (
      <>
        {(overdue || maybe) ? (
          <span className="cc-flags">
            {overdue ? <span className="cc-overdue" title={PAST_DUE_FULL}><Icon name="alert" size={13} />{overdue} past due</span> : null}
            {maybe ? <span className="cc-maybe" title={maybePastLabel(trust)}><Icon name="clock" size={13} />{maybe} may be past due</span> : null}
          </span>
        ) : null}
        {nxt && d
          ? <span className="cc-nextdue"><span className="cc-next-t">{nxt.title}</span><span className="cc-next-r" title={fmtDueFull(d)}>{fmtRelDay(d)} · {fmtDueFull(d)}</span></span>
          : upSec.state === 'ok'
            ? <span className="muted">Nothing upcoming</span>
            : <span className="muted" title={stateReason(upSec.state)}>Due dates not synced</span>}
      </>
    );
  }
  const title = <TitleText c={c} />;
  return (
    <div className={`course-card ${open ? 'is-open' : 'is-locked'}`} style={{ ['--stripe' as string]: safeColor(c.color) }}>
      <div className="cc-main">
        <CodeEyebrow c={c} />
        <h3 className="cc-title">
          {open
            ? <a className="cc-link" href={`#/course/${encodeURIComponent(c.id)}`} title={fullTitle(c)}>{title || c.code || ''}</a>
            : <span title={fullTitle(c)}>{title || c.code || ''}</span>}
        </h3>
        <div className="cc-meta">{status}<Instructor c={c} />{c.pearson ? <span className="mono-tag" title="MyLab results are synced for this course">MyLab</span> : null}</div>
        {isLocked(c) ? <div className="locked-msg"><Icon name="lock" size={15} /><div><strong>You're enrolled, but this course isn't open yet.</strong>{c.note ? <p>{c.note}</p> : null}</div></div> : null}
      </div>
      {open ? <div className="cc-next"><span className="cc-gl">Next due</span><div className="cc-next-v">{next}</div></div> : <div className="cc-next cc-next-empty" />}
      {open ? (
        <>
          <div className="cc-g cc-g-pe"><span className="cc-gl">MyLab</span><span className="cc-gv"><GradeCell c={c} which="mylab" /></span></div>
          <div className="cc-g cc-g-bb"><span className="cc-gl">Blackboard</span><span className="cc-gv"><GradeCell c={c} which="bb" /></span></div>
        </>
      ) : <><div className="cc-g cc-g-pe" /><div className="cc-g cc-g-bb" /></>}
      <button className={`fav ${fav ? 'on' : ''}`} type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFav(); }} aria-label={`${fav ? 'Remove' : 'Add'} ${courseLabel(c)} ${fav ? 'from' : 'to'} favorites`} title={fav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={fav}><Icon name="star" size={18} /></button>
    </div>
  );
}
