"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Snapshot } from "@/lib/schema";
import { courseLabel } from "@/lib/view";

const PAGES = [
  { href: "/", label: "Today", kind: "Page" },
  { href: "/courses", label: "Courses", kind: "Page" },
  { href: "/calendar", label: "Calendar", kind: "Page" },
  { href: "/calendar/month", label: "Month", kind: "Page" },
  { href: "/calendar/recent", label: "Recently due", kind: "Page" },
  { href: "/grades", label: "Grades", kind: "Page" },
  { href: "/diagnostics", label: "Diagnostics", kind: "Page" },
  { href: "/import", label: "Import", kind: "Page" },
];

export function Palette({ snapshot, onClose }: { snapshot: Snapshot; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: { href: string; label: string; kind: string }[] = [...PAGES];
    for (const course of snapshot.courses) {
      items.push({ href: `/courses/${encodeURIComponent(course.id)}`, label: courseLabel(course), kind: course.title?.value || "Course" });
      for (const node of course.content) items.push({ href: `/courses/${encodeURIComponent(course.id)}`, label: node.title, kind: courseLabel(course) });
      for (const item of course.mylab?.assignments ?? []) items.push({ href: `/courses/${encodeURIComponent(course.id)}/gradebook`, label: item.title, kind: `MyLab · ${courseLabel(course)}` });
      for (const item of course.due) items.push({ href: `/courses/${encodeURIComponent(course.id)}/calendar`, label: item.title, kind: `Due · ${courseLabel(course)}` });
    }
    const filtered = q ? items.filter((item) => `${item.label} ${item.kind}`.toLowerCase().includes(q)) : items;
    return filtered.slice(0, 20);
  }, [query, snapshot]);

  useEffect(() => setIndex(0), [query]);

  function go(href: string) {
    router.push(href);
    onClose();
  }

  return (
    <div className="palette" role="dialog" aria-label="Search" onMouseDown={onClose}>
      <div className="palette-card" onMouseDown={(event) => event.stopPropagation()}>
        <input autoFocus placeholder="Courses, pages, assignments" value={query} aria-label="Search" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setIndex((value) => Math.min(value + 1, results.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)); }
          if (event.key === "Enter" && results[index]) go(results[index].href);
          if (event.key === "Escape") onClose();
        }} />
        <div className="results">
          {results.length === 0 && <p className="empty-line" style={{ padding: 12 }}>No matches.</p>}
          {results.map((item, i) => (
            <button key={`${item.href}-${item.label}-${i}`} type="button" className="result" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => go(item.href)}>
              {item.label}
              <small>{item.kind}</small>
            </button>
          ))}
        </div>
        <p className="note" style={{ padding: "0 12px 12px" }}>g then t, c, k, g — Today, Courses, Calendar, Grades</p>
      </div>
    </div>
  );
}
