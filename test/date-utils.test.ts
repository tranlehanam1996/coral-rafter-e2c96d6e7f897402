import { describe, expect, it } from "vitest";
import { daysBetween, formatIsoDate, isCalendarDay, parseRelativeDate } from "../src/core/date-utils";

describe("date utilities", () => {
  it("calculates day distance", () => {
    expect(daysBetween("2026-08-19", "2026-08-20")).toBe(1);
  });

  it("formats ISO dates", () => {
    expect(formatIsoDate(new Date("2026-08-20T12:00:00Z"))).toBe("2026-08-20");
  });

  it("accepts only real calendar dates", () => {
    expect(isCalendarDay("2026-08-20")).toBe(true);
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay(42)).toBe(false);
  });

  it("resolves relative date phrases", () => {
    expect(parseRelativeDate("today")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseRelativeDate("not a date")).toBeNull();
  });
});
