import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|md|json)$/.test(name)) out.push(full);
  }
  return out;
}

const root = path.resolve(__dirname, "..");
const files = walk(root);

function text(file: string): string {
  return readFileSync(file, "utf8");
}

describe("single writer and read-only collectors", () => {
  it("only the cache module names the snapshot key", () => {
    const hits = files
      .filter((file) => !file.endsWith(".test.ts") && text(file).includes("mirror.snapshot.v1"))
      .map((file) => path.relative(root, file))
      .sort();
    expect(hits).toEqual(["README.md", "lib/cache.ts"]);
  });

  it("only cache and prefs write localStorage", () => {
    const hits = files.filter((file) => !file.endsWith(".test.ts") && /localStorage\.(setItem|removeItem)/.test(text(file)));
    expect(hits.map((file) => path.relative(root, file)).sort()).toEqual(["lib/cache.ts", "lib/prefs.ts"]);
  });

  it("the app never fetches Blackboard or Pearson", () => {
    const appFiles = files.filter((file) => /^(app|components|lib)\//.test(path.relative(root, file)) && !file.endsWith(".test.ts"));
    const offenders = appFiles.filter((file) => /fetch\s*\(/.test(text(file)) || /\b(POST|PUT|PATCH|DELETE)\b/.test(text(file)));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });

  it("collectors do not submit or mutate", () => {
    const collectors = files.filter((file) => path.relative(root, file).startsWith("public/collector/"));
    expect(collectors.length).toBe(2);
    for (const file of collectors) {
      const source = text(file);
      expect(source).not.toMatch(/\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b|__doPostBack|\.submit\s*\(/);
      if (file.endsWith("pearson.js")) expect(source).not.toMatch(/fetch\s*\(/);
      if (file.endsWith("blackboard.js")) expect(source).toMatch(/method:\s*["']GET["']/);
    }
  });
});
