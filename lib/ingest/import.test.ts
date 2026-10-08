import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../sample";
import { buildSnapshotFromFiles } from "./import";

const at = "2026-10-08T15:00:00.000Z";

function blackboard(): any {
  return {
    kind: "blackboard-capture",
    capturedAt: at,
    origin: "https://learn.uark.edu",
    mode: "api",
    me: { id: "student-1", name: { given: "Ada", family: "Lovelace" } },
    terms: {
      t1: { id: "t1", name: "Fall 2026", availability: { available: "Yes", duration: { start: "2026-08-01T00:00:00.000Z", end: "2026-12-20T00:00:00.000Z" } } },
    },
    memberships: [
      {
        courseRoleId: "Student",
        courseId: "course-1",
        course: {
          id: "course-1",
          courseId: "2026_FALL_SUBJ_00000_SEC000",
          name: "T",
          termId: "t1",
          availability: { available: "Yes" },
          externalAccessUrl: "https://learn.uark.edu/ultra/courses/course-1/outline",
        },
      },
    ],
    calendar: { state: "ok", data: [{ id: "cal-1", calendarId: "course-1", title: "Event", start: "2026-10-20T04:59:00.000Z", type: "Calendar" }] },
    details: {
      "course-1": {
        faculty: { state: "ok", data: [{ courseRoleId: "Instructor", userId: "f1", user: { id: "f1", name: { given: "Grace", family: "Hopper" } } }] },
        contents: {
          state: "ok",
          data: [
            {
              id: "folder-1",
              title: "Folder",
              contentHandler: { id: "resource/x-bb-folder" },
              _children: {
                state: "ok",
                data: [
                  {
                    id: "doc-1",
                    title: "Doc",
                    contentHandler: { id: "resource/x-bb-file" },
                    links: [{ href: "https://learn.uark.edu/ultra/courses/course-1/cl/doc-1", title: "Doc" }],
                  },
                ],
              },
            },
          ],
        },
        columns: {
          state: "ok",
          data: [
            { id: "overall", name: "Overall Grade", externalGrade: true, score: { possible: 100 } },
            { id: "q1", name: "Quiz", grading: { due: "2026-10-10T04:59:00.000Z", type: "Numeric" }, score: { possible: 10 } },
          ],
        },
        grades: { state: "ok", data: { results: [{ columnId: "overall", displayGrade: { score: 1, scaleType: "Percent" } }] } },
      },
    },
  };
}

describe("import pipeline", () => {
  it("builds a snapshot from Blackboard and MyLab captures and does not invent an outline link", () => {
    const mylab = {
      kind: "pearson-capture",
      capturedAt: at,
      pageUrl: "https://mylab.pearson.com/Student/Results.aspx",
      footerText: "This course (SUBJ 00000-000 - T (2026_FALL_SUBJ_00000_SEC000))",
      overallValueText: "1%",
      overallDetailsText: "",
      categoryHeaders: [],
      categoryRows: [],
      assignmentHeaders: [{ text: "Assignment", colspan: 1 }, { text: "Score", colspan: 1 }],
      assignmentRows: [{ title: "T", cells: [{ tag: "th", text: "T", colspan: 1 }, { tag: "td", text: "1%", colspan: 1 }] }],
    };
    const { snapshot, summary } = buildSnapshotFromFiles(null, [blackboard(), mylab]);
    expect(snapshot.kind).toBe("import");
    expect(snapshot.student?.name).toBe("Ada Lovelace");
    expect(summary.matched).toBe(1);
    const course = snapshot.courses[0];
    expect(course.code?.value).toBe("SUBJ 00000-000");
    expect(course.outlineHref).toBe("https://learn.uark.edu/ultra/courses/course-1/outline");
    expect(course.content[0]?.children?.[0]?.links[0]?.href).toContain("doc-1");
    expect(course.blackboardGradebook?.currentGrade).toBe("1%");
    expect(course.blackboardGradebook?.empty).toBe(false);
    expect(course.due.some((item) => item.title === "Quiz")).toBe(true);
    expect(course.mylab?.currentGrade).toBe("1%");
    expect(course.mylab?.matchedBy).toMatch(/section id/);
    expect(course.instructors[0]?.name).toBe("Grace Hopper");
  });

  it("does not mark an unrecognized grade payload as an empty gradebook", () => {
    const raw = blackboard();
    raw.details["course-1"].columns = { state: "ok", data: [] };
    raw.details["course-1"].grades = { state: "ok", data: { unexpected: true } };
    const { snapshot } = buildSnapshotFromFiles(null, [raw]);
    const course = snapshot.courses[0];
    expect(course.blackboardGradebookState).toBe("partial");
    expect(course.blackboardGradebook?.empty).toBe(false);
    expect(course.blackboardGradebook?.currentGrade).toBeNull();
  });

  it("marks a recognized empty gradebook as empty", () => {
    const raw = blackboard();
    raw.details["course-1"].columns = { state: "ok", data: [] };
    raw.details["course-1"].grades = { state: "ok", data: { results: [] } };
    const { snapshot } = buildSnapshotFromFiles(null, [raw]);
    expect(snapshot.courses[0]?.blackboardGradebook?.empty).toBe(true);
  });

  it("keeps a previous good section when a later read fails", () => {
    const first = buildSnapshotFromFiles(null, [blackboard()]).snapshot;
    const second = blackboard();
    second.details["course-1"].contents = { state: "forbidden", error: "403" };
    const { snapshot } = buildSnapshotFromFiles(first, [second]);
    expect(snapshot.courses[0]?.content[0]?.title).toBe("Folder");
    expect(snapshot.courses[0]?.stale).toContain("content");
  });

  it("refuses the sample fixture as an import", () => {
    expect(() => buildSnapshotFromFiles(null, [sampleSnapshot])).toThrow(/sample/i);
  });

  it("creates a MyLab course when Blackboard has not been imported", () => {
    const mylab = {
      kind: "pearson-capture",
      capturedAt: at,
      pageUrl: "https://mylab.pearson.com/Student/Results.aspx",
      footerText: "This course (SUBJ 00000-000 - T (2026_FALL_SUBJ_00000_SEC000))",
      overallValueText: "1%",
      categoryRows: [],
      assignmentRows: [],
    };
    const { snapshot } = buildSnapshotFromFiles(sampleSnapshot, [mylab]);
    expect(snapshot.courses).toHaveLength(1);
    expect(snapshot.courses[0]?.id.startsWith("mylab:")).toBe(true);
    expect(snapshot.courses[0]?.code?.value).toBe("SUBJ 00000-000");
    expect(snapshot.courses.some((course) => course.id.startsWith("stated-"))).toBe(false);
  });
});
