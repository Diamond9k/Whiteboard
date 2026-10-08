import { z } from "zod";
import { safeUrl } from "./safe-url";

export const SCHEMA_VERSION = 1 as const;

export const sectionStateSchema = z.enum([
  "ok",
  "empty",
  "not-synced",
  "not-fetched",
  "auth",
  "forbidden",
  "not-found",
  "parse-partial",
  "parse-failed",
  "error",
  "partial",
]);
export type SectionState = z.infer<typeof sectionStateSchema>;

export const sourceSchema = z.enum([
  "pearson",
  "blackboard-api",
  "blackboard-dom",
  "student-stated",
  "sample",
]);
export type SourceId = z.infer<typeof sourceSchema>;

export const stampSchema = z.object({
  source: sourceSchema,
  at: z.string().datetime({ offset: true }),
  note: z.string().max(400).optional(),
});
export type Stamp = z.infer<typeof stampSchema>;

export function stamped<T extends z.ZodTypeAny>(value: T) {
  return z.object({ value, stamp: stampSchema });
}

const safeLink = z
  .string()
  .min(1)
  .max(2000)
  .refine((h) => safeUrl(h) !== null, "Link is not an https Blackboard or Pearson URL");

export const linkSchema = z.object({
  href: safeLink,
  text: z.string().max(200).nullable(),
});
export type LinkRef = z.infer<typeof linkSchema>;

export const nullableLink = safeLink.nullable();

export interface ContentNode {
  id: string | null;
  type: "folder" | "module" | "link" | "document" | "generic";
  title: string;
  description: string | null;
  links: LinkRef[];
  children: ContentNode[] | null;
  childrenState: SectionState;
  stamp: Stamp;
}

export const contentNodeSchema: z.ZodType<ContentNode> = z.lazy(() =>
  z.object({
    id: z.string().max(120).nullable(),
    type: z.enum(["folder", "module", "link", "document", "generic"]),
    title: z.string().min(1).max(300),
    description: z.string().max(400).nullable(),
    links: z.array(linkSchema).max(12),
    children: z.array(contentNodeSchema).nullable(),
    childrenState: sectionStateSchema,
    stamp: stampSchema,
  }),
);

export const instructorSchema = z.object({
  name: z.string().min(1).max(160),
  role: z.string().max(40),
  stamp: stampSchema,
});
export type Instructor = z.infer<typeof instructorSchema>;

export const gradeItemSchema = z.object({
  title: z.string().min(1).max(300),
  grade: z.string().max(80).nullable(),
  possible: z.number().nullable(),
  status: z.string().max(40).nullable(),
  due: z.string().datetime({ offset: true }).nullable(),
  columnId: z.string().max(120).nullable(),
  stamp: stampSchema,
});
export type GradeItem = z.infer<typeof gradeItemSchema>;

export const blackboardGradebookSchema = z.object({
  currentGrade: z.string().max(80).nullable(),
  overallColumn: z.string().max(200).nullable(),
  noOverallColumn: z.boolean(),
  overallAmbiguous: z.boolean(),
  empty: z.boolean(),
  items: z.array(gradeItemSchema).max(400),
  stamp: stampSchema,
});
export type BlackboardGradebook = z.infer<typeof blackboardGradebookSchema>;

export const mylabCategorySchema = z.object({
  name: z.string().min(1).max(120),
  average: z.string().max(40).nullable(),
  weight: z.string().max(40).nullable(),
  earned: z.string().max(40).nullable(),
  timeSpent: z.string().max(40).nullable(),
});
export type MyLabCategory = z.infer<typeof mylabCategorySchema>;

export const mylabAssignmentSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.string().max(80).nullable(),
  correctTotal: z.string().max(40).nullable(),
  correctTotalRaw: z.string().max(60).nullable(),
  scorePercent: z.number().nullable(),
  scoreRaw: z.string().max(60).nullable(),
  status: z.enum(["graded", "omitted", "incomplete"]).nullable(),
  timeSpent: z.string().max(40).nullable(),
  dateStarted: z.string().max(40).nullable(),
  dateWorked: z.string().max(40).nullable(),
  asterisk: z.boolean(),
  footnote: z.boolean(),
  links: z.array(linkSchema).max(8),
  incompleteIn: z.string().max(40).nullable(),
});
export type MyLabAssignment = z.infer<typeof mylabAssignmentSchema>;

export const mylabSchema = z.object({
  key: z.string().min(1).max(200),
  courseTitle: z.string().max(200).nullable(),
  sectionId: z.string().max(80).nullable(),
  pageUrl: nullableLink,
  matchedBy: z.string().max(240).nullable(),
  overall: z
    .object({
      percent: z.string().max(20).nullable(),
      earned: z.string().max(20).nullable(),
      total: z.string().max(20).nullable(),
      detailsPercent: z.string().max(20).nullable(),
      detailsText: z.string().max(400).nullable(),
    })
    .nullable(),
  currentGrade: z.string().max(40).nullable(),
  overallPoints: z.string().max(40).nullable(),
  categories: z.array(mylabCategorySchema).max(40),
  categoryTotal: mylabCategorySchema.nullable(),
  assignments: z.array(mylabAssignmentSchema).max(500),
  parsed: z.object({
    overall: z.boolean(),
    categories: z.boolean(),
    items: z.boolean(),
  }),
  staleParts: z.array(z.object({ part: z.string().max(40), at: z.string().nullable() })).max(8),
  viewLabel: z.string().max(80).nullable(),
  notes: z.array(z.string().max(240)).max(12),
  stamp: stampSchema,
});
export type MyLab = z.infer<typeof mylabSchema>;

export const dueSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  due: z.string().datetime({ offset: true }),
  /** true = a grade record showed a score or needs grading; false = grades were fetched and did not; null = unknown */
  submitted: z.boolean().nullable(),
  origin: z.enum(["gradebook", "calendar"]),
  eventType: z.string().max(60).nullable(),
  href: nullableLink,
  stamp: stampSchema,
});
export type DueItem = z.infer<typeof dueSchema>;

export const courseSchema = z.object({
  id: z.string().min(1).max(200),
  code: stamped(z.string().min(1).max(80)).nullable(),
  title: stamped(z.string().min(1).max(200)).nullable(),
  statedDescription: stamped(z.string().min(1).max(200)).nullable(),
  termName: stamped(z.string().min(1).max(80)).nullable(),
  availability: stamped(z.enum(["open", "closed", "not-open"])).nullable(),
  gradeHome: stamped(z.enum(["pearson", "blackboard"])).nullable(),
  role: z.string().max(40).nullable(),
  bbCourseId: z.string().max(80).nullable(),
  bbId: z.string().max(80).nullable(),
  outlineHref: nullableLink,
  mylabHref: nullableLink,
  instructors: z.array(instructorSchema).max(30),
  instructorsUnnamed: z.number().int().nonnegative(),
  instructorsState: sectionStateSchema,
  content: z.array(contentNodeSchema).max(400),
  contentState: sectionStateSchema,
  contentStamp: stampSchema.nullable(),
  blackboardGradebook: blackboardGradebookSchema.nullable(),
  blackboardGradebookState: sectionStateSchema,
  mylab: mylabSchema.nullable(),
  mylabState: sectionStateSchema,
  due: z.array(dueSchema).max(400),
  dueState: sectionStateSchema,
  dueStamp: stampSchema.nullable(),
  current: z.boolean().nullable(),
  stale: z.array(z.string().max(40)).max(12),
});
export type Course = z.infer<typeof courseSchema>;

export const systemStatusSchema = z.object({
  state: sectionStateSchema,
  lastSuccessAt: z.string().datetime({ offset: true }).nullable(),
  lastAttemptAt: z.string().datetime({ offset: true }).nullable(),
  source: z.enum(["pearson", "blackboard-api", "blackboard-dom"]).nullable(),
  message: z.string().max(400).nullable(),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

export const studentSchema = z.object({
  name: z.string().min(1).max(120),
  id: z.string().max(80).optional(),
  stamp: stampSchema,
});
export type Student = z.infer<typeof studentSchema>;

export const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(["sample", "import", "empty"]),
  importedAt: z.string().datetime({ offset: true }).nullable(),
  label: z.string().max(40).nullable(),
  student: studentSchema.nullable(),
  status: z.object({
    pearson: systemStatusSchema,
    blackboard: systemStatusSchema,
  }),
  courses: z.array(courseSchema).max(80),
  unmatchedMyLab: z.array(mylabSchema).max(40),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export function courseShell(id: string): Course {
  return {
    id,
    code: null,
    title: null,
    statedDescription: null,
    termName: null,
    availability: null,
    gradeHome: null,
    role: null,
    bbCourseId: null,
    bbId: null,
    outlineHref: null,
    mylabHref: null,
    instructors: [],
    instructorsUnnamed: 0,
    instructorsState: "not-synced",
    content: [],
    contentState: "not-synced",
    contentStamp: null,
    blackboardGradebook: null,
    blackboardGradebookState: "not-synced",
    mylab: null,
    mylabState: "not-synced",
    due: [],
    dueState: "not-synced",
    dueStamp: null,
    current: null,
    stale: [],
  };
}

export function notSyncedStatus(message: string): SystemStatus {
  return {
    state: "not-synced",
    lastSuccessAt: null,
    lastAttemptAt: null,
    source: null,
    message,
  };
}

export function emptySnapshot(): Snapshot {
  return {
    schemaVersion: 1,
    kind: "empty",
    importedAt: null,
    label: null,
    student: null,
    status: {
      pearson: notSyncedStatus("No MyLab snapshot imported."),
      blackboard: notSyncedStatus("No Blackboard snapshot imported."),
    },
    courses: [],
    unmatchedMyLab: [],
  };
}
