import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "./sample";

describe("sample fixture", () => {
  it("contains only the four stated Fall 2026 courses", () => {
    expect(sampleSnapshot.kind).toBe("sample");
    expect(sampleSnapshot.label).toBe("SAMPLE DATA");
    expect(sampleSnapshot.student).toBeNull();
    expect(sampleSnapshot.courses.map((course) => course.code?.value)).toEqual([
      "COM 1003-901",
      "ECON 2103-901",
      "MATH 20503-019",
      "PLSC 20003-903",
    ]);
  });

  it("does not invent grades, due dates, assignments, instructors, or links", () => {
    const raw = readFileSync(new URL("../fixtures/sample.json", import.meta.url), "utf8");
    expect(raw).not.toMatch(/https?:/);
    expect(raw).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(sampleSnapshot.courses.every((course) => course.due.length === 0)).toBe(true);
    expect(sampleSnapshot.courses.every((course) => course.content.length === 0)).toBe(true);
    expect(sampleSnapshot.courses.every((course) => course.mylab === null)).toBe(true);
    expect(sampleSnapshot.courses.every((course) => course.blackboardGradebook === null)).toBe(true);
    expect(sampleSnapshot.courses.every((course) => course.instructors.length === 0)).toBe(true);
    expect(sampleSnapshot.courses.every((course) => course.outlineHref === null && course.mylabHref === null)).toBe(true);
    const math = sampleSnapshot.courses[2];
    expect(math.gradeHome?.value).toBe("pearson");
    expect(math.title?.value).toBe("Finite Mathematics");
    const plsc = sampleSnapshot.courses[3];
    expect(plsc.availability?.value).toBe("not-open");
    const com = sampleSnapshot.courses[0];
    expect(com.title).toBeNull();
    expect(com.statedDescription?.value).toBe("phone/basic communication course");
  });
});
