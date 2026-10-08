"use client";

import { useState } from "react";
import { stateLabel } from "@/lib/labels";
import type { ContentNode, Course } from "@/lib/schema";
import { safeUrl } from "@/lib/safe-url";
import { formatDue, relativeDay } from "@/lib/format";
import { liveStatus } from "@/lib/view";
import { useCourse } from "./data";
import { Stamp } from "./ui";

export function ContentTree() {
  const { course, now } = useCourse();
  return (
    <div className="course-grid">
      <section className="card">
        <div className="section-head"><h2>Course content</h2>{course.contentStamp && <Stamp stamp={course.contentStamp} />}</div>
        <Tree course={course} />
      </section>
      <aside className="side">
        <section className="card">
          <h2>Due in this course</h2>
          <DueSide course={course} now={now} />
        </section>
        <section className="card">
          <h2>Faculty</h2>
          {course.instructorsState !== "ok" && course.instructorsState !== "empty" && <p className="empty-line">{stateLabel(course.instructorsState)}</p>}
          {course.instructorsState === "empty" && <p className="empty-line">No instructors returned.</p>}
          <ul className="acc">
            {course.instructors.map((person) => (
              <li key={person.name} className="acc-item">
                <div>{person.name}</div>
                <div className="due-meta">{person.role}</div>
                <Stamp stamp={person.stamp} />
              </li>
            ))}
          </ul>
          {course.instructorsUnnamed > 0 && <p className="note">{course.instructorsUnnamed} listed without a name.</p>}
        </section>
      </aside>
    </div>
  );
}

function Tree({ course }: { course: Course }) {
  if (course.contentState !== "ok" && course.contentState !== "empty" && course.contentState !== "partial") {
    return <p className="empty-line">{stateLabel(course.contentState)}</p>;
  }
  if (!course.content.length) return <p className="empty-line">No content items in this snapshot.</p>;
  return <ul className="acc">{course.content.map((node) => <Node key={node.id || node.title} node={node} />)}</ul>;
}

function Node({ node }: { node: ContentNode }) {
  const container = node.type === "folder" || node.type === "module";
  const [open, setOpen] = useState(false);
  const links = node.links.flatMap((link) => {
    const href = safeUrl(link.href);
    return href ? [{ href, text: link.text }] : [];
  });
  const primary = links[0];
  return (
    <li className="acc-item">
      <div className="acc-row">
        {container ? (
          <button type="button" className="chevron" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${node.title}`} onClick={() => setOpen((value) => !value)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        ) : <span className="chevron-spacer" />}
        <span className="type-pill">{node.type}<span className="sr-only"> item</span></span>
        {primary ? <a className="item-link" href={primary.href} target="_blank" rel="noopener noreferrer">{node.title}</a> : <span className="item-link">{node.title}</span>}
        {!primary && <span className="missing">No link in the snapshot</span>}
      </div>
      {(open || !container) && node.description && <p className="desc">{node.description}</p>}
      {links.length > 1 && (
        <div className="acc-body">
          {links.slice(1).map((link) => <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.text || "Open"}</a>)}
        </div>
      )}
      {container && open && (
        <div className="acc-body">
          {node.children && node.children.length > 0 && <ul className="acc">{node.children.map((child) => <Node key={child.id || child.title} node={child} />)}</ul>}
          {node.children && node.children.length === 0 && <p className="empty-line">No items inside.</p>}
          {node.children === null && <p className="empty-line">{stateLabel(node.childrenState)}</p>}
        </div>
      )}
    </li>
  );
}

function DueSide({ course, now }: { course: Course; now: Date }) {
  if (course.dueState !== "ok" && course.dueState !== "empty") return <p className="empty-line">{stateLabel(course.dueState)}</p>;
  const upcoming = course.due.filter((item) => liveStatus(item, now) === "due").slice(0, 4);
  if (!upcoming.length) return <p className="empty-line">Nothing upcoming in this snapshot.</p>;
  return (
    <ul className="acc">
      {upcoming.map((item) => (
        <li key={item.id} className="acc-item">
          <div>{item.title}</div>
          <div className="due-meta">{relativeDay(item.due, now)} · {formatDue(item.due)}</div>
        </li>
      ))}
    </ul>
  );
}
