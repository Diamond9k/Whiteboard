"use client";

import { useState } from "react";
import { ZodError } from "zod";
import { readCache, writeSnapshot } from "@/lib/cache";
import { buildSnapshotFromFiles, type ImportSummary } from "@/lib/ingest/import";
import type { Snapshot } from "@/lib/schema";
import { courseLabel } from "@/lib/view";
import { Gate } from "./data";
import { PageHead } from "./ui";

export function ImportForm() {
  return <Gate>{(snapshot, _now, mode) => <ImportBody current={mode === "import" ? snapshot : null} mode={mode} />}</Gate>;
}

function ImportBody({ current, mode }: { current: Snapshot | null; mode: string }) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ snapshot: Snapshot; summary: ImportSummary } | null>(null);
  const [paste, setPaste] = useState("");

  async function take(files: File[]) {
    setError(null);
    setPreview(null);
    try {
      const payloads = [];
      for (const file of files) {
        let json: unknown;
        try { json = JSON.parse(await file.text()); }
        catch { throw new Error(`${file.name} is not JSON.`); }
        payloads.push(json);
      }
      const cached = readCache();
      const base = cached.status === "ok" ? cached.snapshot : current;
      setPreview(buildSnapshotFromFiles(base, payloads));
    } catch (err) {
      setError(message(err));
    }
  }

  function takePaste() {
    setError(null);
    setPreview(null);
    try {
      const json = JSON.parse(paste) as unknown;
      const payloads = Array.isArray(json) ? json : [json];
      const cached = readCache();
      const base = cached.status === "ok" ? cached.snapshot : current;
      setPreview(buildSnapshotFromFiles(base, payloads));
    } catch (err) {
      setError(message(err));
    }
  }

  function save() {
    if (!preview) return;
    try {
      writeSnapshot(preview.snapshot);
      setPreview(null);
      setPaste("");
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <>
      <PageHead title="Import" snapshot={current ?? preview?.snapshot ?? emptyish(mode)} mode={mode}>
        <p className="sub">Replace the sample fixture with a file from the collector.</p>
      </PageHead>
      <section className="card">
        <h2>How a snapshot gets here</h2>
        <ol>
          <li>Sign in at Blackboard or MyLab in this browser.</li>
          <li>Open <a href="/collector/blackboard.js">blackboard.js</a> or <a href="/collector/pearson.js">pearson.js</a>, copy the file, and paste it into that page’s DevTools console.</li>
          <li>Import the JSON download here. The collector only uses GET requests, or reads the page. It does not submit anything.</li>
        </ol>
        <p className="note">MyLab is read from the Results page you are looking at. If that page is filtered (for example “Past 2 Weeks”), only the visible rows are captured. Change the filter yourself, then run the collector again. The script will not change it.</p>
      </section>
      <div className="drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void take([...event.dataTransfer.files]); }}>
        <input aria-label="Snapshot files" type="file" accept="application/json,.json" multiple onChange={(event) => { if (event.target.files) void take([...event.target.files]); }} />
        <p className="note">Or drop JSON files. Several captures import together: one Blackboard file and one MyLab file per class.</p>
      </div>
      <label className="note" htmlFor="paste">Paste JSON</label>
      <textarea id="paste" className="textarea" value={paste} onChange={(event) => setPaste(event.target.value)} />
      <div className="actions" style={{ marginTop: 8 }}>
        <button className="btn" type="button" onClick={takePaste}>Check paste</button>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {preview && (
        <section className="card" style={{ marginTop: 12 }}>
          <h2>Ready to save</h2>
          <p>{preview.summary.courses} courses · {preview.summary.mylabRecords} MyLab records · {preview.summary.matched} matched to Blackboard · {preview.summary.unmatched} MyLab-only · {preview.summary.droppedLinks} links dropped.</p>
          <ul>
            {preview.snapshot.courses.slice(0, 20).map((course) => (
              <li key={course.id}>{courseLabel(course)} — MyLab {course.mylabState}, Blackboard {course.blackboardGradebookState}</li>
            ))}
          </ul>
          <button className="btn" type="button" onClick={save}>Save in this browser</button>
        </section>
      )}
    </>
  );
}

function message(err: unknown): string {
  if (err instanceof ZodError) return "This file does not match the snapshot schema.";
  if (err instanceof Error) return err.message;
  return "Import failed.";
}

function emptyish(mode: string): Snapshot {
  return {
    schemaVersion: 1,
    kind: mode === "sample" ? "sample" : "empty",
    importedAt: null,
    label: mode === "sample" ? "SAMPLE DATA" : null,
    student: null,
    status: {
      pearson: { state: "not-synced", lastSuccessAt: null, lastAttemptAt: null, source: null, message: null },
      blackboard: { state: "not-synced", lastSuccessAt: null, lastAttemptAt: null, source: null, message: null },
    },
    courses: [],
    unmatchedMyLab: [],
  };
}
