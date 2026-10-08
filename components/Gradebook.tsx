"use client";

import { formatDue } from "@/lib/format";
import { stateLabel } from "@/lib/labels";
import type { Course } from "@/lib/schema";
import { gradeBand } from "@/lib/view";
import { safeUrl } from "@/lib/safe-url";
import { useCourse } from "./data";
import { Stamp } from "./ui";

export function Gradebook() {
  const { course } = useCourse();
  const my = course.mylab;
  const bb = course.blackboardGradebook;
  const band = gradeBand(my?.currentGrade) || gradeBand(bb?.currentGrade);
  return (
    <div className="stack">
      <section className="card">
        <div className="section-head"><h2>Overall</h2>{band && <span className="note">{band}</span>}</div>
        <p className="note">Shown side by side. Never combined.</p>
        <div className="lanes">
          <div className="lane">
            <div className="label">MyLab</div>
            <div className={my?.currentGrade ? "grade" : "grade missing"}>{mylabGrade(course)}</div>
            {my?.overallPoints && <div className="note">{my.overallPoints}</div>}
            {my && <Stamp stamp={my.stamp} />}
            {!my && course.gradeHome?.value === "pearson" && <p className="note">You said grades live in MyLab.</p>}
          </div>
          <div className="lane">
            <div className="label">Blackboard</div>
            <div className={bb?.currentGrade ? "grade" : "grade missing"}>{bbGrade(course)}</div>
            {bb?.overallColumn && <div className="note">{bb.overallColumn}</div>}
            {bb && <Stamp stamp={bb.stamp} />}
          </div>
        </div>
        {my?.notes.map((note) => <p key={note} className="note">{note}</p>)}
        {my?.viewLabel && <p className="note">Results page view: {my.viewLabel}</p>}
        {my?.staleParts.map((part) => <p key={part.part} className="note">From an earlier read{part.at ? ` · ${part.at}` : ""} · {part.part}</p>)}
        {my?.matchedBy && <p className="note">Matched by {my.matchedBy}</p>}
      </section>
      <section className="card">
        <h2>MyLab categories</h2>
        {!my && <p className="empty-line">{stateLabel(course.mylabState)}</p>}
        {my && !my.parsed.categories && <p className="empty-line">Categories couldn’t be read.</p>}
        {my && my.parsed.categories && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Category</th><th>Average</th><th>Weight</th><th>Points</th><th>Time</th></tr></thead>
              <tbody>
                {my.categories.map((row) => (
                  <tr key={row.name}><td>{row.name}</td><td>{row.average || "—"}</td><td>{row.weight || "—"}</td><td>{row.earned || "—"}</td><td>{row.timeSpent || "—"}</td></tr>
                ))}
                {my.categoryTotal && <tr><td>{my.categoryTotal.name}</td><td>{my.categoryTotal.average || "—"}</td><td>{my.categoryTotal.weight || "—"}</td><td>{my.categoryTotal.earned || "—"}</td><td>{my.categoryTotal.timeSpent || "—"}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <h2>MyLab assignments</h2>
        {!my && <p className="empty-line">{stateLabel(course.mylabState)}</p>}
        {my && !my.parsed.items && <p className="empty-line">Assignments couldn’t be read.</p>}
        {my && my.parsed.items && my.assignments.length === 0 && <p className="empty-line">No assignments in this read.</p>}
        {my && my.assignments.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Assignment</th><th>Category</th><th>Correct/Total</th><th>Score</th><th>Status</th><th>Time</th><th>Started</th><th>Worked</th><th>Open</th></tr></thead>
              <tbody>
                {my.assignments.map((item) => {
                  const href = item.links.map((link) => safeUrl(link.href)).find(Boolean);
                  return (
                    <tr key={`${item.title}-${item.dateWorked || ""}`}>
                      <td>{item.title}</td>
                      <td>{item.category || "—"}</td>
                      <td>{item.correctTotal || "—"}{item.asterisk ? " · late" : ""}</td>
                      <td>{item.status === "incomplete" ? "—" : item.scorePercent !== null ? `${item.scorePercent}%` : item.scoreRaw || "—"}</td>
                      <td>{item.status || "—"}</td>
                      <td>{item.timeSpent || "—"}</td>
                      <td>{item.dateStarted || "—"}</td>
                      <td>{item.dateWorked || "—"}</td>
                      <td>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{item.links[0]?.text || "Open"}</a> : <span className="missing">No link on the Results page</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <div className="section-head"><h2>Blackboard gradebook</h2>{bb && <Stamp stamp={bb.stamp} />}</div>
        {bbGradeTable(course)}
      </section>
    </div>
  );
}

function mylabGrade(course: Course): string {
  if (course.mylab?.currentGrade) return course.mylab.currentGrade;
  if (course.mylab?.notes.some((note) => note.includes("disagree"))) return "Couldn’t choose";
  if (!course.mylab) return stateLabel(course.mylabState);
  return "—";
}

function bbGrade(course: Course): string {
  const book = course.blackboardGradebook;
  if (book?.currentGrade) return book.currentGrade;
  if (book?.empty) return "No grades posted";
  if (book?.overallAmbiguous) return "Couldn’t choose";
  if (book?.noOverallColumn) return "No overall column";
  if (!book) return stateLabel(course.blackboardGradebookState);
  return "—";
}

function bbGradeTable(course: Course) {
  const book = course.blackboardGradebook;
  if (!book) return <p className="empty-line">{stateLabel(course.blackboardGradebookState)}</p>;
  if (book.empty) return <p className="empty-line">No grades posted in Blackboard.</p>;
  if (!book.items.length) return <p className="empty-line">No gradebook items in this read.</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>Item</th><th>Due</th><th>Status</th><th>Grade</th></tr></thead>
        <tbody>
          {book.items.map((item) => (
            <tr key={item.columnId || item.title}>
              <td>{item.title}</td>
              <td>{item.due ? formatDue(item.due) : "—"}</td>
              <td>{item.status || "—"}</td>
              <td>{item.grade || (item.possible !== null ? `— / ${item.possible}` : "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
