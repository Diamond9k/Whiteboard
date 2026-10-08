"use client";

import { useState } from "react";
import Link from "next/link";
import { clearSnapshot } from "@/lib/cache";
import { ageLabel, formatFullStamp } from "@/lib/format";
import { stateLabel } from "@/lib/labels";
import type { Snapshot } from "@/lib/schema";
import { courseLabel } from "@/lib/view";
import { Gate } from "./data";
import { PageHead, SampleBanner } from "./ui";

export function Diagnostics() {
  return <Gate>{(snapshot, _now, mode) => <DiagnosticsBody snapshot={snapshot} mode={mode} />}</Gate>;
}

function DiagnosticsBody({ snapshot, mode }: { snapshot: Snapshot; mode: string }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      {mode === "sample" && <SampleBanner />}
      <PageHead title="Diagnostics" snapshot={snapshot} mode={mode} />
      <section className="card">
        <h2>Sync status</h2>
        <Status name="MyLab" status={snapshot.status.pearson} />
        <Status name="Blackboard" status={snapshot.status.blackboard} />
        <p className="note">This app cannot read a signed-in Blackboard or MyLab session. <Link href="/import">Import a collector file</Link> to replace what is shown.</p>
        <div className="actions">
          {mode === "import" && <button className="btn-ghost" type="button" onClick={() => download(snapshot)}>Export snapshot</button>}
          {!confirm ? <button className="btn-ghost" type="button" onClick={() => setConfirm(true)}>Clear cached data</button> : <button className="btn" type="button" onClick={() => { clearSnapshot(); setConfirm(false); }}>Confirm clear</button>}
        </div>
        <p className="note">Clearing removes the snapshot from this browser only. It does not change Blackboard or MyLab.</p>
      </section>
      <section className="card" style={{ marginTop: 12 }}>
        <h2>Courses</h2>
        {snapshot.courses.length === 0 && <p className="empty-line">No courses in this snapshot.</p>}
        {snapshot.courses.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Course</th><th>Content</th><th>MyLab</th><th>Blackboard</th><th>Due</th><th>Faculty</th></tr></thead>
              <tbody>
                {snapshot.courses.map((course) => (
                  <tr key={course.id}>
                    <td><Link href={`/courses/${encodeURIComponent(course.id)}`}>{courseLabel(course)}</Link>{course.stale.length > 0 && <div className="note">Earlier read: {course.stale.join(", ")}</div>}</td>
                    <td>{stateLabel(course.contentState)}</td>
                    <td>{stateLabel(course.mylabState)}</td>
                    <td>{stateLabel(course.blackboardGradebookState)}</td>
                    <td>{stateLabel(course.dueState)}</td>
                    <td>{stateLabel(course.instructorsState)}{course.instructorsUnnamed ? ` · ${course.instructorsUnnamed} unnamed` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Status({ name, status }: { name: string; status: Snapshot["status"]["pearson"] }) {
  return (
    <p>
      <strong>{name}.</strong> {stateLabel(status.state)}
      {status.lastSuccessAt ? ` Last success ${formatFullStamp(status.lastSuccessAt)} (${ageLabel(status.lastSuccessAt)}).` : " No successful read."}
      {status.lastAttemptAt ? ` Last attempt ${formatFullStamp(status.lastAttemptAt)}.` : ""}
      {status.source ? ` Source ${status.source}.` : ""}
      {status.message ? ` ${status.message}` : ""}
    </p>
  );
}

function download(snapshot: Snapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "mirror-snapshot.json";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
