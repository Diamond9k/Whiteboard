"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { clearSnapshot, readCache, subscribeSnapshot } from "@/lib/cache";
import { emptySnapshot, type Course, type Snapshot } from "@/lib/schema";
import { sampleSnapshot } from "@/lib/sample";

export type DataMode = "sample" | "import" | "empty" | "unreadable";

interface DataState {
  ready: boolean;
  mode: DataMode;
  snapshot: Snapshot;
  problem: string | null;
}

const Ctx = createContext<DataState>({ ready: false, mode: "empty", snapshot: emptySnapshot(), problem: null });
const CourseCtx = createContext<{ course: Course; now: Date } | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DataState>({ ready: false, mode: "empty", snapshot: emptySnapshot(), problem: null });
  useEffect(() => {
    const load = () => {
      const read = readCache();
      if (read.status === "unreadable") {
        setState({ ready: true, mode: "unreadable", snapshot: emptySnapshot(), problem: read.message });
        return;
      }
      if (read.status === "ok") {
        setState({ ready: true, mode: "import", snapshot: read.snapshot, problem: null });
        return;
      }
      if (process.env.NODE_ENV !== "production") {
        setState({ ready: true, mode: "sample", snapshot: sampleSnapshot, problem: null });
        return;
      }
      setState({ ready: true, mode: "empty", snapshot: emptySnapshot(), problem: null });
    };
    load();
    return subscribeSnapshot(load);
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useSnapshot(): DataState {
  return useContext(Ctx);
}

export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  return now;
}

export function Gate({ children }: { children: (snapshot: Snapshot, now: Date, mode: DataMode) => React.ReactNode }) {
  const data = useSnapshot();
  const now = useNow();
  if (!data.ready || !now) return <p className="reading">Reading local cache…</p>;
  if (data.mode === "unreadable") {
    return (
      <section className="card">
        <h2>Stored snapshot couldn’t be read</h2>
        <p className="note">{data.problem}</p>
        <button className="btn" type="button" onClick={() => clearSnapshot()}>Clear cached data</button>
      </section>
    );
  }
  return children(data.snapshot, now, data.mode);
}

export function CourseProvider({ course, now, children }: { course: Course; now: Date; children: React.ReactNode }) {
  return <CourseCtx.Provider value={{ course, now }}>{children}</CourseCtx.Provider>;
}

export function useCourse(): { course: Course; now: Date } {
  const value = useContext(CourseCtx);
  if (!value) throw new Error("Course page rendered outside its frame.");
  return value;
}
