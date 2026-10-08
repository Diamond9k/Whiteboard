"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSnapshot } from "./data";
import { Palette } from "./Palette";
import { applyTheme, readPrefs, subscribePrefs, writePrefs, type ThemeChoice } from "@/lib/prefs";

const NAV = [
  { href: "/", label: "Today", exact: true },
  { href: "/courses", label: "Courses" },
  { href: "/calendar", label: "Calendar" },
  { href: "/grades", label: "Grades" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { snapshot } = useSnapshot();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>("dark");

  useEffect(() => {
    const load = () => {
      const prefs = readPrefs();
      setTheme(prefs.theme);
      applyTheme(prefs.theme);
    };
    load();
    return subscribePrefs(load);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    let pending = false;
    let timer = 0;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
        return;
      }
      if (typing) return;
      if (event.key === "/") {
        event.preventDefault();
        setPalette(true);
        return;
      }
      if (event.key === "Escape") setPalette(false);
      if (event.key === "g") {
        pending = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { pending = false; }, 800);
        return;
      }
      if (!pending) return;
      pending = false;
      const go: Record<string, string> = { t: "/", c: "/courses", k: "/calendar", g: "/grades" };
      if (go[event.key]) router.push(go[event.key]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const student = snapshot.student?.name || null;
  const current = useMemo(() => pathname, [pathname]);

  function active(href: string, exact?: boolean) {
    if (exact) return current === href;
    return current === href || current.startsWith(href + "/");
  }

  function chooseTheme(next: ThemeChoice) {
    const prefs = readPrefs();
    writePrefs({ ...prefs, theme: next });
    applyTheme(next);
  }

  return (
    <div className="app">
      {open && <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <aside className={open ? "sidebar open" : "sidebar"}>
        <Link href="/" className="brand">
          <span className="mark">M</span>
          <span><strong>Mirror</strong><small>UARK · read-only</small></span>
        </Link>
        <button className="search-btn" type="button" onClick={() => setPalette(true)}>
          Search <kbd>⌘K</kbd>
        </button>
        <nav aria-label="Primary">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link" aria-current={active(item.href, item.exact) ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="nav-label">Data</div>
        <Link href="/diagnostics" className="nav-quiet" aria-current={active("/diagnostics", true) ? "page" : undefined}>Diagnostics</Link>
        <Link href="/import" className="nav-quiet" aria-current={active("/import", true) ? "page" : undefined}>Import</Link>
        <div className="side-spacer" />
        <div className="nav-label">Sites</div>
        <div className="side-links">
          <a href="https://learn.uark.edu" target="_blank" rel="noopener noreferrer">Blackboard site</a>
          <a href="https://mylab.pearson.com" target="_blank" rel="noopener noreferrer">MyLab site</a>
        </div>
        <div className="theme-row" role="group" aria-label="Theme">
          {(["dark", "light", "system"] as ThemeChoice[]).map((choice) => (
            <button key={choice} type="button" className="theme-btn" aria-pressed={theme === choice} onClick={() => chooseTheme(choice)}>
              {choice === "dark" ? "Dark" : choice === "light" ? "Light" : "System"}
            </button>
          ))}
        </div>
        {student && <div className="who">{student}<span><StampInline snapshotSource={snapshot.student?.stamp.source} /></span></div>}
      </aside>
      <div className="main">
        <button className="menu-btn btn-ghost" type="button" onClick={() => setOpen(true)}>Menu</button>
        <div className="page">{children}</div>
      </div>
      {palette && <Palette snapshot={snapshot} onClose={() => setPalette(false)} />}
    </div>
  );
}

function StampInline({ snapshotSource }: { snapshotSource?: string }) {
  if (snapshotSource === "student-stated") return "Stated";
  if (snapshotSource === "pearson") return "MyLab";
  if (snapshotSource === "blackboard-api" || snapshotSource === "blackboard-dom") return "Blackboard";
  return "Synced";
}
