"use client";

import Link from "next/link";
import { stateLabel } from "@/lib/labels";
import type { Course } from "@/lib/schema";
import { courseLabel, gradeBand } from "@/lib/view";
import { safeUrl } from "@/lib/safe-url";
import { Gate } from "./data";
import { Notices, PageHead, SampleBanner, Stamp } from "./ui";

export function Grades() {
  return <Gate>{(snapshot, _now, mode) => {
    const bands = snapshot.courses.some((course) => gradeBand(course.mylab?.currentGrade) || gradeBand(course.blackboardGradebook?.currentGrade));
    return (
      <>
        {mode === "sample" && <SampleBanner />}
        <PageHead title="Grades" snapshot={snapshot} mode={mode} />
        <Notices snapshot={snapshot} />
        {bands && <p className="note">90+ · 80s · 70s · 60s · &lt;60. MyLab and Blackboard are never combined.</p>}
        {snapshot.courses.length === 0 && <p className="empty-line">No courses in this snapshot.</p>}
        {snapshot.courses.map((course) => <GradeBlock key={course.id} course={course} />)}
      </>
    );
  }}</Gate>;
}

function GradeBlock({ course }: { course: Course }) {
  const my = course.mylab;
  const bb = course.blackboardGradebook;
  return (
    <details className="grade-block">
      <summary>
        <div className="card-top">
          <strong>{courseLabel(course)}</strong>
          <Link href={`/courses/${encodeURIComponent(course.id)}/gradebook`}>Open</Link>
        </div>
        <div className="lanes">
          <div><div className="label">MyLab</div><div>{my?.currentGrade || (my ? stateLabel(course.mylabState) : "Not yet synced")}</div></div>
          <div><div className="label">Blackboard</div><div>{bb?.currentGrade || (bb?.empty ? "No grades posted" : stateLabel(course.blackboardGradebookState))}</div></div>
          <div><div className="label">Items</div><div>{my ? my.assignments.length : "—"}</div></div>
        </div>
      </summary>
      <div className="grade-body">
        {!my && <p className="empty-line">MyLab {stateLabel(course.mylabState).toLowerCase()}.</p>}
        {my && (
          <div>
            <Stamp stamp={my.stamp} />
            {my.matchedBy && <p className="note">Matched by {my.matchedBy}</p>}
            {my.categories.length > 0 && (
              <table className="data">
                <thead><tr><th>Category</th><th>Average</th><th>Weight</th><th>Points</th></tr></thead>
                <tbody>{my.categories.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.average || "—"}</td><td>{row.weight || "—"}</td><td>{row.earned || "—"}</td></tr>)}</tbody>
              </table>
            )}
            {my.assignments.length > 0 && (
              <table className="data">
                <thead><tr><th>Assignment</th><th>Score</th><th>Status</th><th>Open</th></tr></thead>
                <tbody>
                  {my.assignments.map((item) => {
                    const href = item.links.map((link) => safeUrl(link.href)).find(Boolean);
                    return (
                      <tr key={item.title}>
                        <td>{item.title}</td>
                        <td>{item.scorePercent !== null ? `${item.scorePercent}%` : "—"}</td>
                        <td>{item.status || "—"}</td>
                        <td>{href ? <a href={href} target="_blank" rel="noopener noreferrer">Open</a> : <span className="missing">No link</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        {!bb && <p className="empty-line">Blackboard {stateLabel(course.blackboardGradebookState).toLowerCase()}.</p>}
        {bb && <Stamp stamp={bb.stamp} />}
        {bb?.empty && <p className="empty-line">No grades posted in Blackboard.</p>}
        {bb && bb.items.length > 0 && (
          <table className="data">
            <thead><tr><th>Blackboard item</th><th>Grade</th><th>Status</th></tr></thead>
            <tbody>{bb.items.map((item) => <tr key={item.columnId || item.title}><td>{item.title}</td><td>{item.grade || "—"}</td><td>{item.status || "—"}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </details>
  );
}
