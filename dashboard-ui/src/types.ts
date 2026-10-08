export interface SectionState {
  state?: string;
  source?: string;
  syncedAt?: string;
  stale?: boolean;
  message?: string;
  lastError?: string;
}

export interface ContentItem {
  id?: string;
  type?: string;
  title?: string;
  desc?: string;
  progress?: string;
  progressText?: string;
  verified?: boolean;
  source?: string;
  url?: string;
}

export interface UpcomingItem {
  title?: string;
  due?: string;
  status?: string;
  eventType?: string;
  verified?: boolean;
  source?: string;
}

export interface FacultyMember {
  name?: string;
  role?: string;
  verified?: boolean;
  source?: string;
}

export interface GradeItem {
  title?: string;
  due?: string;
  status?: string;
  grade?: string | null;
  possible?: number | string | null;
}

export interface Gradebook {
  verified?: boolean;
  source?: string;
  syncedAt?: string;
  empty?: boolean;
  currentGrade?: string | null;
  overallColumn?: string | null;
  overallAmbiguous?: boolean;
  items?: GradeItem[];
  itemsSynced?: boolean;
}

export interface PearsonItem {
  title?: string;
  category?: string;
  correctTotal?: string;
  asterisk?: boolean;
  scorePercent?: number | null;
  status?: string;
  timeSpent?: string;
  dateStarted?: string;
  dateWorked?: string;
}

export interface PearsonCategory {
  name?: string;
  average?: string;
  earned?: string;
  weight?: string;
}

export interface PearsonStalePart {
  part: string;
  syncedAt?: string;
}

export interface PearsonRecord {
  key?: string;
  verified?: boolean;
  source?: string;
  syncedAt?: string;
  currentGrade?: string | null;
  overallPoints?: string | null;
  matchedBy?: string;
  provider?: string;
  pearsonCourseTitle?: string;
  pageUrl?: string;
  items?: PearsonItem[];
  itemsSchema?: number;
  categories?: PearsonCategory[];
  categoryTotal?: PearsonCategory;
  breakdown?: Record<string, string>;
  parseMissing?: string[];
  staleParts?: PearsonStalePart[];
}

export interface Course {
  id: string;
  code?: string;
  title?: string;
  bbId?: string;
  color?: string;
  current?: boolean;
  termName?: string;
  status?: string;
  locked?: boolean;
  note?: string;
  home?: string;
  source?: string;
  syncedAt?: string;
  verified?: boolean;
  content?: ContentItem[] | null;
  faculty?: FacultyMember[] | null;
  facultyUnnamed?: number;
  upcoming?: UpcomingItem[] | null;
  gradebook?: Gradebook | null;
  pearson?: PearsonRecord | null;
  sections?: Record<string, SectionState>;
}

export interface SysStatus {
  state?: string;
  lastSuccessAt?: string;
  at?: string;
  source?: string;
  message?: string;
}

export interface Prefs {
  layout?: string;
  favorites?: string[];
  pearsonMap?: Record<string, string>;
  theme?: string;
}

export interface DashboardData {
  schemaVersion?: number;
  _meta?: { empty?: boolean; source?: string | null; pulled_at?: string | null };
  student?: { name?: string; verified?: boolean } | null;
  term?: string | null;
  terms?: Record<string, { name?: string; start?: string }>;
  courses: Course[];
  unmatchedPearson: PearsonRecord[];
  status: { blackboard?: SysStatus; pearson?: SysStatus };
  prefs?: Prefs;
  _noStorage?: boolean;
  _storageError?: string;
}

export interface DueRowModel {
  u: UpcomingItem;
  c: Course;
}

export interface ProvEntry {
  label: string;
  source: string;
  syncedAt?: string | null;
  notes: string[];
}
