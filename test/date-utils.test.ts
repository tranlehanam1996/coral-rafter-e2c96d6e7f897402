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

  it("returns null for relative dates that overflow the calendar", () => {
    expect(parseRelativeDate("in 999999999 days")).toBeNull();
  });

  it("resolves next weekday to a UTC calendar day matching that weekday", () => {
    const result = parseRelativeDate("next monday");
    expect(result).not.toBeNull();
    expect(new Date(`${result}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("resolves tomorrow to the following UTC calendar day", () => {
    const today = parseRelativeDate("today")!;
    const tomorrow = parseRelativeDate("tomorrow")!;
    expect(daysBetween(today, tomorrow)).toBe(1);
  });

  it("resolves yesterday to the previous UTC calendar day", () => {
    const today = parseRelativeDate("today")!;
    const yesterday = parseRelativeDate("yesterday")!;
    expect(daysBetween(yesterday, today)).toBe(1);
  });

  it("resolves in N days", () => {
    const today = parseRelativeDate("today")!;
    const later = parseRelativeDate("in 3 days")!;
    expect(daysBetween(today, later)).toBe(3);
  });

  it("resolves in N weeks", () => {
    const today = parseRelativeDate("today")!;
    const later = parseRelativeDate("in 2 weeks")!;
    expect(daysBetween(today, later)).toBe(14);
  });
});
