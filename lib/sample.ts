import raw from "@/fixtures/sample.json";
import { snapshotSchema, type Snapshot } from "./schema";

/** Dev-only roster. Course identities the student stated. No grades, dates, links, or assignments. */
export const sampleSnapshot: Snapshot = snapshotSchema.parse(raw);
