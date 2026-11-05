import type { StudyBlock, StudyPlan } from "@openbot/shared/study";
import { StudyInputError } from "./contracts";

/*
 * Study plans: which blocks of time go to which assignment. Ported from the owner's school-chat
 * prototype (domain.mjs makePlan and applyPlan, its personal mode only) as pure functions. Every
 * input is explicit (today, the minute of the student's day, their tasks, what is already on their
 * calendar, their study hours) and block ids come from the caller, so one input always makes one
 * plan, and nothing here reads a clock, a database or the network.
 *
 * The plan is greedy, one day at a time. A day has one cursor that the tasks share in priority
 * order: each task takes what it can from the cursor on, in blocks no longer than the student's
 * focus span with a rest after each, until its minutes, the minutes asked for, the day's cap or its
 * deadline run out. A commitment keeps a buffer on both sides, for the walk between rooms.
 *
 * Making a plan writes nothing. checkApply re-checks the blocks against the calendar as it is when
 * the student presses Apply, because the calendar can change while a plan waits.
 *
 * Where this differs from the prototype, on purpose:
 * - A task with less than two smallest blocks of work left (16 to 29 minutes), and more than the
 *   focus span, is planned in one sitting when the time is there. The prototype's rule against
 *   leaving a scrap shrank such a block below the smallest size, so the task was never planned.
 * - The smallest block is 15 minutes or all of what is left of a task, after the minutes applied
 *   blocks already cover. Measured against the task's whole estimate, the last few minutes of a
 *   mostly planned task could never be planned again.
 * - A task's search for room does not move the day's cursor; only a block it places does. In the
 *   prototype a long task that fit nowhere pushed every task after it past the time it skipped.
 * - Applied study blocks keep the rest gap around them, as the blocks planned here do.
 * - startTime raises only the first day's start; the prototype applied it to every day.
 */

/** Something to plan: an assignment, or study for one, with what is left of its estimate. */
export type PlanTask = {
  id: string;
  title: string;
  classId: string | null;
  /** The due date, "YYYY-MM-DD" on the student's own calendar, or null for none. */
  due: string | null;
  /** The due time on that date, "HH:mm", or null for the end of the day. */
  dueTime: string | null;
  /** Minutes of work; a fraction rounds up. Zero or less means there is nothing to plan. */
  minutes: number;
  /** In one sitting or not at all, such as a timed practice test. */
  contiguous?: boolean;
  /** A target is a date the student aims for, not a deadline: work after it is not late. */
  dateKind?: "deadline" | "target";
};

/** Time already taken on the student's calendar, clipped to one local day. */
export type BusyEvent = {
  id: string;
  date: string;
  /** "HH:mm". */
  start: string;
  /** "HH:mm", or "24:00" for an event that runs to midnight. */
  end: string;
  /** A commitment is a class, a practice or anything else on the calendar; study is an applied block. */
  kind: "commitment" | "study";
  /** study: the assignment the block works on. */
  assignmentId?: string | null;
};

/** When a student studies on one day. */
export type DayWindow = {
  enabled: boolean;
  /** "HH:mm": the earliest a block may start and the latest it may end. */
  start: string;
  end: string;
  /** The most minutes of study that day, counting blocks already applied. */
  cap: number;
  /** The longest block, in minutes. */
  focus: number;
  /** Minutes of rest after each block. */
  rest: number;
};

export type PlanInput = {
  /** The student's today, "YYYY-MM-DD", and the minute of their day now (0 to 1439). */
  today: string;
  nowMinute: number;
  tasks: PlanTask[];
  /**
   * Commitments and applied study blocks on the days being planned, plus every applied block from
   * now on, which counts toward its assignment's minutes wherever it falls.
   */
  busy: BusyEvent[];
  availability: (date: string) => DayWindow;
  /** Minutes kept clear before and after each commitment. */
  classBufferMin: number;
  /** Minutes of study asked for, across every day of the plan: 15 to 600. */
  minutes: number;
  /** The first day to plan; today when left out. At most 30 days ahead. */
  startDate?: string;
  /** How many days to plan, 1 to 7; one when left out. */
  days?: number;
  /** "HH:mm": no earlier than this on the first day. */
  startTime?: string;
  /** "HH:mm": no later than this on any day. */
  endTime?: string;
  /** Task ids to plan first, in this order. The rest follow by due date and time. */
  priority?: string[];
  /** Task ids the student asked to plan after their deadline, as catch-up work. */
  lateTaskIds?: string[];
};

/** The part of a StudyPlan the scheduler decides; the caller adds the id, status and reason. */
export type PlanDraft = Pick<
  StudyPlan,
  "startDate" | "days" | "blocks" | "remaining" | "warnings" | "totalMinutes"
>;

/** Minutes kept clear before and after each commitment: the walk between rooms, the drive to practice. */
export const DEFAULT_CLASS_BUFFER_MIN = 10;

/** The shortest block worth planning. Anything shorter is a scrap, not a study session. */
const SMALLEST_BLOCK = 15;
/** Nothing is planned to start sooner than this after now, so the student has time to begin. */
const LEAD_MIN = 5;
const DAY_END = 24 * 60;
const LAST_MINUTE = "23:59";
const LAST_DAY = "9999-12-31";

const MIN_ASK = 15;
const MAX_ASK = 600;
const MAX_DAYS = 7;
const MAX_DAYS_AHEAD = 30;

/** Why a plan whose time has begun can't be applied, here and when the route finds it stale. */
export const PASSED =
  "This plan includes a time that has already passed. Ask for a fresh plan.";
const CONFLICT =
  "Something new is on your calendar at that time. Ask for a fresh plan.";

/**
 * A request whose first day is wrong. A StudyInputError like any other, told apart so the plan tool
 * can say what today is: the model asking has no clock.
 */
export class PlanDateError extends StudyInputError {
  override name = "PlanDateError";
}

type Span = { start: number; end: number };
type Busy = Span & { event: BusyEvent };

/** A task as the planner works through it. */
type Work = {
  task: PlanTask;
  /** Minutes still to plan: the task's own, less what applied study blocks already cover. */
  need: number;
  /** The shortest block for this task: SMALLEST_BLOCK, or all it needs when that is less. */
  smallest: number;
  /** The due time as a minute of the due date; the end of the day when it has none. */
  dueMinute: number;
  /** Past its deadline already, so the only work left for it is catch-up. */
  overdue: boolean;
  /** The student asked for it to be planned after its deadline. */
  allowLate: boolean;
};

/**
 * Proposes study blocks for the student's tasks around their calendar. Throws StudyInputError, in a
 * sentence the student or the model can act on, when the request itself is wrong, and a plain Error
 * when the calendar, tasks or study hours it was given cannot be read.
 */
export function makePlan(
  input: PlanInput,
  ids: { newId(): string },
): PlanDraft {
  const { today, nowMinute } = input;
  if (!isDay(today))
    throw new Error("Today's date must be written as YYYY-MM-DD.");
  if (!isWhole(nowMinute, 0, DAY_END - 1))
    throw new Error(
      "The minute of the day must be a whole number from 0 to 1439.",
    );
  if (!isWhole(input.classBufferMin, 0))
    throw new Error("The class buffer must be a whole number of minutes.");

  const startDate = input.startDate ?? today;
  if (!isDay(startDate))
    throw new PlanDateError(
      "Choose a real date to plan, written as YYYY-MM-DD.",
    );
  if (startDate < today)
    throw new PlanDateError("Choose today or a later date to plan.");
  if (startDate > addDays(today, MAX_DAYS_AHEAD))
    throw new PlanDateError(`Plan within the next ${MAX_DAYS_AHEAD} days.`);
  const days = input.days ?? 1;
  if (!isWhole(days, 1, MAX_DAYS))
    throw new StudyInputError(`Plan between 1 and ${MAX_DAYS} days at a time.`);
  if (!isWhole(input.minutes, MIN_ASK, MAX_ASK))
    throw new StudyInputError(
      `Ask for between ${MIN_ASK} and ${MAX_ASK} minutes of study.`,
    );
  const startTime = askedTime(input.startTime, "start", "15:30");
  const endTime = askedTime(input.endTime, "end", "21:00");
  if (startTime !== null && endTime !== null && startTime >= endTime)
    throw new StudyInputError("Choose an end time later than the start time.");

  const calendar: Busy[] = input.busy.map((event) => ({
    event,
    ...busySpan(event),
  }));
  const work = readWork(input, calendar);

  const blocks: StudyBlock[] = [];
  const warnings: string[] = [];
  const warned = new Set<string>();
  let budget = input.minutes;
  let totalMinutes = 0;

  for (let offset = 0; offset < days && budget > 0; offset++) {
    const date = addDays(startDate, offset);
    const asked = input.availability(date);
    if (!asked.enabled) continue;
    const hours = readHours(date, asked);
    const onDay = calendar.filter((busy) => busy.event.date === date);
    const applied = onDay
      .filter((busy) => busy.event.kind === "study")
      .reduce((sum, busy) => sum + busy.end - busy.start, 0);
    let dayLeft = hours.cap - applied;
    if (dayLeft <= 0) continue;
    // Commitments keep the class buffer on both sides. Applied study blocks keep the rest a block
    // planned here would have, so two sessions never run back to back.
    const occupied = onDay
      .map(({ event, start, end }) => {
        const pad =
          event.kind === "commitment" ? input.classBufferMin : hours.rest;
        return {
          start: Math.max(0, start - pad),
          end: Math.min(DAY_END, end + pad),
        };
      })
      .sort((a, b) => a.start - b.start);
    const end = endTime === null ? hours.end : Math.min(hours.end, endTime);
    let cursor = Math.max(
      hours.start,
      offset === 0 ? (startTime ?? 0) : 0,
      date === today ? Math.ceil((nowMinute + LEAD_MIN) / 5) * 5 : 0,
    );

    for (const item of work) {
      const { task } = item;
      if (item.need <= 0) continue;
      const keepsDeadline = !item.overdue && !item.allowLate;
      if (task.due !== null && date > task.due && keepsDeadline) continue;
      const cutoff =
        task.due === date && keepsDeadline
          ? Math.min(end, item.dueMinute)
          : end;
      // Searching moves only `at`. The day's cursor moves when a block is placed, so a task that fits
      // nowhere leaves the time it skipped to the tasks after it.
      let at = cursor;
      while (item.need > 0 && budget > 0 && dayLeft > 0 && at < cutoff) {
        const inside = occupied.find(
          (span) => span.start <= at && span.end > at,
        );
        if (inside) {
          at = inside.end;
          continue;
        }
        const next = occupied.find((span) => span.start > at);
        const freeEnd = Math.min(cutoff, next?.start ?? cutoff);
        const room = Math.min(budget, dayLeft, freeEnd - at);
        const smallest = task.contiguous ? item.need : item.smallest;
        let length = Math.min(
          item.need,
          room,
          task.contiguous ? item.need : hours.focus,
        );
        if (
          !task.contiguous &&
          length < item.need &&
          item.need - length < smallest
        ) {
          // This block would leave a scrap too short to plan on its own. Leave exactly one smallest
          // block for later instead. When the task is too short to split that way, plan it in one
          // sitting if the time is there (it runs past the focus span by less than one smallest
          // block), or look further on.
          if (item.need - smallest >= smallest) length = item.need - smallest;
          else length = room >= item.need ? item.need : 0;
        }
        if (length < smallest) {
          if (next && freeEnd < cutoff) {
            at = next.end;
            continue;
          }
          break;
        }
        const finish = at + length;
        const late =
          task.due !== null &&
          task.dateKind !== "target" &&
          (date > task.due || (date === task.due && finish > item.dueMinute));
        blocks.push({
          id: ids.newId(),
          assignmentId: task.id,
          classId: task.classId,
          title: task.title,
          date,
          start: clockOf(at),
          end: clockOf(finish),
          ...(late ? { late: true } : {}),
        });
        if (late && !warned.has(task.id)) {
          warned.add(task.id);
          warnings.push(lateWarning(task));
        }
        item.need -= length;
        budget -= length;
        dayLeft -= length;
        totalMinutes += length;
        at = finish + hours.rest;
        cursor = at;
      }
    }
  }

  const remaining = work
    .filter((item) => item.need > 0)
    .map((item) => ({
      assignmentId: item.task.id,
      title: item.task.title,
      minutes: item.need,
      due: item.task.due,
    }));
  return { startDate, days, blocks, remaining, warnings, totalMinutes };
}

/**
 * Whether a proposed plan's blocks can go on the calendar as it is now: null when they can,
 * otherwise the sentence to show. Overlap is all that is checked; the buffers are the planner's
 * preference, not a reason to refuse the student's own plan.
 */
export function checkApply(input: {
  today: string;
  nowMinute: number;
  blocks: StudyBlock[];
  busy: BusyEvent[];
}): string | null {
  const planned = input.blocks.map((block) => ({
    block,
    ...blockSpan(block),
  }));
  if (
    planned.some(
      ({ block, start }) =>
        block.date < input.today ||
        (block.date === input.today && start < input.nowMinute),
    )
  )
    return PASSED;
  const calendar = input.busy.map((event) => ({ event, ...busySpan(event) }));
  for (const { block, start, end } of planned) {
    for (const busy of calendar) {
      // Once a plan is applied its blocks are on the calendar too, and a block never conflicts with
      // itself.
      if (busy.event.id === block.id || busy.event.date !== block.date)
        continue;
      if (busy.start < end && start < busy.end) return CONFLICT;
    }
  }
  return null;
}

/**
 * A high school student's study hours until they set their own: weekday afternoons and evenings
 * after school, and longer weekend days with a bigger cap.
 */
export function defaultAvailability(date: string): DayWindow {
  if (!isDay(date))
    throw new Error(`Expected a date written as YYYY-MM-DD, not "${date}".`);
  return isWeekend(date)
    ? {
        enabled: true,
        start: "10:00",
        end: "21:00",
        cap: 240,
        focus: 50,
        rest: 10,
      }
    : {
        enabled: true,
        start: "15:30",
        end: "22:00",
        cap: 180,
        focus: 45,
        rest: 10,
      };
}

/** The tasks with work to plan, in the order they are planned, each checked as it is read. */
function readWork(input: PlanInput, calendar: Busy[]): Work[] {
  const { today, nowMinute } = input;
  const lateIds = new Set(input.lateTaskIds ?? []);
  const known = new Set<string>();
  const work: Work[] = [];
  for (const task of input.tasks) {
    if (known.has(task.id))
      throw new Error(`Two tasks share the id ${task.id}.`);
    known.add(task.id);
    const dueMinute = minuteOf(task.dueTime ?? LAST_MINUTE);
    if ((task.due !== null && !isDay(task.due)) || dueMinute === null)
      throw new Error(
        `The task ${task.id} has a due date or time the planner cannot read.`,
      );
    if (!Number.isFinite(task.minutes) || task.minutes <= 0) continue;
    // Future study blocks already applied for this task count as planned. One under way counts
    // whole, as the prototype did: the student is doing it.
    const covered = calendar
      .filter(
        ({ event, end }) =>
          event.kind === "study" &&
          event.assignmentId === task.id &&
          (event.date > today || (event.date === today && end > nowMinute)),
      )
      .reduce((sum, busy) => sum + busy.end - busy.start, 0);
    const need = Math.max(0, Math.ceil(task.minutes) - covered);
    work.push({
      task,
      need,
      smallest: Math.min(SMALLEST_BLOCK, need),
      dueMinute,
      overdue:
        task.due !== null &&
        (task.due < today || (task.due === today && dueMinute < nowMinute)),
      allowLate: lateIds.has(task.id),
    });
  }
  const priority = input.priority ?? [];
  if (priority.some((id) => !known.has(id)))
    throw new StudyInputError(
      "One of the tasks to put first no longer exists.",
    );
  if ([...lateIds].some((id) => !known.has(id)))
    throw new StudyInputError("One of the catch-up tasks no longer exists.");
  const rank = (item: Work): number => {
    const at = priority.indexOf(item.task.id);
    return at === -1 ? priority.length : at;
  };
  // Array sort is stable, so tasks that tie keep the order they were given in.
  return work.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      compareText(a.task.due ?? LAST_DAY, b.task.due ?? LAST_DAY) ||
      compareText(a.task.dueTime ?? LAST_MINUTE, b.task.dueTime ?? LAST_MINUTE),
  );
}

function readHours(
  date: string,
  hours: DayWindow,
): { start: number; end: number; cap: number; focus: number; rest: number } {
  const start = minuteOf(hours.start);
  const end = minuteOf(hours.end);
  if (
    start === null ||
    end === null ||
    !isWhole(hours.cap, 0) ||
    !isWhole(hours.focus, 1) ||
    !isWhole(hours.rest, 0)
  )
    throw new Error(`The study hours for ${date} cannot be read.`);
  // A focus span shorter than the smallest block would plan nothing at all.
  return {
    start,
    end,
    cap: hours.cap,
    focus: Math.max(hours.focus, SMALLEST_BLOCK),
    rest: hours.rest,
  };
}

/** A start or end time from the request, as a minute of the day, or null when it was left out. */
function askedTime(
  value: string | undefined,
  which: "start" | "end",
  example: string,
): number | null {
  if (value === undefined) return null;
  const minute = minuteOf(value);
  if (minute === null)
    throw new StudyInputError(
      `Write the ${which} time as HH:mm, such as ${example}.`,
    );
  return minute;
}

/**
 * An event's minutes on its own day. "24:00" ends at midnight, and so does an end before the start:
 * the event crosses midnight, and the planner only knows the day it was given.
 */
function busySpan(event: BusyEvent): Span {
  const start = minuteOf(event.start);
  const end = event.end === "24:00" ? DAY_END : minuteOf(event.end);
  if (!isDay(event.date) || start === null || end === null)
    throw new Error(
      `The calendar event ${event.id} has a date or time the planner cannot read.`,
    );
  return { start, end: end < start ? DAY_END : end };
}

function blockSpan(block: StudyBlock): Span {
  const start = minuteOf(block.start);
  const end = minuteOf(block.end);
  if (start === null || end === null)
    throw new Error(
      `The study block ${block.id} has a time the planner cannot read.`,
    );
  return { start, end };
}

function lateWarning(task: PlanTask): string {
  // Cut by code point, so an emoji is never halved: half of one is not text Postgres will store.
  const title = Array.from(task.title).slice(0, 85).join("");
  const deadline =
    task.due === null ? "" : ` (${deadlineOf(task.due, task.dueTime)})`;
  return `${title} is scheduled after its deadline${deadline}. The deadline has not changed.`;
}

const NBSP = "\u00a0";
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

/**
 * A deadline the way the plan card writes days and times, "Tue, Nov 3 at 11:59 PM", or the day
 * alone when it has no time. Always the day itself, never "Today": the warning is kept with the
 * plan and read again later. No-break spaces hold it together, so a phone-width card never breaks
 * it between a number and its unit.
 */
function deadlineOf(due: string, dueTime: string | null): string {
  const noon = new Date(`${due}T12:00:00Z`);
  const day = `${WEEKDAYS[noon.getUTCDay()]}, ${MONTHS[noon.getUTCMonth()]}${NBSP}${noon.getUTCDate()}`;
  const minute = dueTime === null ? null : minuteOf(dueTime);
  if (minute === null) return day;
  const hours = Math.floor(minute / 60);
  const clock = `${hours % 12 === 0 ? 12 : hours % 12}:${String(minute % 60).padStart(2, "0")}`;
  return `${day}${NBSP}at${NBSP}${clock}${NBSP}${hours < 12 ? "AM" : "PM"}`;
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:mm" as minutes after midnight, or null when it is not a time of day. */
function minuteOf(value: string): number | null {
  const match = CLOCK.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function clockOf(minute: number): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  return `${hours}:${String(minute % 60).padStart(2, "0")}`;
}

/** True for a real calendar day written "YYYY-MM-DD", so not 2026-02-30. */
function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const noon = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(noon.getTime()) && noon.toISOString().slice(0, 10) === value
  );
}

/**
 * Whole days at noon UTC, as the prototype counted them, so neither the server's time zone nor a
 * daylight-saving change can move the date.
 */
function addDays(day: string, count: number): string {
  const noon = new Date(`${day}T12:00:00Z`);
  noon.setUTCDate(noon.getUTCDate() + count);
  return noon.toISOString().slice(0, 10);
}

function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function isWhole(
  value: number,
  least: number,
  most = Number.POSITIVE_INFINITY,
): boolean {
  return Number.isInteger(value) && value >= least && value <= most;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
