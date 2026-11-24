// US #27 — the pure rule telling whether today's brief is missing (CLAUDE.md §2).
//
// Contract: `src/lib/briefs/missing.ts` exports `missingBriefAt(now, published)`, where `published`
// says whether a `published` daily / weekly brief dated Paris today exists. In Europe/Paris time:
// Monday to Friday from 08:00 without a daily brief -> "daily"; Saturday from 10:00 without a
// weekly brief -> "weekly"; before those hours, on Sunday, or when the brief is there -> null.
import { describe, expect, it } from "vitest";
import { missingBriefAt } from "../../src/lib/briefs/missing";

const NONE = { daily: false, weekly: false };

describe("US #27 — missingBriefAt", () => {
  it("C1 — given a winter weekday (UTC+1) with no brief, when it is 07:59 in Paris, then nothing is missing yet", () => {
    expect(missingBriefAt(new Date("2026-11-23T06:59:00Z"), NONE)).toBeNull();
  });

  it("C1 — given a winter weekday (UTC+1) with no brief, when it is 08:00 in Paris, then the daily brief is missing", () => {
    expect(missingBriefAt(new Date("2026-11-23T07:00:00Z"), NONE)).toBe("daily");
  });

  it("C1 — given a summer weekday (UTC+2) with no brief, when it is 07:59 in Paris, then nothing is missing yet", () => {
    expect(missingBriefAt(new Date("2026-06-22T05:59:00Z"), NONE)).toBeNull();
  });

  it("C1 — given a summer weekday (UTC+2) with no brief, when it is 08:00 in Paris, then the daily brief is missing", () => {
    expect(missingBriefAt(new Date("2026-06-22T06:00:00Z"), NONE)).toBe("daily");
  });

  it("C1 — given every weekday, when it is 09:00 in Paris with no brief, then the daily brief is missing", () => {
    for (const day of ["23", "24", "25", "26", "27"]) {
      expect(missingBriefAt(new Date(`2026-11-${day}T08:00:00Z`), NONE), day).toBe("daily");
    }
  });

  it("C1 — given a weekday after 08:00, when a weekly is published but no daily, then the daily brief is still missing", () => {
    expect(missingBriefAt(new Date("2026-11-24T08:00:00Z"), { daily: false, weekly: true })).toBe("daily");
  });

  it("C3 — given a weekday after 08:00, when the daily brief is published, then nothing is missing", () => {
    expect(missingBriefAt(new Date("2026-11-24T08:00:00Z"), { daily: true, weekly: false })).toBeNull();
  });

  it("C1 — given a late evening Paris time that is already the next UTC day, when no brief, then the Paris weekday counts", () => {
    // Friday 23:30 in Paris (UTC+1) is still Friday, whereas Sunday 23:30 Paris is Sunday.
    expect(missingBriefAt(new Date("2026-11-27T22:30:00Z"), NONE)).toBe("daily");
    expect(missingBriefAt(new Date("2026-11-22T22:30:00Z"), NONE)).toBeNull();
  });

  it("C2 — given a winter Saturday with no recap, when it is 09:59 then 10:00 in Paris, then the recap is missing from 10:00", () => {
    expect(missingBriefAt(new Date("2026-11-21T08:59:00Z"), NONE)).toBeNull();
    expect(missingBriefAt(new Date("2026-11-21T09:00:00Z"), NONE)).toBe("weekly");
  });

  it("C2 — given a summer Saturday with no recap, when it is 09:59 then 10:00 in Paris, then the recap is missing from 10:00", () => {
    expect(missingBriefAt(new Date("2026-06-20T07:59:00Z"), NONE)).toBeNull();
    expect(missingBriefAt(new Date("2026-06-20T08:00:00Z"), NONE)).toBe("weekly");
  });

  it("C2 — given a Saturday after 10:00, when only a daily brief is published, then the recap is still missing", () => {
    expect(missingBriefAt(new Date("2026-11-21T10:00:00Z"), { daily: true, weekly: false })).toBe("weekly");
  });

  it("C3 — given a Saturday after 10:00, when the recap is published, then nothing is missing", () => {
    expect(missingBriefAt(new Date("2026-11-21T10:00:00Z"), { daily: false, weekly: true })).toBeNull();
  });

  it("C4 — given a Sunday, when it is any hour in Paris with no brief, then nothing is missing", () => {
    for (const hour of ["00", "08", "10", "12", "20"]) {
      expect(missingBriefAt(new Date(`2026-11-22T${hour}:00:00Z`), NONE), hour).toBeNull();
    }
  });
});
