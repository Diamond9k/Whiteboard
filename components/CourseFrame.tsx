"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { availabilityLabel } from "@/lib/labels";
import { courseLabel } from "@/lib/view";
import { CourseProvider, Gate } from "./data";
import { OpenLink, Stamp } from "./ui";

const TABS = [
  { slug: "", label: "Content" },
  { slug: "/gradebook", label: "Gradebook" },
  { slug: "/calendar", label: "Calendar" },
  { slug: "/announcements", label: "Announcements" },
  { slug: "/discussions", label: "Discussions" },
  { slug: "/messages", label: "Messages" },
  { slug: "/groups", label: "Groups" },
];

export function CourseFrame({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  return (
    <Gate>{(snapshot, now) => {
      const course = snapshot.courses.find((item) => item.id === id);
      if (!course) {
        return (
          <section className="card">
            <h2>This course is not in the snapshot.</h2>
            <p className="note"><Link href="/courses">Back to courses</Link></p>
          </section>
        );
      }
      return (
        <CourseProvider course={course} now={now}>
          <Frame id={id}>{children}</Frame>
        </CourseProvider>
      );
    }}</Gate>
  );
}

function Frame({ id, children }: { id: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/courses/${encodeURIComponent(id)}`;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key !== "[" && event.key !== "]") return;
      const index = TABS.findIndex((tab) => pathname === base + tab.slug);
      if (index < 0) return;
      const next = event.key === "]" ? (index + 1) % TABS.length : (index - 1 + TABS.length) % TABS.length;
      router.push(base + TABS[next].slug);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname, router, base]);

  return (
    <Gate>{(snapshot) => {
      const course = snapshot.courses.find((item) => item.id === id);
      if (!course) return null;
      return (
        <>
          <header className="course-head">
            <p className="crumbs"><Link href="/courses">Courses</Link> / {courseLabel(course)}</p>
            <div className="title-row">
              <div>
                <h1>{courseLabel(course)}</h1>
                <p className="sub">{course.title?.value || "Official title not synced"}</p>
                {course.statedDescription && <p className="note">{course.statedDescription.value} <Stamp stamp={course.statedDescription.stamp} /></p>}
                <p className="note">{course.title && <Stamp stamp={course.title.stamp} />} {course.code && course.title?.stamp !== course.code.stamp && <Stamp stamp={course.code.stamp} />}</p>
                {course.availability && <p className="note">{availabilityLabel(course.availability.value, course.availability.stamp.source)} <Stamp stamp={course.availability.stamp} /></p>}
                {course.stale.length > 0 && <p className="note">Kept from an earlier read: {course.stale.join(", ")}.</p>}
              </div>
              <div className="actions">
                <OpenLink href={course.outlineHref} text="Open course in Blackboard" empty="No Blackboard link in the snapshot" />
                {(course.mylabHref || course.mylab || course.gradeHome?.value === "pearson") && (
                  <OpenLink href={course.mylabHref} text="Open MyLab results" empty="No MyLab link in the snapshot" />
                )}
              </div>
            </div>
            <nav className="tabs" aria-label="Course">
              {TABS.map((tab) => {
                const href = base + tab.slug;
                const current = pathname === href;
                return <Link key={tab.label} href={href} aria-current={current ? "page" : undefined}>{tab.label}</Link>;
              })}
            </nav>
          </header>
          {children}
        </>
      );
    }}</Gate>
  );
}
