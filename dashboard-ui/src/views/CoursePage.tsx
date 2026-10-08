import { useEffect, useRef, type ReactNode } from 'react';
import type { ContentItem, Course } from '../types';
import { Icon } from '../components/Icon';
import {
  Chip, DateChip, ExtLink, Freshness, InlineState, SearchButton, SecHead, Stamp, StatePanel, SectionPanel,
} from '../components/bits';
import { GradebookTab } from '../components/pearson';
import { Agenda } from './CalendarView';
import { useDash } from '../context';
import {
  DUE_NOTE, PAST_DUE_FULL, TAB_PATHS, TABS, byDue, courseLabel, courseUrl, fullTitle, initials, isOpen, isVerified,
  kindOf, safeColor, safeUrl, sectionOf, shortTitle, slug, stateReason, verifiedUpcoming,
} from '../lib/course';
import { fmtDueFull, fmtRelDay, parseDate, parseProgress } from '../lib/format';
import { isMaybePast, maybePastFull, maybePastLabel, useTrust } from '../lib/trust';

const EXT_TABS = ['Announcements', 'Discussions', 'Messages', 'Groups'];
const ACTIONS = [
  { label: 'Roster', subtitle: 'Everyone in your course', path: 'outline' },
  { label: 'Attendance', subtitle: 'Your attendance record', path: 'outline' },
  { label: 'Books & Tools', subtitle: 'Course & institution tools', path: 'outline' },
  { label: 'Launch Class', subtitle: 'Class Collaborate', path: 'outline' },
];
const TYPE_LABEL: Record<string, string> = { document: 'Document', link: 'Link', folder: 'Folder', module: 'Learning module', generic: 'Item' };

function actionIcon(label: string) {
  if (/roster/i.test(label)) return 'roster';
  if (/attend/i.test(label)) return 'attendance';
  if (/book|tool/i.test(label)) return 'books';
  if (/class|launch/i.test(label)) return 'video';
  return 'info';
}

export function CoursePage({ id, tabSlug }: { id?: string; tabSlug?: string }) {
  const { data } = useDash();
  const course = id ? data.courses.find((c) => c.id === id) : undefined;
  if (!course) {
    return (
      <>
        <header className="page-head"><div className="ph-text"><h1 className="page-title" tabIndex={-1}>Course not found</h1></div></header>
        <StatePanel kind="notsynced" title="This course is not in the synced data" detail="Return to Courses and pick a course from the list." />
        <p className="after-panel"><a className="btn" href="#/courses">Back to Courses</a></p>
      </>
    );
  }
  if (!isOpen(course)) {
    return (
      <>
        <header className="page-head">
          <div className="ph-text">{course.code ? <div className="eyebrow">{course.code}</div> : null}<h1 className="page-title" tabIndex={-1}>{courseLabel(course)}</h1></div>
          <SearchButton />
          <div className="ph-tools"><Freshness /></div>
        </header>
        <div className="card locked-page">
          <span className="sp-icon"><Icon name="lock" size={18} /></span>
          <div>
            <h2>This course isn't open yet</h2>
            <p>{course.note || 'Course content has not been synced from Blackboard.'}</p>
            <div className="actions-row"><a className="btn" href="#/courses">Back to Courses</a> <ExtLink href={course.home} label="Open in Blackboard" cls="btn-sec" /></div>
          </div>
        </div>
      </>
    );
  }
  const allTabs = [...TABS, ...EXT_TABS];
  const active = allTabs.find((t) => slug(t) === tabSlug) || TABS[0];
  const base = `#/course/${encodeURIComponent(course.id)}`;
  const t = shortTitle(course);
  return (
    <div className="course-page" style={{ ['--course' as string]: safeColor(course.color, '#9D2235') }}>
      <div className="course-topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          <a className="crumb-back" href="#/courses" aria-label="Back to Courses"><Icon name="chevronLeft" size={18} /></a>
          <a href="#/courses">Courses</a>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <span aria-current="page">{course.code || t || 'Course'}</span>
        </nav>
        {course.status === 'Open' ? <span className="status open"><i className="dot" aria-hidden="true" />Open</span> : null}
        <span className="spacer" />
        <Freshness />
        <SearchButton />
      </div>
      <div className="course-wrap">
        <div className="hero">
          <div className="hero-text">
            {course.code ? <div className="hero-code" title={course.bbId || ''}>{course.code}{course.termName ? ` · ${course.termName}` : ''}</div> : null}
            <h1 className="hero-title" tabIndex={-1} title={fullTitle(course)}>{t || course.code || 'Course'}</h1>
          </div>
          <a className="hero-btn" href={courseUrl(course, TAB_PATHS[active] || 'outline')} target="_blank" rel="noopener"><span><span className="hide-phone">Open in </span>Blackboard</span><Icon name="external" size={13} /></a>
        </div>
        <TabStrip active={active} base={base} course={course} />
        <div className="course-inner">
          {active === 'Content' ? <ContentTab course={course} />
            : active === 'Gradebook' ? <GradebookTab course={course} />
              : active === 'Calendar' ? <CourseCalendar course={course} />
                : (
                  <div className="tab-panel">
                    <StatePanel kind="elsewhere" title={`${active} live in Blackboard`} detail="This dashboard does not pull this tab." link={{ href: courseUrl(course, TAB_PATHS[active] || 'outline'), label: `Open ${active} in Blackboard` }} />
                  </div>
                )}
        </div>
      </div>
    </div>
  );
}

function TabStrip({ active, base, course }: { active: string; base: string; course: Course }) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = wrap.current;
    if (!w) return;
    const bar = w.querySelector<HTMLElement>('.tabbar');
    const btn = w.querySelector<HTMLButtonElement>('.tab-more');
    const update = () => {
      if (!bar) return;
      const more = bar.scrollWidth - bar.clientWidth - bar.scrollLeft > 4;
      w.classList.toggle('has-more', more);
      if (btn) btn.hidden = !more;
    };
    update();
    bar?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => { bar?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [active, course.id]);
  return (
    <div className="tabwrap" ref={wrap}>
      <nav className="tabbar" aria-label="Course sections">
        {TABS.map((t) => <a key={t} className={`tab ${t === active ? 'active' : ''}`} href={`${base}/${slug(t)}`} aria-current={t === active ? 'page' : undefined}>{t}</a>)}
        <span className="tab-sep" aria-hidden="true" />
        {EXT_TABS.map((t) => (
          <a key={t} className="tab tab-ext" href={courseUrl(course, TAB_PATHS[t])} target="_blank" rel="noopener" title={`${t} — opens in Blackboard`}>
            {t}<Icon name="external" size={12} /><span className="sr-only"> (opens in Blackboard)</span>
          </a>
        ))}
      </nav>
      <button type="button" className="tab-more" hidden aria-label="Scroll to more course tabs" title="More tabs" onClick={(e) => {
        const bar = e.currentTarget.closest('.tabwrap')?.querySelector<HTMLElement>('.tabbar');
        if (bar) bar.scrollBy({ left: bar.clientWidth * 0.7, behavior: 'smooth' });
      }}><Icon name="chevronRight" size={16} /></button>
    </div>
  );
}

function ContentTab({ course }: { course: Course }) {
  const sec = sectionOf(course, 'content');
  const items = Array.isArray(course.content) ? course.content : null;
  if (!items) {
    return (
      <div className="course-cols no-content">
        <section className="col-main">
          <SectionPanel sec={sec} what="Course content" link={{ href: courseUrl(course), label: 'Open course in Blackboard' }} />
          <CourseDueBlock course={course} />
        </section>
        <aside className="col-side"><FacultyPanel course={course} /><ActionsPanel course={course} /></aside>
      </div>
    );
  }
  const noProgress = items.length > 0 && items.every((i) => !i.progress);
  const linked = items.some((i) => safeUrl(i.url));
  const note = noProgress ? "Progress isn't exposed by the Blackboard API, so no progress rings are shown." : '';
  const linkNote = linked
    ? 'Only items whose synced record included a Blackboard or Pearson address can be opened.'
    : "Items aren't links: Blackboard's API didn't return their addresses. Open the course in Blackboard to use them.";
  return (
    <div className="course-cols">
      <aside className="col-due" aria-label="Due in this course"><DueSoon course={course} /></aside>
      <section className="col-main">
        <SecHead title={<>Course content{items.length ? <> <span className="count">{items.length}</span></> : null}</>} tools={<Stamp source={sec.source || course.source} syncedAt={sec.syncedAt} stale={sec.stale} notes={[note, linkNote]} />} />
        {items.length
          ? <div className="card list-card">{items.map((item, i) => <ContentRow key={item.id || `${item.title}-${i}`} item={item} />)}</div>
          : <StatePanel kind="empty" title="Blackboard returned no top-level content items" detail="The course outline may be empty or hidden from students." />}
      </section>
      <aside className="col-side"><FacultyPanel course={course} /><ActionsPanel course={course} /></aside>
    </div>
  );
}

function Progress({ p }: { p?: string }) {
  if (p === 'complete') return <span className="prog prog-complete" title="Complete"><Icon name="checkCircle" size={20} /><span className="sr-only">Complete</span></span>;
  if (p === 'started') return <span className="prog prog-started" title="Started"><Icon name="halfdot" size={20} /><span className="sr-only">Started</span></span>;
  if (p === 'none') return <span className="prog prog-none" title="Not started"><Icon name="generic" size={20} /><span className="sr-only">Not started</span></span>;
  return null;
}

function SegBar({ text }: { text: string }) {
  const pr = parseProgress(text);
  if (!pr) return null;
  const filled = pr.ratio >= 1 ? 3 : pr.ratio > 0 ? Math.max(1, Math.floor(pr.ratio * 3)) : 0;
  const cls = pr.kind.startsWith('complet') ? 'seg-complete' : 'seg-started';
  return <span className={`segbar ${cls}`} aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i < filled ? 'on' : ''} />)}</span>;
}

function ContentRow({ item }: { item: ContentItem }) {
  if (!isVerified(item)) {
    return <div className="content-item"><span className="ci-icon"><Icon name="generic" /></span><div className="ci-text"><Chip kind="notsynced" text="Item not synced from Blackboard" /></div></div>;
  }
  const type = ['document', 'link', 'folder', 'module'].includes(item.type || '') ? item.type! : 'generic';
  const label = TYPE_LABEL[type] || 'Item';
  const href = safeUrl(item.url);
  const body = (
    <>
      <span className={`ci-icon ci-${type}`} title={label} aria-hidden="true"><Icon name={type} size={18} /></span>
      <div className="ci-text">
        <div className="ci-title"><span className="sr-only">{label}: </span>{item.title}</div>
        {item.desc ? <div className="ci-desc">{item.desc}</div> : null}
        {item.progressText ? <div className="ci-progress">{type === 'module' ? <SegBar text={item.progressText} /> : null}<span>{item.progressText}</span></div> : null}
      </div>
      <Progress p={item.progress} />
      {href ? <span className="ci-open" aria-hidden="true"><Icon name="external" size={14} /></span> : null}
    </>
  );
  return href
    ? <a className="content-item is-link" href={href} target="_blank" rel="noopener">{body}</a>
    : <div className="content-item">{body}</div>;
}

function DueSoon({ course }: { course: Course }) {
  const trust = useTrust();
  const sec = sectionOf(course, 'upcoming');
  const up = verifiedUpcoming(course);
  const next = up.filter((u) => u.status === 'due' && !isMaybePast(trust, u)).sort(byDue).slice(0, 3);
  const overdue = up.filter((u) => u.status === 'overdue').length;
  const maybe = up.filter((u) => isMaybePast(trust, u)).length;
  const calHref = `#/course/${encodeURIComponent(course.id)}/calendar`;
  let body: ReactNode;
  if (next.length) body = <div className="mini-due">{next.map((u, i) => <MiniDue key={i} u={u} />)}</div>;
  else if (Array.isArray(course.upcoming) && sec.state === 'ok') body = <p className="muted small empty-line">Nothing upcoming in Blackboard for this course.</p>;
  else body = <InlineState kind={kindOf(sec.state)} title="Due dates not synced" detail={stateReason(sec.state)} />;
  return (
    <div className="card side-card">
      <SecHead title="Due in this course" tag="h3" tools={Array.isArray(course.upcoming) ? <Stamp source={sec.source || 'blackboard-api'} syncedAt={sec.syncedAt} stale={sec.stale} /> : null} />
      {overdue ? <p className="od-line" title={PAST_DUE_FULL}><Icon name="alert" size={14} />{overdue} past due · <a className="text-link" href={calHref}>see all</a></p> : null}
      {maybe ? <p className="od-line is-maybe" title={maybePastFull(trust)}><Icon name="clock" size={14} /><span>{maybe} {maybePastLabel(trust).replace(/^Past due/, maybe === 1 ? 'item past due' : 'items past due')}</span></p> : null}
      {body}
      <a className="side-more" href={calHref}>All dates<Icon name="arrowRight" size={14} /></a>
    </div>
  );
}

function MiniDue({ u }: { u: { title?: string; due?: string } }) {
  const d = parseDate(u.due);
  return (
    <div className="mini-row">
      <DateChip d={d} />
      <div className="mini-text">
        <div className="mini-title">{u.title}</div>
        <div className="mini-when">{d ? <><strong>{fmtRelDay(d)}</strong> · {fmtDueFull(d)}</> : 'Due date not synced'}</div>
      </div>
    </div>
  );
}

function CourseDueBlock({ course }: { course: Course }) {
  const sec = sectionOf(course, 'upcoming');
  const up = verifiedUpcoming(course);
  let body: ReactNode;
  if (up.length) body = <Agenda rows={up.map((u) => ({ u, c: course }))} showCourse={false} upcomingFirst />;
  else if (Array.isArray(course.upcoming) && sec.state === 'ok') body = <p className="empty-line">Nothing due in Blackboard for this course.</p>;
  else body = <SectionPanel sec={sec} what="Due dates" />;
  return (
    <div className="due-block">
      <SecHead title="Due in this course" tools={Array.isArray(course.upcoming) ? <Stamp source={sec.source || 'blackboard-api'} syncedAt={sec.syncedAt} stale={sec.stale} /> : null} />
      {body}
    </div>
  );
}

function FacultyPanel({ course }: { course: Course }) {
  const sec = sectionOf(course, 'faculty');
  const all = Array.isArray(course.faculty) ? course.faculty : null;
  let rows: ReactNode;
  let st: ReactNode = null;
  if (all && all.length) {
    rows = (
      <>
        {all.map((f, i) => isVerified(f) ? (
          <div className="fac-row" key={i}>
            <span className="avatar sm" aria-hidden="true">{initials(f.name)}</span>
            <div className="fac-name">{f.name}<span className="pill-role">{f.role || 'Instructor'}</span></div>
            <a className="icon-btn" href={courseUrl(course, 'messages')} target="_blank" rel="noopener" title="Message in Blackboard" aria-label={`Message ${f.name} in Blackboard`}><Icon name="messages" size={18} /></a>
          </div>
        ) : <div className="fac-row" key={i}><Chip kind="notsynced" text="Faculty member not synced" /></div>)}
        {course.facultyUnnamed && course.facultyUnnamed > 0 ? <div className="fac-row muted small">{course.facultyUnnamed} more instructor{course.facultyUnnamed === 1 ? '' : 's'} listed, but Blackboard returned no name.</div> : null}
      </>
    );
    st = <Stamp source={all[0].source || sec.source} syncedAt={sec.syncedAt || course.syncedAt} stale={sec.stale} />;
  } else if (all && course.facultyUnnamed && course.facultyUnnamed > 0) {
    rows = <InlineState kind="notsynced" title="Instructor name not returned" detail={`Blackboard listed ${course.facultyUnnamed} instructor${course.facultyUnnamed === 1 ? '' : 's'} for this course but did not return a name.`} />;
    st = <Stamp source={sec.source || course.source} syncedAt={sec.syncedAt || course.syncedAt} stale={sec.stale} />;
  } else if (all && sec.state === 'ok') {
    rows = <p className="muted small empty-line">Blackboard listed no instructors for this course.</p>;
    st = <Stamp source={sec.source || course.source} syncedAt={sec.syncedAt || course.syncedAt} stale={sec.stale} />;
  } else {
    const k = kindOf(sec.state);
    rows = k === 'forbidden'
      ? <InlineState kind="forbidden" title="Faculty list isn't shared with student accounts" detail="It may still be visible in Blackboard itself." />
      : <InlineState kind={k} title={k === 'error' ? "Faculty couldn't be read" : 'Instructor not yet synced'} detail={stateReason(sec.state)} />;
    if (sec.syncedAt && k !== 'notsynced') st = <Stamp source={sec.source || course.source} syncedAt={sec.syncedAt} notes={['Time the restriction was checked.']} />;
  }
  return <div className="card side-card"><SecHead title="Course faculty" tag="h3" tools={st} />{rows}</div>;
}

function ActionsPanel({ course }: { course: Course }) {
  return (
    <div className="card side-card">
      <SecHead title="In Blackboard" tag="h3" sub="Standard Blackboard actions — these open the course in Blackboard." />
      {ACTIONS.map((a) => (
        <a key={a.label} className="action-row" href={courseUrl(course, a.path)} target="_blank" rel="noopener" title="Opens in Blackboard">
          <span className="action-icon"><Icon name={actionIcon(a.label)} size={18} /></span>
          <div className="action-text"><div className="action-label">{a.label}</div><div className="action-sub">{a.subtitle}</div></div>
          <span className="action-go" aria-hidden="true"><Icon name="external" size={14} /></span>
        </a>
      ))}
    </div>
  );
}

function CourseCalendar({ course }: { course: Course }) {
  const sec = sectionOf(course, 'upcoming');
  const up = verifiedUpcoming(course);
  let body: ReactNode;
  if (up.length) body = <Agenda rows={up.map((u) => ({ u, c: course }))} showCourse={false} upcomingFirst split recentDays={30} />;
  else if (Array.isArray(course.upcoming) && sec.state === 'ok') body = <StatePanel kind="empty" title="No due dates found in Blackboard for this course" detail="MyLab-hosted assignments only show here if Blackboard has a gradebook due date for them." />;
  else body = <SectionPanel sec={sec} what="Course calendar" link={{ href: courseUrl(course), label: 'Open course in Blackboard' }} />;
  return (
    <div className="tab-panel tab-cal">
      <SecHead title="Due dates" sub="Upcoming first; past items keep the status Blackboard reported." tools={Array.isArray(course.upcoming) ? <Stamp source="blackboard-api" syncedAt={sec.syncedAt} stale={sec.stale} notes={[DUE_NOTE]} /> : null} />
      {body}
    </div>
  );
}
