import type { ReactNode } from 'react';
import type { Course } from '../types';
import { Icon } from '../components/Icon';
import { BandLegend, Chip, CodeEyebrow, GradeFigure, InlineState, Onboarding, PageHead, Stamp, StaleMark, TitleText } from '../components/bits';
import { BbItemsTable, CategoryTable, MatchedLine, PearsonBlock } from '../components/pearson';
import { useDash } from '../context';
import {
  courseUrl, fullTitle, isLocked, isOpen, isVerified, itemsSchema, kindOf, safeColor, safeUrl, sectionOf,
} from '../lib/course';
import { fmtDateTime, fmtWhen, parseDate } from '../lib/format';
import { PePartialNote } from '../components/bits';

export function GradesPage() {
  const { data, gradesOpen, toggleGrade, prefs, setPrefs } = useDash();
  const visible = data.courses.filter((c) => c.current !== false);
  if (!visible.length && !(data.unmatchedPearson || []).length) return <><PageHead title="Grades" /><Onboarding /></>;
  return (
    <>
      <PageHead title="Grades" />
      <div className="grades-intro">
        <p className="lede">MyLab and Blackboard grades side by side, as each system reports them — never combined.<StaleMark /></p>
        <BandLegend />
      </div>
      <div className="gtable">
        <div className="gt-head" aria-hidden="true"><span>Course</span><span>MyLab</span><span>Blackboard</span><span>Items synced</span><span /></div>
        <div role="list" aria-label="Courses">
          {visible.map((c) => <GradeRow key={c.id} c={c} open={isOpen(c) && gradesOpen.has(c.id)} onToggle={() => toggleGrade(c.id)} />)}
        </div>
      </div>
      <Unmatched prefs={prefs} setPrefs={setPrefs} courses={visible} records={data.unmatchedPearson || []} />
    </>
  );
}

function GradeRow({ c, open, onToggle }: { c: Course; open: boolean; onToggle: () => void }) {
  const unlocked = isOpen(c);
  const name = <span className="gt-name"><CodeEyebrow c={c} /><span className="gt-title" title={fullTitle(c)}><TitleText c={c} /></span></span>;
  if (!unlocked) {
    return (
      <div className="gt-row is-closed" role="listitem" style={{ ['--stripe' as string]: safeColor(c.color) }}>
        <div className="gt-sum"><div className="gt-course">{name}</div><div className="gt-closed"><Chip kind="notsynced" text={isLocked(c) ? "Course isn't open yet" : 'Not synced yet'} title={c.note || ''} /></div></div>
      </div>
    );
  }
  const id = `gx-${c.id}`;
  return (
    <div className={`gt-row${open ? ' is-open' : ''}`} role="listitem" style={{ ['--stripe' as string]: safeColor(c.color) }}>
      <div className="gt-sum">
        <div className="gt-course">
          <button className="gt-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>
            {name}<span className="sr-only"> — show details</span>
          </button>
        </div>
        <div className="gt-cell" data-label="MyLab"><PeCell c={c} /></div>
        <div className="gt-cell" data-label="Blackboard"><BbCell c={c} /></div>
        <div className="gt-cell gt-count" data-label="Items synced"><Counts c={c} /></div>
        <span className="gt-chev" aria-hidden="true"><Icon name="chevronDown" size={16} /></span>
      </div>
      {open ? <div className="gt-detail" id={id}><Detail c={c} /></div> : <div className="gt-detail" id={id} hidden><Detail c={c} /></div>}
    </div>
  );
}

function cellWrap(label: string, st: ReactNode, body: ReactNode) {
  return <><span className="gt-lab" aria-hidden="true">{label}</span>{st ? <span className="gt-st">{st}</span> : null}<div className="gt-v">{body}</div></>;
}

function PeCell({ c }: { c: Course }) {
  const p = c.pearson;
  if (!p || !isVerified(p)) return cellWrap('MyLab', null, <span className="gt-none">No MyLab results</span>);
  const st = <Stamp source="pearson" syncedAt={p.syncedAt} dotOnly notes={[p.matchedBy ? `Matched to this course by ${p.matchedBy}.` : '']} />;
  if (!p.currentGrade) {
    const missing = Array.isArray(p.parseMissing) && p.parseMissing.includes('overall');
    return cellWrap('MyLab', st, <Chip kind={missing ? 'partial' : 'notsynced'} text={missing ? "Overall couldn't be read" : 'Overall not synced'} />);
  }
  return cellWrap('MyLab', st, <div className="gt-fig"><GradeFigure value={p.currentGrade} size="md" />{p.overallPoints ? <span className="gt-sub">{p.overallPoints}</span> : null}</div>);
}

function BbCell({ c }: { c: Course }) {
  const gb = c.gradebook;
  const sec = sectionOf(c, 'gradebook');
  if (!gb || !isVerified(gb)) {
    const k = kindOf(sec.state);
    const ck = parseDate(sec.syncedAt);
    return cellWrap('Blackboard', ck ? <span className="checked-t" title={fmtDateTime(ck)}>Checked {fmtWhen(ck).replace(/, \d.*$/, '')}</span> : null,
      <Chip kind={k} text={k === 'forbidden' ? 'Not shared' : k === 'error' ? "Couldn't be read" : k === 'expired' ? 'Sign-in expired' : 'Not synced yet'} title={k === 'forbidden' ? "Blackboard doesn't let a student session read this gradebook." : ''} />);
  }
  const st = <Stamp source={gb.source} syncedAt={gb.syncedAt} stale={sec.stale} dotOnly />;
  if (gb.empty) return cellWrap('Blackboard', st, <span className="gt-none">No grades posted</span>);
  if (!gb.currentGrade) return cellWrap('Blackboard', st, <span className="gt-none">{gb.overallAmbiguous ? 'Overall not picked' : 'No overall grade shown'}</span>);
  return cellWrap('Blackboard', st, <div className="gt-fig"><GradeFigure value={gb.currentGrade} size="md" />{gb.overallColumn ? <span className="gt-sub">{gb.overallColumn}</span> : null}</div>);
}

function Counts({ c }: { c: Course }) {
  const schema = itemsSchema();
  const n = c.gradebook && isVerified(c.gradebook) && Array.isArray(c.gradebook.items) ? c.gradebook.items.length : null;
  const pn = c.pearson && isVerified(c.pearson) && Array.isArray(c.pearson.items) && c.pearson.itemsSchema === schema ? c.pearson.items.length : null;
  const parts = [];
  if (pn != null) parts.push(<span key="p"><b>{pn}</b> MyLab</span>);
  if (n != null) parts.push(<span key="b"><b>{n}</b> Blackboard</span>);
  return parts.length ? <>{parts}</> : <span className="muted">—</span>;
}

function Detail({ c }: { c: Course }) {
  const p = c.pearson && isVerified(c.pearson) ? c.pearson : null;
  const gb = c.gradebook && isVerified(c.gradebook) ? c.gradebook : null;
  const sec = sectionOf(c, 'gradebook');
  const schema = itemsSchema();
  const items = p && Array.isArray(p.items) && p.itemsSchema === schema ? p.items : [];
  const inc = items.filter((x) => x.status === 'incomplete').length;
  const k = kindOf(sec.state);
  const link = p ? safeUrl(p.pageUrl) : null;
  return (
    <div className={`gx-grid ${p ? 'has-pe' : ''}`}>
      {p ? (
        <div className="gx-col">
          <h3 className="gx-h">MyLab</h3>
          <MatchedLine p={p} />
          <PePartialNote />
          <CategoryTable p={p} />
          {!p.categories?.length ? <p className="muted small">Category breakdown not in synced data.</p> : null}
          <p className="muted small gx-note">{items.length} assignment{items.length === 1 ? '' : 's'} synced{inc ? ` · ${inc} started, not finished` : ''}</p>
          {link ? <div className="actions-row"><a className="text-link" href={link} target="_blank" rel="noopener">Open in MyLab<Icon name="external" size={13} /></a></div> : null}
        </div>
      ) : null}
      <div className="gx-col">
        <h3 className="gx-h">Blackboard</h3>
        {gb && !gb.empty
          ? (Array.isArray(gb.items) && gb.items.length ? <BbItemsTable gb={gb} /> : <p className="muted small">No gradebook items.</p>)
          : gb && gb.empty
            ? <p className="muted small">Blackboard returned an empty gradebook{p ? '; this course grades in MyLab' : ''}.</p>
            : <InlineState kind={k} title={k === 'forbidden' ? "Gradebook isn't shared with student accounts" : k === 'error' ? "Gradebook couldn't be read" : 'Gradebook not synced yet'} detail={k === 'forbidden' ? 'It may still be visible in Blackboard itself.' : ''} />}
        <div className="actions-row">
          {gb
            ? <a className="text-link" href={`#/course/${encodeURIComponent(c.id)}/gradebook`}>Course gradebook<Icon name="arrowRight" size={13} /></a>
            : <a className="text-link" href={courseUrl(c, 'grades')} target="_blank" rel="noopener">Open in Blackboard<Icon name="external" size={13} /></a>}
        </div>
      </div>
    </div>
  );
}

function Unmatched({ records, courses, prefs, setPrefs }: {
  records: NonNullable<Course['pearson']>[];
  courses: Course[];
  prefs: { pearsonMap?: Record<string, string> };
  setPrefs: (p: { pearsonMap: Record<string, string> }) => Promise<void>;
}) {
  if (!records.length) return null;
  const opts = courses.filter((c) => c.code);
  return (
    <>
      <h2 className="act-heading gap-top">MyLab results not matched to a course</h2>
      <p className="muted small">The MyLab course title didn't contain a recognisable course code or a keyword unique to one course, so it isn't attached anywhere automatically.</p>
      <div className="grade-grid">
        {records.map((p) => (
          <div key={p.key || p.pearsonCourseTitle} className="card grade-card" style={{ ['--stripe' as string]: '#8a8a93' }}>
            <div className="gc-head">
              <div className="gc-name"><span className="ccode">MyLab course</span><h3 className="gc-title">{p.pearsonCourseTitle || p.key}</h3></div>
              <label className="map-select">Show under
                <select defaultValue="" onChange={(e) => {
                  const v = e.target.value;
                  if (!v || !p.key) return;
                  void setPrefs({ pearsonMap: { ...(prefs.pearsonMap || {}), [p.key]: v } });
                }}>
                  <option value="">— choose course —</option>
                  {opts.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                </select>
              </label>
            </div>
            <div className="lanes">
              <div className="lane">
                <div className="lane-head"><span className="lane-label">MyLab</span><Stamp source="pearson" syncedAt={p.syncedAt} /></div>
                {p.currentGrade
                  ? <><div className="lane-val"><GradeFigure value={p.currentGrade} size="md" /></div>{p.overallPoints ? <div className="lane-sub">{p.overallPoints}</div> : null}</>
                  : <div className="lane-empty"><Chip kind="notsynced" text="Overall score not synced" /></div>}
              </div>
            </div>
            <PearsonBlock p={p} compact />
          </div>
        ))}
      </div>
    </>
  );
}
