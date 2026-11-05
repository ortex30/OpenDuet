import { formatDate, formatTime } from "./helpers";
import { usePace } from "./store";
import { taskRemainingMinutes } from "./task-progress";
import type { Block, Task } from "./types";

export const CALENDAR_TASK_DRAG_MIME = "application/x-pace-task";
export const CALENDAR_RESIZE_MIN_MINUTES = 15;
export const CALENDAR_RESIZE_KEYBOARD_STEP_MINUTES = 15;

/** One stable drag payload lets the full task panel and the compact clone
 * sidebar feed the same timeline drop target without sharing component state. */
export function writeCalendarTaskDragData(
  transfer: Pick<DataTransfer, "effectAllowed" | "setData">,
  taskId: string,
): void {
  transfer.effectAllowed = "move";
  transfer.setData(CALENDAR_TASK_DRAG_MIME, taskId);
  transfer.setData("text/plain", taskId);
}

/** An outside drop schedules the task's remaining estimate. The store repeats
 * this calculation before mutation, so stale drag payloads cannot create a
 * differently sized block. */
export function calendarTaskDragDuration(
  task: Task,
  blocks: readonly Block[] = [],
): number {
  return Math.max(
    CALENDAR_RESIZE_MIN_MINUTES,
    Math.round(taskRemainingMinutes(task, blocks) / 5) * 5,
  );
}

export interface CalendarMoveResult {
  ok: boolean;
  placement: "exact" | "override" | "none";
  /** Timestamp of the durable notification/Undo receipt, when one was made. */
  receiptAt?: string;
  error?: string;
}

export interface CalendarMoveOptions {
  /** Explicitly accepts a learned avoid/reset window. Store hard-conflict
   * validation still runs first and can never be waived. */
  override?: boolean;
  /** Internal composition hook. User-facing calendar drops should record their
   * receipt immediately so reloads cannot strand an irreversible move. */
  recordReceipt?: boolean;
}

export interface CalendarScheduleResult extends CalendarMoveResult {
  block?: Block;
}

function recordCalendarBlockChangeReceipt(
  before: Block,
  input: {
    override?: boolean;
    summary: (after: Block) => string;
    reason: string;
  },
): CalendarMoveResult {
  const state = usePace.getState();
  const after = state.blocks.find((candidate) => candidate.id === before.id);
  if (!after) {
    return {
      ok: false,
      placement: "none",
      error: "The changed block could not be read back.",
    };
  }
  if (
    before.date === after.date &&
    before.start === after.start &&
    before.end === after.end
  ) {
    return {
      ok: true,
      placement: input.override ? "override" : "exact",
    };
  }
  const receipt = state.recordRecoveryMoves({
    source: "manual",
    summary: input.summary(after),
    moves: [{ before, after, reason: input.reason }],
  });
  return {
    ok: true,
    placement: input.override ? "override" : "exact",
    ...(receipt ? { receiptAt: receipt.at } : {}),
  };
}

export function recordCalendarMoveReceipt(
  before: Block,
  override = false,
): CalendarMoveResult {
  return recordCalendarBlockChangeReceipt(before, {
    override,
    summary: (after) =>
      `Moved “${after.title}” · ${formatDate(after.date)}, ${formatTime(after.start)}`,
    reason: override
      ? "Placed at the exact time you chose after confirming an overrideable preference warning"
      : "Placed where you dropped it after checking availability and hard conflicts",
  });
}

/** Calendar drag policy: honor only the exact five-minute destination the
 * student chose. Failed drops do not silently jump to a nearby/planner slot.
 * Every landed move remains flexible and gets one reversible manual receipt. */
export function moveTaskFromCalendar(
  before: Block,
  date: string,
  start: string,
  options: CalendarMoveOptions = {},
): CalendarMoveResult {
  const state = usePace.getState();
  const current = state.blocks.find((candidate) => candidate.id === before.id);
  if (!current) {
    return {
      ok: false,
      placement: "none",
      error: "That block no longer exists.",
    };
  }
  if (current.status !== "todo") {
    return {
      ok: false,
      placement: "none",
      error: "Only open work can be dragged.",
    };
  }
  if (current.date === date && current.start === start) {
    return { ok: true, placement: "exact" };
  }

  const exact = state.moveBlock(before.id, date, start, options.override);
  if (!exact.ok) {
    return {
      ok: false,
      placement: "none",
      error: exact.error ?? "That exact time is not available.",
    };
  }

  // moveBlock locks an explicit destination. Calendar drags intentionally stay
  // flexible so a later rebuild can still protect deadlines and capacity.
  usePace.getState().unlockBlock(before.id);
  const after = usePace
    .getState()
    .blocks.find((candidate) => candidate.id === before.id);
  if (!after) {
    return {
      ok: false,
      placement: "none",
      error: "The block moved but could not be read back.",
    };
  }

  const receipt =
    options.recordReceipt === false
      ? undefined
      : recordCalendarMoveReceipt(before, options.override);
  return {
    ok: true,
    placement: options.override ? "override" : "exact",
    ...(receipt?.receiptAt ? { receiptAt: receipt.receiptAt } : {}),
  };
}

/** Resize one exact end edge, keeping the block flexible and writing the same
 * durable, reversible manual receipt as a move. */
export function resizeTaskFromCalendar(
  before: Block,
  end: string,
  options: CalendarMoveOptions = {},
): CalendarMoveResult {
  const state = usePace.getState();
  const current = state.blocks.find((candidate) => candidate.id === before.id);
  if (!current) {
    return {
      ok: false,
      placement: "none",
      error: "That block no longer exists.",
    };
  }
  if (current.status !== "todo") {
    return {
      ok: false,
      placement: "none",
      error: "Only open work can be resized.",
    };
  }
  if (current.end === end) {
    return {
      ok: true,
      placement: options.override ? "override" : "exact",
    };
  }
  const resized = state.resizeBlock(before.id, end, options.override);
  if (!resized.ok) {
    return {
      ok: false,
      placement: "none",
      error: resized.error ?? "That end time is not available.",
    };
  }
  usePace.getState().unlockBlock(before.id);
  const receipt =
    options.recordReceipt === false
      ? undefined
      : recordCalendarBlockChangeReceipt(before, {
          override: options.override,
          summary: (after) =>
            `Resized “${after.title}” · ${formatTime(after.start)}–${formatTime(after.end)}`,
          reason: options.override
            ? "Extended to the exact end time selected after confirming a preference warning"
            : "Changed only the end edge after checking availability and hard conflicts",
        });
  return {
    ok: true,
    placement: options.override ? "override" : "exact",
    ...(receipt?.receiptAt ? { receiptAt: receipt.receiptAt } : {}),
  };
}

/** Schedule an unscheduled task from an external calendar drag. The store owns
 * the hard validation and the remove-on-Undo receipt. */
export function scheduleTaskFromCalendar(
  taskId: string,
  date: string,
  start: string,
  options: CalendarMoveOptions & { durationMin?: number } = {},
): CalendarScheduleResult {
  const result = usePace
    .getState()
    .scheduleTaskBlock(
      taskId,
      date,
      start,
      options.durationMin,
      options.override,
    );
  if (!result.ok) {
    return {
      ok: false,
      placement: "none",
      error: result.error ?? "That task could not be scheduled there.",
    };
  }
  return {
    ok: true,
    placement: options.override ? "override" : "exact",
    ...(result.block ? { block: result.block } : {}),
    ...(result.receiptAt ? { receiptAt: result.receiptAt } : {}),
  };
}
