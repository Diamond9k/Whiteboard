"use client";

import Link from "next/link";
import { formatDayHeading, greeting } from "@/lib/format";
import { availabilityLabel, stateLabel } from "@/lib/labels";
import type { Course, Snapshot, Stamp as StampType } from "@/lib/schema";
import { allDue, bucketDue, courseLabel, dueCoverage, gradeBand, mylabSynced, unfinishedMyLab } from "@/lib/view";
import { Gate } from "./data";
import { DueRows, Notices, PageHead, SampleBanner, Stamp } from "./ui";

export function Today() {
  return <Gate>{(snapshot, now, mode) => <TodayBody snapshot={snapshot} now={now} mode={mode} />}</Gate>;
}

function TodayBody({ snapshot, now, mode }: { snapshot: Snapshot; now: Date; mode: string }) {
  const name = snapshot.student?.name;
  const coverage = dueCoverage(snapshot.courses);
  const items = allDue(snapshot, now);
  const buckets = bucketDue(items, now);
  const bands = snapshot.courses.some((course) => gradeBand(course.mylab?.currentGrade) || gradeBand(course.blackboardGradebook?.currentGrade));
  return (
    <>
      {mode === "sample" && <SampleBanner />}
      <PageHead kicker={formatDayHeading(now)} title={name ? `${greeting(now)}, ${name}` : greeting(now)} snapshot={snapshot} mode={mode} />
      <Notices snapshot={snapshot} />
      <div className="today">
        <div>
          <div className="kpis">
            <Kpi href="#past-due" label="Past due" value={coverage === "none" ? "—" : String(buckets.past.length)} danger={coverage !== "none" && buckets.past.length > 0} />
            <Kpi href="#due-today" label="Due today" value={coverage === "none" ? "—" : String(buckets.today.length)} />
            <Kpi href="#next-7" label="Next 7 days" value={coverage === "none" ? "—" : String(buckets.upcoming.length)} />
          </div>
          {coverage === "none" ? <p className="empty-line">Due dates are not in this snapshot.</p> : (
            <>
              {coverage === "partial" && <p className="note">Some courses have no due dates synced. Counts use only the courses that were read.</p>}
              <section className="section" id="past-due">
                <div className="section-head"><h2>Past due</h2><span className="count">{buckets.past.length}</span></div>
                <DueRows items={buckets.past} snapshot={snapshot} now={now} />
              </section>
              <section className="section" id="due-today">
                <div className="section-head"><h2>Today</h2><span className="count">{buckets.today.length}</span></div>
                <DueRows items={buckets.today} snapshot={snapshot} now={now} />
              </section>
              <section className="section" id="next-7">
                <div className="section-head"><h2>Next 7 days</h2><span className="count">{buckets.upcoming.length}</span></div>
                <DueRows items={buckets.upcoming} snapshot={snapshot} now={now} />
              </section>
            </>
          )}
          <section className="section">
            <div className="section-head"><h2>Unfinished MyLab work</h2></div>
            <Unfinished snapshot={snapshot} />
          </section>
        </div>
        <aside>
          <div className="section-head">
            <h2>How you’re doing</h2>
            <Link href="/grades">Grades</Link>
          </div>
          {bands && <p className="note">90+ · 80s · 70s · 60s · &lt;60 — labels for a synced percent. MyLab and Blackboard stay separate.</p>}
          <div className="stack">
            {snapshot.courses.length === 0 && <p className="empty-line">No courses in this snapshot.</p>}
            {snapshot.courses.map((course) => <ClassCard key={course.id} course={course} />)}
          </div>
        </aside>
      </div>
      <p className="foot">Read-only. Times are Central (CT). <Link href="/diagnostics">Diagnostics</Link></p>
    </>
  );
}

function Kpi({ href, label, value, danger }: { href: string; label: string; value: string; danger?: boolean }) {
  return <a className="kpi" href={href}><span className={danger ? "n danger" : "n"}>{value}</span><span className="l">{label}</span></a>;
}

function ClassCard({ course }: { course: Course }) {
  return (
    <Link className="card-link" href={`/courses/${encodeURIComponent(course.id)}`}>
      <div className="card-top">
        <span className="code">{courseLabel(course)}</span>
        {course.code && <Stamp stamp={course.code.stamp} />}
      </div>
      <h3 style={{ marginTop: 4 }}>{course.title?.value || "Official title not synced"}</h3>
      {course.statedDescription && <p className="note">{course.statedDescription.value}</p>}
      {course.availability && <p className="note">{availabilityLabel(course.availability.value, course.availability.stamp.source)}</p>}
      <div className="lanes">
        <Lane label="MyLab" value={mylabValue(course)} stamp={course.mylab?.stamp || course.gradeHome?.stamp} />
        <Lane label="Blackboard" value={blackboardValue(course)} stamp={course.blackboardGradebook?.stamp} />
      </div>
      {course.gradeHome?.value === "pearson" && !course.mylab && <p className="note">You said grades live in MyLab. None are synced.</p>}
    </Link>
  );
}

function Lane({ label, value, stamp }: { label: string; value: string; stamp?: StampType | null }) {
  const numeric = /\d/.test(value) && value !== "—";
  return (
    <div className="lane">
      <div className="label">{label}</div>
      <div className={numeric ? "grade" : "grade missing"}>{value}</div>
      {stamp && numeric ? <Stamp stamp={stamp} /> : null}
    </div>
  );
}

function mylabValue(course: Course): string {
  if (course.mylab?.currentGrade) return course.mylab.currentGrade;
  if (course.mylab?.notes.some((note) => note.includes("disagree"))) return "Couldn’t choose";
  if (course.mylab) return course.mylabState === "ok" ? "—" : stateLabel(course.mylabState);
  return "Not yet synced";
}

function blackboardValue(course: Course): string {
  const book = course.blackboardGradebook;
  if (book?.currentGrade) return book.currentGrade;
  if (book?.empty) return "No grades posted";
  if (book?.overallAmbiguous) return "Couldn’t choose";
  if (book?.noOverallColumn) return "No overall column";
  if (course.blackboardGradebookState === "ok" || course.blackboardGradebookState === "partial") return "—";
  return stateLabel(course.blackboardGradebookState);
}

function Unfinished({ snapshot }: { snapshot: Snapshot }) {
  if (!mylabSynced(snapshot)) return <p className="empty-line">MyLab assignments are not yet synced.</p>;
  const rows = snapshot.courses.flatMap((course) => unfinishedMyLab(course).map((item) => ({ course, item })));
  const unread = snapshot.courses.some((course) => course.mylab && !course.mylab.parsed.items && course.mylabState !== "ok");
  return (
    <>
      {rows.length === 0 && <p className="empty-line">No incomplete items in the synced MyLab lists.</p>}
      {rows.length > 0 && (
        <ul className="due-list">
          {rows.map(({ course, item }) => (
            <li key={`${course.id}-${item.title}`} className="due-row">
              <div />
              <div>
                <div className="due-title">{item.title}</div>
                <div className="due-meta">{courseLabel(course)}{item.category ? ` · ${item.category}` : ""} · Incomplete</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {unread && <p className="note">Some MyLab assignment lists couldn’t be read.</p>}
    </>
  );
}
