import { safeUrl } from "../safe-url";
import type { MyLab, MyLabAssignment, MyLabCategory, Stamp } from "../schema";
import { cleanText, str } from "../text";

interface CapCell {
  tag?: string;
  colspan?: number;
  text?: string;
  raw?: string;
  hasSup?: boolean;
  links?: { href?: string; text?: string | null }[];
}

interface CapRow {
  title?: string;
  category?: string | null;
  className?: string;
  cells?: CapCell[];
}

const RE_PCT = /^(\d{1,3}(?:\.\d+)?)\s*%$/;
const RE_PTS = /^(\d+(?:\.\d+)?)\s*(?:pts?|points?)$/i;
const RE_CORRECT_TOTAL = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(\*)?$/;
const RE_FIRST_FRACTION = /(?<![\d./])(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?![\d.]|\s*\/\s*\d)/;
const RE_FOOTNOTE_MARK = /[*\u2020\u2021\u00A7\u00B9\u00B2\u00B3\u2070-\u2079]/;
const RE_INCOMPLETE = /\bincomplete\b/i;
const RE_SCORE_PCT = /(\d{1,3}(?:\.\d+)?)\s*%/;
const RE_TIME_SPENT = /^<?\s*(?:\d+\s*(?:h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\.?\s*)+$/i;
const RE_DATE_TIME = /^\d{1,2}\/\d{1,2}\/\d{2}(?:\d{2})?(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)?$/i;
const SECTION_SRC = "\\d{4}_(?:FALL|SPRING|SUMMER|WINTER)_[A-Z]{2,5}_\\d{3,5}_SEC\\w+";
const SECTION_EXACT = new RegExp("^" + SECTION_SRC + "$", "i");
const FOOTER_FULL = new RegExp("This course\\s*\\(\\s*(.{1,200}?)\\s*\\(\\s*(" + SECTION_SRC + ")\\s*\\)\\s*\\)", "gi");
const FOOTER_TITLE = /This course\s*\(\s*(.{1,200}?)\s*\(/gi;
const FOOTER_ID = new RegExp("\\b(" + SECTION_SRC + ")\\b", "gi");

const HEADER_RULES: [string, (label: string) => boolean][] = [
  ["correctTotal", (label) => label.includes("correct/total") || label.includes("correct")],
  ["dateStarted", (label) => label.includes("date started") || label.includes("started")],
  ["dateWorked", (label) => label.includes("date worked") || label.includes("worked")],
  ["timeSpent", (label) => label.includes("time spent") || /\btime\b/.test(label)],
  ["score", (label) => label.includes("score")],
  ["review", (label) => label.includes("review")],
  ["assignment", (label) => label.includes("assignment")],
];

function spanOf(cell: { colspan?: number } | undefined): number {
  const n = Number(cell?.colspan);
  return n > 0 && n < 50 ? n : 1;
}

export function cleanSectionId(value: unknown): string | null {
  const text = str(value);
  return text && text.length <= 60 && SECTION_EXACT.test(text) ? text.toUpperCase() : null;
}

export function parsePearsonCourseFooter(text: string): {
  courseTitle: string | null;
  sectionId: string | null;
  ambiguous: { title: boolean; sectionId: boolean };
} {
  const out = { courseTitle: null as string | null, sectionId: null as string | null, ambiguous: { title: false, sectionId: false } };
  const body = text.replace(/\s+/g, " ");
  if (!body.trim()) return out;
  const titles = new Set<string>();
  const footerIds = new Set<string>();
  for (const match of body.matchAll(FOOTER_FULL)) {
    const title = cleanText(match[1], 160);
    if (title) titles.add(title);
    footerIds.add(match[2].toUpperCase());
  }
  if (!titles.size) {
    for (const match of body.matchAll(FOOTER_TITLE)) {
      const title = cleanText(match[1], 160);
      if (title) titles.add(title);
    }
  }
  let ids = footerIds;
  if (!ids.size) {
    ids = new Set<string>();
    for (const match of body.matchAll(FOOTER_ID)) ids.add(match[1].toUpperCase());
  }
  if (titles.size === 1) out.courseTitle = [...titles][0];
  else if (titles.size > 1) out.ambiguous.title = true;
  if (ids.size === 1) out.sectionId = cleanSectionId([...ids][0]);
  else if (ids.size > 1) out.ambiguous.sectionId = true;
  return out;
}

function parseOverallDetails(text: string) {
  const body = cleanText(text, 2000);
  const out: { earned?: string; total?: string; percent?: string } = {};
  const points = body.match(/earned\s+(\d+(?:\.\d+)?)\s+out\s+of\s+(\d+(?:\.\d+)?)\s+points?/i);
  if (points) {
    out.earned = points[1];
    out.total = points[2];
  }
  const percent = body.match(/overall\s+score\s+of\s+(\d{1,3}(?:\.\d+)?)\s*%/i);
  if (percent) out.percent = percent[1];
  return out.earned || out.percent ? out : null;
}

function headerMap(headers: { text?: string; colspan?: number }[]): Record<string, number> | null {
  const map: Record<string, number> = {};
  const dup = new Set<string>();
  let pos = 0;
  for (const header of headers) {
    const label = cleanText(header.text, 80).toLowerCase();
    const rule = label ? HEADER_RULES.find(([, test]) => test(label)) : null;
    if (rule) {
      if (map[rule[0]] !== undefined) dup.add(rule[0]);
      else map[rule[0]] = pos;
    }
    pos += spanOf(header);
  }
  for (const key of dup) delete map[key];
  const count = ["correctTotal", "score", "timeSpent", "dateStarted", "dateWorked"].filter((key) => map[key] !== undefined).length;
  return count >= 2 ? map : null;
}

function cellsByPosition(cells: CapCell[]): Record<number, CapCell> {
  const out: Record<number, CapCell> = {};
  let pos = 0;
  for (const cell of cells) {
    out[pos] = cell;
    pos += spanOf(cell);
  }
  return out;
}

function fixDateTime(value: string): string {
  return cleanText(value, 80).replace(/^(\d{2}\/\d{2}\/\d{2})(\d{1,2}:\d{2})/, "$1 $2");
}

function categoryFromCells(name: string, cells: string[]): MyLabCategory | null {
  const cleaned = cells.map((cell) => cleanText(cell, 40));
  const row: MyLabCategory = { name: cleanText(name, 80), average: null, weight: null, earned: null, timeSpent: null };
  if (!row.name) return null;
  if (RE_PCT.test(cleaned[0] || "")) row.average = cleaned[0];
  if (RE_PTS.test(cleaned[1] || "")) row.weight = cleaned[1];
  if (RE_PTS.test(cleaned[2] || "")) row.earned = cleaned[2];
  if (cleaned[3]) row.timeSpent = cleaned[3];
  return row.average || row.weight || row.earned ? row : null;
}

function collectLinks(cells: CapCell[], pageUrl: string, dropped: { n: number }) {
  const links: MyLabAssignment["links"] = [];
  for (const cell of cells) {
    for (const link of cell.links ?? []) {
      const href = safeUrl(link.href, pageUrl);
      if (!href) {
        if (typeof link.href === "string" && link.href.trim()) dropped.n += 1;
        continue;
      }
      if (links.some((item) => item.href === href)) continue;
      links.push({ href, text: link.text ? cleanText(link.text, 80) : null });
      if (links.length >= 8) return links;
    }
  }
  return links;
}

function assignmentFromRow(row: CapRow, headers: { text?: string; colspan?: number }[], pageUrl: string, dropped: { n: number }, positional: boolean): MyLabAssignment | null {
  const cells = Array.isArray(row.cells) ? row.cells : [];
  const map = positional ? null : headerMap(headers);
  const byPos = cellsByPosition(cells);
  const cellAt = (key: string, fallbackIndex: number | null): CapCell | null => {
    if (map && map[key] !== undefined) return byPos[map[key]] ?? null;
    if (!map && fallbackIndex !== null) {
      const tds = cells.filter((cell) => (cell.tag || "td").toLowerCase() !== "th");
      const offset = tds.length >= 6 ? 1 : 0;
      return tds[fallbackIndex + offset] ?? null;
    }
    return null;
  };
  const title = cleanText(row.title, 160);
  if (!title) return null;
  const category = cleanText(row.category, 80).replace(/[:\-–\s]+$/, "");
  const item: MyLabAssignment = {
    title,
    category: category || null,
    correctTotal: null,
    correctTotalRaw: null,
    scorePercent: null,
    scoreRaw: null,
    status: null,
    timeSpent: null,
    dateStarted: null,
    dateWorked: null,
    asterisk: false,
    footnote: false,
    links: collectLinks(cells, pageUrl, dropped),
    incompleteIn: null,
  };
  const correctCell = cellAt("correctTotal", 0);
  const correctText = cleanText(correctCell?.text, 300);
  const fraction = correctText.match(RE_FIRST_FRACTION);
  if (fraction && correctCell) {
    item.correctTotal = `${fraction[1]}/${fraction[2]}`;
    const raw = cleanText(correctCell.raw || correctCell.text, 80).replace(/\s+/g, "");
    const rawFraction = raw.length <= 60 ? raw.match(RE_FIRST_FRACTION) : null;
    if (rawFraction && `${rawFraction[1]}/${rawFraction[2]}` === item.correctTotal) item.correctTotalRaw = raw;
    const after = correctText.slice((fraction.index ?? 0) + fraction[0].length);
    if (correctCell.hasSup || RE_FOOTNOTE_MARK.test(after) || RE_FOOTNOTE_MARK.test(raw)) {
      item.asterisk = true;
      const mark = after.match(RE_FOOTNOTE_MARK);
      if (correctCell.hasSup || (mark && mark[0] !== "*")) item.footnote = true;
    }
  }
  let incompleteIn: string | null = null;
  for (const [pos, cell] of Object.entries(byPos)) {
    if (map && map.assignment === Number(pos)) continue;
    if (!map && (cell.tag || "").toLowerCase() === "th") continue;
    if (!RE_INCOMPLETE.test(cleanText(cell.text, 200))) continue;
    const key = map ? Object.keys(map).find((name) => map[name] === Number(pos)) : null;
    incompleteIn = key || `col${pos}`;
    break;
  }
  const scoreCell = cellAt("score", 1);
  const scoreText = cleanText(scoreCell?.text, 80);
  const omitted = !incompleteIn && (/\(\s*omitted\s*\)/i.test(scoreText) || /(^|\s)omit(\s|$)/.test(row.className || ""));
  if (!incompleteIn) {
    const percent = scoreText.match(RE_SCORE_PCT);
    if (percent) {
      const n = Number(percent[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 1000) item.scorePercent = n;
    }
  }
  if (scoreText) item.scoreRaw = scoreText;
  if (incompleteIn) {
    item.status = "incomplete";
    item.incompleteIn = incompleteIn;
    item.scorePercent = null;
  } else if (omitted) item.status = "omitted";
  else if (item.scorePercent !== null || item.correctTotal) item.status = "graded";
  const time = cleanText(cellAt("timeSpent", 2)?.text, 40);
  if (RE_TIME_SPENT.test(time)) item.timeSpent = time;
  for (const key of ["dateStarted", "dateWorked"] as const) {
    const value = fixDateTime(str(cellAt(key, key === "dateStarted" ? 3 : 4)?.text));
    if (RE_DATE_TIME.test(value)) item[key] = value;
  }
  if (item.correctTotal && !RE_CORRECT_TOTAL.test(item.correctTotal) && !RE_FIRST_FRACTION.test(item.correctTotal)) item.correctTotal = null;
  return item;
}

export function normalizePearsonCapture(input: unknown): { record: MyLab | null; droppedLinks: number; reason: string | null } {
  if (!isObjCapture(input)) throw new Error("Not a MyLab capture.");
  const capturedAt = new Date(input.capturedAt).toISOString();
  let page: URL;
  try {
    page = new URL(input.pageUrl);
  } catch {
    throw new Error("MyLab capture has no page URL.");
  }
  const host = page.hostname.toLowerCase();
  if (page.protocol !== "https:" || (host !== "pearson.com" && !host.endsWith(".pearson.com"))) {
    throw new Error("MyLab captures are only accepted from https://*.pearson.com.");
  }
  const pageUrl = safeUrl(page.origin + page.pathname);
  if (!pageUrl) throw new Error("MyLab page URL was rejected.");
  const dropped = { n: 0 };
  const footer = parsePearsonCourseFooter(typeof input.footerText === "string" ? input.footerText : "");
  if (footer.ambiguous.sectionId || footer.ambiguous.title) {
    return { record: null, droppedLinks: 0, reason: "Course identity on the MyLab page was ambiguous, so nothing was imported." };
  }
  const notes: string[] = [];
  const stamp: Stamp = { source: "pearson", at: capturedAt };
  const overall: NonNullable<MyLab["overall"]> = { percent: null, earned: null, total: null, detailsPercent: null, detailsText: null };
  const value = cleanText(input.overallValueText, 40);
  const valueMatch = value.match(/^(\d{1,3}(?:\.\d+)?)\s*%?$/);
  if (valueMatch) overall.percent = valueMatch[1];
  const details = parseOverallDetails(typeof input.overallDetailsText === "string" ? input.overallDetailsText : "");
  if (details) {
    if (details.earned && details.total) {
      overall.earned = details.earned;
      overall.total = details.total;
    }
    if (!overall.percent && details.percent) overall.percent = details.percent;
    if (details.percent && overall.percent && details.percent !== overall.percent) overall.detailsPercent = details.percent;
    const sentence = cleanText(input.overallDetailsText, 300);
    if (sentence) overall.detailsText = sentence;
  }
  const hasOverall = !!(overall.percent || overall.earned);

  const headerTexts = Array.isArray(input.categoryHeaders) ? input.categoryHeaders.map((header) => cleanText(header, 40)) : [];
  const headersKnown = headerTexts.length >= 3 && headerTexts.some((header) => /average|score/i.test(header)) && headerTexts.some((header) => /weight/i.test(header)) && headerTexts.some((header) => /point|earned/i.test(header));
  let categories: MyLabCategory[] = [];
  let categoryTotal: MyLabCategory | null = null;
  if (Array.isArray(input.categoryHeaders) && input.categoryHeaders.length > 0 && !headersKnown) {
    notes.push("Category headers didn't match, so category scores were left out.");
  } else if (Array.isArray(input.categoryRows)) {
    if (!headerTexts.length) notes.push("Category columns were read in the known Results table order because no header row was found.");
    categories = input.categoryRows
      .map((row) => (row && typeof row === "object" ? categoryFromCells(str((row as { name?: string }).name), Array.isArray((row as { cells?: string[] }).cells) ? (row as { cells: string[] }).cells : []) : null))
      .filter((row): row is MyLabCategory => !!row)
      .slice(0, 40);
    if (input.categoryTotal && typeof input.categoryTotal === "object") {
      const total = input.categoryTotal as { name?: string; cells?: string[] };
      categoryTotal = categoryFromCells(str(total.name) || "Total", Array.isArray(total.cells) ? total.cells : []);
    }
  }

  const headers = Array.isArray(input.assignmentHeaders) ? input.assignmentHeaders.filter((header) => header && typeof header === "object") as { text?: string; colspan?: number }[] : [];
  const positional = !headerMap(headers);
  if (positional && Array.isArray(input.assignmentRows) && input.assignmentRows.length) {
    notes.push("Assignment columns were read by position because the header row was not recognized.");
  }
  const assignments: MyLabAssignment[] = [];
  if (Array.isArray(input.assignmentRows)) {
    for (const row of input.assignmentRows) {
      if (!row || typeof row !== "object") continue;
      const item = assignmentFromRow(row as CapRow, headers, pageUrl, dropped, positional);
      if (item) assignments.push(item);
      if (assignments.length >= 500) break;
    }
  }

  const parsed = { overall: hasOverall, categories: categories.length > 0, items: assignments.length > 0 };
  if (!parsed.overall && !parsed.categories && !parsed.items) {
    return { record: null, droppedLinks: dropped.n, reason: "MyLab page had no overall score, categories, or assignments to read." };
  }
  const sectionId = footer.sectionId;
  const key = sectionId ? `section:${sectionId}` : footer.courseTitle ? `title:${footer.courseTitle.toLowerCase()}` : null;
  if (!key) return { record: null, droppedLinks: dropped.n, reason: "MyLab page had grade data but no course identity, so nothing was imported." };

  let currentGrade: string | null = null;
  if (overall.percent && overall.detailsPercent && overall.percent !== overall.detailsPercent) {
    notes.push("Overall percent and the details sentence disagree. Neither was chosen.");
  } else if (overall.percent) currentGrade = `${overall.percent}%`;
  const record: MyLab = {
    key,
    courseTitle: footer.courseTitle,
    sectionId,
    pageUrl,
    matchedBy: null,
    overall: hasOverall ? overall : null,
    currentGrade,
    overallPoints: overall.earned && overall.total ? `${overall.earned} / ${overall.total} pts` : null,
    categories,
    categoryTotal: categories.length ? categoryTotal : null,
    assignments,
    parsed,
    staleParts: [],
    viewLabel: typeof input.viewLabel === "string" && cleanText(input.viewLabel, 80) ? cleanText(input.viewLabel, 80) : null,
    notes,
    stamp,
  };
  return { record, droppedLinks: dropped.n, reason: null };
}

function isObjCapture(input: unknown): input is {
  kind: string;
  capturedAt: string;
  pageUrl: string;
  footerText?: string;
  overallValueText?: string;
  overallDetailsText?: string;
  viewLabel?: string | null;
  categoryHeaders?: unknown[];
  categoryRows?: unknown[];
  categoryTotal?: unknown;
  assignmentHeaders?: unknown[];
  assignmentRows?: unknown[];
} {
  return !!input && typeof input === "object" && (input as { kind?: string }).kind === "pearson-capture" && typeof (input as { capturedAt?: string }).capturedAt === "string" && !Number.isNaN(Date.parse((input as { capturedAt: string }).capturedAt)) && typeof (input as { pageUrl?: string }).pageUrl === "string";
}
