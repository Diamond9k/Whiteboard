import { dayDelta } from "./format";
import type { Course, DueItem, MyLabAssignment, Snapshot } from "./schema";

export type DueCoverage = "none" | "partial" | "full";

export interface LiveDue extends DueItem {
  courseId: string;
  live: "submitted" | "due" | "overdue" | "past";
}

export function courseLabel(course: Course): string {
  return course.code?.value || course.title?.value || course.id;
}

export function gradeBand(grade: string | null | undefined): "90+" | "80s" | "70s" | "60s" | "<60" | null {
  if (!grade) return null;
  const match = grade.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  if (n >= 90) return "90+";
  if (n >= 80) return "80s";
  if (n >= 70) return "70s";
  if (n >= 60) return "60s";
  return "<60";
}

export function liveStatus(item: DueItem, now: Date): LiveDue["live"] {
  if (item.submitted === true) return "submitted";
  const t = Date.parse(item.due);
  if (Number.isNaN(t)) return "past";
  if (t >= now.getTime()) return "due";
  return item.submitted === false ? "overdue" : "past";
}

export function dueCoverage(courses: Course[]): DueCoverage {
  if (!courses.length) return "none";
  const synced = courses.filter((c) => c.dueState === "ok" || c.dueState === "empty").length;
  if (synced === 0) return "none";
  if (synced === courses.length) return "full";
  return "partial";
}

export function allDue(snapshot: Snapshot, now: Date): LiveDue[] {
  const out: LiveDue[] = [];
  for (const course of snapshot.courses) {
    for (const item of course.due) {
      out.push({ ...item, courseId: course.id, live: liveStatus(item, now) });
    }
  }
  return out.sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
}

export function bucketDue(items: LiveDue[], now: Date) {
  const past: LiveDue[] = [];
  const today: LiveDue[] = [];
  const upcoming: LiveDue[] = [];
  const later: LiveDue[] = [];
  for (const item of items) {
    if (item.live === "submitted") continue;
    const delta = dayDelta(item.due, now);
    if (delta === null) continue;
    if (item.live === "overdue" || item.live === "past" || delta < 0) past.push(item);
    else if (delta === 0) today.push(item);
    else if (delta <= 7) upcoming.push(item);
    else later.push(item);
  }
  return { past, today, upcoming, later };
}

export function recentDue(items: LiveDue[], now: Date) {
  const recent: LiveDue[] = [];
  const older: LiveDue[] = [];
  for (const item of items) {
    const delta = dayDelta(item.due, now);
    if (delta === null || delta > 0) continue;
    if (delta >= -14) recent.push(item);
    else older.push(item);
  }
  recent.sort((a, b) => Date.parse(b.due) - Date.parse(a.due));
  older.sort((a, b) => Date.parse(b.due) - Date.parse(a.due));
  return { recent, older };
}

export function staleRead(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return now - t > 24 * 60 * 60 * 1000;
}

export function unfinishedMyLab(course: Course): MyLabAssignment[] {
  if (!course.mylab) return [];
  return course.mylab.assignments.filter((item) => item.status === "incomplete");
}

export function mylabSynced(snapshot: Snapshot): boolean {
  return snapshot.courses.some((c) => c.mylab && (c.mylabState === "ok" || c.mylabState === "parse-partial" || c.mylabState === "partial"));
}

export function termLabel(snapshot: Snapshot): { value: string; sourceNote: string } | null {
  const stamped = snapshot.courses.map((c) => c.termName).filter((t): t is NonNullable<typeof t> => !!t);
  const values = [...new Set(stamped.map((t) => t.value))];
  if (values.length !== 1) return null;
  const sources = [...new Set(stamped.map((t) => t.stamp.source))];
  return { value: values[0], sourceNote: sources.join(", ") };
}
