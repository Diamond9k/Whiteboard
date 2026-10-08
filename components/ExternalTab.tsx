"use client";

import { useCourse } from "./data";
import { OpenLink } from "./ui";

const COPY: Record<string, string> = {
  announcements: "Announcements are not in this snapshot. The collector does not read them.",
  discussions: "Discussions are not in this snapshot. The collector does not read them.",
  messages: "Messages are not in this snapshot. The collector does not read them.",
  groups: "Groups are not in this snapshot. The collector does not read them.",
};

export function ExternalTab({ tab }: { tab: keyof typeof COPY }) {
  const { course } = useCourse();
  return (
    <section className="card">
      <h2>{tab[0].toUpperCase() + tab.slice(1)}</h2>
      <p className="empty-line">{COPY[tab]}</p>
      <div className="actions" style={{ marginTop: 12 }}>
        <OpenLink href={course.outlineHref} text="Open course in Blackboard" empty="No Blackboard link in the snapshot" />
      </div>
    </section>
  );
}
