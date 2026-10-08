/** UI preferences only. This module never reads or writes the academic snapshot. */

export const PREFS_KEY = "mirror.prefs.v1";

export type ThemeChoice = "dark" | "light" | "system";
export type CourseLayout = "list" | "grid";

export interface Prefs {
  theme: ThemeChoice;
  layout: CourseLayout;
  favorites: string[];
}

const DEFAULTS: Prefs = { theme: "dark", layout: "list", favorites: [] };

export function readPrefs(): Prefs {
  if (typeof localStorage === "undefined") return DEFAULTS;
  const raw = localStorage.getItem(PREFS_KEY);
  if (!raw) return DEFAULTS;
  try {
    const json = JSON.parse(raw) as Partial<Prefs>;
    const theme = json.theme === "light" || json.theme === "system" || json.theme === "dark" ? json.theme : "dark";
    const layout = json.layout === "grid" ? "grid" : "list";
    const favorites = Array.isArray(json.favorites) ? json.favorites.filter((id) => typeof id === "string").slice(0, 80) : [];
    return { theme, layout, favorites };
  } catch {
    return DEFAULTS;
  }
}

export function writePrefs(prefs: Prefs): void {
  if (typeof localStorage === "undefined") return;
  const next: Prefs = {
    theme: prefs.theme === "light" || prefs.theme === "system" ? prefs.theme : "dark",
    layout: prefs.layout === "grid" ? "grid" : "list",
    favorites: prefs.favorites.filter((id) => typeof id === "string").slice(0, 80),
  };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("mirror:prefs"));
}

export function subscribePrefs(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener("mirror:prefs", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("mirror:prefs", handler);
    window.removeEventListener("storage", handler);
  };
}

export function resolveTheme(choice: ThemeChoice): "dark" | "light" {
  if (choice === "system") {
    if (typeof window === "undefined" || !window.matchMedia) return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return choice;
}

export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(choice);
  document.documentElement.dataset.themeChoice = choice;
}
