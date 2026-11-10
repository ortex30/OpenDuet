import type {
  CalendarAllDay,
  CalendarDeadline,
  CalendarEvent,
  SchoolClass,
  StudyBlock,
} from "@openbot/shared/study";
import { type ReactNode, useMemo } from "react";
import "./calendar.css";
import {
  type AllDayChip,
  allDayChips,
  type CalendarItem,
  type CalendarMode,
  dayLabel,
  dayWindow,
  toCalendarData,
  visibleDates,
} from "./calendar-data";
import { CalendarTimeline } from "./components/calendar-timeline";
import { calendarOccurrenceKey } from "./lib/calendar-layout";
import { COURSE_COLORS } from "./lib/helpers";
import { CalendarStoreContext, type CalendarStoreState } from "./lib/store";
import { cn } from "./lib/utils";

/**
 * What the timeline reads from Rebound's store, with nothing in it but the blocks: no profile, so no
 * preferred hours are drawn, and no commitments, tasks or routines, which only drag and placement use.
 */
const READ_ONLY_STORE: Omit<CalendarStoreState, "blocks"> = {
  profile: null,
  quizAnswers: {},
  commitments: [],
  oneOffs: [],
  tasks: [],
  routines: [],
  availabilityOverrides: [],
  learnedNotes: [],
  assistantOpen: false,
};

/**
 * A chip's line is 15px (calendar.css). Week chips wrap to three lines so a long
 * title stays readable in a phone column; day chips sit wider and use two.
 */
const CHIP_LINE_PX = 15;
const CHIP_PAD_PX = 8;
const WEEK_LINES = 4;
const DAY_LINES = 2;
const CHIP_GAP_PX = 2;
const LANE_PAD_PX = 6;
/** Chips a day shows stacked in a week before the last one becomes "+N more". */
const WEEK_CHIPS = 2;

/**
 * Rebound's timeline (components/calendar-timeline.tsx), drawing Academic OS's calendar. It is
 * read-only three ways: it is given no move, create or double-click handler, its `movable` needs a
 * move handler, and its store refuses every write (lib/store.ts). Blocks change when a plan is
 * applied in Chat, never here.
 *
 * What owns no hours, an all-day event or what is due, sits in one row under the day headings, as
 * a calendar app draws it: a chip in its class's colour, which opens its details like any item. A
 * week shows two a day, the second becoming "+N more" (which opens that day) when there are more;
 * one day lays them all side by side.
 */
export function AcademicCalendar({
  day,
  mode,
  today,
  nowMinute,
  provisional,
  classes,
  events,
  blocks,
  proposed,
  allDay = [],
  deadlines = [],
  selectedKey,
  onSelect,
  onOpenDay,
  overlay,
  className,
}: {
  /** The day shown, or a day of the week shown, "YYYY-MM-DD". */
  day: string;
  mode: CalendarMode;
  /** The student's today and the minute of their day now, in their own time zone. */
  today: string;
  nowMinute: number;
  /**
   * True while what is drawn stands in for a range still loading. The timeline's jump to now made
   * for it runs again once the real range lands.
   */
  provisional?: boolean;
  classes: readonly SchoolClass[];
  events: readonly CalendarEvent[];
  blocks: readonly StudyBlock[];
  /** A proposed plan's blocks, drawn dashed over the rest. */
  proposed?: readonly StudyBlock[];
  /** All-day events and what is due, for the row under the day headings. */
  allDay?: readonly CalendarAllDay[];
  deadlines?: readonly CalendarDeadline[];
  /** The selected item's `key`, or null. */
  selectedKey: string | null;
  /** An item pressed, and the button it was pressed on, so focus can go back to it. */
  onSelect: (item: CalendarItem, anchor: HTMLButtonElement) => void;
  /** A day's heading pressed in Week view. */
  onOpenDay?: (date: string) => void;
  /** Drawn over the timeline, inside the calendar's tokens, such as the selected item's details. */
  overlay?: ReactNode;
  className?: string;
}) {
  // Kept the same array while the day and mode are: the timeline scrolls to now when its dates change.
  const dates = useMemo(() => visibleDates(day, mode), [day, mode]);
  const data = useMemo(
    () => toCalendarData({ dates, classes, events, blocks, proposed }),
    [dates, classes, events, blocks, proposed],
  );
  const showsToday = dates.includes(today);
  const hours = useMemo(
    () => dayWindow(data.agendaByDate, showsToday ? nowMinute : undefined),
    [data.agendaByDate, showsToday, nowMinute],
  );
  const store = useMemo<CalendarStoreState>(
    () => ({ ...READ_ONLY_STORE, blocks: data.allBlocks }),
    [data.allBlocks],
  );
  const chips = useMemo(
    () => allDayChips({ dates, classes, allDay, deadlines }),
    [dates, classes, allDay, deadlines],
  );
  const press = (chip: AllDayChip, anchor: HTMLButtonElement) =>
    onSelect(chip.item, anchor);
  const most = Math.max(0, ...chips.map((day) => day.length));
  const rows = mode === "day" ? Math.min(most, 1) : Math.min(most, WEEK_CHIPS);
  const chipPx =
    (mode === "week" ? WEEK_LINES : DAY_LINES) * CHIP_LINE_PX + CHIP_PAD_PX;
  const allDayLane =
    rows === 0
      ? undefined
      : {
          height: rows * chipPx + (rows - 1) * CHIP_GAP_PX + LANE_PAD_PX,
          cells: chips.map((day, index) => (
            <AllDayCell
              chips={day}
              date={dates[index] ?? ""}
              key={dates[index]}
              mode={mode}
              onOpenDay={onOpenDay}
              onPress={press}
              selectedKey={selectedKey}
            />
          )),
        };
  return (
    <div
      className={cn(
        // `isolate` keeps the timeline's own layers (its sticky gutter is z-30) inside the calendar,
        // under the app's floating header and tab bar.
        "academic-calendar relative isolate flex min-h-0 flex-col",
        className,
      )}
      data-calendar-mode={mode}
    >
      <CalendarStoreContext.Provider value={store}>
        <CalendarTimeline
          agendaByDate={data.agendaByDate}
          allBlocks={data.allBlocks}
          allDayLane={allDayLane}
          className="rounded-none border-0"
          courses={data.courses}
          dates={dates}
          nowMinute={nowMinute}
          onActivateDay={mode === "week" ? onOpenDay : undefined}
          onSelectItem={(item, anchor) => {
            const found = data.items.get(calendarOccurrenceKey(item));
            if (found) onSelect(found, anchor);
          }}
          provisional={provisional}
          selectedItemId={selectedKey}
          singleDay={mode === "day"}
          sleepMinute={hours.sleepMinute}
          today={today}
          wakeMinute={hours.wakeMinute}
        />
      </CalendarStoreContext.Provider>
      {overlay}
    </div>
  );
}

/**
 * One day's chips in the row under its heading. In a week the day shows two; with more, the second
 * says how many more and opens the day, where they all sit side by side and the row scrolls sideways.
 */
function AllDayCell({
  date,
  chips,
  mode,
  selectedKey,
  onPress,
  onOpenDay,
}: {
  date: string;
  chips: readonly AllDayChip[];
  mode: CalendarMode;
  selectedKey: string | null;
  onPress: (chip: AllDayChip, anchor: HTMLButtonElement) => void;
  onOpenDay?: (date: string) => void;
}) {
  if (mode === "day")
    return (
      <div className="academic-calendar-chip-row flex min-w-0 gap-1 overflow-x-auto">
        {chips.map((chip) => (
          <Chip
            chip={chip}
            key={chip.id}
            onPress={onPress}
            selected={selectedKey === chip.item.key}
            wide={false}
          />
        ))}
      </div>
    );
  const folded = chips.length > WEEK_CHIPS && onOpenDay;
  const shown = folded ? chips.slice(0, WEEK_CHIPS - 1) : chips;
  return (
    <>
      {shown.map((chip) => (
        <Chip
          chip={chip}
          key={chip.id}
          onPress={onPress}
          selected={selectedKey === chip.item.key}
          wide
        />
      ))}
      {folded ? (
        <button
          aria-label={`${chips.length - shown.length} more on ${dayLabel(date, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}`}
          className="academic-calendar-chip academic-calendar-more w-full"
          onClick={() => onOpenDay(date)}
          type="button"
        >
          +{chips.length - shown.length} more
        </button>
      ) : null}
    </>
  );
}

/** A chip: its title on its class's tint, the whole of it a button that opens its details. */
function Chip({
  chip,
  selected,
  wide,
  onPress,
}: {
  chip: AllDayChip;
  selected: boolean;
  /** Fills its day's column, as in a week; otherwise as wide as its title. */
  wide: boolean;
  onPress: (chip: AllDayChip, anchor: HTMLButtonElement) => void;
}) {
  const colors = COURSE_COLORS[chip.color] ?? COURSE_COLORS.slate;
  return (
    <button
      aria-label={chip.label}
      aria-pressed={selected}
      className={cn(
        "academic-calendar-chip",
        wide ? "w-full" : "max-w-[16rem] shrink-0",
      )}
      data-calendar-course-id={chip.courseId}
      data-calendar-date={chip.date}
      // Found again by its id and day for focus (calendar-data.ts itemButton); never draggable.
      data-calendar-flexible="false"
      data-calendar-item-id={chip.id}
      onClick={(event) => onPress(chip, event.currentTarget)}
      style={{ backgroundColor: colors?.bg, color: colors?.fg }}
      title={chip.hint}
      type="button"
    >
      <span>{chip.title}</span>
    </button>
  );
}
