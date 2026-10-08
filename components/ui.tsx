"use client";

import { useState } from "react";
import Link from "next/link";
import { ageLabel, dateChip, formatDue, formatFullStamp, relativeDay } from "@/lib/format";
import { sourceLabel, stateLabel } from "@/lib/labels";
import type { DueItem, Snapshot, Stamp as StampType } from "@/lib/schema";
import { safeUrl } from "@/lib/safe-url";
import type { LiveDue } from "@/lib/view";
import { courseLabel, staleRead } from "@/lib/view";

export function Stamp({ stamp }: { stamp: StampType | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!stamp) return <span className="missing">Not yet synced</span>;
  const full = `${formatFullStamp(stamp.at)} (${ageLabel(stamp.at)})`;
  return (
    <span>
      <button type="button" className="stamp" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {sourceLabel(stamp.source)} · {formatFullStamp(stamp.at)}
      </button>
      {open && (
        <span className="stamp-pop">
          {full}
          {stamp.note ? ` — ${stamp.note}` : ""}
        </span>
      )}
    </span>
  );
}

export function SampleBanner() {
  return (
    <div className="banner" role="status">
      <b>SAMPLE DATA</b>
      <p>Fall 2026 course identities you stated. Grades, due dates, assignments, instructors, and links are not in this fixture.</p>
    </div>
  );
}

export function Notices({ snapshot }: { snapshot: Snapshot }) {
  const lines: string[] = [];
  const bb = snapshot.status.blackboard;
  const my = snapshot.status.pearson;
  if (bb.state === "auth") lines.push("Blackboard sign-in expired. Showing the last saved snapshot.");
  else if (bb.state === "error") lines.push(bb.message || "Blackboard couldn’t be read.");
  else if (bb.state === "partial") lines.push(bb.message || "Blackboard was partly read.");
  else if (staleRead(bb.lastSuccessAt)) lines.push(`Blackboard data is from ${formatFullStamp(bb.lastSuccessAt || "")}.`);
  if (my.state === "auth") lines.push("MyLab sign-in expired. Showing the last saved snapshot.");
  else if (my.state === "parse-partial" || my.state === "partial") lines.push(my.message || "MyLab was partly read.");
  else if (my.state === "parse-failed" || my.state === "error") lines.push(my.message || "MyLab couldn’t be read.");
  if (!lines.length) return null;
  return <div className="notice">{lines.join(" ")}</div>;
}

export function Freshness({ snapshot, mode }: { snapshot: Snapshot; mode: string }) {
  const [open, setOpen] = useState(false);
  const label = mode === "sample"
    ? "Sample fixture · not a sync"
    : mode === "empty"
      ? "Nothing synced"
      : [bit("MyLab", snapshot.status.pearson), bit("Blackboard", snapshot.status.blackboard)].join(" · ");
  return (
    <div className="fresh">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{label}</button>
      {open && (
        <div className="fresh-panel">
          <SystemDetail name="MyLab" status={snapshot.status.pearson} />
          <SystemDetail name="Blackboard" status={snapshot.status.blackboard} />
          <p><Link href="/import">Import a snapshot</Link> · <Link href="/diagnostics">Diagnostics</Link></p>
        </div>
      )}
    </div>
  );
}

function bit(name: string, status: Snapshot["status"]["pearson"]): string {
  if (!status.lastSuccessAt) return `${name} ${stateLabel(status.state).toLowerCase()}`;
  const stale = status.state === "auth" || status.state === "error" || staleRead(status.lastSuccessAt);
  return `${name} ${formatFullStamp(status.lastSuccessAt).replace(/, \d{4}/, "")}${stale ? ` · ${stateLabel(status.state).toLowerCase()}` : ` · ${ageLabel(status.lastSuccessAt)}`}`;
}

function SystemDetail({ name, status }: { name: string; status: Snapshot["status"]["pearson"] }) {
  return (
    <p>
      <strong>{name}.</strong> {stateLabel(status.state)}
      {status.lastSuccessAt ? ` Last success ${formatFullStamp(status.lastSuccessAt)} (${ageLabel(status.lastSuccessAt)}).` : " No successful read."}
      {status.lastAttemptAt ? ` Last attempt ${formatFullStamp(status.lastAttemptAt)}.` : ""}
      {status.message ? ` ${status.message}` : ""}
    </p>
  );
}

export function PageHead({ kicker, title, snapshot, mode, children }: { kicker?: string; title: string; snapshot: Snapshot; mode: string; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h1>{title}</h1>
        {children}
      </div>
      <div className="page-head-side">
        <Freshness snapshot={snapshot} mode={mode} />
      </div>
    </header>
  );
}

export function DateChip({ iso }: { iso: string }) {
  const chip = dateChip(iso);
  if (!chip) return null;
  return (
    <span className="datechip">
      <span className="mo">{chip.month}</span>
      <span className="dy">{chip.day}</span>
      <span className="wd">{chip.weekday}</span>
    </span>
  );
}

export function DueRows({ items, snapshot, now }: { items: LiveDue[]; snapshot: Snapshot; now: Date }) {
  if (!items.length) return <p className="empty-line">None.</p>;
  return (
    <ul className="due-list">
      {items.map((item) => <DueRow key={item.id} item={item} snapshot={snapshot} now={now} />)}
    </ul>
  );
}

export function DueRow({ item, snapshot, now }: { item: LiveDue | (DueItem & { courseId: string; live: LiveDue["live"] }); snapshot: Snapshot; now: Date }) {
  const course = snapshot.courses.find((entry) => entry.id === item.courseId);
  const href = item.href ? safeUrl(item.href) : null;
  const unknown = item.live === "past";
  const stale = staleRead(item.stamp.at, now.getTime()) || item.stamp.source === "blackboard-api" && (snapshot.status.blackboard.state === "auth" || snapshot.status.blackboard.state === "error");
  return (
    <li className="due-row">
      <DateChip iso={item.due} />
      <div>
        <div className="due-title">{href ? <a href={href} target="_blank" rel="noopener noreferrer">{item.title}</a> : item.title}</div>
        <div className="due-meta">
          {course ? courseLabel(course) : "Course"} · {formatDue(item.due)} · {relativeDay(item.due, now)}
          {item.live === "submitted" ? " · Submitted" : ""}
          {item.live === "overdue" ? " · Past due" : ""}
          {unknown ? " · Past due · status unknown since last sync" : ""}
          {stale && item.live !== "due" ? ` (${formatFullStamp(item.stamp.at)})` : ""}
        </div>
      </div>
    </li>
  );
}

export function OpenLink({ href, text, empty }: { href: string | null | undefined; text: string; empty: string }) {
  const safe = href ? safeUrl(href) : null;
  if (!safe) return <span className="missing">{empty}</span>;
  return <a className="btn" href={safe} target="_blank" rel="noopener noreferrer">{text}</a>;
}
