import { safeUrl } from "../safe-url";
import type { ContentNode, Course, DueItem, GradeItem, Instructor, SectionState, Stamp, Student } from "../schema";
import { courseShell } from "../schema";
import {
  cleanText,
  courseCodeFromId,
  finite,
  isObj,
  isPlaceholderName,
  nonEmpty,
  num,
  personName,
  str,
  stripHtml,
  validIso,
} from "../text";

export interface SectionRaw {
  state?: string;
  data?: unknown;
  error?: string;
  syncedAt?: string;
}

interface DetailRaw {
  faculty?: SectionRaw;
  contents?: SectionRaw;
  columns?: SectionRaw;
  grades?: SectionRaw;
}

export interface BlackboardNormalized {
  mode: "api" | "dom" | "error";
  capturedAt: string;
  source: "blackboard-api" | "blackboard-dom";
  error: { state: SectionState; message: string } | null;
  student: Student | null;
  courses: Course[];
  partial: boolean;
  droppedLinks: number;
}

const BB = "https://learn.uark.edu";

function mapState(value: unknown): SectionState {
  const v = str(value);
  if (
    v === "ok" || v === "empty" || v === "not-synced" || v === "not-fetched" ||
    v === "auth" || v === "forbidden" || v === "not-found" || v === "parse-partial" ||
    v === "parse-failed" || v === "error" || v === "partial"
  ) return v;
  if (v === "session-expired") return "auth";
  return v ? "error" : "not-fetched";
}

function stamp(source: Stamp["source"], at: string, note?: string): Stamp {
  const out: Stamp = { source, at: new Date(at).toISOString() };
  if (note) out.note = note.slice(0, 400);
  return out;
}

function contentType(handlerId: string): ContentNode["type"] {
  if (/x-bb-folder/.test(handlerId)) return "folder";
  if (/x-bb-lesson|x-bb-module|learning-module/.test(handlerId)) return "module";
  if (/externallink|blti-link|lti/.test(handlerId)) return "link";
  if (/document|x-bb-file|x-bb-syllabus|x-bb-asmt|assignment|test|forumlink/.test(handlerId)) return "document";
  return "generic";
}

function takeLinks(candidates: { href: unknown; text: string | null }[], dropped: { n: number }) {
  const links: ContentNode["links"] = [];
  for (const candidate of candidates) {
    const href = safeUrl(candidate.href, BB);
    if (!href) {
      if (typeof candidate.href === "string" && candidate.href.trim()) dropped.n += 1;
      continue;
    }
    if (links.some((link) => link.href === href)) continue;
    links.push({ href, text: candidate.text ? cleanText(candidate.text, 120) : null });
    if (links.length >= 12) break;
  }
  return links;
}

function linksFromUnknown(value: unknown, dropped: { n: number }) {
  const candidates: { href: unknown; text: string | null }[] = [];
  if (!isObj(value)) return takeLinks(candidates, dropped);
  const handler = isObj(value.contentHandler) ? value.contentHandler : null;
  if (handler) candidates.push({ href: handler.url, text: null });
  if (typeof value.externalAccessUrl === "string") candidates.push({ href: value.externalAccessUrl, text: null });
  if (typeof value.homePageUrl === "string") candidates.push({ href: value.homePageUrl, text: null });
  if (Array.isArray(value.links)) {
    for (const link of value.links) {
      if (typeof link === "string") candidates.push({ href: link, text: null });
      else if (isObj(link)) candidates.push({ href: link.href, text: str(link.title) || str(link.rel) || null });
    }
  }
  const html = [value.body, value.description].filter((part) => typeof part === "string").join("\n");
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) candidates.push({ href: match[1], text: stripHtml(match[2], 120) || null });
  return takeLinks(candidates, dropped);
}

function nodeFrom(item: unknown, source: Stamp["source"], at: string, dropped: { n: number }): ContentNode | null {
  if (!isObj(item)) return null;
  const title = cleanText(str(item.title) || str(item.name), 200);
  if (!title) return null;
  const handler = isObj(item.contentHandler) ? str(item.contentHandler.id) : "";
  const type = contentType(handler);
  const description = stripHtml(item.description || item.body || "") || null;
  const links = linksFromUnknown(item, dropped);
  let children: ContentNode[] | null = null;
  let childrenState: SectionState = type === "folder" || type === "module" ? "not-fetched" : "empty";
  if (isObj(item._children)) {
    const state = mapState(item._children.state);
    if (state === "ok" && Array.isArray(item._children.data)) {
      children = item._children.data
        .map((child) => nodeFrom(child, source, at, dropped))
        .filter((child): child is ContentNode => !!child)
        .slice(0, 200);
      childrenState = children.length ? "ok" : "empty";
    } else childrenState = state === "ok" ? "error" : state;
  }
  return {
    id: str(item.id) || null,
    type,
    title,
    description,
    links,
    children,
    childrenState,
    stamp: stamp(source, at),
  };
}

function colName(column: Record<string, unknown>): string {
  return str(column.name) || str(column.columnName);
}

function gradeText(grade: unknown, possible: unknown): string | null {
  if (!isObj(grade)) return null;
  const display = isObj(grade.displayGrade) ? grade.displayGrade : null;
  if (display) {
    if (nonEmpty(display.text)) {
      const text = str(display.text);
      if (/^\d+(\.\d+)?$/.test(text) && finite(possible) && possible > 0) return `${text} / ${num(possible)}`;
      return text;
    }
    if (finite(display.score)) {
      if (/percent/i.test(str(display.scaleType))) return `${num(display.score)}%`;
      if (finite(possible) && possible > 0) return `${num(display.score)} / ${num(possible)}`;
      return String(num(display.score));
    }
  }
  if (nonEmpty(grade.text)) return str(grade.text);
  if (finite(grade.score)) return finite(possible) && possible > 0 ? `${num(grade.score)} / ${num(possible)}` : String(num(grade.score));
  return null;
}

function findOverallColumn(columns: Record<string, unknown>[]) {
  let best: Record<string, unknown> | null = null;
  let bestScore = 0;
  let tie = false;
  for (const column of columns) {
    if (!nonEmpty(column.id)) continue;
    const name = colName(column);
    let score = 0;
    if (column.externalGrade === true) score += 4;
    if (/overall/i.test(name)) score += 3;
    if (isObj(column.grading) && /^calculated$/i.test(str(column.grading.type))) score += 2;
    if (/\btotal\b/i.test(name)) score += 1;
    if (score === 0) continue;
    if (score > bestScore) {
      best = column;
      bestScore = score;
      tie = false;
    } else if (score === bestScore) tie = true;
  }
  if (best && tie && best.externalGrade !== true) return { column: null, ambiguous: true };
  return { column: best, ambiguous: false };
}

function gradeRows(data: unknown): { rows: Record<string, unknown>[] | null; recognized: boolean } {
  if (Array.isArray(data)) return { rows: data.filter(isObj), recognized: true };
  if (!isObj(data)) return { rows: null, recognized: false };
  for (const key of ["results", "columnGrades", "grades"]) {
    if (Array.isArray(data[key])) return { rows: data[key].filter(isObj), recognized: true };
  }
  if (Object.keys(data).length === 0) return { rows: [], recognized: true };
  return { rows: null, recognized: false };
}

function submittedOf(grade: Record<string, unknown> | undefined, gradesFetched: boolean): boolean | null {
  if (!gradesFetched) return null;
  if (!grade) return false;
  const display = isObj(grade.displayGrade) ? grade.displayGrade : null;
  if (finite(grade.score)) return true;
  if (/graded|needsgrading/i.test(str(grade.status))) return true;
  if (display && (finite(display.score) || nonEmpty(display.text))) return true;
  return false;
}

function facultyFrom(results: unknown, at: string, source: Stamp["source"]): { named: Instructor[]; unnamed: number } {
  const named: Instructor[] = [];
  let unnamed = 0;
  const seen = new Set<string>();
  if (!Array.isArray(results)) return { named, unnamed };
  for (const row of results) {
    if (!isObj(row)) continue;
    const role = str(row.courseRoleId) || str(isObj(row.courseRole) && row.courseRole.identifier);
    if (role && !/instructor|teaching|^ta$|^p$/i.test(role)) continue;
    const user = isObj(row.user) ? row.user : null;
    const uid = str(row.userId) || str(user && user.id);
    if (uid && seen.has(uid)) continue;
    if (uid) seen.add(uid);
    const name = personName(user);
    if (!name || isPlaceholderName(name)) {
      unnamed += 1;
      continue;
    }
    named.push({
      name,
      role: /assistant|^ta$/i.test(role) ? "TEACHING ASSISTANT" : "INSTRUCTOR",
      stamp: stamp(source, at),
    });
  }
  return { named: named.slice(0, 30), unnamed };
}

function normalizeTerm(value: unknown) {
  if (!isObj(value) || !nonEmpty(value.id)) return null;
  const availability = isObj(value.availability) ? value.availability : {};
  const duration = isObj(availability.duration) ? availability.duration : {};
  return {
    id: str(value.id),
    name: str(value.name) || null,
    start: validIso(duration.start),
    end: validIso(duration.end),
    available: /^yes$/i.test(str(availability.available)) ? true : /^no$/i.test(str(availability.available)) ? false : null,
  };
}

function termIsCurrent(term: { start: string | null; end: string | null } | null, now: number): boolean | null {
  if (!term) return null;
  const start = term.start ? Date.parse(term.start) : NaN;
  const end = term.end ? Date.parse(term.end) : NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (!Number.isNaN(end) && end + 21 * 864e5 < now) return false;
  return true;
}

function availabilityOf(
  course: Record<string, unknown> | null,
  term: { available: boolean | null } | null,
): "open" | "closed" | null {
  if (!course) return null;
  const available = isObj(course.availability) ? str(course.availability.available) : "";
  if (/^yes$/i.test(available) || course.isAvailable === true) return "open";
  if (/^(no|disabled)$/i.test(available) || course.isAvailable === false) return "closed";
  if (/^term$/i.test(available)) {
    if (term?.available === true) return "open";
    if (term?.available === false) return "closed";
  }
  return null;
}

function courseFromMembership(
  membership: unknown,
  terms: Record<string, ReturnType<typeof normalizeTerm>>,
  at: string,
  dropped: { n: number },
  now: number,
): Course | null {
  if (!isObj(membership)) return null;
  const course = isObj(membership.course) ? membership.course : null;
  const id = str(course && course.id) || str(membership.courseId);
  if (!id) return null;
  if (course && (course.organization === true || course.isOrganization === true)) return null;
  const bbId = str(course && course.courseId) || "";
  const title = str(course && (course.name || course.displayName));
  const termId = str(course && course.termId);
  const term = termId ? terms[termId] : null;
  const availability = availabilityOf(course, term);
  const sourceStamp = stamp("blackboard-api", at);
  const shell = courseShell(id);
  shell.bbCourseId = id;
  shell.bbId = bbId || null;
  shell.role = str(membership.courseRoleId) || null;
  shell.code = courseCodeFromId(bbId) || bbId ? { value: courseCodeFromId(bbId) || bbId, stamp: sourceStamp } : null;
  shell.title = title ? { value: cleanText(title, 200), stamp: sourceStamp } : null;
  shell.termName = term?.name ? { value: term.name, stamp: sourceStamp } : null;
  shell.availability = availability ? { value: availability, stamp: sourceStamp } : null;
  shell.current = termIsCurrent(term, now);
  shell.outlineHref = course ? linksFromUnknown(course, dropped)[0]?.href ?? null : null;
  return shell;
}

function buildGradebook(
  columnsRaw: unknown,
  gradesRaw: unknown,
  gradesFetched: boolean,
  at: string,
  note?: string,
) {
  const columns = Array.isArray(columnsRaw) ? columnsRaw.filter(isObj) : [];
  const extracted = gradesFetched ? gradeRows(gradesRaw) : { rows: null as Record<string, unknown>[] | null, recognized: false };
  const grades = extracted.recognized && extracted.rows ? extracted.rows : [];
  const recognized = gradesFetched && extracted.recognized;
  const byColumn = new Map<string, Record<string, unknown>>();
  for (const grade of grades) if (nonEmpty(grade.columnId)) byColumn.set(str(grade.columnId), grade);
  const { column: overall, ambiguous } = findOverallColumn(columns);
  const itemStamp = stamp("blackboard-api", at, note);
  let currentGrade: string | null = null;
  let overallColumn: string | null = null;
  if (overall) {
    const possible = isObj(overall.score) ? overall.score.possible : undefined;
    currentGrade = gradeText(byColumn.get(str(overall.id)), possible);
    overallColumn = colName(overall) || null;
  }
  const items: GradeItem[] = [];
  for (const column of columns) {
    if (column === overall || !colName(column)) continue;
    const possible = isObj(column.score) ? column.score.possible : undefined;
    const grade = byColumn.get(str(column.id));
    const text = recognized ? gradeText(grade, possible) : null;
    items.push({
      title: colName(column),
      grade: text,
      possible: !text && finite(possible) ? num(possible) : null,
      status: grade && nonEmpty(grade.status) ? str(grade.status) : null,
      due: isObj(column.grading) ? validIso(column.grading.due) : null,
      columnId: str(column.id) || null,
      stamp: itemStamp,
    });
  }
  return {
    gradebook: {
      currentGrade,
      overallColumn,
      noOverallColumn: !overall && columns.length > 0,
      overallAmbiguous: !overall && ambiguous,
      empty: columns.length === 0 && recognized && grades.length === 0,
      items,
      stamp: itemStamp,
    },
    recognized,
    columns,
    byColumn,
    overallId: overall ? str(overall.id) : "",
  };
}

function buildDue(
  courseId: string,
  columns: Record<string, unknown>[],
  byColumn: Map<string, Record<string, unknown>>,
  gradesFetched: boolean,
  overallId: string,
  calendarItems: Record<string, unknown>[],
  at: string,
  note?: string,
): DueItem[] {
  const out: DueItem[] = [];
  const seen = new Set<string>();
  const seenCol = new Set<string>();
  const dueStamp = stamp("blackboard-api", at, note);
  for (const column of columns) {
    if (!colName(column) || column.externalGrade === true || (overallId && str(column.id) === overallId)) continue;
    const due = isObj(column.grading) ? validIso(column.grading.due) : null;
    if (!due) continue;
    const colId = str(column.id) || colName(column);
    const grade = str(column.id) ? byColumn.get(str(column.id)) : undefined;
    out.push({
      id: `${courseId}:gradebook:${colId}:${due}`.slice(0, 200),
      title: cleanText(colName(column), 200),
      due,
      submitted: submittedOf(grade, gradesFetched),
      origin: "gradebook",
      eventType: null,
      href: null,
      stamp: dueStamp,
    });
    seen.add(colName(column).toLowerCase() + "|" + due);
    if (str(column.id)) seenCol.add(str(column.id));
  }
  for (const item of calendarItems) {
    if (!nonEmpty(item.title)) continue;
    const due = validIso(item.start);
    if (!due) continue;
    const id = str(item.id);
    const linked = /gradebookcolumn/i.test(str(item.type)) && id && seenCol.has(id);
    if (linked) continue;
    const key = str(item.title).toLowerCase() + "|" + due;
    if (seen.has(key)) continue;
    seen.add(key);
    const href = safeUrl(item.url, BB) || safeUrl(item.href, BB) || safeUrl(item.launchUrl, BB);
    const props = isObj(item.dynamicCalendarItemProps) ? item.dynamicCalendarItemProps : null;
    out.push({
      id: `${courseId}:calendar:${id || key}`.slice(0, 200),
      title: cleanText(item.title, 200),
      due,
      submitted: null,
      origin: "calendar",
      eventType: props && nonEmpty(props.eventType) ? cleanText(props.eventType, 60) : null,
      href,
      stamp: dueStamp,
    });
  }
  return out.sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
}

function calendarByCourse(items: unknown[]): Record<string, Record<string, unknown>[]> {
  const map: Record<string, Record<string, unknown>[]> = {};
  for (const item of items) {
    if (!isObj(item)) continue;
    const id = str(item.calendarId) || str(item.courseId);
    if (!id) continue;
    (map[id] ??= []).push(item);
  }
  return map;
}

function asSection(value: unknown): SectionRaw {
  return isObj(value) ? (value as SectionRaw) : {};
}

export function normalizeBlackboardCapture(input: unknown, now = Date.now()): BlackboardNormalized {
  if (!isObj(input) || input.kind !== "blackboard-capture") throw new Error("Not a Blackboard capture.");
  if (input.origin !== BB) throw new Error("Blackboard captures are only accepted from https://learn.uark.edu.");
  const capturedAt = validIso(input.capturedAt);
  if (!capturedAt) throw new Error("Blackboard capture is missing a timestamp.");
  const mode = input.mode === "dom" || input.mode === "error" ? input.mode : input.mode === "api" ? "api" : null;
  if (!mode) throw new Error("Blackboard capture has no mode (api, dom, or error).");
  const dropped = { n: 0 };

  if (mode === "error") {
    const error = isObj(input.error) ? input.error : {};
    return {
      mode,
      capturedAt,
      source: "blackboard-api",
      error: { state: mapState(error.state || "error"), message: cleanText(error.message || "Blackboard read failed.", 300) },
      student: null,
      courses: [],
      partial: true,
      droppedLinks: 0,
    };
  }

  if (mode === "dom") {
    const cards = Array.isArray(input.domCards) ? input.domCards : [];
    const courses: Course[] = [];
    for (const card of cards) {
      if (!isObj(card)) continue;
      const id = str(card.id);
      const title = cleanText(card.title, 200);
      if (!id || !title) continue;
      const sourceStamp = stamp("blackboard-dom", capturedAt);
      const course = courseShell(id);
      course.bbCourseId = id;
      course.bbId = str(card.bbId) || null;
      const code = courseCodeFromId(course.bbId) || course.bbId;
      course.code = code ? { value: code, stamp: sourceStamp } : null;
      course.title = { value: title, stamp: sourceStamp };
      course.availability = card.closed === true ? { value: "closed", stamp: sourceStamp } : card.closed === false ? { value: "open", stamp: sourceStamp } : null;
      const instructor = cleanText(card.instructor, 120);
      if (instructor && !isPlaceholderName(instructor)) {
        course.instructors = [{ name: instructor, role: "INSTRUCTOR", stamp: sourceStamp }];
        course.instructorsState = "ok";
      }
      courses.push(course);
    }
    const studentName = personName(isObj(input.me) ? input.me : null) || (!isPlaceholderName(input.domStudentName) ? cleanText(input.domStudentName, 80) : "");
    return {
      mode,
      capturedAt,
      source: "blackboard-dom",
      error: null,
      student: studentName ? { name: studentName, stamp: stamp("blackboard-dom", capturedAt) } : null,
      courses,
      partial: true,
      droppedLinks: dropped.n,
    };
  }

  const terms: Record<string, ReturnType<typeof normalizeTerm>> = {};
  if (isObj(input.terms)) {
    for (const [id, term] of Object.entries(input.terms)) {
      const normalized = normalizeTerm(term);
      if (normalized) terms[id] = normalized;
    }
  }
  const memberships = Array.isArray(input.memberships) ? input.memberships : [];
  const calendarSection = asSection(input.calendar);
  const calendarOk = mapState(calendarSection.state) === "ok" && Array.isArray(calendarSection.data);
  const calendarMap = calendarOk ? calendarByCourse(calendarSection.data as unknown[]) : {};
  const details = isObj(input.details) ? input.details : {};
  const courses: Course[] = [];
  let partial = mapState(calendarSection.state) !== "ok";

  for (const membership of memberships) {
    const course = courseFromMembership(membership, terms, capturedAt, dropped, now);
    if (!course) continue;
    const detail = isObj(details[course.id]) ? (details[course.id] as DetailRaw) : null;
    const calendarItems = calendarMap[course.id] ?? [];
    if (!detail) {
      if (calendarOk) {
        course.due = buildDue(course.id, [], new Map(), false, "", calendarItems, capturedAt, "Calendar only. This course's gradebook was not fetched.");
        course.dueState = "ok";
        course.dueStamp = stamp("blackboard-api", capturedAt, "Calendar only.");
      }
      partial = true;
      courses.push(course);
      continue;
    }

    const faculty = asSection(detail.faculty);
    const contents = asSection(detail.contents);
    const columns = asSection(detail.columns);
    const grades = asSection(detail.grades);
    const facultyState = mapState(faculty.state);
    const contentState = mapState(contents.state);
    const columnState = mapState(columns.state);
    const gradeState = mapState(grades.state);
    course.instructorsState = facultyState === "ok" ? "ok" : facultyState;
    if (facultyState === "ok") {
      const info = facultyFrom(faculty.data, faculty.syncedAt || capturedAt, "blackboard-api");
      course.instructors = info.named;
      course.instructorsUnnamed = info.unnamed;
      if (!info.named.length && !info.unnamed) course.instructorsState = "empty";
    }
    course.contentState = contentState;
    course.contentStamp = contentState === "ok" ? stamp("blackboard-api", contents.syncedAt || capturedAt) : null;
    if (contentState === "ok" && Array.isArray(contents.data)) {
      course.content = contents.data
        .map((item) => nodeFrom(item, "blackboard-api", contents.syncedAt || capturedAt, dropped))
        .filter((item): item is ContentNode => !!item)
        .slice(0, 400);
      if (!course.content.length) course.contentState = "empty";
    }
    const gradesFetched = gradeState === "ok";
    if (columnState === "ok") {
      const built = buildGradebook(columns.data, grades.data, gradesFetched, columns.syncedAt || capturedAt, gradesFetched ? undefined : "Columns were read. Grade values were not.");
      if (gradesFetched && !built.recognized) {
        built.gradebook.stamp = stamp("blackboard-api", capturedAt, "Grade response shape was not recognized.");
        course.blackboardGradebookState = "partial";
      } else if (!gradesFetched) course.blackboardGradebookState = "partial";
      else course.blackboardGradebookState = "ok";
      course.blackboardGradebook = built.gradebook;
      const dueNote = calendarOk ? undefined : "Gradebook due dates only. Calendar was not read.";
      course.due = buildDue(course.id, built.columns, built.byColumn, gradesFetched && built.recognized, built.overallId, calendarItems, capturedAt, dueNote);
      course.dueState = "ok";
      course.dueStamp = stamp("blackboard-api", capturedAt, dueNote);
    } else if (calendarOk) {
      course.blackboardGradebookState = columnState;
      course.due = buildDue(course.id, [], new Map(), false, "", calendarItems, capturedAt, "Calendar only. Gradebook was not read, so submission status is unknown.");
      course.dueState = "ok";
      course.dueStamp = stamp("blackboard-api", capturedAt, "Calendar only.");
    } else {
      course.blackboardGradebookState = columnState;
      course.dueState = columnState;
    }
    if ([facultyState, contentState, columnState, gradeState].some((state) => state !== "ok" && state !== "empty")) partial = true;
    courses.push(course);
  }

  const meName = personName(input.me);
  const student: Student | null = meName
    ? { name: meName, id: isObj(input.me) && str(input.me.id) ? str(input.me.id) : undefined, stamp: stamp("blackboard-api", capturedAt) }
    : null;
  return {
    mode,
    capturedAt,
    source: "blackboard-api",
    error: null,
    student,
    courses,
    partial: partial || courses.length === 0,
    droppedLinks: dropped.n,
  };
}
