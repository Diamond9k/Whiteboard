/** https links to Blackboard or Pearson only. Everything else is dropped. */

const BB_HOST = "learn.uark.edu";

export function safeUrl(input: unknown, base?: string | null): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 2000) return null;
  if (/^(javascript|data|vbscript):/i.test(raw)) return null;
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host !== BB_HOST && host !== "pearson.com" && !host.endsWith(".pearson.com")) return null;
  return url.href;
}

export function isSafeUrl(input: unknown): boolean {
  return typeof input === "string" && safeUrl(input) !== null;
}
