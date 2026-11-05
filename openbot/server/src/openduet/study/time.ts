/*
 * Days and clock times where the student is, for the scheduler, the calendar and the Classroom
 * notice parser.
 *
 * A study block lives on the student's own day ("2026-11-06") at a time on their wall clock
 * ("16:30"), and an instant only becomes a day once a time zone is named, so days and times are
 * plain strings here and instants are Dates. The zone rules come from Intl alone: no dependency and
 * no table of offsets to keep up to date.
 */

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const NOON_MS = 12 * 3_600_000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** A day's midnight as UTC milliseconds. `Date.UTC` reads years below 100 as 19xx, so not that. */
function utcDay(year: number, month: number, day: number): number {
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  return at.getTime();
}

/** "YYYY-MM-DD" as the UTC milliseconds of its midnight, or a sentence saying what is wrong. */
function dayOf(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match) {
    const [year, month, day] = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ];
    const at = utcDay(year, month, day);
    // 2026-02-30 is a real string and not a real day: it would roll over into March.
    if (new Date(at).getUTCMonth() === month - 1 && day >= 1) return at;
  }
  throw new RangeError("Use a date such as 2026-11-06.");
}

/** The UTC calendar day of an instant, as "YYYY-MM-DD". */
function dateOf(at: number): string {
  const day = new Date(at);
  return `${pad(day.getUTCFullYear(), 4)}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
}

/** Whether `value` is a real day written "YYYY-MM-DD". */
export function isDate(value: string): boolean {
  try {
    dayOf(value);
    return true;
  } catch {
    return false;
  }
}

/** "HH:mm" as minutes since midnight, from "00:00" to "24:00", the end of the day. */
export function minutesOf(time: string): number {
  const match = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):(00))$/.exec(time);
  if (!match) throw new RangeError("Use a valid time, such as 18:00.");
  if (match[3]) return 24 * 60;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since midnight as "HH:mm". 1440 is "24:00", the end of the day. */
export function clockOf(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60)
    throw new RangeError("Use a whole number of minutes from 0 to 1440.");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The day `days` after `date` (before it when negative), counted from noon UTC so no zone can move it. */
export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days))
    throw new RangeError("Add a whole number of days.");
  return dateOf(dayOf(date) + NOON_MS + days * DAY_MS);
}

/** 0 for Sunday to 6 for Saturday. */
export function weekdayOf(date: string): number {
  return new Date(dayOf(date) + NOON_MS).getUTCDay();
}

/**
 * One formatter per zone, kept: making one costs far more than using it, and the scheduler asks the
 * same zone hundreds of times a plan. Only zones Intl accepted are kept, so the map stays as small
 * as the set of real zone names.
 */
const formats = new Map<string, Intl.DateTimeFormat>();

function formatIn(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      throw new RangeError(
        `"${String(timeZone).slice(0, 100)}" is not a time zone this server knows.`,
      );
    }
    formats.set(timeZone, format);
  }
  return format;
}

/** Whether Intl knows `name` as a time zone, such as "America/Chicago" or "UTC". */
export function isTimeZone(name: string): boolean {
  if (typeof name !== "string" || name.trim() === "") return false;
  try {
    formatIn(name);
    return true;
  } catch {
    return false;
  }
}

/** The zone's wall clock at `at`, to the second, written as the UTC milliseconds of those digits. */
function wallAt(at: number, timeZone: string): number {
  const part: Record<string, number> = {};
  for (const { type, value } of formatIn(timeZone).formatToParts(at))
    part[type] = Number(value);
  // Some engines write midnight as hour 24 even with h23; it is still the start of that day.
  return (
    utcDay(part.year, part.month, part.day) +
    ((part.hour % 24) * 60 + part.minute) * MINUTE_MS +
    part.second * 1000
  );
}

export type ZonedParts = {
  /** The day where the zone is, "YYYY-MM-DD". */
  date: string;
  /** The wall-clock time there, "HH:mm". */
  time: string;
  /** Minutes since that day's midnight, 0 to 1439. */
  minute: number;
  /** 0 for Sunday to 6 for Saturday. */
  weekday: number;
};

/** What a clock in `timeZone` reads at `instant`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const at = instant.getTime();
  if (!Number.isFinite(at)) throw new RangeError("That is not a real moment.");
  const wall = wallAt(Math.floor(at / 1000) * 1000, timeZone);
  const day = new Date(wall);
  const minute = day.getUTCHours() * 60 + day.getUTCMinutes();
  return {
    date: dateOf(wall),
    time: clockOf(minute),
    minute,
    weekday: day.getUTCDay(),
  };
}

/**
 * The instant a clock in `timeZone` reads `time` on `date`. "24:00" is the next day's start.
 *
 * Intl gives a zone's wall clock at an instant, not the instant a wall-clock time falls on, so the
 * offsets a day either side are tried: across a change of offset they are the offsets before and
 * after it, and a time that one of them reads back exactly is the answer.
 *
 * Twice a year that is not one answer, and both cases are settled the way JavaScript's Temporal
 * settles them by default. When the clocks go back, 1:30 happens twice, and the first one is meant:
 * the earlier instant. When they go forward, 2:30 never happens, and it is read with the offset in
 * force before the change, which lands as far past the jump as the time was past 2:00: 3:30.
 */
export function zonedInstant(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const minutes = minutesOf(time);
  if (minutes === 24 * 60)
    return zonedInstant(addDays(date, 1), "00:00", timeZone);
  const wall = dayOf(date) + minutes * MINUTE_MS;
  const offsetAt = (at: number) => wallAt(at, timeZone) - at;
  const before = offsetAt(wall - DAY_MS);
  const after = offsetAt(wall + DAY_MS);
  const exact = [wall - before, wall - after].filter(
    (at) => wallAt(at, timeZone) === wall,
  );
  return new Date(exact.length > 0 ? Math.min(...exact) : wall - before);
}

/** "Today", "Tomorrow", or the day itself, such as "Fri, Nov 6". */
export function formatDay(date: string, today: string): string {
  const day = new Date(dayOf(date) + NOON_MS);
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return `${WEEKDAYS[day.getUTCDay()]}, ${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`;
}
