import type { Course, MyLab, SectionState, Snapshot } from "../schema";
import { courseShell, emptySnapshot, snapshotSchema } from "../schema";
import { courseCodeFromId, isObj } from "../text";
import { normalizeBlackboardCapture, type BlackboardNormalized } from "./blackboard";
import { displayTitle, matchMyLab } from "./match";
import { normalizePearsonCapture } from "./pearson";

export interface ImportSummary {
  courses: number;
  mylabRecords: number;
  matched: number;
  unmatched: number;
  droppedLinks: number;
}

function mylabState(rec: MyLab): SectionState {
  const { overall, categories, items } = rec.parsed;
  if (overall && categories && items) return "ok";
  if (overall || categories || items) return "parse-partial";
  return "parse-failed";
}

function failed(state: SectionState): boolean {
  return state !== "ok" && state !== "empty" && state !== "partial" && state !== "parse-partial";
}

function keepIfFailed(next: Course, prev: Course | undefined): Course {
  if (!prev) return next;
  const out: Course = { ...next, stale: [...next.stale] };
  if (failed(next.instructorsState) && !failed(prev.instructorsState)) {
    out.instructors = prev.instructors;
    out.instructorsUnnamed = prev.instructorsUnnamed;
    out.instructorsState = prev.instructorsState;
    out.stale.push("instructors");
  }
  if (failed(next.contentState) && !failed(prev.contentState)) {
    out.content = prev.content;
    out.contentState = prev.contentState;
    out.contentStamp = prev.contentStamp;
    out.stale.push("content");
  }
  if (failed(next.blackboardGradebookState) && !failed(prev.blackboardGradebookState)) {
    out.blackboardGradebook = prev.blackboardGradebook;
    out.blackboardGradebookState = prev.blackboardGradebookState;
    out.stale.push("gradebook");
  }
  if (failed(next.dueState) && !failed(prev.dueState)) {
    out.due = prev.due;
    out.dueState = prev.dueState;
    out.dueStamp = prev.dueStamp;
    out.stale.push("due");
  }
  if (!out.code && prev.code) out.code = prev.code;
  if (!out.title && prev.title) out.title = prev.title;
  if (!out.availability && prev.availability) out.availability = prev.availability;
  if (!out.outlineHref && prev.outlineHref) out.outlineHref = prev.outlineHref;
  return out;
}

function mergeMyLab(prev: MyLab | undefined, next: MyLab): MyLab {
  if (!prev) return next;
  const out: MyLab = { ...next, parsed: { ...next.parsed }, staleParts: [], notes: [...next.notes] };
  if (!out.parsed.overall && prev.parsed.overall) {
    out.overall = prev.overall;
    out.currentGrade = prev.currentGrade;
    out.overallPoints = prev.overallPoints;
    out.parsed.overall = true;
    out.staleParts.push({ part: "overall", at: prev.stamp.at });
  }
  if (!out.parsed.categories && prev.parsed.categories) {
    out.categories = prev.categories;
    out.categoryTotal = prev.categoryTotal;
    out.parsed.categories = true;
    out.staleParts.push({ part: "categories", at: prev.stamp.at });
  }
  if (!out.parsed.items && prev.parsed.items) {
    out.assignments = prev.assignments;
    out.parsed.items = true;
    out.staleParts.push({ part: "items", at: prev.stamp.at });
  }
  if (!out.viewLabel && prev.viewLabel) out.viewLabel = prev.viewLabel;
  return out;
}

function courseFromMyLab(rec: MyLab): Course {
  const course = courseShell(`mylab:${rec.key}`);
  const code = rec.sectionId ? courseCodeFromId(rec.sectionId) : null;
  if (code) course.code = { value: code, stamp: rec.stamp };
  if (rec.courseTitle) course.title = { value: displayTitle(code, rec.courseTitle), stamp: rec.stamp };
  course.mylab = { ...rec, matchedBy: "MyLab record. No Blackboard course matched." };
  course.mylabState = mylabState(rec);
  course.mylabHref = rec.pageUrl;
  course.current = null;
  return course;
}

function place(snapshot: Snapshot, rec: MyLab, summary: ImportSummary) {
  const blackboardCourses = snapshot.courses.filter((course) => !course.id.startsWith("mylab:"));
  const match = matchMyLab(rec, blackboardCourses);
  if (match) {
    const course = snapshot.courses.find((item) => item.id === match.courseId);
    if (course) {
      course.mylab = { ...rec, matchedBy: match.matchedBy };
      course.mylabState = mylabState(rec);
      course.mylabHref = rec.pageUrl;
      if (!course.code && rec.sectionId) {
        const code = courseCodeFromId(rec.sectionId);
        if (code) course.code = { value: code, stamp: rec.stamp };
      }
      if (!course.title && rec.courseTitle) {
        course.title = { value: displayTitle(course.code?.value ?? null, rec.courseTitle), stamp: rec.stamp };
      }
      summary.matched += 1;
      return;
    }
  }
  snapshot.courses.push(courseFromMyLab(rec));
  summary.unmatched += 1;
}

function applyBlackboard(snapshot: Snapshot, parsed: BlackboardNormalized) {
  if (parsed.mode === "error") {
    snapshot.status.blackboard = {
      state: parsed.error?.state ?? "error",
      lastSuccessAt: snapshot.status.blackboard.lastSuccessAt,
      lastAttemptAt: parsed.capturedAt,
      source: snapshot.status.blackboard.source,
      message: parsed.error?.message ?? "Blackboard read failed. Previous courses kept.",
    };
    return;
  }
  if (parsed.mode === "dom") {
    const ids = new Set(snapshot.courses.map((course) => course.id));
    for (const course of parsed.courses) if (!ids.has(course.id)) snapshot.courses.push(course);
    snapshot.student = snapshot.student ?? parsed.student;
    snapshot.status.blackboard = {
      state: "partial",
      lastSuccessAt: parsed.capturedAt,
      lastAttemptAt: parsed.capturedAt,
      source: "blackboard-dom",
      message: parsed.courses.length
        ? "Course list was read from the Blackboard page. Details were not fetched."
        : "Blackboard page had no course cards. Previous courses kept.",
    };
    return;
  }
  if (!parsed.courses.length) {
    snapshot.status.blackboard = {
      state: "error",
      lastSuccessAt: snapshot.status.blackboard.lastSuccessAt,
      lastAttemptAt: parsed.capturedAt,
      source: snapshot.status.blackboard.source,
      message: "Blackboard returned no courses. Previous courses kept.",
    };
    return;
  }
  const previous = new Map(snapshot.courses.filter((course) => !course.id.startsWith("mylab:")).map((course) => [course.id, course]));
  const mylabCourses = snapshot.courses.filter((course) => course.id.startsWith("mylab:"));
  snapshot.courses = [...parsed.courses.map((course) => keepIfFailed(course, previous.get(course.id))), ...mylabCourses];
  snapshot.student = parsed.student ?? snapshot.student;
  snapshot.status.blackboard = {
    state: parsed.partial ? "partial" : "ok",
    lastSuccessAt: parsed.capturedAt,
    lastAttemptAt: parsed.capturedAt,
    source: parsed.source,
    message: parsed.partial ? "Some Blackboard sections could not be read." : null,
  };
}

function detect(payload: unknown): "snapshot" | "blackboard" | "pearson" | "unknown" {
  if (!isObj(payload)) return "unknown";
  if (payload.kind === "sample" || payload.kind === "import" || payload.kind === "empty") return "snapshot";
  if (payload.schemaVersion === 1 && Array.isArray(payload.courses) && payload.status) return "snapshot";
  if (payload.kind === "blackboard-capture") return "blackboard";
  if (payload.kind === "pearson-capture") return "pearson";
  return "unknown";
}

export function buildSnapshotFromFiles(current: Snapshot | null, payloads: unknown[]): { snapshot: Snapshot; summary: ImportSummary } {
  if (!payloads.length) throw new Error("No file selected.");
  const kinds = payloads.map(detect);
  if (kinds.some((kind) => kind === "unknown")) throw new Error("Unrecognized file. Expected a collector capture or an exported snapshot.");
  if (kinds.includes("snapshot") && kinds.some((kind) => kind !== "snapshot")) {
    throw new Error("Import an exported snapshot on its own, separate from collector captures.");
  }
  if (kinds.includes("snapshot")) {
    if (payloads.length !== 1) throw new Error("Import one exported snapshot at a time.");
    const parsed = snapshotSchema.parse(payloads[0]);
    if (parsed.kind !== "import") throw new Error("This file is sample data, not a sync.");
    return {
      snapshot: parsed,
      summary: {
        courses: parsed.courses.length,
        mylabRecords: parsed.courses.filter((course) => course.mylab).length + parsed.unmatchedMyLab.length,
        matched: parsed.courses.filter((course) => course.mylab && !course.id.startsWith("mylab:")).length,
        unmatched: parsed.courses.filter((course) => course.id.startsWith("mylab:")).length + parsed.unmatchedMyLab.length,
        droppedLinks: 0,
      },
    };
  }

  const snapshot = current && current.kind === "import" ? structuredClone(current) : emptySnapshot();
  snapshot.kind = "import";
  snapshot.label = null;
  const summary: ImportSummary = { courses: 0, mylabRecords: 0, matched: 0, unmatched: 0, droppedLinks: 0 };
  const mylabs = new Map<string, MyLab>();
  for (const course of snapshot.courses) if (course.mylab) mylabs.set(course.mylab.key, course.mylab);
  for (const rec of snapshot.unmatchedMyLab) mylabs.set(rec.key, rec);

  let sawPearson = false;
  let pearsonAt: string | null = snapshot.status.pearson.lastSuccessAt;
  for (const payload of payloads) {
    const kind = detect(payload);
    if (kind === "blackboard") {
      const parsed = normalizeBlackboardCapture(payload);
      summary.droppedLinks += parsed.droppedLinks;
      applyBlackboard(snapshot, parsed);
    } else if (kind === "pearson") {
      const parsed = normalizePearsonCapture(payload);
      summary.droppedLinks += parsed.droppedLinks;
      if (!parsed.record) throw new Error(parsed.reason || "MyLab page had nothing to import.");
      mylabs.set(parsed.record.key, mergeMyLab(mylabs.get(parsed.record.key), parsed.record));
      sawPearson = true;
      pearsonAt = parsed.record.stamp.at;
    }
  }

  for (const course of snapshot.courses) {
    course.mylab = null;
    course.mylabState = "not-synced";
    course.mylabHref = null;
  }
  snapshot.courses = snapshot.courses.filter((course) => !course.id.startsWith("mylab:"));
  snapshot.unmatchedMyLab = [];
  for (const rec of mylabs.values()) place(snapshot, rec, summary);
  if (sawPearson || mylabs.size) {
    const partial = [...mylabs.values()].some((rec) => mylabState(rec) !== "ok");
    snapshot.status.pearson = {
      state: partial ? "parse-partial" : "ok",
      lastSuccessAt: pearsonAt,
      lastAttemptAt: pearsonAt,
      source: "pearson",
      message: partial ? "At least one MyLab page was only partly read." : null,
    };
  }
  snapshot.importedAt = new Date().toISOString();
  const validated = snapshotSchema.parse(snapshot);
  summary.courses = validated.courses.length;
  summary.mylabRecords = mylabs.size;
  return { snapshot: validated, summary };
}
