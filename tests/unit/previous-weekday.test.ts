import { describe, expect, it } from "vitest";
import { previousWeekday } from "@/lib/dates/paris";

describe("previousWeekday", () => {
  it.each([
    ["2026-11-23", "2026-11-20"], // Monday
    ["2026-11-22", "2026-11-20"], // Sunday
    ["2026-11-21", "2026-11-20"], // Saturday
    ["2026-11-20", "2026-11-19"], // Friday
    ["2026-01-01", "2025-12-31"],
  ])("gives the weekday before %s: %s", (date, expected) => {
    expect(previousWeekday(date)).toBe(expected);
  });
});
