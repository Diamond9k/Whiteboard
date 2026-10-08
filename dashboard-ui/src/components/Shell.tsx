import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { useDash } from '../context';
import { BB, MOD, initials, isVerified } from '../lib/course';
import { fmtAgo, fmtDateTime } from '../lib/format';
import { sysInfo, useTrust } from '../lib/trust';

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

export function Shell({ active, moreOpen, setMore, children }: { active: string; moreOpen: boolean; setMore: (v: boolean) => void; children: ReactNode }) {
  const { data, prefs, setPrefs, openSearch, openShortcuts } = useDash();
  const student = data && isVerified(data.student) ? data.student?.name : null;
  const ini = student ? initials(student) : null;
  const theme = prefs.theme === 'light' || prefs.theme === 'dark' ? prefs.theme : (prefs.theme === 'system' ? 'system' : 'light');
  const moreActive = NAV_QUIET.some((n) => n.key === active) || NAV_EXT.some((n) => n.key === active);
  useEffect(() => { document.body.classList.toggle('more-open', moreOpen); }, [moreOpen]);

  const item = (n: { key: string; label: string; icon: string }) => (
    <a key={n.key} className={`nav-item ${n.key === active ? 'active' : ''}`} href={`#/${n.key}`} aria-current={n.key === active ? 'page' : undefined} title={n.label}>
      <span className="nav-icon"><Icon name={n.icon} size={20} /></span><span className="nav-label">{n.label}</span>
    </a>
  );
  const setTheme = (t: string) => { void setPrefs({ theme: t }); };

  return (
    <>
      <a className="skip-link" href="#view" onClick={(e) => { e.preventDefault(); const h = document.querySelector<HTMLElement>('#view h1, #view'); if (h) { h.tabIndex = -1; h.focus(); } }}>Skip to content</a>
      <nav id="nav" className="sidenav" aria-label="Main navigation">
        <a className="monogram" href="#/today" title="University of Arkansas · Today"><span aria-hidden="true">A</span><span className="sr-only">University of Arkansas — Today</span></a>
        <button className="nav-search" type="button" onClick={openSearch} title={`Search (${MOD} K or /)`} aria-label={`Search courses and items (${MOD} K)`}>
          <span className="nav-icon"><Icon name="search" size={19} /></span><span className="nav-label">Search</span><kbd>{MOD} K</kbd>
        </button>
        <div className="nav-items">
          {NAV.map(item)}
          <button className={`nav-item nav-more-btn ${moreActive ? 'active' : ''}`} type="button" aria-expanded={moreOpen} aria-controls="nav-more" title="More" onClick={() => setMore(!moreOpen)}>
            <span className="nav-icon"><Icon name="more" size={20} /></span><span className="nav-label">More</span>
          </button>
        </div>
        <div className="nav-secondary" id="nav-more">
          <div className="sheet-head"><strong>More</strong><button className="icon-btn sheet-close" type="button" aria-label="Close" onClick={() => setMore(false)}><Icon name="close" size={18} /></button></div>
          {NAV_QUIET.map(item)}
          <div className="nav-group" role="group" aria-label="In Blackboard (opens in a new tab)">
            <div className="nav-eyebrow">In Blackboard <Icon name="external" size={10} /></div>
            {NAV_EXT.map((n) => (
              <a key={n.key} className={`nav-item nav-ext ${n.key === active ? 'active' : ''}`} href={n.href} target="_blank" rel="noopener" title={`${n.label} — opens in Blackboard`} aria-current={n.key === active ? 'page' : undefined} onClick={() => setMore(false)}>
                <span className="nav-icon"><Icon name={n.icon} size={18} /></span>
                <span className="nav-label">{n.label}<span className="sr-only"> (opens in Blackboard)</span></span>
                <span className="nav-ext-mark" aria-hidden="true"><Icon name="external" size={12} /></span>
              </a>
            ))}
            <a className="nav-item nav-ext" href={`${BB}/ultra/course`} target="_blank" rel="noopener" title="Open Blackboard"><span className="nav-icon"><Icon name="external" size={18} /></span><span className="nav-label">Open Blackboard</span></a>
          </div>
          <div className="theme-seg" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((key) => (
              <button key={key} type="button" role="radio" aria-checked={theme === key} title={`${cap(key)} theme`} className={theme === key ? 'on' : ''} onClick={() => setTheme(key)}>
                <Icon name={key === 'system' ? 'monitor' : key === 'light' ? 'sun' : 'moon'} size={15} /><span className="theme-l">{cap(key)}</span>
              </button>
            ))}
          </div>
          {student ? <div className="nav-profile" title={student}><span className="avatar" aria-hidden="true">{ini}</span><span className="nav-label">{student}</span></div> : null}
        </div>
      </nav>
      <div className="main">
        <Notices />
        <main id="view" className="view" tabIndex={-1}>{children}</main>
        <footer id="provenance" className="provenance-footer">
          <span>Read-only view of your Blackboard and MyLab data. All times Central (CT).</span>
          <a className="text-link" href="#/tools">Diagnostics</a>
          <button className="link-btn foot-keys" type="button" onClick={openShortcuts}><Icon name="keyboard" size={14} />Shortcuts <kbd>?</kbd></button>
        </footer>
      </div>
    </>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function Notices() {
  const { data } = useDash();
  const trust = useTrust();
  const st = data.status || {};
  const bb = st.blackboard || {};
  const pe = st.pearson || {};
  const hasCache = data.courses.length > 0;
  const parts: ReactNode[] = [];
  let tone = 'info';
  const bbInfo = sysInfo(trust, 'blackboard');
  const peInfo = sysInfo(trust, 'pearson');
  const age = (d: Date | null) => (d ? `from ${fmtDateTime(d)} (${fmtAgo(d)})` : 'from an earlier sync (time unknown)');
  if (bb.state === 'session-expired') {
    tone = 'warn';
    parts.push(<span key="bbx"><strong>Blackboard sign-in expired</strong> — {hasCache ? `showing data ${age(bbInfo.last)}.` : 'nothing cached yet.'} <a href={`${BB}/ultra/course`} target="_blank" rel="noopener">Sign in to Blackboard ↗</a></span>);
  } else if (bb.state === 'error') {
    tone = 'danger';
    parts.push(<span key="bbe"><strong>Last Blackboard sync failed</strong>{hasCache ? ` — showing data ${age(bbInfo.last)}` : ''}.{bb.message ? ` ${bb.message}` : ''} <a href={`${BB}/ultra/course`} target="_blank" rel="noopener">Open Blackboard ↗</a></span>);
  } else if (bbInfo.last && Date.now() - bbInfo.last.getTime() > 864e5) {
    parts.push(<span key="bbo"><strong>Blackboard data is {fmtAgo(bbInfo.last)} old</strong> (last synced {fmtDateTime(bbInfo.last)}). <a href={`${BB}/ultra/course`} target="_blank" rel="noopener">Open Blackboard to refresh ↗</a></span>);
  }
  if (pe.state === 'session-expired') {
    if (tone === 'info') tone = 'warn';
    parts.push(<span key="pex"><strong>MyLab sign-in expired</strong> — showing MyLab grades {age(peInfo.last)}. <a href="https://mylab.pearson.com/" target="_blank" rel="noopener">Open MyLab ↗</a></span>);
  } else if (pe.state === 'parse-failed') {
    tone = 'danger';
    parts.push(<span key="pef"><strong>MyLab results page couldn't be read</strong> (its layout may have changed) — earlier MyLab data kept.{pe.message ? ` ${pe.message}` : ''}</span>);
  } else if (pe.state === 'parse-partial' && parts.length) {
    parts.push(<span key="pep"><strong>MyLab partly read</strong> — {pe.message || 'part of the results page could not be read.'}</span>);
  }
  if (!parts.length) return <div id="notices" className="notices" aria-live="polite" />;
  const icon = tone === 'info' ? 'clock' : tone === 'danger' ? 'alert' : 'key';
  return (
    <div id="notices" className="notices" aria-live="polite">
      <div className="notice" data-tone={tone}>
        <Icon name={icon} size={16} />
        <p>{parts.map((p, i) => <span key={i}>{i ? <span className="notice-sep"> · </span> : null}{p}</span>)}</p>
      </div>
    </div>
  );
}
