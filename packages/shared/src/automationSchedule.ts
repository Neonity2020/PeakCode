/**
 * Schedule math for automations.
 *
 * Ported from OmniStudio's `automations.ts`. A plan is either **once** (a single
 * instant), **daily** or **weekly**, and the daily/weekly times are *wall-clock*
 * times in an IANA timezone — "every day at 09:00" keeps meaning 09:00 local
 * across a daylight-saving switch, which is what a person writing the schedule
 * expects.
 *
 * Everything in this module is pure: the server's scheduler computes the next
 * run from it, and the UI reads the same definitions to describe a plan.
 */
import type { AutomationSchedule } from "@peakcode/contracts";

/** Milliseconds in a day; the daily/weekly search walks whole wall-clock days. */
const DAY_MS = 86_400_000;

export interface ZonedDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekday: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timezone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  formatterCache.set(timezone, formatter);
  return formatter;
};

/** True when `timezone` is an IANA zone name `Intl` can resolve. */
export function isValidTimeZone(timezone: string): boolean {
  const trimmed = timezone.trim();
  if (trimmed.length === 0) return false;
  try {
    formatterFor(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * The timezone to store for a plan: the caller's choice when it is a real IANA
 * zone, otherwise the server's own zone (never an invalid value, which would
 * make every later schedule computation throw).
 */
export function resolveTimeZone(timezone: string | undefined): string {
  if (timezone !== undefined && isValidTimeZone(timezone)) return timezone.trim();
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return local !== undefined && isValidTimeZone(local) ? local : "UTC";
}

/** The offset of `timezone` from UTC at `ts`, in milliseconds. */
export function timezoneOffsetMs(ts: number, timezone: string): number {
  const parts = formatterFor(timezone).formatToParts(new Date(ts));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  // `h23` should never hand back 24, but a bogus hour would silently shift a plan
  // by a day, so clamp it the same way the original did.
  const hour = read("hour") % 24;
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second"),
  );
  return asUtc - (ts - (ts % 1000));
}

/**
 * The instant at which `timezone`'s wall clock reads the given date and time.
 *
 * Two passes: the first guess uses the offset at the naive timestamp, the second
 * corrects using the offset at that guess, which is enough to land on the right
 * side of a daylight-saving switch. A wall-clock time that does not exist
 * (the skipped hour) resolves to the instant right after the switch.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - timezoneOffsetMs(guess, timezone);
  return guess - timezoneOffsetMs(first, timezone);
}

/** The wall clock in `timezone` at `ts`, plus the weekday it falls on. */
export function zonedParts(ts: number, timezone: string): ZonedDateParts {
  const parts = formatterFor(timezone).formatToParts(new Date(ts));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const year = read("year");
  const month = read("month");
  const day = read("day");
  return {
    year,
    month,
    day,
    hour: read("hour") % 24,
    minute: read("minute"),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

function isOnceSchedule(
  schedule: AutomationSchedule,
): schedule is Extract<AutomationSchedule, { kind: "once" }> {
  return schedule.kind === "once";
}

/**
 * The next instant `schedule` fires, or null when it will never fire again.
 *
 * - **once**: the planned instant, or null once it is in the past.
 * - **daily**: today's wall-clock time, or tomorrow's when today's has passed.
 * - **weekly**: the next selected weekday at that wall-clock time.
 *
 * The daily/weekly search walks at most a week of wall-clock days, so an empty
 * weekday selection (which the UI never produces) yields null instead of looping.
 */
export function computeNextRunAt(
  schedule: AutomationSchedule,
  timezone: string,
  from: number = Date.now(),
): number | null {
  if (!isValidTimeZone(timezone)) return null;

  if (isOnceSchedule(schedule)) {
    const at = Date.parse(schedule.at);
    return Number.isFinite(at) && at > from ? at : null;
  }

  const start = zonedParts(from, timezone);
  // Probe at noon: far enough from midnight that adding whole days cannot land on
  // the previous or next wall-clock date.
  const noon = zonedTimeToUtc(start.year, start.month, start.day, 12, 0, timezone);
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = zonedParts(noon + offset * DAY_MS, timezone);
    if (schedule.kind === "weekly" && !schedule.daysOfWeek.includes(day.weekday)) continue;
    const candidate = zonedTimeToUtc(
      day.year,
      day.month,
      day.day,
      schedule.hour,
      schedule.minute,
      timezone,
    );
    if (candidate > from) return candidate;
  }
  return null;
}

const pad = (value: number) => String(value).padStart(2, "0");

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * A short, locale-neutral description of a plan (`daily 09:00 Mon-Fri`).
 *
 * The UI builds its own localized labels; this one is for logs and for agent tool
 * results, where a fixed phrasing reads better than the server's locale.
 */
export function describeSchedule(schedule: AutomationSchedule): string {
  if (isOnceSchedule(schedule)) {
    const at = Date.parse(schedule.at);
    return Number.isFinite(at) ? `once at ${new Date(at).toISOString()}` : "once (invalid time)";
  }
  const time = `${pad(schedule.hour)}:${pad(schedule.minute)}`;
  if (schedule.kind === "daily") return `daily at ${time}`;
  const days = [...schedule.daysOfWeek]
    .toSorted((left, right) => left - right)
    .map((day) => WEEKDAY_NAMES[day] ?? "?")
    .join(",");
  return days.length > 0 ? `weekly at ${time} on ${days}` : `weekly at ${time} (no days selected)`;
}
