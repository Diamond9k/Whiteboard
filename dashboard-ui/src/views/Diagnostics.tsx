import type { ReactNode } from 'react';
import { Chip, PageHead, SecHead, StatePanel } from '../components/bits';
import { Icon } from '../components/Icon';
import { useDash } from '../context';
import { BB, courseLabel, kindOf, sourceLabel } from '../lib/course';
import { fmtDateTime, fmtFullAgo, fmtWhen, parseDate } from '../lib/format';
import type { Course, SysStatus } from '../types';

const SYS_TEXT = (s?: SysStatus) => {
  if (!s || !s.state) return 'Never synced';
  const map: Record<string, string> = { ok: 'OK', 'session-expired': 'Sign-in expired', error: 'Failed', partial: 'Partly read', 'parse-partial': 'Partly read', 'parse-failed': "Couldn't read page" };
  return map[s.state] || s.state;
};
const SYS_KIND = (s?: SysStatus) => (!s || !s.state ? 'notsynced' : s.state === 'ok' ? 'ok' : kindOf(s.state));
const SEC_TEXT: Record<string, string> = { ok: 'OK', partial: 'Partly read', forbidden: 'Not shared', auth: 'Sign-in expired', 'not-found': 'Not available', 'not-fetched': 'Not synced', error: 'Failed', network: 'Failed', timeout: 'Failed', 'bad-json': 'Failed', 'bad-content-type': 'Failed' };
const SECS = ['faculty', 'content', 'gradebook', 'upcoming'] as const;
const LABELS: Record<string, string> = { faculty: 'Faculty', content: 'Content', gradebook: 'Gradebook', upcoming: 'Due dates' };

export function DiagnosticsPage() {
  const { data, requestSync, clearCache, syncMsg } = useDash();
  const st = data.status || {};
  const dash = <span className="muted">—</span>;
  const srcs = [...new Set(data.courses.map((c) => c.source).filter(Boolean))] as string[];
  const oneSource = srcs.length === 1;
  const current = data.courses.filter((c) => c.current !== false);
  const full = current.filter((c) => SECS.every((k) => c.sections?.[k]?.state === 'ok')).length;
  const restricted = current.filter((c) => SECS.some((k) => c.sections?.[k]?.state === 'forbidden')).map((c) => c.code || c.id);
  const unsynced = current.filter((c) => !c.sections?.faculty && c.sections?.details).map((c) => c.code || c.id);
  return (
    <>
      <PageHead title="Diagnostics" />
      {current.length ? <p className="lede">{full} of {current.length} current course{current.length === 1 ? '' : 's'} fully read{restricted.length ? ` · ${restricted.join(', ')} restricted by Blackboard` : ''}{unsynced.length ? ` · ${unsynced.join(', ')} not synced in detail` : ''}.</p> : null}
      <section className="card">
        <SecHead title="Sync status" />
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Sync status">
          <table className="data-table diag stack-table">
            <thead><tr><th scope="col">System</th><th scope="col">State</th><th scope="col">Last success</th><th scope="col">Source</th><th scope="col">Last attempt</th><th scope="col">Message</th><th scope="col"><span className="sr-only">Link</span></th></tr></thead>
            <tbody>
              <SysRow name="Blackboard" s={st.blackboard} link={`${BB}/ultra/course`} />
              <SysRow name="Pearson MyLab" s={st.pearson} link="https://mylab.pearson.com/" />
            </tbody>
          </table>
        </div>
        <div className="actions-row">
          <button className="btn" type="button" onClick={() => { void requestSync(); }}><Icon name="sync" size={15} />Sync now (open tabs)</button>
          <button className="btn-sec" type="button" onClick={() => { if (confirm('Remove all cached Blackboard/Pearson data stored by this extension on this computer?')) void clearCache(); }}>Clear cached data</button>
          <span className="sync-msg muted small" role="status">{syncMsg}</span>
        </div>
        <p className="muted small block-note">Sync only works through an open, signed-in Blackboard or Pearson tab. "Clear cached data" removes everything this extension stored on this computer; it does not touch Blackboard or Pearson.</p>
      </section>
      <section className="card">
        <SecHead title="Per-course sections" sub={`${oneSource && srcs[0] ? `All read from ${sourceLabel(srcs[0])}. ` : ''}Read shows the latest read for each course; each state's tooltip has its own read time. Times are Central (CT).`} />
        {data.courses.length ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Per-course sections">
            <table className="data-table diag stack-table diag-courses">
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  {oneSource ? null : <th scope="col">Source</th>}
                  <th scope="col">Faculty</th><th scope="col">Content</th><th scope="col">Gradebook</th><th scope="col">Due dates</th><th scope="col">MyLab</th><th scope="col">Read</th>
                </tr>
              </thead>
              <tbody>
                {data.courses.map((c) => <CourseRow key={c.id} c={c} oneSource={oneSource} dash={dash} />)}
              </tbody>
            </table>
          </div>
        ) : <StatePanel kind="notsynced" title="No courses synced yet" />}
      </section>
    </>
  );
}

function SysRow({ name, s, link }: { name: string; s?: SysStatus; link: string }) {
  const last = parseDate(s?.lastSuccessAt);
  const at = parseDate(s?.at);
  const dash = <span className="muted">—</span>;
  return (
    <tr>
      <th scope="row" className="cell-title">{name}</th>
      <td className="cell-key" data-label="State"><Chip kind={SYS_KIND(s)} text={SYS_TEXT(s)} /></td>
      <td className="cell-kv cell-span" data-label="Last success">{last ? <span className="full-ts">{fmtFullAgo(last)}</span> : dash}</td>
      <td className={`cell-kv${s?.source ? '' : ' is-na'}`} data-label="Source">{s?.source ? sourceLabel(s.source) : dash}</td>
      <td className={`cell-kv cell-span${at ? '' : ' is-na'}`} data-label="Last attempt">{at ? <span className="full-ts">{fmtFullAgo(at)}</span> : dash}</td>
      <td className={`small cell-kv cell-span${s?.message ? '' : ' is-na'}`} data-label="Message">{s?.message || dash}</td>
      <td className="cell-kv cell-open nolabel" data-label="Open"><a className="text-link nowrap" href={link} target="_blank" rel="noopener">Open<span className="sr-only"> {name}</span><Icon name="external" size={12} /></a></td>
    </tr>
  );
}

function CourseRow({ c, oneSource, dash }: { c: Course; oneSource: boolean; dash: ReactNode }) {
  const secs = c.sections || {};
  const pastTerm = c.current === false;
  const cell = (k: string) => {
    const s = secs[k] || secs.details;
    if (!s) return dash;
    const t = parseDate(s.syncedAt);
    const tip = [t ? `Read ${fmtDateTime(t)}` : '', s.lastError ? `Last error: ${s.lastError}` : '', s.stale ? 'Stale: showing the earlier copy' : '', pastTerm && s.state === 'not-fetched' ? 'Course is from a past term; its details were not read.' : ''].filter(Boolean).join(' · ');
    return <>{<Chip kind={s.state === 'ok' ? 'ok' : kindOf(s.state)} text={SEC_TEXT[s.state || ''] || s.state} title={tip} />}{s.stale ? <Chip kind="stale" text="stale" /> : null}</>;
  };
  const times = Object.values(secs).map((s) => s && s.syncedAt).filter((x): x is string => !!x).sort();
  const read = parseDate(times[times.length - 1]);
  return (
    <tr>
      <th scope="row" className="cell-title"><span title={courseLabel(c)}>{c.code || c.id}</span>{pastTerm ? <span className="item-status">Past term · details not read</span> : null}</th>
      {oneSource ? null : <td className="small cell-kv" data-label="Source">{sourceLabel(c.source)}</td>}
      {SECS.map((k) => <td key={k} className="cell-kv" data-label={LABELS[k]}>{cell(k)}</td>)}
      <td className="cell-kv" data-label="MyLab">{c.pearson ? <Chip kind="ok" text="Linked" /> : dash}</td>
      <td className="nowrap cell-kv" data-label="Read">{read ? <span title={fmtDateTime(read)}>{fmtWhen(read)}</span> : dash}</td>
    </tr>
  );
}
