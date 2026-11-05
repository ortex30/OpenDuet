import type {
  CalendarEvent,
  SchoolClass,
  StudyBlock,
} from "@openbot/shared/study";
import { type ReactNode, useMemo } from "react";
import "./calendar.css";
import {
  type CalendarItem,
  type CalendarMode,
  dayWindow,
  toCalendarData,
  visibleDates,
} from "./calendar-data";
import { CalendarTimeline } from "./components/calendar-timeline";
import { calendarOccurrenceKey } from "./lib/calendar-layout";
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
 * Rebound's timeline (components/calendar-timeline.tsx), drawing Academic OS's calendar. It is
 * read-only three ways: it is given no move, create or double-click handler, its `movable` needs a
 * move handler, and its store refuses every write (lib/store.ts). Blocks change when a plan is
 * applied in Chat, never here.
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
  return (
    <div
      className={cn(
        // `isolate` keeps the timeline's own layers (its sticky gutter is z-30) inside the calendar,
        // under the app's floating header and tab bar.
        "academic-calendar relative isolate flex min-h-0 flex-col",
        className,
      )}
    >
      <CalendarStoreContext.Provider value={store}>
        <CalendarTimeline
          agendaByDate={data.agendaByDate}
          allBlocks={data.allBlocks}
          className="rounded-[var(--duet-radius-card)] border-0 shadow-duet-card"
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
