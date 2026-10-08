"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { chicagoDayKey, dayDelta, formatDayHeading, monthGrid, monthKey, monthTitle, shiftMonth } from "@/lib/format";
import { stateLabel } from "@/lib/labels";
import type { Snapshot } from "@/lib/schema";
import { allDue, bucketDue, dueCoverage, recentDue, type LiveDue } from "@/lib/view";
import { Gate, useCourse, useSnapshot } from "./data";
import { DueRows, Notices, PageHead, SampleBanner } from "./ui";

export function CalendarPage({ view }: { view: "agenda" | "month" | "recent" }) {
  return <Gate>{(snapshot, now, mode) => <CalendarBody snapshot={snapshot} now={now} mode={mode} view={view} />}</Gate>;
}

function CalendarBody({ snapshot, now, mode, view }: { snapshot: Snapshot; now: Date; mode: string; view: "agenda" | "month" | "recent" }) {
  const coverage = dueCoverage(snapshot.courses);
  const items = allDue(snapshot, now);
  return (
    <>
      {mode === "sample" && <SampleBanner />}
      <PageHead kicker={formatDayHeading(now)} title="Calendar" snapshot={snapshot} mode={mode} />
      <Notices snapshot={snapshot} />
      <div className="seg" role="tablist" aria-label="Calendar view">
        <Link href="/calendar" aria-current={view === "agenda" ? "page" : undefined}>Agenda</Link>
        <Link href="/calendar/month" aria-current={view === "month" ? "page" : undefined}>Month</Link>
        <Link href="/calendar/recent" aria-current={view === "recent" ? "page" : undefined}>Recent</Link>
      </div>
      <div style={{ height: 14 }} />
      {coverage === "none" && <p className="empty-line" style={view === "month" ? { marginBottom: 14 } : undefined}>Due dates are not in this snapshot.</p>}
      {view === "month" && <Month snapshot={snapshot} now={now} items={items} />}
      {coverage !== "none" && view === "agenda" && <Agenda snapshot={snapshot} now={now} items={items} />}
      {coverage !== "none" && view === "recent" && <Recent snapshot={snapshot} now={now} items={items} />}
      <p className="foot"><a href="https://learn.uark.edu" target="_blank" rel="noopener noreferrer">Blackboard site</a></p>
    </>
  );
}

function Agenda({ snapshot, now, items }: { snapshot: Snapshot; now: Date; items: LiveDue[] }) {
  const buckets = bucketDue(items, now);
  const recent = recentDue(items, now);
  return (
    <div className="today">
      <div>
        <section className="section"><h2>Past due</h2><DueRows items={buckets.past} snapshot={snapshot} now={now} /></section>
        <section className="section"><h2>Upcoming</h2><DueRows items={[...buckets.today, ...buckets.upcoming, ...buckets.later]} snapshot={snapshot} now={now} /></section>
      </div>
      <div>
        <section className="section"><h2>Recently due · last 14 days</h2><DueRows items={recent.recent} snapshot={snapshot} now={now} /></section>
        <Older items={recent.older} snapshot={snapshot} now={now} />
      </div>
    </div>
  );
}

function Recent({ snapshot, now, items }: { snapshot: Snapshot; now: Date; items: LiveDue[] }) {
  const buckets = bucketDue(items, now);
  const recent = recentDue(items, now);
  return (
    <>
      <section className="section"><h2>Past due</h2><DueRows items={buckets.past} snapshot={snapshot} now={now} /></section>
      <section className="section"><h2>Recently due</h2><DueRows items={recent.recent} snapshot={snapshot} now={now} /></section>
      <Older items={recent.older} snapshot={snapshot} now={now} />
    </>
  );
}

function Older({ items, snapshot, now }: { items: LiveDue[]; snapshot: Snapshot; now: Date }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <section className="section">
      <button className="btn-ghost" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Hide older" : `Older · ${items.length}`}</button>
      {open && <DueRows items={items} snapshot={snapshot} now={now} />}
    </section>
  );
}

function Month({ snapshot, now, items }: { snapshot: Snapshot; now: Date; items: LiveDue[] }) {
  const [key, setKey] = useState(monthKey(now));
  const [selected, setSelected] = useState(chicagoDayKey(now.toISOString()));
  const cells = useMemo(() => monthGrid(key), [key]);
  const byDay = new Map<string, LiveDue[]>();
  for (const item of items) {
    const day = chicagoDayKey(item.due);
    if (!day) continue;
    const list = byDay.get(day) ?? [];
    list.push(item);
    byDay.set(day, list);
  }
  const selectedItems = selected ? byDay.get(selected) ?? [] : [];
  return (
    <div className="today">
      <div>
        <div className="month-head">
          <button className="btn-ghost" type="button" onClick={() => setKey(shiftMonth(key, -1))}>Previous</button>
          <h2>{monthTitle(key)}</h2>
          <button className="btn-ghost" type="button" onClick={() => setKey(shiftMonth(key, 1))}>Next</button>
        </div>
        <div className="month-grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="dow">{day}</div>)}
          {cells.map((cell) => {
            const list = byDay.get(cell.isoDay) ?? [];
            return (
              <button key={cell.isoDay} type="button" className={cell.inMonth ? "day" : "day out"} aria-pressed={selected === cell.isoDay} onClick={() => setSelected(cell.isoDay)}>
                <span className="n">{cell.label}</span>
                {list.slice(0, 2).map((item) => <span key={item.id} className="dot" title={item.title}>{item.title}</span>)}
              </button>
            );
          })}
        </div>
      </div>
      <section className="card">
        <h2>{selected || "Day"}</h2>
        {selectedItems.length === 0 ? <p className="empty-line">Nothing due this day in the snapshot.</p> : <DueRows items={selectedItems} snapshot={snapshot} now={now} />}
      </section>
    </div>
  );
}

export function CourseCalendar() {
  const { course, now } = useCourse();
  const { snapshot } = useSnapshot();
  if (course.dueState !== "ok" && course.dueState !== "empty") return <p className="empty-line">{stateLabel(course.dueState)}</p>;
  const scoped = { ...snapshot, courses: [course] };
  const items = allDue(scoped, now);
  const upcoming = items.filter((item) => {
    const delta = dayDelta(item.due, now);
    return item.live === "due" || (item.live === "submitted" && delta !== null && delta >= 0);
  });
  const recent = items.filter((item) => { const delta = dayDelta(item.due, now); return delta !== null && delta < 0 && delta >= -30; });
  const older = items.filter((item) => { const delta = dayDelta(item.due, now); return delta !== null && delta < -30; });
  return (
    <div className="stack">
      <section className="section"><h2>Upcoming</h2><DueRows items={upcoming} snapshot={scoped} now={now} /></section>
      <section className="section"><h2>Past · last 30 days</h2><DueRows items={recent} snapshot={scoped} now={now} /></section>
      <Older items={older} snapshot={scoped} now={now} />
    </div>
  );
}
