import { describe, expect, it } from "vitest";
import { normalizePearsonCapture, parsePearsonCourseFooter } from "./pearson";

const at = "2026-10-08T15:00:00.000Z";

function capture(overrides: Record<string, unknown> = {}) {
  return {
    kind: "pearson-capture",
    capturedAt: at,
    pageUrl: "https://mylab.pearson.com/Student/Results.aspx?course=1",
    footerText: "This course (SUBJ 00000-000 - T (2026_FALL_SUBJ_00000_SEC000)) is based on a book.",
    overallValueText: "1%",
    overallDetailsText: "You have earned 1 out of 2 points for a Overall Score of 1%.",
    categoryHeaders: ["Average Score", "Category Weight", "Points Earned", "Time Spent"],
    categoryRows: [{ name: "Homework", cells: ["1%", "2 pts", "1 pts", "3 mins"] }],
    categoryTotal: { name: "Total", cells: ["1%", "2 pts", "1 pts", ""] },
    assignmentHeaders: [
      { text: "Assignment", colspan: 1 },
      { text: "Correct/Total", colspan: 1 },
      { text: "Score", colspan: 1 },
      { text: "Time Spent", colspan: 1 },
      { text: "Date Started", colspan: 1 },
      { text: "Date Worked", colspan: 1 },
    ],
    assignmentRows: [
      {
        title: "T",
        category: "Homework",
        className: "",
        cells: [
          { tag: "th", text: "T", colspan: 1, links: [] },
          { tag: "td", text: "1/2", raw: "1/2", colspan: 1, links: [{ href: "/Student/Player.aspx?item=1", text: "Review" }] },
          { tag: "td", text: "1%", colspan: 1 },
          { tag: "td", text: "3 mins", colspan: 1 },
          { tag: "td", text: "10/01/26 1:00 PM", colspan: 1 },
          { tag: "td", text: "10/01/26 1:05 PM", colspan: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("pearson capture", () => {
  it("reads a footer when exactly one section id is present", () => {
    const footer = parsePearsonCourseFooter("This course (SUBJ 00000-000 - T (2026_FALL_SUBJ_00000_SEC000))");
    expect(footer.sectionId).toBe("2026_FALL_SUBJ_00000_SEC000");
    expect(footer.courseTitle).toBe("SUBJ 00000-000 - T");
    expect(footer.ambiguous.sectionId).toBe(false);
  });

  it("refuses an ambiguous footer", () => {
    const footer = parsePearsonCourseFooter("2026_FALL_SUBJ_00000_SEC000 and 2026_FALL_SUBJ_00000_SEC001");
    expect(footer.sectionId).toBeNull();
    expect(footer.ambiguous.sectionId).toBe(true);
    const parsed = normalizePearsonCapture(capture({ footerText: "2026_FALL_SUBJ_00000_SEC000 2026_FALL_SUBJ_00000_SEC001", overallValueText: "1%" }));
    expect(parsed.record).toBeNull();
  });

  it("keeps checked fields and a real link, and drops a bad fraction and an incomplete percent", () => {
    const parsed = normalizePearsonCapture(capture({
      assignmentRows: [
        ...capture().assignmentRows as unknown[],
        {
          title: "U",
          category: null,
          className: "",
          cells: [
            { tag: "th", text: "U", colspan: 1 },
            { tag: "td", text: "nope", colspan: 1 },
            { tag: "td", text: "9%", colspan: 1 },
            { tag: "td", text: "incomplete", colspan: 1 },
          ],
        },
      ],
    }));
    const record = parsed.record;
    expect(record).not.toBeNull();
    expect(record?.currentGrade).toBe("1%");
    expect(record?.overallPoints).toBe("1 / 2 pts");
    expect(record?.categories[0]?.average).toBe("1%");
    expect(record?.pageUrl).toBe("https://mylab.pearson.com/Student/Results.aspx");
    const graded = record?.assignments[0];
    expect(graded?.correctTotal).toBe("1/2");
    expect(graded?.scorePercent).toBe(1);
    expect(graded?.links[0]?.href).toBe("https://mylab.pearson.com/Student/Player.aspx?item=1");
    const incomplete = record?.assignments[1];
    expect(incomplete?.status).toBe("incomplete");
    expect(incomplete?.scorePercent).toBeNull();
    expect(incomplete?.correctTotal).toBeNull();
  });

  it("does not choose a grade when the two overall percents disagree", () => {
    const parsed = normalizePearsonCapture(capture({
      overallValueText: "2%",
      overallDetailsText: "You have earned 1 out of 2 points for a Overall Score of 1%.",
      categoryRows: [],
      assignmentRows: [],
    }));
    expect(parsed.record?.currentGrade).toBeNull();
    expect(parsed.record?.overall?.percent).toBe("2");
    expect(parsed.record?.overall?.detailsPercent).toBe("1");
    expect(parsed.record?.notes.some((note) => note.includes("disagree"))).toBe(true);
  });

  it("rejects a non-Pearson page", () => {
    expect(() => normalizePearsonCapture(capture({ pageUrl: "https://example.com/Student/Results.aspx" }))).toThrow(/pearson/i);
  });
});
