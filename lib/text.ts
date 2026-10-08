export function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function nonEmpty(v: unknown): boolean {
  return str(v).length > 0;
}

export function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Round to at most 2 decimals. Input must already be a real number. */
export function num(n: number): number {
  return Math.round(n * 100) / 100;
}

export function cleanText(t: unknown, max = 300): string {
  const s = String(t == null ? "" : t).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Strip HTML to plain text. Truncation is marked. */
export function stripHtml(html: unknown, max = 280): string {
  if (typeof html !== "string") return "";
  let t = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h\d)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > max) t = t.slice(0, max - 1).trimEnd() + "…";
  return t;
}

export function validIso(v: unknown): string | null {
  const s = str(v);
  if (!s || Number.isNaN(Date.parse(s))) return null;
  return new Date(s).toISOString();
}

/**
 * UARK courseId YEAR_TERM_SUBJ_NUMBER_SECnnn -> "SUBJ NUMBER-nnn".
 * Returns null when the id does not follow that pattern.
 */
export function courseCodeFromId(courseId: unknown): string | null {
  const m = str(courseId).match(/^\d{4}_[A-Z]+_([A-Z]{2,5})_(\d{4,5})_SEC(\w+)$/i);
  return m ? `${m[1].toUpperCase()} ${m[2]}-${m[3].toUpperCase()}` : null;
}

const NAME_PLACEHOLDER = /^(given\s*name|family\s*name|preferred\s*name|middle\s*name)$/i;
const NAME_PLACEHOLDER_IN_TEXT = /\b(GivenName|FamilyName|PreferredName|MiddleName)\b/;

function namePart(v: unknown): string {
  const s = str(v);
  return s && !NAME_PLACEHOLDER.test(s) ? s : "";
}

export function isPlaceholderName(name: unknown): boolean {
  return !nonEmpty(name) || NAME_PLACEHOLDER_IN_TEXT.test(str(name));
}

/** given + family only. preferredDisplayName is a setting enum, never a name. */
export function personName(u: unknown): string | null {
  if (!isObj(u)) return null;
  const n = isObj(u.name) ? u.name : {};
  const given = namePart(n.given) || namePart(u.givenName);
  const family = namePart(n.family) || namePart(u.familyName);
  const name = [given, family].filter(Boolean).join(" ");
  return name || null;
}
