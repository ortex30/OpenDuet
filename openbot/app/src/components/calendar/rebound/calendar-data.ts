import type {
  CalendarEvent,
  ClassColor,
  SchoolClass,
  StudyBlock,
} from "@openbot/shared/study";
import { calendarOccurrenceKey } from "./lib/calendar-layout";
import {
  addDays,
  COURSE_COLORS,
  formatTime,
  parseDateStr,
  timeToMin,
  toDateStr,
} from "./lib/helpers";
import type { AgendaItem, Block, Course } from "./lib/types";

/*
 * Academic OS's calendar in the shapes Rebound's timeline draws (lib/types.ts). A Google Calendar
 * event becomes a fixed commitment, an applied study block becomes a block, and a proposed plan's
 * blocks are laid over both without replacing anything. Every id is namespaced by where it came from,
 * so an event and a block can never be taken for one another, and a proposed block is known by its id.
 */

/** One day, or the week around it, Sunday first. */
export type CalendarMode = "day" | "week";

/** What an item on the timeline is, for the detail card. `key` is the timeline's occurrence key. */
export type CalendarItem =
  | { kind: "event"; key: string; event: CalendarEvent }
  | { kind: "block"; key: string; block: StudyBlock; proposed: boolean };

export type CalendarData = {
  /** The items of each visible day, in the order of the dates asked for. */
  agendaByDate: AgendaItem[][];
  allBlocks: Block[];
  courses: Course[];
  items: ReadonlyMap<string, CalendarItem>;
};

/** Starts the id of a block that is only proposed. calendar.css dashes any item whose id does. */
export const PROPOSED_ID_PREFIX = "proposed:";

/** Starts a proposed block's title, so it says so in words as well, to a screen reader too. */
export const PROPOSED_TITLE_PREFIX = "Proposed: ";

/**
 * The course every item without a class is drawn under, in Rebound's neutral graphite. Only a class
 * carries colour, so a colour on the calendar always means a class.
 */
export const UNCLASSED_COURSE_ID = "academic-os:unclassed";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** "HH:mm" on a 24-hour clock. "24:00" is allowed as an end: an event that runs to midnight. */
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;

/** True for a real day written "YYYY-MM-DD", such as a link's `?date=`; false for "2026-02-30". */
export function isCalendarDate(text: string): boolean {
  return DATE.test(text) && toDateStr(parseDateStr(text)) === text;
}

/** The seven days of the week `day` falls in, Sunday first, as Rebound's week view lays them out. */
export function weekDates(day: string): string[] {
  const start = addDays(day, -parseDateStr(day).getDay());
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** The days the calendar shows for `day`: that day alone, or its week. */
export function visibleDates(day: string, mode: CalendarMode): string[] {
  return mode === "day" ? [day] : weekDates(day);
}

/** The day a step before or after `day`: one day in Day view, one week in Week view. */
export function stepDay(day: string, mode: CalendarMode, step: -1 | 1): string {
  return addDays(day, step * (mode === "day" ? 1 : 7));
}

/**
 * "18:30" as "6:30 PM", the way the timeline writes times. "24:00", an event that runs to midnight,
 * is "12 AM" (Rebound's formatTime reads it as noon), as the plan card writes it.
 */
export function clockLabel(time: string): string {
  return time === "24:00" ? "12 AM" : formatTime(time);
}

/** A "YYYY-MM-DD" day in words, such as "Wed, Nov 4": the day as written, never shifted by a zone. */
export function dayLabel(
  date: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return parseDateStr(date).toLocaleDateString("en-US", options);
}

/** This device's own day and minute, for the moments before the calendar has said the student's. */
export function deviceNow(at: Date): { day: string; minute: number } {
  return { day: toDateStr(at), minute: at.getHours() * 60 + at.getMinutes() };
}

/**
 * The student's day and minute at `at` in their calendar's time zone, by this device's clock, so
 * the now line keeps time between reads, whichever range is on screen. Null for a zone this browser
 * doesn't know.
 */
export function zonedNow(
  at: Date,
  timeZone: string,
): { day: string; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((piece) => piece.type === type)?.value;
    const [year, month, day] = [part("year"), part("month"), part("day")];
    const hour = Number(part("hour"));
    const minute = Number(part("minute"));
    if (
      !year ||
      !month ||
      !day ||
      !Number.isInteger(hour) ||
      !Number.isInteger(minute)
    )
      return null;
    return {
      day: `${year}-${month}-${day}`,
      minute: (hour % 24) * 60 + minute,
    };
  } catch {
    return null;
  }
}

/**
 * The timeline's button for an item, found by the id and day it is drawn under, or null when it is
 * not drawn. For giving focus back to an item once its details close.
 */
export function itemButton(
  root: ParentNode,
  item: CalendarItem,
): HTMLElement | null {
  for (const button of root.querySelectorAll<HTMLElement>(
    "[data-calendar-item-id][data-calendar-date]",
  )) {
    const id = button.getAttribute("data-calendar-item-id") ?? "";
    const date = button.getAttribute("data-calendar-date") ?? "";
    if (calendarOccurrenceKey({ id, date }) === item.key) return button;
  }
  return null;
}

/** A class's colour, as the dot drawn beside its name. The same hue its blocks are filled with. */
export function classColor(color: ClassColor): string {
  return COURSE_COLORS[color].dot;
}

/** The classes as Rebound's courses, and the one neutral course for everything that has no class. */
export function toCourses(classes: readonly SchoolClass[]): Course[] {
  return [
    ...classes.map((schoolClass) =>
      course(schoolClass.id, schoolClass.name, schoolClass.color),
    ),
    course(UNCLASSED_COURSE_ID, "", "slate"),
  ];
}

function course(id: string, name: string, color: ClassColor): Course {
  return { id, name, color, weeklyEffortMin: 0, createdAt: "" };
}

/**
 * Whether a time range can be drawn: two clock times, the end not before the start. The server clips
 * events to one day, so this only keeps a malformed one from breaking the timeline's arithmetic.
 */
function drawable(range: { start: string; end: string }): boolean {
  return (
    CLOCK.test(range.start) &&
    CLOCK.test(range.end) &&
    range.start !== "24:00" &&
    timeToMin(range.end) >= timeToMin(range.start)
  );
}

type DrawnBlock = { source: StudyBlock; proposed: boolean; block: Block };

/**
 * The visible days' items as the timeline takes them, and what each one is.
 *
 * An event is matched to its class by `classId`, and only to a class the student has, so a class's
 * colour is the one it has everywhere else; anything else is neutral. A proposed block is added to
 * the day beside what is already applied and never takes an applied block's place: Apply decides what
 * changes, not this view.
 */
export function toCalendarData(input: {
  dates: readonly string[];
  classes: readonly SchoolClass[];
  events: readonly CalendarEvent[];
  /** Applied study blocks. */
  blocks: readonly StudyBlock[];
  /** A proposed plan's blocks, drawn over the rest. */
  proposed?: readonly StudyBlock[];
}): CalendarData {
  const known = new Set(input.classes.map((schoolClass) => schoolClass.id));
  const courseOf = (classId: string | null | undefined): string =>
    classId && known.has(classId) ? classId : UNCLASSED_COURSE_ID;
  const toBlock = (source: StudyBlock, proposed: boolean): DrawnBlock => ({
    source,
    proposed,
    block: {
      id: `${proposed ? PROPOSED_ID_PREFIX : "block:"}${source.id}`,
      date: source.date,
      start: source.start,
      end: source.end,
      kind: "study",
      refId: source.assignmentId ?? source.id,
      title: proposed
        ? `${PROPOSED_TITLE_PREFIX}${source.title}`
        : source.title,
      courseId: courseOf(source.classId),
      status: "todo",
    },
  });
  const blocks = [
    ...input.blocks.filter(drawable).map((block) => toBlock(block, false)),
    ...(input.proposed ?? [])
      .filter(drawable)
      .map((block) => toBlock(block, true)),
  ];

  const items = new Map<string, CalendarItem>();
  const agendaByDate = input.dates.map((date) => {
    const day: AgendaItem[] = [];
    const add = (item: AgendaItem, describe: (key: string) => CalendarItem) => {
      const key = calendarOccurrenceKey(item);
      // The same id twice on one day would be drawn twice under one key. The first one stands.
      if (items.has(key)) return;
      items.set(key, describe(key));
      day.push(item);
    };
    for (const event of input.events) {
      if (event.date !== date || !drawable(event)) continue;
      add(
        {
          id: `event:${event.id}`,
          date,
          start: event.start,
          end: event.end,
          kind: "commitment",
          title: event.title,
          courseId: courseOf(event.classId),
        },
        (key) => ({ kind: "event", key, event }),
      );
    }
    for (const { source, proposed, block } of blocks) {
      if (block.date !== date) continue;
      add(
        {
          id: block.id,
          date,
          start: block.start,
          end: block.end,
          kind: "block",
          title: block.title,
          courseId: block.courseId,
          block,
        },
        (key) => ({ kind: "block", key, block: source, proposed }),
      );
    }
    return day;
  });

  return {
    agendaByDate,
    allBlocks: blocks.map((entry) => entry.block),
    courses: toCourses(input.classes),
    items,
  };
}

/**
 * The hours to draw: Rebound's waking day, 7 AM to 11 PM, widened to the whole hour around anything
 * earlier or later, and around now when today is shown, since the timeline leaves out whatever falls
 * outside its window.
 */
export function dayWindow(
  agendaByDate: readonly (readonly AgendaItem[])[],
  nowMinute?: number,
): { wakeMinute: number; sleepMinute: number } {
  let wake = 7 * 60;
  let sleep = 23 * 60;
  const widen = (start: number, end: number) => {
    wake = Math.min(wake, Math.floor(start / 60) * 60);
    sleep = Math.max(sleep, Math.ceil(end / 60) * 60);
  };
  for (const day of agendaByDate)
    for (const item of day) widen(timeToMin(item.start), timeToMin(item.end));
  if (nowMinute !== undefined) widen(nowMinute, nowMinute + 1);
  return {
    wakeMinute: Math.max(0, wake),
    sleepMinute: Math.min(24 * 60, sleep),
  };
}
