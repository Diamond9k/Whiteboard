import { snapshotSchema, type Snapshot } from "./schema";

/**
 * SINGLE WRITER for the academic cache.
 * The only localStorage key is mirror.snapshot.v1.
 * Nothing else in the app may call setItem/removeItem for this key.
 * UI preferences live in lib/prefs.ts under a different key.
 */

export const SNAPSHOT_KEY = "mirror.snapshot.v1";

export type ReadResult =
  | { status: "empty" }
  | { status: "ok"; snapshot: Snapshot }
  | { status: "unreadable"; message: string };

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("mirror:snapshot"));
}

export function readCache(): ReadResult {
  if (typeof localStorage === "undefined") return { status: "empty" };
  const raw = localStorage.getItem(SNAPSHOT_KEY);
  if (!raw) return { status: "empty" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { status: "unreadable", message: "Stored snapshot is not valid JSON." };
  }
  const parsed = snapshotSchema.safeParse(json);
  if (!parsed.success) return { status: "unreadable", message: "Stored snapshot does not match the schema." };
  if (parsed.data.kind !== "import") {
    return { status: "unreadable", message: "Stored snapshot is not an import." };
  }
  return { status: "ok", snapshot: parsed.data };
}

/** Persist an imported snapshot. Sample and empty snapshots are refused. */
export function writeSnapshot(snapshot: Snapshot): void {
  if (typeof localStorage === "undefined") throw new Error("This browser has no local cache.");
  const parsed = snapshotSchema.parse(snapshot);
  if (parsed.kind !== "import") {
    throw new Error("Only an imported snapshot can be saved. Sample data is not written to the cache.");
  }
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(parsed));
  notify();
}

export function clearSnapshot(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(SNAPSHOT_KEY);
  notify();
}

export function subscribeSnapshot(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener("mirror:snapshot", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("mirror:snapshot", handler);
    window.removeEventListener("storage", handler);
  };
}
