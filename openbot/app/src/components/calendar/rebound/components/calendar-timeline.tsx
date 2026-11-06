import * as React from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleDashed,
  IconCirclePlus,
  IconLock,
  IconRepeat,
  IconRotate,
  IconX,
  type Icon,
} from "@tabler/icons-react";

import {
  blockStateSemantics,
  fixedItemSemantics,
} from "../lib/calendar-context";
import {
  CALENDAR_EVENT_MIN_HEIGHT,
  CALENDAR_PX_PER_HOUR,
  calendarOpenSlotSuggestion,
  calendarOccurrenceKey,
  calendarOverlapLayout,
  calendarDropMinute,
  calendarItemIntersectsWindow,
  isCalendarBusyWash,
} from "../lib/calendar-layout";
import {
  CALENDAR_RESIZE_KEYBOARD_STEP_MINUTES,
  CALENDAR_RESIZE_MIN_MINUTES,
  CALENDAR_TASK_DRAG_MIME,
  calendarTaskDragDuration,
  resizeTaskFromCalendar,
  scheduleTaskFromCalendar,
  type CalendarMoveOptions,
  type CalendarMoveResult,
} from "../lib/calendar-drag";
import {
  calendarBlockDuration,
  calendarDiscouragedWindows,
  classifyCalendarPlacement,
  rankCalendarPlacementSlots,
  type CalendarPlacementContext,
  type CalendarPlacementDecision,
  type CalendarPlacementSlot,
} from "../lib/calendar-placement";
import {
  blockColors,
  formatTime,
  minToTime,
  parseDateStr,
  timeToMin,
} from "../lib/helpers";
import { usePace } from "../lib/store";
import { deriveProfile } from "../lib/quiz";
import {
  overlaySafePopoverPosition,
  type OverlayRect,
} from "../lib/overlay-layout";
import type { AgendaItem, Block, Course } from "../lib/types";
import { cn } from "../lib/utils";

const SEMANTIC_ICONS: Partial<Record<string, Icon>> = {
  done: IconCheck,
  partial: IconCircleDashed,
  missed: IconX,
  "at-risk": IconAlertTriangle,
  locked: IconLock,
  rebounded: IconRotate,
  // Academic OS change: no glyph on fixed time. Rebound's later blocks dropped the lock, and in a
  // calendar where nothing moves it marked every class.
};

function visibleOverlayRects(): OverlayRect[] {
  if (typeof document === "undefined") return [];
  return [
    document.querySelector<HTMLElement>(".app-rail"),
    document.querySelector<HTMLElement>(".assistant-panel"),
  ]
    .filter((node): node is HTMLElement =>
      Boolean(node?.getClientRects().length),
    )
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
}

/** Academic OS change: an item's end as the timeline writes it. An event that
 * runs to midnight ends at "24:00" (minute 1440), which formatTime reads as
 * "12 PM" and minToTime stops at 11:59 PM, so it is written "12 AM", as the
 * details card and the plan card write it. */
function formatEnd(end: string | number): string {
  const minute = typeof end === "number" ? end : timeToMin(end);
  if (minute >= 24 * 60) return "12 AM";
  return formatTime(typeof end === "number" ? minToTime(end) : end);
}

/** Academic OS change, after Rebound's later timeline: an hour in the hours column as "8am",
 * "12pm" or, at the end of the day, "12am". */
function hourLabel(hour: number): string {
  return formatEnd(hour * 60)
    .replace(" ", "")
    .toLowerCase();
}

/** A finger owns the scroll until it proves otherwise: a block only takes the
 * gesture after a stationary hold, so ordinary swipes still pan the timeline. */
const TOUCH_DRAG_HOLD_MS = 300;
const TOUCH_DRAG_SLOP_PX = 8;
const CALENDAR_STICKY_HEADER_HEIGHT_PX = 40;

interface TimelineDragState {
  block: Block;
  pointerId: number;
  pointerType: string;
  /** Mouse arms on contact; touch arms only after the hold completes. */
  armed: boolean;
  /** True once the pointer travelled far enough to retarget the block. */
  moved: boolean;
  originX: number;
  originY: number;
  pointerX: number;
  pointerY: number;
  active: boolean;
  targetDate: string;
  targetMinute: number;
  decision: CalendarPlacementDecision;
}

interface TimelineResizeState {
  block: Block;
  pointerId: number;
  pointerOffsetY: number;
  targetEndMinute: number;
  decision: CalendarPlacementDecision;
}

interface ExternalTaskDropState {
  block: Block;
  taskId: string;
  targetDate: string;
  targetMinute: number;
  decision: CalendarPlacementDecision;
}

interface PlacementWarning {
  block: Block;
  date: string;
  startMinute: number;
  reason: string;
  bestSlot?: CalendarPlacementSlot;
  receiptAt?: string;
  anchorX: number;
  anchorY: number;
}

export interface CalendarTimelineProps {
  dates: string[];
  agendaByDate: AgendaItem[][];
  allBlocks?: Block[];
  courses: Course[];
  wakeMinute: number;
  sleepMinute: number;
  today: string;
  nowMinute: number;
  /** Academic OS change: true while the items drawn stand in for ones still
   * loading. A jump to now made for them runs again once the real ones land. */
  provisional?: boolean;
  selectedItemId?: string | null;
  atRiskTaskIds?: ReadonlySet<string>;
  singleDay?: boolean;
  /** Academic OS change: a row under the day headings for what owns no hours
   * (all-day events and what is due), one cell per date in `dates`, held
   * under the headings while the hours scroll. Absent, nothing is drawn. */
  allDayLane?: { height: number; cells: readonly React.ReactNode[] };
  className?: string;
  onSelectItem: (item: AgendaItem, anchor: HTMLButtonElement) => void;
  onDoubleClickBlock?: (block: Block) => void;
  onMoveTask?: (
    block: Block,
    date: string,
    start: string,
    options?: CalendarMoveOptions,
  ) => CalendarMoveResult;
  onCreateAt?: (
    date: string,
    start: string,
    point?: { x: number; y: number },
  ) => void;
  onActivateDay?: (date: string) => void;
}

export function CalendarTimeline({
  dates,
  agendaByDate,
  allBlocks,
  courses,
  wakeMinute,
  sleepMinute,
  today,
  nowMinute,
  provisional = false,
  selectedItemId,
  atRiskTaskIds,
  singleDay = false,
  allDayLane,
  className,
  onSelectItem,
  onDoubleClickBlock,
  onMoveTask,
  onCreateAt,
  onActivateDay,
}: CalendarTimelineProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const profile = usePace((state) => state.profile);
  const quizAnswers = usePace((state) => state.quizAnswers);
  const commitments = usePace((state) => state.commitments);
  const oneOffs = usePace((state) => state.oneOffs);
  const storeBlocks = usePace((state) => state.blocks);
  const tasks = usePace((state) => state.tasks);
  const routines = usePace((state) => state.routines);
  const availabilityOverrides = usePace((state) => state.availabilityOverrides);
  const learnedNotes = usePace((state) => state.learnedNotes);
  const assistantOpen = usePace((state) => state.assistantOpen);
  const [drag, setDragState] = React.useState<TimelineDragState | null>(null);
  const [resize, setResizeState] = React.useState<TimelineResizeState | null>(
    null,
  );
  const [externalTaskDrop, setExternalTaskDrop] =
    React.useState<ExternalTaskDropState | null>(null);
  const [hiddenCourseIds, setHiddenCourseIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [basePxPerHour, setBasePxPerHour] =
    React.useState(CALENDAR_PX_PER_HOUR);
  const [timelineViewportHeight, setTimelineViewportHeight] = React.useState(0);
  const gridTop = Math.floor(wakeMinute / 60) * 60;
  const gridBottom = Math.ceil(sleepMinute / 60) * 60;
  const visibleHours = Math.max(1, (gridBottom - gridTop) / 60);
  // Academic OS change: one day draws no heading row (the toolbar's title says the day), as
  // Rebound's later day view collapses it; what sits under the headings is then at the very top.
  const headerHeight = singleDay ? 0 : CALENDAR_STICKY_HEADER_HEIGHT_PX;
  const stickyChrome = headerHeight + (allDayLane?.height ?? 0);
  const fitPxPerHour = Math.max(
    0,
    (timelineViewportHeight - stickyChrome) / visibleHours,
  );
  const pxPerHour = Math.max(basePxPerHour, fitPxPerHour);
  const pxPerMinute = pxPerHour / 60;
  const [placementWarning, setPlacementWarning] =
    React.useState<PlacementWarning | null>(null);
  const [dragMessage, setDragMessage] = React.useState("");
  const [dragNotice, setDragNotice] = React.useState("");
  const [, setOverlayVersion] = React.useState(0);
  const dragRef = React.useRef<TimelineDragState | null>(null);
  const resizeRef = React.useRef<TimelineResizeState | null>(null);
  const placementWarningRef = React.useRef<PlacementWarning | null>(null);
  const dragSourceRef = React.useRef<HTMLButtonElement | null>(null);
  const resizeSourceRef = React.useRef<HTMLButtonElement | null>(null);
  const warningKeepRef = React.useRef<HTMLButtonElement | null>(null);
  const pointerRef = React.useRef({ x: 0, y: 0 });
  const messageTimerRef = React.useRef<number | null>(null);
  const longPressTimerRef = React.useRef<number | null>(null);
  const suppressClickUntilRef = React.useRef(0);
  const courseById = React.useMemo(
    () => new Map(courses.map((course) => [course.id, course])),
    [courses],
  );
  const commitmentById = React.useMemo(
    () => new Map(commitments.map((commitment) => [commitment.id, commitment])),
    [commitments],
  );
  const placementContext = React.useMemo<CalendarPlacementContext>(
    () => ({
      profile:
        profile && profile.postCommitmentBufferMin === undefined
          ? {
              ...profile,
              postCommitmentBufferMin: deriveProfile(quizAnswers ?? {})
                .postCommitmentBufferMin,
            }
          : profile,
      commitments,
      oneOffs,
      blocks: allBlocks ?? storeBlocks,
      tasks,
      routines,
      availabilityOverrides,
      learnedNotes,
      today,
      nowMinute,
    }),
    [
      allBlocks,
      availabilityOverrides,
      commitments,
      learnedNotes,
      nowMinute,
      oneOffs,
      profile,
      quizAnswers,
      routines,
      storeBlocks,
      tasks,
      today,
    ],
  );
  const gridHeight = Math.max(60, gridBottom - gridTop) * pxPerMinute;
  const hours = Array.from(
    { length: Math.floor((gridBottom - gridTop) / 60) + 1 },
    (_, index) => gridTop / 60 + index,
  );
  const openSlotSuggestion = React.useMemo(
    () =>
      singleDay || !onCreateAt
        ? null
        : calendarOpenSlotSuggestion({
            dates,
            agendaByDate,
            commitments,
            today,
            nowMinute,
            gridTop,
            gridBottom,
          }),
    [
      agendaByDate,
      commitments,
      dates,
      gridBottom,
      gridTop,
      nowMinute,
      onCreateAt,
      singleDay,
      today,
    ],
  );

  const commitDrag = React.useCallback((next: TimelineDragState | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);

  const commitResize = React.useCallback((next: TimelineResizeState | null) => {
    resizeRef.current = next;
    setResizeState(next);
  }, []);

  const commitPlacementWarning = React.useCallback(
    (next: PlacementWarning | null) => {
      placementWarningRef.current = next;
      setPlacementWarning(next);
    },
    [],
  );

  React.useEffect(() => {
    const onCourseVisibility = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const courseId =
        detail && typeof detail === "object" && "courseId" in detail
          ? detail.courseId
          : undefined;
      const visible =
        detail && typeof detail === "object" && "visible" in detail
          ? detail.visible
          : undefined;
      if (typeof courseId !== "string" || typeof visible !== "boolean") {
        return;
      }
      setHiddenCourseIds((current) => {
        const next = new Set(current);
        if (visible) next.delete(courseId);
        else next.add(courseId);
        return next;
      });
    };
    window.addEventListener(
      "pace:calendar-course-visibility",
      onCourseVisibility,
    );
    return () =>
      window.removeEventListener(
        "pace:calendar-course-visibility",
        onCourseVisibility,
      );
  }, []);

  React.useLayoutEffect(() => {
    const timeline = scrollRef.current;
    if (!timeline) return;

    const measure = () => setTimelineViewportHeight(timeline.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(timeline);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const onDensity = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const density =
        detail && typeof detail === "object" && "density" in detail
          ? detail.density
          : undefined;
      if (density === "comfortable") {
        setBasePxPerHour(CALENDAR_PX_PER_HOUR);
      } else if (density === "compact") {
        setBasePxPerHour(CALENDAR_PX_PER_HOUR * 0.8);
      }
    };
    window.addEventListener("pace:calendar-density", onDensity);
    return () => window.removeEventListener("pace:calendar-density", onDensity);
  }, []);

  /** `visible` promotes an outcome the student did not ask for — a refused or
   *  redirected drop — into a transient on-grid chip, so the move stops being
   *  screen-reader-only news. Confirmations stay in the live region. */
  const showDragMessage = React.useCallback(
    (message: string, visible = false) => {
      setDragMessage(message);
      setDragNotice(visible ? message : "");
      if (messageTimerRef.current !== null) {
        window.clearTimeout(messageTimerRef.current);
      }
      messageTimerRef.current = window.setTimeout(() => {
        setDragMessage("");
        setDragNotice("");
        messageTimerRef.current = null;
      }, 3200);
    },
    [],
  );

  /** The warning takes focus when it opens, so dismissing it has to hand focus
   *  back to the block it describes instead of dropping it on <body>. Guarded
   *  on focus still living inside the dialog: a warning dismissed by grabbing
   *  another block must not steal focus from that block. */
  const restoreBlockFocus = React.useCallback(
    (blockId: string, defer = false) => {
      const active = document.activeElement;
      if (
        !(active instanceof HTMLElement) ||
        !active.closest("[data-calendar-placement-warning]")
      ) {
        return;
      }
      const focusChip = () => {
        scrollRef.current
          ?.querySelector<HTMLButtonElement>(`[data-block-id="${blockId}"]`)
          ?.focus();
      };
      if (defer) window.requestAnimationFrame(focusChip);
      else focusChip();
    },
    [],
  );

  const keepPlacementWarning = React.useCallback(
    (warning: PlacementWarning, announce = true) => {
      restoreBlockFocus(warning.block.id);
      commitPlacementWarning(null);
      if (announce) {
        showDragMessage(
          `${warning.block.title} will stay at ${formatTime(minToTime(warning.startMinute))}.`,
        );
      }
    },
    [commitPlacementWarning, restoreBlockFocus, showDragMessage],
  );

  React.useEffect(
    () => () => {
      if (messageTimerRef.current !== null) {
        window.clearTimeout(messageTimerRef.current);
      }
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    },
    [],
  );

  const updateDragTarget = React.useCallback(
    (clientX: number, clientY: number) => {
      const current = dragRef.current;
      const scrollport = scrollRef.current;
      if (!current || !scrollport) return;
      const columns = Array.from(
        scrollport.querySelectorAll<HTMLElement>("[data-calendar-grid]"),
      );
      if (columns.length === 0) return;
      const column =
        columns.find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return clientX >= rect.left && clientX <= rect.right;
        }) ??
        columns.slice().sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          const leftDistance = Math.min(
            Math.abs(clientX - leftRect.left),
            Math.abs(clientX - leftRect.right),
          );
          const rightDistance = Math.min(
            Math.abs(clientX - rightRect.left),
            Math.abs(clientX - rightRect.right),
          );
          return leftDistance - rightDistance;
        })[0];
      if (!column) return;
      const date = column.dataset.calendarGrid;
      if (!date) return;
      const rect = column.getBoundingClientRect();
      const targetMinute = calendarDropMinute({
        clientY,
        gridTop: rect.top,
        wakeMinute: gridTop,
        sleepMinute: gridBottom,
        durationMinute: calendarBlockDuration(current.block),
        pxPerHour,
      });
      const decision = classifyCalendarPlacement(
        placementContext,
        current.block,
        date,
        targetMinute,
      );
      commitDrag({
        ...current,
        active: true,
        moved: true,
        pointerX: clientX,
        pointerY: clientY,
        targetDate: date,
        targetMinute,
        decision,
      });
    },
    [commitDrag, gridBottom, gridTop, placementContext, pxPerHour],
  );

  const clearLongPress = React.useCallback(() => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  /** The hold completed: open the ghost on the block's own slot so the pick-up
   *  is legible without moving anything the finger has not moved yet. */
  const armTouchDrag = React.useCallback(() => {
    longPressTimerRef.current = null;
    const current = dragRef.current;
    if (!current || current.armed) return;
    commitDrag({ ...current, armed: true, active: true });
  }, [commitDrag]);

  /** A finger that travelled before the hold completed was scrolling. Give the
   *  gesture back without the click suppression a real cancel needs. */
  const abandonUnarmedDrag = React.useCallback(() => {
    clearLongPress();
    const current = dragRef.current;
    if (!current || current.armed) return;
    const source = dragSourceRef.current;
    dragSourceRef.current = null;
    commitDrag(null);
    if (source?.hasPointerCapture(current.pointerId)) {
      source.releasePointerCapture(current.pointerId);
    }
  }, [clearLongPress, commitDrag]);

  const cancelDrag = React.useCallback(
    (announce = true) => {
      clearLongPress();
      const current = dragRef.current;
      if (!current) return;
      suppressClickUntilRef.current = performance.now() + 400;
      const source = dragSourceRef.current;
      dragSourceRef.current = null;
      commitDrag(null);
      if (source?.hasPointerCapture(current.pointerId)) {
        source.releasePointerCapture(current.pointerId);
      }
      if (announce) showDragMessage("Move cancelled.");
    },
    [clearLongPress, commitDrag, showDragMessage],
  );

  const updateResizeTarget = React.useCallback(
    (clientY: number) => {
      const current = resizeRef.current;
      const grid = scrollRef.current?.querySelector<HTMLElement>(
        `[data-calendar-grid="${current?.block.date ?? ""}"]`,
      );
      if (!current || !grid) return;
      const rect = grid.getBoundingClientRect();
      const startMinute = timeToMin(current.block.start);
      const rawMinute =
        gridTop + (clientY - current.pointerOffsetY - rect.top) / pxPerMinute;
      const targetEndMinute = Math.max(
        startMinute + CALENDAR_RESIZE_MIN_MINUTES,
        Math.min(gridBottom, Math.round(rawMinute / 5) * 5),
      );
      const preview = {
        ...current.block,
        end: minToTime(targetEndMinute),
      };
      const decision = classifyCalendarPlacement(
        placementContext,
        preview,
        preview.date,
        startMinute,
      );
      commitResize({ ...current, targetEndMinute, decision });
    },
    [commitResize, gridBottom, gridTop, placementContext, pxPerMinute],
  );

  const cancelResize = React.useCallback(
    (announce = true) => {
      const current = resizeRef.current;
      if (!current) return;
      suppressClickUntilRef.current = performance.now() + 350;
      const source = resizeSourceRef.current;
      resizeSourceRef.current = null;
      commitResize(null);
      if (source?.hasPointerCapture(current.pointerId)) {
        source.releasePointerCapture(current.pointerId);
      }
      if (announce) showDragMessage("Resize cancelled.");
    },
    [commitResize, showDragMessage],
  );

  const completeResize = React.useCallback(
    (current: TimelineResizeState) => {
      suppressClickUntilRef.current = performance.now() + 400;
      resizeSourceRef.current = null;
      commitResize(null);
      const originalEndMinute = timeToMin(current.block.end);
      if (current.targetEndMinute === originalEndMinute) return;
      if (current.decision.kind === "blocked") {
        showDragMessage(current.decision.reason, true);
        return;
      }
      const end = minToTime(current.targetEndMinute);
      const override = current.decision.kind === "discouraged";
      const result = resizeTaskFromCalendar(current.block, end, { override });
      if (!result.ok) {
        showDragMessage(
          result.error ??
            "That end time is not available; the block stayed unchanged.",
          true,
        );
        return;
      }
      showDragMessage(
        `${current.block.title} now ends at ${formatTime(end)}${override ? " after confirming your preference warning" : ""}.`,
      );
    },
    [commitResize, showDragMessage],
  );

  const resizeByKeyboard = React.useCallback(
    (block: Block, targetEndMinute: number) => {
      const startMinute = timeToMin(block.start);
      const endMinute = Math.max(
        startMinute + CALENDAR_RESIZE_MIN_MINUTES,
        Math.min(gridBottom, Math.round(targetEndMinute / 5) * 5),
      );
      const preview = { ...block, end: minToTime(endMinute) };
      const decision = classifyCalendarPlacement(
        placementContext,
        preview,
        block.date,
        startMinute,
      );
      if (decision.kind === "blocked") {
        showDragMessage(decision.reason, true);
        return;
      }
      const override = decision.kind === "discouraged";
      const result = resizeTaskFromCalendar(block, preview.end, { override });
      if (!result.ok) {
        showDragMessage(
          result.error ??
            "That end time is not available; the block stayed unchanged.",
          true,
        );
        return;
      }
      showDragMessage(`${block.title} now ends at ${formatTime(preview.end)}.`);
    },
    [gridBottom, placementContext, showDragMessage],
  );

  const bestSlots = React.useMemo(() => {
    if (!drag?.active) return [];
    return rankCalendarPlacementSlots({
      context: placementContext,
      block: drag.block,
      dates,
      targetDate: drag.targetDate,
      targetMinute: drag.targetMinute,
      limit: singleDay ? 3 : 7,
    });
  }, [dates, drag, placementContext, singleDay]);

  const completeDrag = React.useCallback(
    (current: TimelineDragState) => {
      suppressClickUntilRef.current = performance.now() + 500;
      dragSourceRef.current = null;
      commitDrag(null);
      // A hold the finger put straight back down is a pick-up, not a move:
      // committing it would lock the block in place for no reason.
      if (current.pointerType === "touch" && !current.moved) return;
      if (!onMoveTask) return;
      if (current.decision.kind === "blocked") {
        showDragMessage(current.decision.reason, true);
        return;
      }
      const start = minToTime(current.targetMinute);
      const override = current.decision.kind === "discouraged";
      const result = onMoveTask(current.block, current.targetDate, start, {
        override,
      });
      if (!result.ok) {
        showDragMessage(
          result.error ?? "That time is already taken — the block stayed put.",
          true,
        );
        return;
      }
      if (override) {
        const slot = rankCalendarPlacementSlots({
          context: placementContext,
          block: current.block,
          dates,
          targetDate: current.targetDate,
          targetMinute: current.targetMinute,
          limit: singleDay ? 3 : 7,
        })[0];
        commitPlacementWarning({
          block: current.block,
          date: current.targetDate,
          startMinute: current.targetMinute,
          reason: current.decision.reason,
          ...(slot ? { bestSlot: slot } : {}),
          ...(result.receiptAt ? { receiptAt: result.receiptAt } : {}),
          anchorX: current.pointerX,
          anchorY: current.pointerY,
        });
        showDragMessage(
          `${current.block.title} moved to a time you usually avoid. Review the warning.`,
        );
      } else {
        commitPlacementWarning(null);
        showDragMessage(
          `${current.block.title} moved exactly to ${formatTime(start)}.`,
        );
      }
    },
    [
      commitDrag,
      commitPlacementWarning,
      dates,
      onMoveTask,
      placementContext,
      showDragMessage,
      singleDay,
    ],
  );

  React.useEffect(() => {
    if (!drag?.active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelDrag();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancelDrag, drag?.active]);

  React.useEffect(() => {
    if (!resize) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelResize();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancelResize, resize]);

  React.useEffect(() => {
    const clearExternalDrop = () => setExternalTaskDrop(null);
    window.addEventListener("dragend", clearExternalDrop);
    window.addEventListener("drop", clearExternalDrop);
    return () => {
      window.removeEventListener("dragend", clearExternalDrop);
      window.removeEventListener("drop", clearExternalDrop);
    };
  }, []);

  // touch-action is latched when the gesture begins, so flipping the block to
  // touch-none after the hold cannot stop the pan on its own. The armed drag
  // holds the scroll off with a non-passive touchmove instead.
  const touchDragActive = drag?.active === true && drag.pointerType === "touch";
  React.useEffect(() => {
    if (!touchDragActive) return;
    const holdScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    document.addEventListener("touchmove", holdScroll, { passive: false });
    return () => document.removeEventListener("touchmove", holdScroll);
  }, [touchDragActive]);

  React.useEffect(() => {
    if (!placementWarning) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      keepPlacementWarning(placementWarning);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [keepPlacementWarning, placementWarning]);

  // An alertdialog nobody focuses is an alertdialog nobody hears.
  React.useEffect(() => {
    if (!placementWarning) return;
    warningKeepRef.current?.focus();
  }, [placementWarning]);

  React.useEffect(() => {
    if (!drag?.active) return;
    let frame = 0;
    const tick = () => {
      const scrollport = scrollRef.current;
      const current = dragRef.current;
      if (!scrollport || !current?.active) return;
      const rect = scrollport.getBoundingClientRect();
      const edge = 64;
      const { x, y } = pointerRef.current;
      const horizontal =
        x < rect.left + edge
          ? -Math.ceil(((rect.left + edge - x) / edge) * 18)
          : x > rect.right - edge
            ? Math.ceil(((x - (rect.right - edge)) / edge) * 18)
            : 0;
      const vertical =
        y < rect.top + edge
          ? -Math.ceil(((rect.top + edge - y) / edge) * 22)
          : y > rect.bottom - edge
            ? Math.ceil(((y - (rect.bottom - edge)) / edge) * 22)
            : 0;
      if (horizontal !== 0 || vertical !== 0) {
        const beforeLeft = scrollport.scrollLeft;
        const beforeTop = scrollport.scrollTop;
        scrollport.scrollBy({ left: horizontal, top: vertical });
        if (
          scrollport.scrollLeft !== beforeLeft ||
          scrollport.scrollTop !== beforeTop
        ) {
          updateDragTarget(x, y);
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [drag?.active, updateDragTarget]);

  // Academic OS change: the jump to now runs once for each set of days and grid, not again each
  // time the now line moves or the page re-renders, which pulled the timeline back mid-read. One
  // made while the items were only standing in runs once more when the real ones land.
  const scrolledForRef = React.useRef("");
  React.useEffect(() => {
    const scrollport = scrollRef.current;
    if (!scrollport) return;
    const scrolledFor = `${dates.join(",")}|${today}|${gridTop}|${pxPerMinute}${provisional ? "|provisional" : ""}`;
    if (scrolledForRef.current === scrolledFor) return;
    scrolledForRef.current = scrolledFor;
    const todayColumn = scrollport.querySelector<HTMLElement>(
      "[data-calendar-today='true']",
    );
    // Academic OS change: sideways only when part of today is out of view, and then to just right
    // of the hours column (the row's first child), rather than centred with half-days either side.
    if (todayColumn && scrollport.scrollWidth > scrollport.clientWidth) {
      const viewport = scrollport.getBoundingClientRect();
      const column = todayColumn.getBoundingClientRect();
      const start =
        todayColumn.parentElement?.firstElementChild?.getBoundingClientRect()
          .right ?? viewport.left + 64;
      const end =
        viewport.left + scrollport.clientLeft + scrollport.clientWidth;
      if (column.left < start || column.right > end) {
        scrollport.scrollLeft += column.left - start;
      }
    }
    if (dates.includes(today) && nowMinute > gridTop + 120) {
      const target = (nowMinute - gridTop) * pxPerMinute - 180;
      scrollport.scrollTop = Math.max(0, target);
    }
  }, [dates, gridTop, nowMinute, provisional, pxPerMinute, today]);

  React.useEffect(() => {
    if (!placementWarning) return;
    const refreshOverlayPosition = () => {
      setOverlayVersion((version) => version + 1);
    };
    window.addEventListener("resize", refreshOverlayPosition);
    window.addEventListener("rebound:assistant-open", refreshOverlayPosition);
    window.addEventListener("rebound:assistant-close", refreshOverlayPosition);
    return () => {
      window.removeEventListener("resize", refreshOverlayPosition);
      window.removeEventListener(
        "rebound:assistant-open",
        refreshOverlayPosition,
      );
      window.removeEventListener(
        "rebound:assistant-close",
        refreshOverlayPosition,
      );
    };
  }, [placementWarning]);

  const warningPosition = (() => {
    if (!placementWarning || typeof window === "undefined") return null;
    const width = Math.min(320, Math.max(0, window.innerWidth - 24));
    return overlaySafePopoverPosition({
      anchor: {
        left: placementWarning.anchorX,
        right: placementWarning.anchorX,
        top: placementWarning.anchorY,
        bottom: placementWarning.anchorY,
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      exclusions: visibleOverlayRects(),
      width,
      estimatedHeight: 190,
      gap: 12,
    });
  })();

  React.useEffect(() => {
    if (
      placementWarning &&
      assistantOpen &&
      warningPosition &&
      !warningPosition.fitsWithoutOverlap
    ) {
      const frame = window.requestAnimationFrame(() => {
        keepPlacementWarning(placementWarning, false);
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [assistantOpen, keepPlacementWarning, placementWarning, warningPosition]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: Rebound's scrollport is the div its ref and drag code measure; the role names it.
    <div
      ref={scrollRef}
      data-calendar-scrollport="true"
      data-calendar-single-day={singleDay ? "true" : undefined}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls takes focus, so it can be scrolled from the keyboard.
      tabIndex={0}
      role="region"
      aria-label={
        singleDay ? "Day calendar timeline" : "Week calendar timeline"
      }
      className={cn(
        "app-scroll-region relative min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-card",
        className,
      )}
      style={
        {
          // Academic OS change: how much of the top the day headings (and the all-day row) hold,
          // for what has to stay clear of them (calendar.css).
          "--calendar-sticky-chrome": `${stickyChrome}px`,
        } as React.CSSProperties
      }
    >
      {/* Mounted empty rather than with its first message: a live region that
          appears together with its text is routinely skipped. */}
      <p role="status" aria-live="polite" className="sr-only">
        {dragMessage}
      </p>
      {dragNotice && (
        <div
          data-calendar-drag-notice="true"
          className="pointer-events-none sticky left-0 top-0 z-40 flex h-0 justify-center"
          aria-hidden="true"
        >
          <p className="mt-16 flex max-w-[min(22rem,calc(100%-1rem))] items-start gap-1.5 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[12px] font-medium leading-4 text-popover-foreground">
            <IconAlertTriangle
              className="mt-px size-3.5 shrink-0 text-warm"
              aria-hidden="true"
            />
            {dragNotice}
          </p>
        </div>
      )}
      <div className="flex min-w-full w-max">
        <div className="sticky left-0 z-30 w-16 shrink-0 border-r border-border bg-card">
          {singleDay ? null : (
            <div
              data-calendar-time-gutter-header="true"
              className="sticky top-0 z-40 h-10 border-b border-border bg-card"
            />
          )}
          {allDayLane ? (
            <div
              data-calendar-all-day-gutter="true"
              className="sticky z-40 border-b border-border bg-card"
              style={{ top: headerHeight, height: allDayLane.height }}
            />
          ) : null}
          <div className="relative" style={{ height: gridHeight }}>
            {hours.map((hour) => (
              <time
                key={hour}
                dateTime={minToTime(hour * 60)}
                className="absolute right-2.5 -translate-y-1/2 text-[10px] font-normal tabular-nums text-muted-foreground"
                style={{ top: (hour * 60 - gridTop) * pxPerMinute }}
              >
                {hourLabel(hour)}
              </time>
            ))}
          </div>
        </div>

        {dates.map((date, dayIndex) => {
          const parsed = parseDateStr(date);
          const dayLabel = parsed.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          });
          const isToday = date === today;
          const positioned = calendarOverlapLayout(
            (agendaByDate[dayIndex] ?? []).filter(
              (item) => !item.courseId || !hiddenCourseIds.has(item.courseId),
            ),
            pxPerHour,
          );
          const discouragedWindows =
            drag?.active || externalTaskDrop
              ? calendarDiscouragedWindows(placementContext, date)
              : [];
          const dateSlots = drag?.active
            ? bestSlots.filter((slot) => slot.date === date)
            : [];
          const dragHere =
            drag?.active && drag.targetDate === date ? drag : null;
          const taskDropHere =
            externalTaskDrop?.targetDate === date ? externalTaskDrop : null;
          const openSlot =
            !drag?.active &&
            !externalTaskDrop &&
            openSlotSuggestion?.date === date
              ? openSlotSuggestion
              : null;
          return (
            <section
              key={date}
              data-calendar-date={date}
              data-calendar-today={isToday ? "true" : undefined}
              aria-label={dayLabel}
              className={cn(
                // lg releases the phone/tablet floor but keeps one of its
                // own: with the assistant drawer open a seven-day week at
                // 1024px collapses to unreadable ~66px columns, and the
                // scrollport is there to pan instead.
                "min-w-44 flex-1 border-r border-border/65 last:border-r-0 md:min-w-48 lg:min-w-28",
                singleDay && "min-w-0",
              )}
            >
              {singleDay ? null : (
                <button
                  type="button"
                  data-calendar-sticky-header="true"
                  className={cn(
                    "sticky top-0 z-30 flex h-10 w-full items-center justify-center gap-1.5 border-b border-border bg-card px-2 text-[0.8125rem] outline-none transition-colors",
                    "hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-inset",
                  )}
                  onClick={() => onActivateDay?.(date)}
                  aria-label={onActivateDay ? `Open ${dayLabel}` : dayLabel}
                >
                  <span
                    className={cn(
                      "font-normal text-muted-foreground",
                      isToday && "font-semibold text-foreground",
                    )}
                  >
                    {parsed.toLocaleDateString("en-US", {
                      weekday: singleDay ? "long" : "short",
                    })}
                  </span>
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full tabular-nums",
                      isToday
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "font-normal text-muted-foreground",
                    )}
                  >
                    {parsed.getDate()}
                  </span>
                </button>
              )}
              {/* Academic OS change: the cell's width comes from its day, never from its chips, so a
                  long title is cut short in its chip instead of widening every day of the week. */}
              {allDayLane ? (
                <div
                  data-calendar-all-day={date}
                  className="sticky z-30 flex min-w-0 flex-col gap-0.5 overflow-hidden border-b border-border bg-card px-1 py-[3px] [contain:inline-size]"
                  style={{ top: headerHeight, height: allDayLane.height }}
                >
                  {allDayLane.cells[dayIndex]}
                </div>
              ) : null}
              {/* Academic OS change, after Rebound's later timeline: a block that began before the
                  hours in view is cut by the headings; this zero-height wash under them dissolves
                  whatever crosses the edge (calendar.css) instead of leaving a hard bar of colour. */}
              <div
                data-calendar-grid-fade="true"
                aria-hidden="true"
                className="pointer-events-none sticky z-20 h-0"
                style={{ top: stickyChrome }}
              />

              {/* biome-ignore lint/a11y/useKeyWithClickEvents: a click on the empty grid only creates at a time, which the read-only calendar never offers. */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the grid is the drop and click surface behind the items, and every item is its own button. */}
              <div
                data-calendar-grid={date}
                data-calendar-grid-start-minute={gridTop}
                data-calendar-grid-end-minute={gridBottom}
                className="relative bg-transparent"
                style={{ height: gridHeight }}
                onDragOver={(event) => {
                  if (
                    !Array.from(event.dataTransfer.types).includes(
                      CALENDAR_TASK_DRAG_MIME,
                    )
                  ) {
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const taskId = event.dataTransfer.getData(
                    CALENDAR_TASK_DRAG_MIME,
                  );
                  const task = tasks.find(
                    (candidate) => candidate.id === taskId && !candidate.done,
                  );
                  if (!task) return;
                  const durationMinute = calendarTaskDragDuration(
                    task,
                    allBlocks ?? storeBlocks,
                  );
                  const rect = event.currentTarget.getBoundingClientRect();
                  const targetMinute = calendarDropMinute({
                    clientY: event.clientY,
                    gridTop: rect.top,
                    wakeMinute: gridTop,
                    sleepMinute: gridBottom,
                    durationMinute,
                    pxPerHour,
                  });
                  const block: Block = {
                    id: `calendar-task-preview-${task.id}`,
                    date,
                    start: minToTime(targetMinute),
                    end: minToTime(targetMinute + durationMinute),
                    kind: "task",
                    refId: task.id,
                    title: task.title,
                    ...(task.courseId ? { courseId: task.courseId } : {}),
                    status: "todo",
                  };
                  setExternalTaskDrop({
                    block,
                    taskId: task.id,
                    targetDate: date,
                    targetMinute,
                    decision: classifyCalendarPlacement(
                      placementContext,
                      block,
                      date,
                      targetMinute,
                    ),
                  });
                }}
                onDragLeave={(event) => {
                  if (
                    event.relatedTarget instanceof Node &&
                    event.currentTarget.contains(event.relatedTarget)
                  ) {
                    return;
                  }
                  if (externalTaskDrop?.targetDate === date) {
                    setExternalTaskDrop(null);
                  }
                }}
                onDrop={(event) => {
                  if (
                    !Array.from(event.dataTransfer.types).includes(
                      CALENDAR_TASK_DRAG_MIME,
                    )
                  ) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  suppressClickUntilRef.current = performance.now() + 500;
                  const taskId = event.dataTransfer.getData(
                    CALENDAR_TASK_DRAG_MIME,
                  );
                  const task = tasks.find(
                    (candidate) => candidate.id === taskId && !candidate.done,
                  );
                  if (!task) {
                    setExternalTaskDrop(null);
                    showDragMessage("That open task no longer exists.", true);
                    return;
                  }
                  const durationMinute = calendarTaskDragDuration(
                    task,
                    allBlocks ?? storeBlocks,
                  );
                  const rect = event.currentTarget.getBoundingClientRect();
                  const targetMinute = calendarDropMinute({
                    clientY: event.clientY,
                    gridTop: rect.top,
                    wakeMinute: gridTop,
                    sleepMinute: gridBottom,
                    durationMinute,
                    pxPerHour,
                  });
                  const preview: Block = {
                    id: `calendar-task-preview-${task.id}`,
                    date,
                    start: minToTime(targetMinute),
                    end: minToTime(targetMinute + durationMinute),
                    kind: "task",
                    refId: task.id,
                    title: task.title,
                    ...(task.courseId ? { courseId: task.courseId } : {}),
                    status: "todo",
                  };
                  const decision = classifyCalendarPlacement(
                    placementContext,
                    preview,
                    date,
                    targetMinute,
                  );
                  setExternalTaskDrop(null);
                  if (decision.kind === "blocked") {
                    showDragMessage(decision.reason, true);
                    return;
                  }
                  const result = scheduleTaskFromCalendar(
                    task.id,
                    date,
                    minToTime(targetMinute),
                    {
                      durationMin: durationMinute,
                      override: decision.kind === "discouraged",
                    },
                  );
                  if (!result.ok) {
                    showDragMessage(
                      result.error ?? "That task could not be scheduled there.",
                      true,
                    );
                    return;
                  }
                  showDragMessage(
                    `${task.title} scheduled at ${formatTime(minToTime(targetMinute))}.`,
                  );
                }}
                onClick={(event) => {
                  if (!onCreateAt || event.target !== event.currentTarget)
                    return;
                  if (
                    dragRef.current ||
                    performance.now() < suppressClickUntilRef.current
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                  const rect = event.currentTarget.getBoundingClientRect();
                  const minute = calendarDropMinute({
                    clientY: event.clientY,
                    gridTop: rect.top,
                    wakeMinute: gridTop,
                    sleepMinute: gridBottom,
                    durationMinute: 30,
                    pxPerHour,
                  });
                  onCreateAt(date, minToTime(minute), {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                {hours.slice(1).map((hour) => (
                  <div
                    key={hour}
                    className="pointer-events-none absolute inset-x-0 border-t border-border/65"
                    style={{
                      top: (hour * 60 - gridTop) * pxPerMinute,
                    }}
                    aria-hidden="true"
                  />
                ))}
                {(drag?.active || externalTaskDrop) &&
                  Array.from({
                    length: Math.floor((gridBottom - gridTop) / 30),
                  }).map((_, index) =>
                    index % 2 === 1 ? (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: the half-hour lines are fixed in order down the grid.
                        key={`half-${index}`}
                        className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/30"
                        style={{ top: (index + 1) * 30 * pxPerMinute }}
                        aria-hidden="true"
                      />
                    ) : null,
                  )}

                {discouragedWindows.map((window, index) => {
                  const start = Math.max(gridTop, window.startMinute);
                  const end = Math.min(gridBottom, window.endMinute);
                  if (end <= start) return null;
                  return (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: two windows may share a span, so the index keeps their keys apart.
                      key={`discouraged-${window.startMinute}-${window.endMinute}-${index}`}
                      data-calendar-discouraged-zone="true"
                      data-placement-guide="discouraged"
                      data-placement-kind="discouraged"
                      data-calendar-date={date}
                      data-calendar-start-minute={window.startMinute}
                      data-calendar-end-minute={window.endMinute}
                      className="pointer-events-none absolute inset-x-1 z-[1] rounded-[6px] bg-amber-500/[0.08]"
                      style={{
                        top: (start - gridTop) * pxPerMinute,
                        height: Math.max(5, (end - start) * pxPerMinute),
                      }}
                      title={window.reason}
                      aria-hidden="true"
                    />
                  );
                })}

                {dateSlots.map((slot) => {
                  const duration = drag
                    ? calendarBlockDuration(drag.block)
                    : 30;
                  return (
                    <div
                      key={`slot-${slot.date}-${slot.startMinute}`}
                      data-calendar-placement-guide="best"
                      data-placement-kind={slot.kind}
                      data-calendar-date={slot.date}
                      data-calendar-start-minute={slot.startMinute}
                      className="pointer-events-none absolute inset-x-1 z-[3] rounded-[6px] bg-primary/[0.09]"
                      style={{
                        top: (slot.startMinute - gridTop) * pxPerMinute,
                        height: Math.max(
                          CALENDAR_EVENT_MIN_HEIGHT,
                          duration * pxPerMinute,
                        ),
                      }}
                      aria-hidden="true"
                    />
                  );
                })}

                {dragHere && (
                  <div
                    data-calendar-drag-ghost="true"
                    data-placement-kind={dragHere.decision.kind}
                    data-calendar-date={date}
                    data-calendar-start-minute={dragHere.targetMinute}
                    className={cn(
                      "pointer-events-none absolute inset-x-1 z-[25] overflow-hidden rounded-[6px] border-2 px-2 py-1.5 text-left",
                      dragHere.decision.kind === "preferred" &&
                        "bg-blue-500/24 text-blue-950 dark:text-blue-50",
                      dragHere.decision.kind === "available" &&
                        "bg-blue-400/18 text-foreground",
                      dragHere.decision.kind === "discouraged" &&
                        "bg-amber-500/18 text-amber-950 dark:text-amber-50",
                      dragHere.decision.kind === "blocked" &&
                        "bg-slate-500/16 text-foreground opacity-75",
                    )}
                    style={{
                      top: (dragHere.targetMinute - gridTop) * pxPerMinute,
                      height: Math.max(
                        CALENDAR_EVENT_MIN_HEIGHT,
                        calendarBlockDuration(dragHere.block) * pxPerMinute,
                      ),
                    }}
                    aria-hidden="true"
                  >
                    <p className="truncate text-[13px] font-semibold leading-4">
                      {dragHere.block.title}
                    </p>
                    <p className="truncate text-[12px] leading-4 opacity-80 tabular-nums">
                      {formatTime(minToTime(dragHere.targetMinute))} ·{" "}
                      {dragHere.decision.reason}
                    </p>
                  </div>
                )}

                {taskDropHere && (
                  <div
                    data-calendar-task-drop-ghost="true"
                    data-placement-kind={taskDropHere.decision.kind}
                    data-calendar-date={date}
                    data-calendar-start-minute={taskDropHere.targetMinute}
                    className={cn(
                      "pointer-events-none absolute inset-x-1 z-[25] overflow-hidden rounded-[6px] border-2 px-2 py-1.5 text-left",
                      taskDropHere.decision.kind === "preferred" &&
                        "bg-blue-500/24 text-blue-950 dark:text-blue-50",
                      taskDropHere.decision.kind === "available" &&
                        "bg-blue-400/18 text-foreground",
                      taskDropHere.decision.kind === "discouraged" &&
                        "bg-amber-500/18 text-amber-950 dark:text-amber-50",
                      taskDropHere.decision.kind === "blocked" &&
                        "bg-slate-500/16 text-foreground opacity-75",
                    )}
                    style={{
                      top: (taskDropHere.targetMinute - gridTop) * pxPerMinute,
                      height: Math.max(
                        CALENDAR_EVENT_MIN_HEIGHT,
                        calendarBlockDuration(taskDropHere.block) * pxPerMinute,
                      ),
                    }}
                    aria-hidden="true"
                  >
                    <p className="truncate text-[13px] font-semibold leading-4">
                      {taskDropHere.block.title}
                    </p>
                    <p className="truncate text-[12px] leading-4 opacity-80 tabular-nums">
                      {formatTime(minToTime(taskDropHere.targetMinute))} ·{" "}
                      {taskDropHere.decision.reason}
                    </p>
                  </div>
                )}

                {openSlot && (
                  <button
                    type="button"
                    data-calendar-open-slot-suggestion="true"
                    data-calendar-date={date}
                    data-calendar-start-minute={openSlot.startMinute}
                    className="absolute inset-x-1 z-[2] flex flex-col items-start justify-start overflow-hidden rounded-[6px] bg-primary/[0.06] px-2 py-1.5 text-left text-primary outline-none transition-colors hover:bg-primary/[0.1] focus-visible:ring-2 focus-visible:ring-primary/40"
                    style={{
                      top: (openSlot.startMinute - gridTop) * pxPerMinute,
                      height: Math.max(
                        CALENDAR_EVENT_MIN_HEIGHT,
                        (openSlot.endMinute - openSlot.startMinute) *
                          pxPerMinute,
                      ),
                    }}
                    aria-label={`Open ${formatTime(minToTime(openSlot.startMinute))} to ${formatTime(minToTime(openSlot.endMinute))}. No ${openSlot.sourceTitle} today. Add study or a task.`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCreateAt?.(date, minToTime(openSlot.startMinute), {
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  >
                    <span className="flex w-full items-center gap-1 text-[12.5px] font-semibold leading-4">
                      <IconCirclePlus
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="truncate">
                        Open {formatTime(minToTime(openSlot.startMinute))} –{" "}
                        {formatTime(minToTime(openSlot.endMinute))}
                      </span>
                    </span>
                  </button>
                )}

                {isToday && nowMinute >= gridTop && nowMinute <= gridBottom && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center gap-1"
                    style={{
                      top: (nowMinute - gridTop) * pxPerMinute,
                    }}
                    aria-hidden="true"
                  >
                    {/* "Now" has to stay findable on top of a saturated block
                        fill, so the dot carries a card-colored ring and the
                        rule is a full pixel-and-a-half rather than a hairline.
                        The time reads as a quiet card-backed marker, not an
                        alarm pill. */}
                    <span className="calendar-now-dot size-2.5 -translate-x-1 rounded-full bg-[var(--calendar-now,#CD5E5A)] ring-2 ring-[var(--card)]" />
                    <span
                      data-calendar-now-time="true"
                      className="rounded-full bg-[var(--card)] px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-[color-mix(in_oklab,var(--calendar-now)_78%,var(--foreground))]"
                    >
                      {formatTime(minToTime(nowMinute))}
                    </span>
                    <span className="h-[1.5px] flex-1 bg-[var(--calendar-now,#CD5E5A)]" />
                  </div>
                )}

                {positioned
                  .filter(({ item }) =>
                    calendarItemIntersectsWindow({
                      startMinute: timeToMin(item.start),
                      endMinute: timeToMin(item.end),
                      windowStartMinute: gridTop,
                      windowEndMinute: gridBottom,
                    }),
                  )
                  .map(({ item, lane, laneCount }) => {
                    const block =
                      item.kind === "block" ? item.block : undefined;
                    const start = Math.max(gridTop, timeToMin(item.start));
                    const activeResize =
                      block && resize?.block.id === block.id ? resize : null;
                    const end = Math.min(
                      gridBottom,
                      activeResize?.targetEndMinute ?? timeToMin(item.end),
                    );
                    const top = (start - gridTop) * pxPerMinute;
                    const height = Math.max(
                      CALENDAR_EVENT_MIN_HEIGHT,
                      (end - start) * pxPerMinute - 3,
                    );
                    const courseColor = item.courseId
                      ? courseById.get(item.courseId)?.color
                      : undefined;
                    const colorRole =
                      block?.kind ??
                      (item.kind === "commitment" &&
                      commitmentById.get(item.id)?.kind === "activity"
                        ? "routine"
                        : "event");
                    const colors = blockColors(
                      courseColor,
                      block?.refId ?? item.id,
                      colorRole,
                    );
                    const semantics = block
                      ? blockStateSemantics(block, {
                          atRisk:
                            block.kind === "task" &&
                            atRiskTaskIds?.has(block.refId),
                        })
                      : fixedItemSemantics();
                    const StateIcon = semantics.glyph
                      ? SEMANTIC_ICONS[semantics.glyph]
                      : undefined;
                    const Icon =
                      StateIcon ??
                      (block?.kind === "routine" ? IconRepeat : undefined);
                    const selected =
                      selectedItemId === calendarOccurrenceKey(item);
                    const edge = 4;
                    const lanePercent = 100 / laneCount;
                    const movable = Boolean(
                      onMoveTask && block && block.status === "todo",
                    );
                    const resizable = Boolean(
                      block && block.kind === "task" && movable,
                    );
                    const moving = Boolean(
                      drag?.active && block && drag.block.id === block.id,
                    );
                    const resizing = Boolean(activeResize);
                    const fixed = !block;
                    // Reclaim's two-intensity rule: anything already behind the
                    // student — resolved (done/missed) OR simply past by the
                    // clock, fixed commitments included — drops to a washed
                    // same-hue tint instead of opacity dimming, so "where am I
                    // in time" reads from tint alone.
                    const pastByClock =
                      date < today ||
                      (isToday && timeToMin(item.end) <= nowMinute);
                    const washed =
                      pastByClock ||
                      block?.status === "done" ||
                      block?.status === "partial" ||
                      block?.status === "missed";
                    const busyWash = isCalendarBusyWash(item);
                    if (busyWash) {
                      return (
                        <button
                          key={item.id}
                          type="button"
                          draggable={false}
                          data-calendar-item-id={item.id}
                          data-calendar-kind="fixed"
                          data-calendar-course-id={item.courseId}
                          data-calendar-color-role="busy"
                          data-calendar-busy-wash="true"
                          data-calendar-date={date}
                          data-calendar-start-minute={timeToMin(item.start)}
                          data-calendar-duration-minute={Math.max(
                            5,
                            timeToMin(item.end) - timeToMin(item.start),
                          )}
                          data-calendar-flexible="false"
                          aria-pressed={selected}
                          aria-label={`${item.title}, ${formatTime(item.start)} to ${formatEnd(item.end)}${semantics.ariaStates}`}
                          title={`${item.title} · ${formatTime(item.start)} – ${formatEnd(item.end)}`}
                          className="calendar-busy-wash absolute inset-x-1 z-[1] rounded-[10px] border text-left outline-none focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                          style={{
                            top,
                            height: Math.max(1, (end - start) * pxPerMinute),
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectItem(item, event.currentTarget);
                          }}
                        >
                          <span className="calendar-busy-wash-label">
                            <span className="calendar-busy-wash-copy">
                              <strong>{item.title}</strong>
                              <time>
                                {formatTime(item.start)} – {formatEnd(item.end)}
                              </time>
                            </span>
                          </span>
                        </button>
                      );
                    }
                    return (
                      <React.Fragment key={item.id}>
                        <button
                          type="button"
                          draggable={false}
                          data-block-id={block?.id}
                          data-calendar-item-id={item.id}
                          data-calendar-kind={block?.kind ?? "fixed"}
                          data-calendar-course-id={item.courseId}
                          data-calendar-color-role={colorRole}
                          data-calendar-date={date}
                          data-calendar-start-minute={timeToMin(item.start)}
                          data-calendar-duration-minute={Math.max(
                            5,
                            end - timeToMin(item.start),
                          )}
                          data-calendar-flexible={movable ? "true" : "false"}
                          aria-pressed={selected}
                          aria-label={`${item.title}, ${formatTime(item.start)} to ${formatEnd(end)}${semantics.ariaStates}${resizable ? ". End time can be resized." : ""}`}
                          title={`${item.title} · ${formatTime(item.start)} – ${formatEnd(end)}`}
                          className={cn(
                            "reclaim-calendar-card absolute z-[2] flex flex-col items-start justify-start overflow-hidden px-2 py-1.5 text-left outline-none",
                            "hover:z-10 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
                            fixed && "calendar-commitment-card",
                            movable && "cursor-grab active:cursor-grabbing",
                            resizable && "pb-3",
                            moving && "opacity-30",
                            resizing && "z-20 ring-2 ring-primary/55",
                            block?.status === "done" && "calendar-card-done",
                            washed && "calendar-card-past",
                          )}
                          style={{
                            top,
                            height,
                            left: `calc(${lane * lanePercent}% + ${lane === 0 ? edge : 2}px)`,
                            width: `calc(${lanePercent}% - ${laneCount === 1 ? edge * 2 : 6}px)`,
                            backgroundColor: colors.bg,
                            color: colors.fg,
                            // Scroll stays native until the hold arms the drag —
                            // the armed drag suppresses panning via the document
                            // touchmove listener above, not by latching
                            // touch-action:none here (which hijacked every swipe).
                            touchAction: movable ? "manipulation" : undefined,
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (
                              performance.now() < suppressClickUntilRef.current
                            ) {
                              event.preventDefault();
                              return;
                            }
                            onSelectItem(item, event.currentTarget);
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            if (
                              performance.now() < suppressClickUntilRef.current
                            ) {
                              event.preventDefault();
                              return;
                            }
                            if (block) onDoubleClickBlock?.(block);
                          }}
                          onPointerDown={(event) => {
                            if (!block || !movable || !onMoveTask) return;
                            if (
                              event.pointerType === "mouse" &&
                              event.button !== 0
                            ) {
                              return;
                            }
                            const pendingWarning = placementWarningRef.current;
                            if (pendingWarning) {
                              keepPlacementWarning(pendingWarning, false);
                            }
                            pointerRef.current = {
                              x: event.clientX,
                              y: event.clientY,
                            };
                            const decision = classifyCalendarPlacement(
                              placementContext,
                              block,
                              date,
                              timeToMin(item.start),
                            );
                            const touch = event.pointerType === "touch";
                            const next: TimelineDragState = {
                              block,
                              pointerId: event.pointerId,
                              pointerType: event.pointerType,
                              armed: !touch,
                              moved: false,
                              originX: event.clientX,
                              originY: event.clientY,
                              pointerX: event.clientX,
                              pointerY: event.clientY,
                              active: false,
                              targetDate: date,
                              targetMinute: timeToMin(item.start),
                              decision,
                            };
                            dragSourceRef.current = event.currentTarget;
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            commitDrag(next);
                            if (touch) {
                              clearLongPress();
                              longPressTimerRef.current = window.setTimeout(
                                armTouchDrag,
                                TOUCH_DRAG_HOLD_MS,
                              );
                            }
                          }}
                          onPointerMove={(event) => {
                            const activeDrag = dragRef.current;
                            if (
                              !activeDrag ||
                              activeDrag.pointerId !== event.pointerId
                            ) {
                              return;
                            }
                            pointerRef.current = {
                              x: event.clientX,
                              y: event.clientY,
                            };
                            const distance = Math.hypot(
                              event.clientX - activeDrag.originX,
                              event.clientY - activeDrag.originY,
                            );
                            if (!activeDrag.armed) {
                              // A finger that travels before the hold completes is
                              // scrolling — hand the gesture back to the browser.
                              if (distance > TOUCH_DRAG_SLOP_PX)
                                abandonUnarmedDrag();
                              return;
                            }
                            if (!activeDrag.active && distance < 6) return;
                            event.preventDefault();
                            updateDragTarget(event.clientX, event.clientY);
                          }}
                          onPointerUp={(event) => {
                            clearLongPress();
                            const activeDrag = dragRef.current;
                            if (
                              !activeDrag ||
                              activeDrag.pointerId !== event.pointerId
                            ) {
                              return;
                            }
                            if (!activeDrag.active) {
                              dragSourceRef.current = null;
                              commitDrag(null);
                              if (
                                event.currentTarget.hasPointerCapture(
                                  event.pointerId,
                                )
                              ) {
                                event.currentTarget.releasePointerCapture(
                                  event.pointerId,
                                );
                              }
                              return;
                            }
                            event.preventDefault();
                            completeDrag(activeDrag);
                            if (
                              event.currentTarget.hasPointerCapture(
                                event.pointerId,
                              )
                            ) {
                              event.currentTarget.releasePointerCapture(
                                event.pointerId,
                              );
                            }
                          }}
                          onPointerCancel={() => {
                            // The browser reclaiming an unarmed touch (to scroll)
                            // is routine, not a cancelled move — no click
                            // suppression, no announcement.
                            if (dragRef.current && !dragRef.current.armed) {
                              abandonUnarmedDrag();
                            } else {
                              cancelDrag(false);
                            }
                          }}
                          onLostPointerCapture={() => {
                            if (dragRef.current?.active) cancelDrag(false);
                          }}
                        >
                          {/* Every line must FIT before it draws: a partially
                          clipped row reads as a rendering bug, not truncation.
                          Budgets (worst case = resizable pb-3): one title line
                          + time needs 45px, a second title line needs 59px —
                          so the time waits for 48px and the second title line
                          waits for 62px. The full range and title stay in the
                          tooltip and aria-label. */}
                          <p
                            className={cn(
                              "flex w-full items-start gap-1 text-[11px] leading-[14px] tracking-[-0.005em]",
                              fixed
                                ? "font-medium opacity-90"
                                : "font-semibold",
                            )}
                          >
                            {Icon && (
                              <Icon
                                className="mt-px size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                            <span
                              className={cn(
                                "calendar-card-title",
                                height >= 62 ? "line-clamp-2" : "truncate",
                              )}
                            >
                              {item.title}
                            </span>
                          </p>
                          {height >= Math.max(48, pxPerHour * 0.75) && (
                            <p
                              className={cn(
                                "w-full truncate text-[10px] leading-[13px] tabular-nums",
                                // The washed tier already mutes its ink; stacking
                                // opacity on top pushed 12px text below AA — and
                                // 75% sat at ≈4.1–4.5:1 on the stronger course
                                // tints, so the time line runs at 85%.
                                !washed && "opacity-85",
                              )}
                            >
                              {formatTime(item.start)} – {formatEnd(end)}
                            </p>
                          )}
                        </button>
                        {resizable && block && (
                          <button
                            type="button"
                            role="slider"
                            aria-orientation="vertical"
                            aria-label={`Resize ${block.title} end time`}
                            aria-valuemin={
                              timeToMin(block.start) +
                              CALENDAR_RESIZE_MIN_MINUTES
                            }
                            aria-valuemax={gridBottom}
                            aria-valuenow={end}
                            aria-valuetext={`Ends at ${formatTime(minToTime(end))}`}
                            data-calendar-resize-handle="end"
                            data-calendar-resize-block-id={block.id}
                            data-calendar-course-id={item.courseId}
                            className={cn(
                              // A real 24px square sits over the lower-right corner
                              // instead of spanning the event. The main event keeps
                              // a full-height target to its left, while the visible
                              // 2px grip remains at the original compact edge.
                              "absolute z-[7] h-6 w-6 cursor-ns-resize rounded-b-[7px] outline-none touch-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-inset",
                              "after:absolute after:top-2 after:left-1/2 after:h-[2px] after:w-4 after:-translate-x-1/2 after:rounded-full after:bg-current after:opacity-45 after:content-[''] hover:after:opacity-85",
                              "motion-reduce:transition-none",
                              resizing &&
                                activeResize?.decision.kind === "blocked" &&
                                "text-red-100",
                              resizing &&
                                activeResize?.decision.kind !== "blocked" &&
                                "text-blue-100",
                            )}
                            style={{
                              top: top + height - 12,
                              right: `calc(${(laneCount - lane - 1) * lanePercent}% + ${laneCount === 1 ? edge : lane === 0 ? 2 : 4}px)`,
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onPointerDown={(event) => {
                              if (
                                event.pointerType === "mouse" &&
                                event.button !== 0
                              ) {
                                return;
                              }
                              event.preventDefault();
                              event.stopPropagation();
                              const grid =
                                event.currentTarget.closest<HTMLElement>(
                                  "[data-calendar-grid]",
                                );
                              if (!grid) return;
                              const pendingWarning =
                                placementWarningRef.current;
                              if (pendingWarning) {
                                keepPlacementWarning(pendingWarning, false);
                              }
                              const rect = grid.getBoundingClientRect();
                              const pointerOffsetY =
                                event.clientY -
                                (rect.top +
                                  (timeToMin(block.end) - gridTop) *
                                    pxPerMinute);
                              const next: TimelineResizeState = {
                                block,
                                pointerId: event.pointerId,
                                pointerOffsetY,
                                targetEndMinute: timeToMin(block.end),
                                decision: classifyCalendarPlacement(
                                  placementContext,
                                  block,
                                  block.date,
                                  timeToMin(block.start),
                                ),
                              };
                              resizeSourceRef.current = event.currentTarget;
                              event.currentTarget.setPointerCapture(
                                event.pointerId,
                              );
                              commitResize(next);
                            }}
                            onPointerMove={(event) => {
                              const current = resizeRef.current;
                              if (
                                !current ||
                                current.pointerId !== event.pointerId
                              ) {
                                return;
                              }
                              event.preventDefault();
                              event.stopPropagation();
                              updateResizeTarget(event.clientY);
                            }}
                            onPointerUp={(event) => {
                              const current = resizeRef.current;
                              if (
                                !current ||
                                current.pointerId !== event.pointerId
                              ) {
                                return;
                              }
                              event.preventDefault();
                              event.stopPropagation();
                              completeResize(current);
                              if (
                                event.currentTarget.hasPointerCapture(
                                  event.pointerId,
                                )
                              ) {
                                event.currentTarget.releasePointerCapture(
                                  event.pointerId,
                                );
                              }
                            }}
                            onPointerCancel={() => cancelResize(false)}
                            onLostPointerCapture={() => {
                              if (resizeRef.current) cancelResize(false);
                            }}
                            onKeyDown={(event) => {
                              const currentEnd = timeToMin(block.end);
                              let targetEnd: number | null = null;
                              if (event.key === "ArrowUp") {
                                targetEnd =
                                  currentEnd -
                                  CALENDAR_RESIZE_KEYBOARD_STEP_MINUTES;
                              } else if (event.key === "ArrowDown") {
                                targetEnd =
                                  currentEnd +
                                  CALENDAR_RESIZE_KEYBOARD_STEP_MINUTES;
                              } else if (event.key === "Home") {
                                targetEnd =
                                  timeToMin(block.start) +
                                  CALENDAR_RESIZE_MIN_MINUTES;
                              } else if (event.key === "End") {
                                targetEnd = gridBottom;
                              }
                              if (targetEnd === null) return;
                              event.preventDefault();
                              event.stopPropagation();
                              resizeByKeyboard(block, targetEnd);
                            }}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
              </div>
            </section>
          );
        })}
      </div>

      {placementWarning && warningPosition && (
        <div
          role="alertdialog"
          aria-labelledby="calendar-placement-warning-title"
          aria-describedby="calendar-placement-warning-description"
          data-calendar-placement-warning="true"
          data-best-date={placementWarning.bestSlot?.date}
          data-best-start={placementWarning.bestSlot?.startMinute}
          className="shell-layer-popover fixed w-[min(320px,calc(100vw-24px))] rounded-xl border border-red-300 bg-popover p-3 text-popover-foreground dark:border-red-900"
          style={{
            left: warningPosition.left,
            top: warningPosition.top,
          }}
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-700 dark:text-red-300">
              <IconAlertTriangle className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id="calendar-placement-warning-title"
                className="text-sm font-semibold"
              >
                This is a time you usually avoid
              </h2>
              <p
                id="calendar-placement-warning-description"
                className="mt-1 text-xs leading-5 text-muted-foreground"
              >
                {placementWarning.reason}. Your block is already at{" "}
                {formatTime(minToTime(placementWarning.startMinute))}; keep it
                there or move it to Rebound&apos;s best open time.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="min-h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                keepPlacementWarning(placementWarning);
              }}
            >
              Keep here
            </button>
            <button
              type="button"
              className="min-h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!placementWarning.bestSlot || !onMoveTask}
              onClick={() => {
                const slot = placementWarning.bestSlot;
                if (!slot || !onMoveTask) return;
                const result = onMoveTask(
                  placementWarning.block,
                  slot.date,
                  minToTime(slot.startMinute),
                );
                if (!result.ok) {
                  showDragMessage(
                    result.error ?? "The recommended time is no longer open.",
                  );
                  return;
                }
                if (
                  placementWarning.receiptAt &&
                  placementWarning.receiptAt !== result.receiptAt
                ) {
                  usePace
                    .getState()
                    .dismissHealNote(placementWarning.receiptAt);
                }
                commitPlacementWarning(null);
                showDragMessage(
                  `${placementWarning.block.title} moved to ${formatTime(minToTime(slot.startMinute))}.`,
                );
              }}
            >
              Move to best time
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
