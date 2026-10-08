import type { SectionState, SourceId } from "./schema";

export function stateLabel(state: SectionState): string {
  switch (state) {
    case "ok":
      return "Synced";
    case "empty":
      return "Nothing posted";
    case "not-synced":
    case "not-fetched":
      return "Not yet synced";
    case "auth":
      return "Sign-in expired";
    case "forbidden":
      return "Not shared with student accounts";
    case "not-found":
    case "parse-failed":
    case "error":
      return "Couldn't be read";
    case "parse-partial":
    case "partial":
      return "Partly read";
  }
}

export function sourceLabel(source: SourceId): string {
  switch (source) {
    case "pearson":
      return "MyLab";
    case "blackboard-api":
      return "Blackboard";
    case "blackboard-dom":
      return "Blackboard page";
    case "student-stated":
      return "Stated";
    case "sample":
      return "Sample";
  }
}

export function availabilityLabel(value: "open" | "closed" | "not-open", source: SourceId): string {
  if (value === "open") return source === "student-stated" ? "You said this course is open" : "Open";
  if (value === "closed") return source === "student-stated" ? "You said this course is closed" : "Closed";
  return source === "student-stated" ? "You said this course is not open yet" : "Not open";
}
