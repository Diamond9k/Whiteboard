import { afterEach, describe, expect, it } from "vitest";
import { clearSnapshot, readCache, writeSnapshot } from "./cache";
import { emptySnapshot } from "./schema";
import { sampleSnapshot } from "./sample";

function installStorage() {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
    },
  });
}

describe("cache writer", () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("writes an import and refuses sample data", () => {
    installStorage();
    const snapshot = emptySnapshot();
    snapshot.kind = "import";
    snapshot.importedAt = "2026-10-08T15:00:00.000Z";
    writeSnapshot(snapshot);
    expect(readCache().status).toBe("ok");
    expect(() => writeSnapshot(sampleSnapshot)).toThrow(/sample/i);
    clearSnapshot();
    expect(readCache().status).toBe("empty");
  });

  it("reports an unreadable cache instead of falling back silently", () => {
    installStorage();
    localStorage.setItem("mirror.snapshot.v1", "{");
    const read = readCache();
    expect(read.status).toBe("unreadable");
  });
});
