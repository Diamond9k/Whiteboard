import type { Course, MyLab } from "../schema";
import { courseCodeFromId } from "../text";
import { cleanSectionId } from "./pearson";

function norm(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

/** Attach a MyLab record to one Blackboard course. Ambiguous matches return null. */
export function matchMyLab(rec: MyLab, courses: Course[]): { courseId: string; matchedBy: string } | null {
  let list = courses.filter((course) => course.code?.value);
  const title = rec.courseTitle || "";
  const sectionId = cleanSectionId(rec.sectionId);
  const sectionCode = sectionId ? courseCodeFromId(sectionId) : null;
  if (sectionCode) {
    const parts = sectionCode.match(/^([A-Z]{2,5}) (\d{4,5})-(\w+)$/);
    if (parts) {
      const conflict = [...title.matchAll(/\b([A-Z]{2,5})\s*(\d{4,5})-([A-Z0-9]{1,6})\b/gi)].some(
        (match) => match[1].toUpperCase() === parts[1] && match[2] === parts[2] && match[3].toUpperCase() !== parts[3],
      );
      if (conflict) return null;
    }
    const matchedBy = `section id "${sectionId}" from the MyLab page footer`;
    const byBbId = list.filter((course) => norm(course.bbId) === sectionId);
    if (byBbId.length === 1) return { courseId: byBbId[0].id, matchedBy };
    const byCode = list.filter((course) => norm(course.code?.value) === sectionCode);
    if (byCode.length === 1) return { courseId: byCode[0].id, matchedBy };
    list = list.filter((course) => !/^[A-Z]{2,5} \d{4,5}-\w+$/.test(norm(course.code?.value)) || norm(course.code?.value) === sectionCode);
  }
  const subjectNumber = (code: string | null | undefined) => {
    const match = (code || "").match(/^([A-Z]{2,5})\s*(\d{4,5})/i);
    return match ? (match[1] + match[2]).toUpperCase() : null;
  };
  const re = /\b([A-Z]{2,5})\s*-?\s*(\d{4,5})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(title))) {
    const key = (match[1] + match[2]).toUpperCase();
    const hits = list.filter((course) => subjectNumber(course.code?.value) === key);
    if (hits.length === 1) return { courseId: hits[0].id, matchedBy: `course code "${match[1]} ${match[2]}" in the MyLab course title` };
  }
  const keywords = [
    { re: /econ|macro|micro/i, subject: "ECON" },
    { re: /\bmath|finite|algebra|calculus|statistic/i, subject: "MATH" },
  ];
  for (const keyword of keywords) {
    const hit = title.match(keyword.re);
    if (!hit) continue;
    const hits = list.filter((course) => (course.code?.value || "").toUpperCase().startsWith(keyword.subject + " ") && course.current !== false);
    if (hits.length === 1) return { courseId: hits[0].id, matchedBy: `keyword "${hit[0]}" in the MyLab course title` };
  }
  return null;
}

export function displayTitle(code: string | null, title: string): string {
  if (!code) return title;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = title.match(new RegExp("^" + escaped + "\\s*[–-]\\s*(.+)$", "i"));
  return match?.[1]?.trim() || title;
}
