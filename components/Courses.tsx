"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDue, relativeDay } from "@/lib/format";
import { stateLabel } from "@/lib/labels";
import { readPrefs, subscribePrefs, writePrefs } from "@/lib/prefs";
import type { Course, Snapshot } from "@/lib/schema";
import { courseLabel, liveStatus } from "@/lib/view";
import { Gate } from "./data";
import { Notices, PageHead, SampleBanner, Stamp } from "./ui";

export function Courses() {
  return <Gate>{(snapshot, now, mode) => <CoursesBody snapshot={snapshot} now={now} mode={mode} />}</Gate>;
}

function CoursesBody({ snapshot, now, mode }: { snapshot: Snapshot; now: Date; mode: string }) {
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showPast, setShowPast] = useState(false);
  useEffect(() => {
    const load = () => {
      const prefs = readPrefs();
      setLayout(prefs.layout);
      setFavorites(prefs.favorites);
    };
    load();
    return subscribePrefs(load);
  }, []);
  const past = snapshot.courses.filter((course) => course.current === false);
  const visible = snapshot.courses.filter((course) => showPast || course.current !== false);
  const ordered = [...visible].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  const term = singleTerm(snapshot);
  function toggleFavorite(id: string) {
    const prefs = readPrefs();
    const next = prefs.favorites.includes(id) ? prefs.favorites.filter((item) => item !== id) : [...prefs.favorites, id];
    writePrefs({ ...prefs, favorites: next });
  }
  function chooseLayout(next: "list" | "grid") {
    const prefs = readPrefs();
    writePrefs({ ...prefs, layout: next });
  }
  return (
    <>
      {mode === "sample" && <SampleBanner />}
      <PageHead kicker={term ? term : "Courses"} title="Courses" snapshot={snapshot} mode={mode}>
        <p className="sub">{ordered.length} shown{past.length ? ` · ${past.length} from past terms hidden` : ""}</p>
      </PageHead>
      <Notices snapshot={snapshot} />
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Layout">
          <button type="button" aria-pressed={layout === "list"} onClick={() => chooseLayout("list")}>List</button>
          <button type="button" aria-pressed={layout === "grid"} onClick={() => chooseLayout("grid")}>Grid</button>
        </div>
        {past.length > 0 && <button className="btn-ghost" type="button" onClick={() => setShowPast((value) => !value)}>{showPast ? "Hide past terms" : "Show past terms"}</button>}
      </div>
      {ordered.length === 0 && <p className="empty-line">No courses in this snapshot.</p>}
      {layout === "grid" ? (
        <div className="grid-cards">
          {ordered.map((course) => <CourseCard key={course.id} course={course} now={now} favorite={favorites.includes(course.id)} onFavorite={toggleFavorite} />)}
        </div>
      ) : (
        <table className="course-table">
          <thead><tr><th>Course</th><th>Next due</th><th>MyLab</th><th>Blackboard</th><th><span className="sr-only">Favorite</span></th></tr></thead>
          <tbody>
            {ordered.map((course) => (
              <tr key={course.id}>
                <td colSpan={5}>
                  <div className="row-link">
                    <Link href={`/courses/${encodeURIComponent(course.id)}`}>
                      <div className="code">{courseLabel(course)}</div>
                      <div>{course.title?.value || "Official title not synced"}</div>
                      {course.code && <Stamp stamp={course.code.stamp} />}
                    </Link>
                    <div>{nextDue(course, now)}</div>
                    <div>{mylabCell(course)}</div>
                    <div>{bbCell(course)}</div>
                    <button type="button" className="star" aria-pressed={favorites.includes(course.id)} aria-label={`Favorite ${courseLabel(course)}`} onClick={() => toggleFavorite(course.id)}>★</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function CourseCard({ course, now, favorite, onFavorite }: { course: Course; now: Date; favorite: boolean; onFavorite: (id: string) => void }) {
  return (
    <article className="card">
      <div className="card-top">
        <Link href={`/courses/${encodeURIComponent(course.id)}`}><span className="code">{courseLabel(course)}</span></Link>
        <button type="button" className="star" aria-pressed={favorite} aria-label={`Favorite ${courseLabel(course)}`} onClick={() => onFavorite(course.id)}>★</button>
      </div>
      <h3 style={{ marginTop: 6 }}>{course.title?.value || "Official title not synced"}</h3>
      <p className="note">{nextDue(course, now)}</p>
      <div className="lanes">
        <div><div className="label">MyLab</div><div>{mylabCell(course)}</div></div>
        <div><div className="label">Blackboard</div><div>{bbCell(course)}</div></div>
      </div>
    </article>
  );
}

function singleTerm(snapshot: Snapshot): string | null {
  const names = [...new Set(snapshot.courses.map((course) => course.termName?.value).filter(Boolean))];
  return names.length === 1 ? names[0] || null : null;
}

function nextDue(course: Course, now: Date): string {
  if (course.dueState !== "ok" && course.dueState !== "empty") return stateLabel(course.dueState);
  const open = course.due
    .map((item) => ({ item, live: liveStatus(item, now) }))
    .filter((entry) => entry.live === "due")
    .sort((a, b) => Date.parse(a.item.due) - Date.parse(b.item.due));
  const past = course.due.filter((item) => { const live = liveStatus(item, now); return live === "overdue" || live === "past"; }).length;
  if (!open.length && !past) return "—";
  const next = open[0];
  const prefix = past ? `${past} past due` : "";
  if (!next) return prefix;
  return `${prefix ? prefix + " · " : ""}${next.item.title} · ${relativeDay(next.item.due, now)} · ${formatDue(next.item.due)}`;
}

function mylabCell(course: Course): string {
  if (course.mylab?.currentGrade) return course.mylab.currentGrade;
  if (!course.mylab) return "Not yet synced";
  return stateLabel(course.mylabState);
}

function bbCell(course: Course): string {
  if (course.blackboardGradebook?.currentGrade) return course.blackboardGradebook.currentGrade;
  if (course.blackboardGradebook?.empty) return "No grades posted";
  if (course.blackboardGradebookState === "not-synced" || course.blackboardGradebookState === "not-fetched") return "Not yet synced";
  return stateLabel(course.blackboardGradebookState);
}
