"use client";

import { CourseFrame } from "@/components/CourseFrame";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <CourseFrame>{children}</CourseFrame>;
}
