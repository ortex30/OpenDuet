import { readConnectPrompt } from "@openbot/shared/connect-prompt";
import type {
  CalendarAllDay,
  CalendarEvent,
  SchoolClass,
} from "@openbot/shared/study";
import { z } from "zod";
import { CALENDAR_LIST, type CallTool } from "../brief";
import type { StudyContext } from "./contracts";
import { normaliseName } from "./rules";
import {
  addDays,
  clockOf,
  isDate,
  isTimeZone,
  weekdayOf,
  zonedInstant,
  zonedParts,
} from "./time";

/*
 * The student's Google Calendar for a run of their own days, read the way the plan tool, Apply and
 * the Calendar tab need it: each timed event clipped to each local day it touches, in "HH:mm" on
 * the student's wall clock; each all-day event once for every day it covers; and anything that
 * could not be read said in a sentence the student can act on, never thrown.
 *
 * ONE REQUEST PER DAY. calendar_list_events answers at most 50 events a call, and a school week
 * holds more than that (the demo student's holds about 61), so a week asked for in one call loses
 * its last days without a word. One day is far from 50, and each day's answer is still checked
 * against the cap, so a day that is somehow that full says so.
 *
 * Read through the plugin store as the student and under the Bot's grants, as the school sync and
 * the morning brief read it, so it only ever sees what this Bot was given and this student connected.
 */

/** The most calendar_list_events answers in one call (google-workspace-rest.ts MAX_RESULTS). */
export const EVENTS_PER_CALL = 50;

/** Days asked for at once: quick, and well inside Calendar's per-user rate. */
const DAYS_AT_ONCE = 4;

/** The longest run of days read in one go: the Calendar tab asks for two weeks at most. */
const MOST_DAYS = 31;

/** Long enough for any real title or room, short enough that a pasted essay can't fill a card. */
const MOST_TEXT = 200;

const MINUTE_MS = 60_000;

export type CalendarRange = {
  /** The first and last of the student's own days to read, "YYYY-MM-DD", both included. */
  from: string;
  to: string;
};

export type CalendarRead = {
  /** The zone the days and times are in: the one given, the calendar's own, or UTC when unknown. */
  timeZone: string;
  events: CalendarEvent[];
  allDay: CalendarAllDay[];
  /** What could not be read and what to do about it, in words for the student. */
  couldNotRead: string[];
};

/** calendar_list_events' answer: only the parts read here. */
const answerSchema = z.object({
  timeZone: z.string().optional(),
  note: z.string().optional(),
  events: z
    .array(
      z.object({
        id: z.string().default(""),
        summary: z.string().default("(no title)"),
        start: z.string().default(""),
        end: z.string().default(""),
        location: z.string().optional(),
        status: z.string().optional(),
      }),
    )
    .default([]),
});

type Listed = z.infer<typeof answerSchema>["events"][number];

type Answer = { ok: true; text: string } | { ok: false; text: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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

/** "Thu Nov 5": no comma, so a list of days reads as a list. */
function dayName(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(date)]} ${MONTHS[(month ?? 1) - 1]} ${day}`;
}

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function clipped(text: string): string {
  const words = text.replace(/\s+/g, " ").trim();
  return words.length > MOST_TEXT ? `${words.slice(0, MOST_TEXT - 1)}…` : words;
}

/**
 * The sentence for calendar days that could not be read: what was lost and what the student can do
 * about it. A refusal carrying a Connect card names its reason; a Bot without the tool is an admin's
 * to fix; anything else is said in Google's or the plugin store's own words. The same wording the
 * school sync uses for Gmail (school.ts), so the two read as one voice on the screen.
 */
function unreadable(text: string, what: string): string {
  const bare = text.replace(/^Refused\.\s*/, "");
  const prompt = readConnectPrompt(bare);
  if (prompt?.reason === "reconnect")
    return `Google Calendar needs reconnecting, so ${what} couldn't be read. Reconnect Google on the Connections page.`;
  if (prompt?.reason === "shared")
    return `The shared Google account isn't connected, so ${what} couldn't be read. An admin has to connect it.`;
  if (prompt)
    return `Google Calendar isn't connected, so ${what} couldn't be read. Connect Google on the Connections page.`;
  if (/has not been given the tool/i.test(bare))
    return `This Bot hasn't been given Google Calendar, so ${what} couldn't be read. Google Calendar needs to be turned on for this coach.`;
  const reason = bare.replace(/\s+/g, " ").trim();
  const said = reason.length > 300 ? `${reason.slice(0, 299)}…` : reason;
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} couldn't be read from Google Calendar.${said ? ` ${said}` : ""}`;
}

/** Up to `limit` of these at once, answers in the order asked. */
async function inParallel<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let index = next++; index < items.length; index = next++)
        results[index] = await work(items[index] as T);
    }),
  );
  return results;
}

function wordsOf(text: string): string[] {
  const normalised = normaliseName(text);
  return normalised.length > 0 ? normalised.split(" ") : [];
}

/** Where `needle` first runs, whole words, inside `haystack`; -1 when it does not. */
function runAt(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0) return -1;
  for (let start = 0; start + needle.length <= haystack.length; start++)
    if (needle.every((word, offset) => haystack[start + offset] === word))
      return start;
  return -1;
}

/**
 * The class an event belongs to, when its title names one: "Chemistry (Dr. Okoro)" is Chemistry.
 * Whole words only, so "Chem lab help" is nobody's and "Art" is not inside "Smart board". A name at
 * the start of the title beats one later in it, and the longer of two names wins where one holds the
 * other, so "AP Chemistry (Ms. Lee)" is AP Chemistry beside Chemistry.
 */
function classOf(
  title: string,
  classes: readonly { id: string; words: string[] }[],
): string | undefined {
  const words = wordsOf(title);
  let best: { id: string; at: number; length: number } | null = null;
  for (const schoolClass of classes) {
    const at = runAt(words, schoolClass.words);
    if (at < 0) continue;
    if (
      !best ||
      at < best.at ||
      (at === best.at && schoolClass.words.length > best.length)
    )
      best = { id: schoolClass.id, at, length: schoolClass.words.length };
  }
  return best?.id;
}

/**
 * The part of a timed event on one local day, as wall-clock times: clipped at the day's midnights,
 * with "24:00" for an end at the next one. Null when the event does not touch the day.
 */
function pieceOn(
  day: { start: number; end: number },
  startAt: number,
  endAt: number,
  timeZone: string,
): { start: string; end: string } | null {
  const from = Math.max(startAt, day.start);
  const to = Math.min(endAt, day.end);
  if (to - from < MINUTE_MS) return null;
  const first = zonedParts(new Date(from), timeZone);
  const start = from === day.start ? "00:00" : first.time;
  if (to === day.end) return { start, end: "24:00" };
  const at = from === day.start ? 0 : first.minute;
  const until = zonedParts(new Date(to), timeZone).minute;
  /*
   * Only the night the clocks go back can an end read earlier than its start on one day: 1:30 to
   * 1:15 is three quarters of an hour across the change. It keeps its real length rather than vanish.
   */
  const end =
    until > at
      ? until
      : Math.min(24 * 60, at + Math.round((to - from) / MINUTE_MS));
  return { start, end: clockOf(end) };
}

/** Whether an all-day event, from `start` up to the day before `end`, covers `date`. */
function coversDay(start: string, end: string, date: string): boolean {
  // Google's end is the day after the last one. A missing or backwards end is the start day alone.
  const last = isDate(end) && end > start ? addDays(end, -1) : start;
  return start <= date && date <= last;
}

/**
 * Reads the student's calendar for `range`, a day at a time. `timeZone` is the zone to read the days
 * in, from the student's Classroom snapshot when there is one; without it the calendar is asked for
 * its own. `classes` lets each event be matched to a class by its title.
 *
 * Never throws for something Google or the plugin store said: that is a `couldNotRead` sentence.
 * Throws only for a range that is not one, which is the caller's to check.
 */
export async function readCalendar(
  callTool: CallTool,
  context: StudyContext,
  range: CalendarRange,
  options: { timeZone?: string; classes?: SchoolClass[] } = {},
): Promise<CalendarRead> {
  const { from, to } = range;
  if (!isDate(from) || !isDate(to) || from > to)
    throw new RangeError("Read the calendar for a real range of days.");
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(day);
    if (days.length > MOST_DAYS)
      throw new RangeError(`Read at most ${MOST_DAYS} days at a time.`);
  }

  const ask = async (args: Record<string, unknown>): Promise<Answer> => {
    try {
      const result = await callTool({
        ref: CALENDAR_LIST,
        args,
        botId: context.botId,
        actorId: context.actorId,
        initiator: context.initiator,
      });
      return { ok: !result.isError, text: result.text };
    } catch (error) {
      // The plugin store refuses by throwing: not connected, not granted, a policy.
      return {
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const couldNotRead: string[] = [];

  let timeZone = options.timeZone;
  if (timeZone === undefined || !isTimeZone(timeZone)) {
    // Asked with no timeMax, the calendar names its own zone. One event is plenty for that.
    const answer = await ask({ maxResults: 1 });
    if (!answer.ok) {
      // A calendar that will not say its zone will not list its days either: say it once.
      return {
        timeZone: "UTC",
        events: [],
        allDay: [],
        couldNotRead: [unreadable(answer.text, "your calendar")],
      };
    }
    const zone = answerOf(answer.text);
    if (zone?.timeZone && !zone.note && isTimeZone(zone.timeZone))
      timeZone = zone.timeZone;
    else {
      timeZone = "UTC";
      couldNotRead.push(
        "Google Calendar didn't say which time zone you're in, so times are shown in UTC.",
      );
    }
  }
  const zone = timeZone;

  const classes = (options.classes ?? [])
    .map((schoolClass) => ({
      id: schoolClass.id,
      words: wordsOf(schoolClass.name),
    }))
    .filter((schoolClass) => schoolClass.words.length > 0);

  const read = await inParallel(days, DAYS_AT_ONCE, async (date) => {
    const window = {
      start: zonedInstant(date, "00:00", zone).getTime(),
      end: zonedInstant(date, "24:00", zone).getTime(),
    };
    const answer = await ask({
      timeMin: new Date(window.start).toISOString(),
      timeMax: new Date(window.end).toISOString(),
      maxResults: EVENTS_PER_CALL,
    });
    return { date, window, answer };
  });

  const events = new Map<string, CalendarEvent>();
  const allDay = new Map<string, CalendarAllDay>();
  /** Days that failed, by what went wrong, so one cause is said once however many days it hit. */
  const failed = new Map<string, string[]>();
  const garbled: string[] = [];
  const full: string[] = [];
  for (const { date, window, answer } of read) {
    if (!answer.ok) {
      failed.set(answer.text, [...(failed.get(answer.text) ?? []), date]);
      continue;
    }
    const parsed = answerOf(answer.text);
    if (!parsed) {
      garbled.push(date);
      continue;
    }
    if (parsed.events.length >= EVENTS_PER_CALL) full.push(date);
    for (const event of parsed.events) {
      if (event.status === "cancelled") continue;
      const id = event.id || `untitled:${event.start}`;
      const key = `${id}|${date}`;
      const title = clipped(event.summary) || "(no title)";
      if (DATE_ONLY.test(event.start)) {
        if (coversDay(event.start, event.end, date) && !allDay.has(key))
          allDay.set(key, { id, title, date });
        continue;
      }
      const piece = timedPiece(event, window, zone);
      if (!piece || events.has(key)) continue;
      const classId = classOf(title, classes);
      const location = event.location ? clipped(event.location) : "";
      events.set(key, {
        id,
        title,
        date,
        ...piece,
        ...(location ? { location } : {}),
        ...(classId ? { classId } : {}),
      });
    }
  }

  for (const [text, dates] of failed)
    couldNotRead.push(unreadable(text, lostDays(dates, days.length)));
  if (garbled.length > 0)
    couldNotRead.push(
      `Google Calendar sent ${lostDays(garbled, days.length)} in a way that couldn't be read. Try again in a minute.`,
    );
  if (full.length > 0)
    couldNotRead.push(
      `Only the first ${EVENTS_PER_CALL} events were read on ${andList(full.map(dayName))}.`,
    );

  return {
    timeZone: zone,
    events: [...events.values()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.start.localeCompare(b.start) ||
        a.end.localeCompare(b.end) ||
        a.title.localeCompare(b.title, "en") ||
        a.id.localeCompare(b.id),
    ),
    allDay: [...allDay.values()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.title.localeCompare(b.title, "en") ||
        a.id.localeCompare(b.id),
    ),
    couldNotRead: [...new Set(couldNotRead)],
  };
}

function answerOf(text: string): z.infer<typeof answerSchema> | null {
  try {
    const parsed = answerSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** "your calendar", or which part of it, when only some days were lost. */
function lostDays(dates: readonly string[], of: number): string {
  if (dates.length === of) return "your calendar";
  if (dates.length <= 3)
    return `your calendar for ${andList([...dates].sort().map(dayName))}`;
  return `your calendar for ${dates.length} of the ${of} days`;
}

/** A timed event's piece on one day, or null for one that is not timed, not real or not on it. */
function timedPiece(
  event: Listed,
  window: { start: number; end: number },
  timeZone: string,
): { start: string; end: string } | null {
  const startAt = Date.parse(event.start);
  const endAt = Date.parse(event.end);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null;
  if (endAt <= startAt) return null;
  return pieceOn(window, startAt, endAt, timeZone);
}
