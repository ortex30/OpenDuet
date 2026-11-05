import { commitmentsForDate } from "./calendar-occurrences";
import { timeToMin } from "./helpers";
import type { AgendaItem, Commitment } from "./types";

// Reset by pointer precision, not viewport width: tablets are wider than sm
// but still touch-first, and dropping them to 28px controls was the audit's
// most-repeated mobile finding.
export const calendarMobileTouchTarget =
  "min-h-11 min-w-11 sm:pointer-fine:min-h-0 sm:pointer-fine:min-w-0";

/** Notion Calendar density: one waking day remains legible at laptop height
 * while timed work still has a readable minimum card surface. */
export const CALENDAR_PX_PER_HOUR = 48;
export const CALENDAR_PX_PER_MINUTE = CALENDAR_PX_PER_HOUR / 60;
// Short items keep a readable control surface even at the denser Notion scale.
// 24 is also exactly the WCAG 2.5.8 minimum target size.
export const CALENDAR_EVENT_MIN_HEIGHT = 24;
export const CALENDAR_FIXED_WASH_MIN_MINUTES = 240;

/** Long recurring commitments describe unavailable time more clearly as a
 * background wash than as an event card competing with flexible work. */
export function isCalendarBusyWash(item: AgendaItem): boolean {
  return (
    item.kind === "commitment" &&
    timeToMin(item.end) - timeToMin(item.start) >=
      CALENDAR_FIXED_WASH_MIN_MINUTES
  );
}

/** Recurring commitments reuse their source id across every rendered day.
 * Selection state must include the date so opening Tuesday's class does not
 * highlight every occurrence (or reopen Monday's details). */
export function calendarOccurrenceKey(
  item: Pick<AgendaItem, "id" | "date">,
): string {
  return `${item.date}::${item.id}`;
}

export interface PositionedCalendarItem {
  item: AgendaItem;
  lane: number;
  laneCount: number;
}

type PendingCalendarItem = Omit<PositionedCalendarItem, "laneCount">;

/** Assign true side-by-side lanes to each overlap cluster. Display-height is
 * included in collision detection so short cards never cover one another just
 * because their readable surface is taller than their natural duration. */
export function calendarOverlapLayout(
  items: AgendaItem[],
  pxPerHour = CALENDAR_PX_PER_HOUR,
): PositionedCalendarItem[] {
  const sorted = items
    .slice()
    .sort(
      (a, b) =>
        timeToMin(a.start) - timeToMin(b.start) ||
        timeToMin(a.end) - timeToMin(b.end) ||
        a.id.localeCompare(b.id),
    );
  const busyWashes = sorted
    .filter(isCalendarBusyWash)
    .map((item) => ({ item, lane: 0, laneCount: 1 }));
  const laneItems = sorted.filter((item) => !isCalendarBusyWash(item));
  const result: PositionedCalendarItem[] = [];
  let cluster: PendingCalendarItem[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  function flush() {
    const laneCount = Math.max(1, laneEnds.length);
    result.push(...cluster.map((entry) => ({ ...entry, laneCount })));
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  }

  for (const item of laneItems) {
    const start = timeToMin(item.start);
    const naturalEnd = Math.max(timeToMin(item.end), start + 5);
    const readableMinutes = Math.ceil(
      (CALENDAR_EVENT_MIN_HEIGHT * 60) / pxPerHour,
    );
    const displayEnd = Math.max(naturalEnd, start + readableMinutes);
    if (cluster.length > 0 && start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(displayEnd);
    } else {
      laneEnds[lane] = displayEnd;
    }
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, displayEnd);
  }
  flush();
  return [...busyWashes, ...result].sort(
    (a, b) =>
      timeToMin(a.item.start) - timeToMin(b.item.start) ||
      timeToMin(a.item.end) - timeToMin(b.item.end) ||
      a.item.id.localeCompare(b.item.id),
  );
}

export interface CalendarOpenSlotSuggestion {
  date: string;
  startMinute: number;
  endMinute: number;
  sourceId: string;
  sourceTitle: string;
}

/** Pick one useful hole between occurrences of a recurring commitment. This
 * keeps the hint scarce: the largest genuinely empty, non-past opening wins. */
export function calendarOpenSlotSuggestion(input: {
  dates: string[];
  agendaByDate: AgendaItem[][];
  commitments: Commitment[];
  today: string;
  nowMinute: number;
  gridTop: number;
  gridBottom: number;
}): CalendarOpenSlotSuggestion | null {
  const candidates: CalendarOpenSlotSuggestion[] = [];

  for (const commitment of input.commitments) {
    const occurrenceIndexes = input.dates
      .map((date, index) =>
        commitmentsForDate([commitment], date).length > 0 ? index : -1,
      )
      .filter((index) => index >= 0);
    if (occurrenceIndexes.length < 2) continue;

    const first = occurrenceIndexes[0];
    const last = occurrenceIndexes[occurrenceIndexes.length - 1];
    const startMinute = timeToMin(commitment.start);
    const endMinute = timeToMin(commitment.end);
    if (
      endMinute <= startMinute ||
      startMinute < input.gridTop ||
      endMinute > input.gridBottom
    ) {
      continue;
    }

    for (let index = first + 1; index < last; index += 1) {
      const date = input.dates[index];
      if (!date || commitmentsForDate([commitment], date).length > 0) continue;
      if (date < input.today) continue;
      if (date === input.today && startMinute <= input.nowMinute) continue;

      const open = (input.agendaByDate[index] ?? []).every((item) => {
        const itemStart = timeToMin(item.start);
        const itemEnd = timeToMin(item.end);
        return itemEnd <= startMinute || itemStart >= endMinute;
      });
      if (!open) continue;

      candidates.push({
        date,
        startMinute,
        endMinute,
        sourceId: commitment.id,
        sourceTitle: commitment.title,
      });
    }
  }

  return (
    candidates.sort(
      (a, b) =>
        b.endMinute - b.startMinute - (a.endMinute - a.startMinute) ||
        a.date.localeCompare(b.date) ||
        a.startMinute - b.startMinute ||
        a.sourceId.localeCompare(b.sourceId),
    )[0] ?? null
  );
}

export interface CalendarPopoverPosition {
  left: number;
  top: number;
}

/** Keep the 420px calendar detail surface on-screen while preferring the
 * trigger's right edge. The mobile bottom sheet ignores this position. */
export function calendarPopoverPosition(input: {
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">;
  viewportWidth: number;
  viewportHeight: number;
  width?: number;
  estimatedHeight?: number;
  gap?: number;
}): CalendarPopoverPosition {
  const {
    anchor,
    viewportWidth,
    viewportHeight,
    width = 420,
    estimatedHeight = 560,
    gap = 10,
  } = input;
  const inset = 12;
  const fitsRight = anchor.right + gap + width <= viewportWidth - inset;
  const preferredLeft = fitsRight
    ? anchor.right + gap
    : anchor.left - gap - width;
  const left = Math.max(
    inset,
    Math.min(preferredLeft, viewportWidth - width - inset),
  );
  const preferredTop = anchor.top;
  const top = Math.max(
    inset,
    Math.min(
      preferredTop,
      viewportHeight -
        Math.min(estimatedHeight, viewportHeight - inset * 2) -
        inset,
    ),
  );
  return { left, top };
}

/** Snap a pointer drop to the nearest five-minute calendar time. */
export function calendarDropMinute(input: {
  clientY: number;
  gridTop: number;
  scrollTop?: number;
  wakeMinute: number;
  sleepMinute: number;
  durationMinute: number;
  pxPerHour?: number;
}): number {
  const {
    clientY,
    gridTop,
    scrollTop = 0,
    wakeMinute,
    sleepMinute,
    durationMinute,
    pxPerHour = CALENDAR_PX_PER_HOUR,
  } = input;
  const raw = wakeMinute + ((clientY - gridTop + scrollTop) / pxPerHour) * 60;
  const snapped = Math.round(raw / 5) * 5;
  return Math.max(wakeMinute, Math.min(snapped, sleepMinute - durationMinute));
}

/** Coarse target for a failed exact drop. The deterministic planner uses this
 * to choose the closest legal opening on the intended date. */
export function calendarWindowForMinute(
  minute: number,
): "morning" | "afternoon" | "evening" {
  if (minute < 12 * 60) return "morning";
  if (minute < 17 * 60) return "afternoon";
  return "evening";
}

/** True only when an item occupies real time inside the rendered wake/sleep
 * window. Fully off-hours items must not be clamped into a misleading card at
 * the nearest grid edge. */
export function calendarItemIntersectsWindow(input: {
  startMinute: number;
  endMinute: number;
  windowStartMinute: number;
  windowEndMinute: number;
}): boolean {
  return (
    input.endMinute > input.windowStartMinute &&
    input.startMinute < input.windowEndMinute
  );
}

export function fitCalendarChipHeight({
  naturalHeight,
  nextStartOffset,
}: {
  naturalHeight: number;
  nextStartOffset?: number;
}): number {
  const desiredHeight = Math.max(CALENDAR_EVENT_MIN_HEIGHT, naturalHeight);
  if (nextStartOffset === undefined) return desiredHeight;
  // Never crush a calendar item below its readable/tappable contract. Overlap
  // lanes expose the following card's edge instead of shrinking either card.
  return Math.max(
    CALENDAR_EVENT_MIN_HEIGHT,
    Math.min(desiredHeight, Math.max(0, nextStartOffset - 3)),
  );
}
