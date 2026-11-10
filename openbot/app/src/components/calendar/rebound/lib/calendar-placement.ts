import { minToTime, parseDateStr, timeToMin, toDateStr } from "./helpers";
import { commitmentsForDate } from "./calendar-occurrences";
import { postCommitmentRecoveryWindows } from "./transition-buffer";
import type {
  Block,
  Commitment,
  DayAvailabilityOverride,
  LearnedNote,
  OneOff,
  Profile,
  Routine,
  Task,
  TimeWindow,
} from "./types";

export type CalendarPlacementKind =
  | "preferred"
  | "available"
  | "discouraged"
  | "blocked";

export interface CalendarPlacementContext {
  profile: Profile | null;
  commitments: Commitment[];
  oneOffs: OneOff[];
  blocks: Block[];
  tasks: Task[];
  routines: Routine[];
  availabilityOverrides: DayAvailabilityOverride[];
  learnedNotes: LearnedNote[];
  today: string;
  nowMinute: number;
}

export interface CalendarPlacementDecision {
  kind: CalendarPlacementKind;
  reason: string;
}

export interface CalendarPlacementSlot {
  date: string;
  startMinute: number;
  kind: Extract<CalendarPlacementKind, "preferred" | "available">;
}

export interface CalendarDiscouragedWindow {
  startMinute: number;
  endMinute: number;
  reason: string;
}

const FIVE_MINUTES = 5;

function overlaps(
  start: number,
  end: number,
  otherStart: number,
  otherEnd: number,
): boolean {
  return otherStart < end && start < otherEnd;
}

function validMinute(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(24 * 60, Math.max(0, Math.round(value)))
    : undefined;
}

function mergeWindows(
  windows: CalendarDiscouragedWindow[],
): CalendarDiscouragedWindow[] {
  const sorted = windows
    .filter((window) => window.endMinute > window.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  const merged: CalendarDiscouragedWindow[] = [];
  for (const window of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || window.startMinute > previous.endMinute) {
      merged.push({ ...window });
      continue;
    }
    previous.endMinute = Math.max(previous.endMinute, window.endMinute);
    if (previous.reason !== window.reason) {
      previous.reason = "Usually avoided time";
    }
  }
  return merged;
}

/** Mirrors the scheduler's learned avoid-window derivation without importing
 * the client store. The safety valve prevents old notes from making an entire
 * waking day look unavailable. */
export function calendarLearnedAvoidWindows(
  learnedNotes: readonly LearnedNote[],
  profile: Profile,
): CalendarDiscouragedWindow[] {
  const raw: CalendarDiscouragedWindow[] = [];
  for (const note of learnedNotes) {
    const before = validMinute(note.notBeforeMin);
    if (before !== undefined && before > 0) {
      raw.push({
        startMinute: 0,
        endMinute: before,
        reason: "Usually avoided time",
      });
    }
    const after = validMinute(note.notAfterMin);
    if (after !== undefined && after < 24 * 60) {
      raw.push({
        startMinute: after,
        endMinute: 24 * 60,
        reason: "Usually avoided time",
      });
    }
  }
  if (raw.length === 0) return [];

  const merged = mergeWindows(raw);
  const wake = timeToMin(profile.wake);
  const sleep = timeToMin(profile.sleep);
  let cursor = wake;
  let hasFreeMinute = false;
  for (const window of merged) {
    if (window.startMinute > cursor) {
      hasFreeMinute = true;
      break;
    }
    cursor = Math.max(cursor, window.endMinute);
    if (cursor >= sleep) break;
  }
  if (!hasFreeMinute && cursor < sleep) hasFreeMinute = true;
  return hasFreeMinute ? merged : [];
}

function availabilityForDate(
  context: CalendarPlacementContext,
  date: string,
): { startMinute: number; endMinute: number; blocked: TimeWindow[] } | null {
  if (!context.profile) return null;
  const override = context.availabilityOverrides.find(
    (candidate) => candidate.date === date,
  );
  return {
    startMinute: timeToMin(override?.start ?? context.profile.wake),
    endMinute: timeToMin(override?.end ?? context.profile.sleep),
    blocked: override?.blocked ?? [],
  };
}

export function calendarDiscouragedWindows(
  context: CalendarPlacementContext,
  date: string,
): CalendarDiscouragedWindow[] {
  if (!context.profile) return [];
  const availability = availabilityForDate(context, date);
  if (!availability || availability.endMinute <= availability.startMinute) {
    return [];
  }

  const windows = [
    ...calendarLearnedAvoidWindows(context.learnedNotes, context.profile),
    ...postCommitmentRecoveryWindows(
      context.profile,
      context.commitments,
      context.oneOffs,
      date,
    ).map((window) => ({
      startMinute: window.startMin,
      endMinute: window.endMin,
      reason: `Recovery after ${window.title}`,
    })),
  ]
    .map((window) => ({
      ...window,
      startMinute: Math.max(window.startMinute, availability.startMinute),
      endMinute: Math.min(window.endMinute, availability.endMinute),
    }))
    .filter((window) => window.endMinute > window.startMinute);

  return mergeWindows(windows);
}

function preferredWindowsForBlock(
  context: CalendarPlacementContext,
  block: Block,
): TimeWindow[] {
  if (!context.profile) return [];
  if (block.kind === "routine") {
    const routine = context.routines.find((item) => item.id === block.refId);
    if (routine?.preferredStart) {
      const duration = calendarBlockDuration(block);
      const startMinute = timeToMin(routine.preferredStart);
      return [
        {
          start: routine.preferredStart,
          end: minToTime(startMinute + duration),
        },
      ];
    }
  }

  const task =
    block.kind === "task"
      ? context.tasks.find((item) => item.id === block.refId)
      : undefined;
  const preference = task?.preferredWindow ?? "peak";
  if (preference === "any") return [];
  if (preference === "morning") return [{ start: "05:00", end: "12:00" }];
  if (preference === "afternoon") return [{ start: "12:00", end: "17:00" }];
  if (preference === "evening") return [{ start: "17:00", end: "23:59" }];
  return context.profile.peakWindows;
}

export function calendarBlockDuration(block: Block): number {
  return Math.max(FIVE_MINUTES, timeToMin(block.end) - timeToMin(block.start));
}

/** Pure preview of the store's move policy. Hard conflicts are never waived;
 * learned avoid windows and class/work recovery are deliberately surfaced as
 * discouraged so the UI can offer an explicit override. */
export function classifyCalendarPlacement(
  context: CalendarPlacementContext,
  block: Block,
  date: string,
  startMinute: number,
): CalendarPlacementDecision {
  const duration = calendarBlockDuration(block);
  const endMinute = startMinute + duration;

  if (block.status !== "todo") {
    return { kind: "blocked", reason: "Only open work can be moved." };
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    toDateStr(parseDateStr(date)) !== date
  ) {
    return { kind: "blocked", reason: "Choose a valid date." };
  }
  if (date < context.today) {
    return { kind: "blocked", reason: "Past days cannot be changed." };
  }
  if (!context.profile) {
    return { kind: "blocked", reason: "Finish schedule setup first." };
  }
  if (startMinute < 0 || endMinute > 24 * 60) {
    return { kind: "blocked", reason: "That block would cross midnight." };
  }

  if (block.kind === "task") {
    const task = context.tasks.find((item) => item.id === block.refId);
    if (task?.startDate && date < task.startDate) {
      return {
        kind: "blocked",
        reason: `Available starting ${task.startDate}.`,
      };
    }
    if (
      task?.deadlineType === "hard" &&
      task.due &&
      (date > task.due ||
        (date === task.due &&
          !!task.dueTime &&
          endMinute > timeToMin(task.dueTime)))
    ) {
      return { kind: "blocked", reason: `Hard deadline: ${task.due}.` };
    }
    const dependency = task?.dependsOn
      ?.map((id) => context.tasks.find((item) => item.id === id))
      .find((item) => item && !item.done);
    if (dependency) {
      return {
        kind: "blocked",
        reason: `Finish ${dependency.title} first.`,
      };
    }
  }

  const availability = availabilityForDate(context, date);
  if (
    !availability ||
    startMinute < availability.startMinute ||
    endMinute > availability.endMinute
  ) {
    return { kind: "blocked", reason: "Outside your available hours." };
  }
  const blockedWindow = availability.blocked.find((window) =>
    overlaps(
      startMinute,
      endMinute,
      timeToMin(window.start),
      timeToMin(window.end),
    ),
  );
  if (blockedWindow) {
    return { kind: "blocked", reason: "Unavailable time." };
  }

  const commitment = commitmentsForDate(context.commitments, date).find(
    (item) =>
      overlaps(
        startMinute,
        endMinute,
        timeToMin(item.start),
        timeToMin(item.end),
      ),
  );
  if (commitment) {
    return { kind: "blocked", reason: `Conflicts with ${commitment.title}.` };
  }
  const oneOff = context.oneOffs.find(
    (item) =>
      item.date === date &&
      overlaps(
        startMinute,
        endMinute,
        timeToMin(item.start),
        timeToMin(item.end),
      ),
  );
  if (oneOff) {
    return { kind: "blocked", reason: `Conflicts with ${oneOff.title}.` };
  }
  const occupied = context.blocks.find(
    (item) =>
      item.id !== block.id &&
      item.date === date &&
      item.status !== "missed" &&
      overlaps(
        startMinute,
        endMinute,
        timeToMin(item.start),
        timeToMin(item.end),
      ),
  );
  if (occupied) {
    return { kind: "blocked", reason: `Conflicts with ${occupied.title}.` };
  }
  if (date === context.today && startMinute < context.nowMinute) {
    return { kind: "blocked", reason: "That time has already passed." };
  }

  const discouraged = calendarDiscouragedWindows(context, date).find((window) =>
    overlaps(startMinute, endMinute, window.startMinute, window.endMinute),
  );
  if (discouraged) {
    return { kind: "discouraged", reason: discouraged.reason };
  }

  const preferred = preferredWindowsForBlock(context, block).some(
    (window) =>
      startMinute >= timeToMin(window.start) &&
      endMinute <= timeToMin(window.end),
  );
  return preferred
    ? { kind: "preferred", reason: "Matches your preferred work time." }
    : { kind: "available", reason: "Open and available." };
}

function dateDistance(left: string, right: string): number {
  return Math.abs(
    Math.round(
      (parseDateStr(left).getTime() - parseDateStr(right).getTime()) /
        (24 * 60 * 60 * 1000),
    ),
  );
}

/** Return a small, stable set of useful outline targets instead of painting
 * every five-minute opening. Day gets three separated choices; Week favors
 * one clear recommendation per date. */
export function rankCalendarPlacementSlots(input: {
  context: CalendarPlacementContext;
  block: Block;
  dates: string[];
  targetDate?: string;
  targetMinute?: number;
  limit: number;
}): CalendarPlacementSlot[] {
  const {
    context,
    block,
    dates,
    targetDate = block.date,
    targetMinute = timeToMin(block.start),
    limit,
  } = input;
  if (limit <= 0 || !context.profile) return [];

  const duration = calendarBlockDuration(block);
  const candidatesByDate = new Map<
    string,
    Array<CalendarPlacementSlot & { score: number }>
  >();
  for (const date of dates) {
    const availability = availabilityForDate(context, date);
    if (!availability) continue;
    const candidates: Array<CalendarPlacementSlot & { score: number }> = [];
    const first =
      Math.ceil(availability.startMinute / FIVE_MINUTES) * FIVE_MINUTES;
    for (
      let startMinute = first;
      startMinute + duration <= availability.endMinute;
      startMinute += FIVE_MINUTES
    ) {
      const decision = classifyCalendarPlacement(
        context,
        block,
        date,
        startMinute,
      );
      if (decision.kind !== "preferred" && decision.kind !== "available") {
        continue;
      }
      candidates.push({
        date,
        startMinute,
        kind: decision.kind,
        score:
          Math.abs(startMinute - targetMinute) +
          (decision.kind === "available" ? 240 : 0),
      });
    }
    candidates.sort(
      (a, b) => a.score - b.score || a.startMinute - b.startMinute,
    );
    candidatesByDate.set(date, candidates);
  }

  if (dates.length === 1) {
    const selected: CalendarPlacementSlot[] = [];
    const minimumSeparation = Math.max(30, Math.min(duration, 90));
    for (const candidate of candidatesByDate.get(dates[0]) ?? []) {
      if (
        selected.every(
          (slot) =>
            Math.abs(slot.startMinute - candidate.startMinute) >=
            minimumSeparation,
        )
      ) {
        selected.push(candidate);
      }
      if (selected.length === limit) break;
    }
    return selected;
  }

  return dates
    .flatMap((date) => {
      const candidate = candidatesByDate.get(date)?.[0];
      return candidate ? [candidate] : [];
    })
    .sort(
      (a, b) =>
        (a.date === targetDate ? 0 : 1) - (b.date === targetDate ? 0 : 1) ||
        dateDistance(a.date, targetDate) - dateDistance(b.date, targetDate) ||
        a.score - b.score ||
        a.date.localeCompare(b.date),
    )
    .slice(0, limit);
}
