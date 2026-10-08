import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { DashboardData, Prefs } from './types';
import { DashProvider } from './context';
import { TrustProvider } from './lib/trust';
import { applyTheme, clearCache, loadData, onDataChanged, requestSync, savePrefs } from './lib/storage';
import { Shell } from './components/Shell';
import { Palette, Shortcuts } from './components/Palette';
import { TodayPage } from './views/Today';
import { CoursesPage } from './views/Courses';
import { CoursePage } from './views/CoursePage';
import { GradesPage } from './views/Grades';
import { CalendarPage } from './views/CalendarView';
import { DiagnosticsPage } from './views/Diagnostics';
import { ErrorPage, StubPage } from './views/Stubs';
import { BB, TABS, slug } from './lib/course';

function parseRoute(hash: string) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { page: parts[0] || 'today', parts };
}

const GRADES_OPEN = new Set<string>();

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [hash, setHash] = useState(() => location.hash);
  const [showPast, setShowPast] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [gradesTick, setGradesTick] = useState(0);
  const route = parseRoute(hash);
  const prefs: Prefs = data?.prefs || {};

  const reload = useCallback(async () => {
    try {
      const next = await loadData();
      setData(next);
      setBootError(null);
      applyTheme(next.prefs?.theme || 'light');
    } catch (err) {
      console.error(err);
      setBootError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
    onDataChanged(() => { window.setTimeout(() => { void reload(); }, 150); });
  }, [reload]);

  useEffect(() => {
    const onHash = () => { setHash(location.hash); setMoreOpen(false); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const gradeId = route.page === 'grades' ? route.parts[1] : '';
  useEffect(() => {
    if (gradeId) {
      GRADES_OPEN.add(gradeId);
      setGradesTick((n) => n + 1);
    }
  }, [gradeId]);

  useEffect(() => {
    const h = document.querySelector<HTMLElement>('#view h1');
    if (h) h.focus({ preventScroll: true });
    document.title = `${h?.textContent || 'Dashboard'} · Blackboard`;
  }, [hash, data]);

  useEffect(() => {
    document.body.classList.toggle('modal-open', palette || shortcuts);
  }, [palette, shortcuts]);

  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (palette || shortcuts) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      if (e.key === 'Escape') {
        document.querySelectorAll<HTMLDetailsElement>('details.fresh[open], details.stamp[open]').forEach((d) => { d.open = false; });
        if (moreOpen) { setMoreOpen(false); document.querySelector<HTMLElement>('.nav-more-btn')?.focus(); }
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); setPalette(true); return; }
      if (e.key === '?') { e.preventDefault(); setShortcuts(true); return; }
      if (gAt && Date.now() - gAt < 1200) {
        gAt = 0;
        const map: Record<string, string> = { t: 'today', c: 'courses', k: 'calendar', g: 'grades' };
        if (map[e.key]) { e.preventDefault(); location.hash = `#/${map[e.key]}`; }
        return;
      }
      if (e.key === 'g') { gAt = Date.now(); return; }
      if (e.key === '[' || e.key === ']') {
        const { page, parts } = parseRoute(location.hash);
        if (page !== 'course' || !parts[1]) return;
        const slugs = TABS.map(slug);
        const cur = Math.max(0, slugs.indexOf(parts[2] || 'content'));
        const nxt = (cur + (e.key === ']' ? 1 : -1) + slugs.length) % slugs.length;
        e.preventDefault();
        location.hash = `#/course/${encodeURIComponent(parts[1])}/${slugs[nxt]}`;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [palette, shortcuts, moreOpen]);

  const setPrefs = async (patch: Partial<Prefs>) => {
    setData((d) => d ? { ...d, prefs: { ...(d.prefs || {}), ...patch } } : d);
    if (patch.theme) applyTheme(patch.theme);
    await savePrefs(patch);
  };
  const doSync = async () => {
    const r = await requestSync();
    const msg = !r ? 'Sync request failed.'
      : (r.blackboardTabs || 0) + (r.pearsonTabs || 0) === 0 ? 'No Blackboard or MyLab tab is open — open one while signed in to sync.'
        : `Asked ${r.blackboardTabs ? 'Blackboard' : ''}${r.blackboardTabs && r.pearsonTabs ? ' + ' : ''}${r.pearsonTabs ? 'MyLab' : ''} tab(s) to refresh…`;
    setSyncMsg(msg);
  };

  if (!data && !bootError) {
    return <main id="view" className="view"><p className="loading">Loading cached data…</p></main>;
  }

  const navKey = route.page === 'course' ? 'courses'
    : route.page === 'activity' ? 'calendar'
      : ['today', 'courses', 'calendar', 'grades', 'tools', 'messages', 'institution', 'organizations'].includes(route.page) ? route.page : '';

  let page: ReactNode;
  if (bootError || !data) page = <ErrorPage message={bootError || 'Data not loaded'} />;
  else {
    switch (route.page) {
      case 'today': page = <TodayPage />; break;
      case 'courses': page = <CoursesPage />; break;
      case 'course': page = <CoursePage id={route.parts[1]} tabSlug={route.parts[2]} />; break;
      case 'grades': page = <GradesPage />; break;
      case 'activity': page = <CalendarPage parts={['recent']} />; break;
      case 'calendar': page = <CalendarPage parts={route.parts.slice(1)} />; break;
      case 'tools': page = <DiagnosticsPage />; break;
      case 'messages': page = <StubPage title="Messages" text="Messages are not pulled into this dashboard." link={{ href: `${BB}/ultra/messages`, label: 'Open Messages in Blackboard' }} />; break;
      case 'institution': page = <StubPage title="Institution Page" link={{ href: `${BB}/ultra/institution-page`, label: 'Open in Blackboard' }} />; break;
      case 'organizations': page = <StubPage title="Organizations" link={{ href: `${BB}/ultra/organizations`, label: 'Open Organizations in Blackboard' }} />; break;
      default: page = <StubPage title="Page not found" kind="notsynced" heading="Nothing at this address" text="Use the navigation to pick a page." />;
    }
  }

  const api = {
    data: data || { courses: [], unmatchedPearson: [], status: {} },
    prefs,
    showPast,
    setShowPast,
    syncMsg,
    requestSync: doSync,
    clearCache: async () => { await clearCache(); },
    setPrefs,
    openSearch: () => setPalette(true),
    openShortcuts: () => setShortcuts(true),
    gradesOpen: GRADES_OPEN,
    toggleGrade: (id: string) => {
      if (GRADES_OPEN.has(id)) GRADES_OPEN.delete(id); else GRADES_OPEN.add(id);
      setGradesTick((n) => n + 1);
    },
  };

  void gradesTick;
  return (
    <DashProvider value={api}>
      <TrustProvider data={api.data}>
        <Shell active={navKey} moreOpen={moreOpen} setMore={setMoreOpen}>{page}</Shell>
        <Palette open={palette} data={data} onClose={() => setPalette(false)} />
        <Shortcuts open={shortcuts} onClose={() => setShortcuts(false)} />
      </TrustProvider>
    </DashProvider>
  );
}
