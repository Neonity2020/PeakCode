/**
 * Schedule maths: the wall-clock conversions, the next-instant search, and the guard rails
 * around invalid input. Ported from OmniStudio's automation tests, plus the daily/weekly
 * cases that the UI relies on for its defaults.
 */
import { describe, expect, test } from "vitest";

import {
  computeNextRunAt,
  describeSchedule,
  isValidTimeZone,
  resolveTimeZone,
  timezoneOffsetMs,
  zonedParts,
  zonedTimeToUtc,
} from "./automationSchedule";

const SHANGHAI = "Asia/Shanghai";
const NEW_YORK = "America/New_York";

describe("zonedTimeToUtc / zonedParts", () => {
  test("converts a Shanghai wall clock (UTC+8) both ways", () => {
    const ts = zonedTimeToUtc(2026, 3, 10, 9, 30, SHANGHAI);
    expect(new Date(ts).toISOString()).toBe("2026-03-10T01:30:00.000Z");
    const parts = zonedParts(ts, SHANGHAI);
    expect([parts.year, parts.month, parts.day, parts.hour, parts.minute]).toEqual([
      2026, 3, 10, 9, 30,
    ]);
  });

  test("keeps wall-clock times stable across a daylight-saving switch", () => {
    // 2026-03-08 is the day US Eastern switches to EDT (UTC-4).
    const before = zonedTimeToUtc(2026, 3, 8, 1, 0, NEW_YORK);
    expect(new Date(before).toISOString()).toBe("2026-03-08T06:00:00.000Z");
    const after = zonedTimeToUtc(2026, 3, 8, 12, 0, NEW_YORK);
    expect(new Date(after).toISOString()).toBe("2026-03-08T16:00:00.000Z");
  });

  test("reports the offset it used", () => {
    expect(timezoneOffsetMs(Date.parse("2026-01-15T00:00:00Z"), SHANGHAI)).toBe(8 * 3_600_000);
    expect(timezoneOffsetMs(Date.parse("2026-01-15T00:00:00Z"), NEW_YORK)).toBe(-5 * 3_600_000);
  });

  test("carries the weekday with the wall clock", () => {
    // 2026-05-01 is a Friday.
    expect(zonedParts(Date.parse("2026-05-01T04:00:00Z"), SHANGHAI).weekday).toBe(5);
  });
});

describe("computeNextRunAt", () => {
  test("daily: today when the time is still ahead, otherwise tomorrow", () => {
    const morning = zonedTimeToUtc(2026, 5, 1, 8, 0, SHANGHAI);
    const today = computeNextRunAt({ kind: "daily", hour: 9, minute: 30 }, SHANGHAI, morning);
    expect(zonedParts(today!, SHANGHAI)).toMatchObject({ day: 1, hour: 9, minute: 30 });

    const evening = zonedTimeToUtc(2026, 5, 1, 10, 0, SHANGHAI);
    const tomorrow = computeNextRunAt({ kind: "daily", hour: 9, minute: 30 }, SHANGHAI, evening);
    expect(zonedParts(tomorrow!, SHANGHAI).day).toBe(2);
  });

  test("weekly: only the selected weekdays, starting from the next one", () => {
    const friday = zonedTimeToUtc(2026, 5, 1, 10, 0, SHANGHAI);
    const next = computeNextRunAt(
      { kind: "weekly", hour: 8, minute: 0, daysOfWeek: [1, 3] },
      SHANGHAI,
      friday,
    );
    expect(zonedParts(next!, SHANGHAI)).toMatchObject({
      month: 5,
      day: 4,
      weekday: 1,
      hour: 8,
    });
  });

  test("weekly: today counts when the time has not passed yet", () => {
    const mondayMorning = zonedTimeToUtc(2026, 5, 4, 7, 0, SHANGHAI);
    const next = computeNextRunAt(
      { kind: "weekly", hour: 8, minute: 0, daysOfWeek: [1] },
      SHANGHAI,
      mondayMorning,
    );
    expect(zonedParts(next!, SHANGHAI).day).toBe(4);
  });

  test("weekly: a plan with no weekdays never fires instead of looping", () => {
    expect(
      computeNextRunAt(
        { kind: "weekly", hour: 8, minute: 0, daysOfWeek: [] },
        SHANGHAI,
        Date.now(),
      ),
    ).toBeNull();
  });

  test("once: the planned instant, but not once it is behind us", () => {
    const from = Date.parse("2026-05-01T00:00:00Z");
    const at = "2026-05-01T06:00:00.000Z";
    expect(computeNextRunAt({ kind: "once", at }, SHANGHAI, from)).toBe(Date.parse(at));
    expect(
      computeNextRunAt({ kind: "once", at: "2026-04-30T06:00:00.000Z" }, SHANGHAI, from),
    ).toBeNull();
    expect(computeNextRunAt({ kind: "once", at: "not-a-date" }, SHANGHAI, from)).toBeNull();
  });

  test("an unusable timezone yields no instant instead of throwing", () => {
    expect(
      computeNextRunAt({ kind: "daily", hour: 9, minute: 0 }, "Mars/Olympus", Date.now()),
    ).toBeNull();
  });

  test("the instant is always in the future", () => {
    const from = Date.parse("2026-05-01T00:00:00Z");
    const next = computeNextRunAt({ kind: "daily", hour: 0, minute: 0 }, SHANGHAI, from);
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(from);
  });
});

describe("timezone validation", () => {
  test("accepts IANA names and rejects the rest", () => {
    expect(isValidTimeZone(SHANGHAI)).toBe(true);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  test("falls back to the machine's zone when the request is unusable", () => {
    expect(resolveTimeZone(SHANGHAI)).toBe(SHANGHAI);
    expect(resolveTimeZone("  ")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(resolveTimeZone(undefined)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("describeSchedule", () => {
  test("reads back the three plan shapes", () => {
    expect(describeSchedule({ kind: "daily", hour: 9, minute: 5 })).toBe("daily at 09:05");
    expect(describeSchedule({ kind: "weekly", hour: 18, minute: 0, daysOfWeek: [3, 1] })).toBe(
      "weekly at 18:00 on Mon,Wed",
    );
    expect(describeSchedule({ kind: "once", at: "2026-01-01T09:00:00.000Z" })).toContain("once at");
  });

  test("flags a broken one-off instead of printing a bogus time", () => {
    expect(describeSchedule({ kind: "once", at: "nonsense" })).toContain("invalid");
  });
});
