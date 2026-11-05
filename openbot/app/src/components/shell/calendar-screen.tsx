import {
  type AssignmentKind,
  type CalendarView,
  HELP_LEVEL_LABEL,
  type HelpLevel,
  type SchoolClass,
  type StudyPlan,
} from "@openbot/shared/study";
import {
  keepPreviousData,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  type ComponentProps,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AcademicCalendar } from "@/components/calendar/rebound/AcademicCalendar";
import {
  type CalendarItem,
  type CalendarMode,
  classColor,
  clockLabel,
  dayLabel,
  deviceNow,
  isCalendarDate,
  itemButton,
  stepDay,
  visibleDates,
  weekDates,
  zonedNow,
} from "@/components/calendar/rebound/calendar-data";
import { DuetIcon, type DuetIconName } from "@/components/duet/icons";
import { DuetCard, Segmented } from "@/components/duet/kit";
import { staleSentence } from "@/components/duet/study/study-plan-card";
import {
  calendarQueryOptions,
  pendingPlanQueryOptions,
} from "@/lib/study/calendar";
import { removePlanMutationOptions } from "@/lib/study/plans";
import { cn } from "@/lib/utils";
import { ScreenScroll } from "./screen";

/** The item whose details are open, and the button it was pressed on. */
type Pressed = { key: string; button: HTMLElement };

/** Focus back on an item: on the button it was pressed on, or the one drawn for it now. */
function focusItem(item: CalendarItem, pressed: Pressed | null) {
  const back =
    pressed?.key === item.key && pressed.button.isConnected
      ? pressed.button
      : itemButton(document, item);
  back?.focus();
}

/** What the Calendar tab reads from its address: a day, Day or Week, and a plan to lay over it. */
export type CalendarSearch = { date?: string; plan?: string; view?: string };

const VIEWS: readonly { value: CalendarMode; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
];

/** What each kind of deadline is called on its line, before its time. */
const KIND_WORD: Record<AssignmentKind, string> = {
  assignment: "Due",
  quiz: "Quiz",
  test: "Test",
  announcement: "Note",
  material: "Material",
};

/** More lines than this in the all-day strip and it shows the first few, and how many more. */
const STRIP_LIMIT = 4;

/**
 * The Calendar tab: the student's Google Calendar with the study blocks they applied and what is due,
 * one day at a time by default (the column is a phone's width) or a week. `?plan=<id>` lays a plan
 * that is only proposed over it, dashed, until it is applied in Chat; once applied, its banner can
 * take it off again. The timeline is Rebound's own renderer, read-only (components/calendar/rebound).
 *
 * The page does not scroll: the timeline scrolls inside a card that fills the room between the
 * header and the tab bar, so the hours keep their place under the toolbar. At a large text size the
 * room runs out, and the page scrolls with the toolbar held at the top.
 */
export function CalendarScreen({
  search,
  onSearch,
}: {
  search: CalendarSearch;
  onSearch: (next: CalendarSearch) => void;
}) {
  const clock = useClock();
  const device = deviceNow(new Date(clock));
  // The student's today, in their calendar's zone. Until it is known, this device's own day stands in.
  const [studentToday, setStudentToday] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  // Where focus goes back to: the item whose details close, and the toolbar's heading.
  const pressed = useRef<Pressed | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const mode: CalendarMode = search.view === "week" ? "week" : "day";
  const asked = search.date && isCalendarDate(search.date) ? search.date : null;
  const planId = search.plan ? search.plan : null;
  const plan = useQuery({
    ...pendingPlanQueryOptions(planId ?? ""),
    enabled: planId !== null,
  });
  const proposal =
    planId !== null && plan.data?.status === "proposed" ? plan.data : null;

  const today = studentToday ?? device.day;
  // A link with a plan and no day opens where the plan starts.
  const day = asked ?? (proposal ? firstDay(proposal) : null) ?? today;
  const dates = useMemo(() => visibleDates(day, mode), [day, mode]);
  // A whole week is read even in Day view, so stepping through its days draws at once.
  const week = useMemo(() => weekDates(day), [day]);
  const calendar = useQuery({
    ...calendarQueryOptions(week[0] ?? day, week[6] ?? day),
    placeholderData: keepPreviousData,
  });
  const view = calendar.data;
  /*
   * The student's day and minute now: this device's clock read in their calendar's zone, so the
   * now line keeps time between reads and is right over any range drawn, one standing in for a
   * range still loading too. A zone this browser doesn't know keeps the calendar's own reading.
   */
  const now = view
    ? (zonedNow(new Date(clock), view.timeZone) ?? {
        day: view.today,
        minute: view.nowMinute,
      })
    : device;
  if (view && now.day !== studentToday) setStudentToday(now.day);

  const shown = new Set(dates);
  const details = selected && shown.has(itemDate(selected)) ? selected : null;
  useEffect(() => {
    if (!details) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelected(null);
      // From inside the details, focus would go with them: it goes back to the item instead.
      if (
        event.target instanceof Element &&
        event.target.closest("[data-calendar-details]")
      )
        focusItem(details, pressed.current);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [details]);

  const go = (next: CalendarSearch) => {
    setSelected(null);
    onSearch(next);
  };
  const show = (date: string) => go({ ...search, date });
  // Said only once both reads are in: a plan still loading may yet put something on these days.
  const settled =
    view !== undefined &&
    !calendar.isPlaceholderData &&
    !(planId !== null && plan.isPending);
  const nothing =
    settled &&
    !view.events.some((event) => shown.has(event.date)) &&
    !view.blocks.some((block) => shown.has(block.date)) &&
    !view.deadlines.some((deadline) => shown.has(deadline.date)) &&
    !view.allDay.some((event) => shown.has(event.date)) &&
    !proposal?.blocks.some((block) => shown.has(block.date));

  return (
    <ScreenScroll>
      <div className="flex min-h-full flex-col">
        <CalendarToolbar
          headingRef={heading}
          label={
            mode === "day"
              ? dayLabel(day, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })
              : rangeLabel(dates)
          }
          mode={mode}
          onMode={(next) =>
            go({
              ...search,
              date: day,
              view: next === "week" ? "week" : undefined,
            })
          }
          onStep={(step) => show(stepDay(day, mode, step))}
          onToday={() => show(today)}
        />
        {planId ? (
          <PlanNotice
            dates={dates}
            // The pressed control goes with the banner or the day: focus lands on the day shown.
            onGo={(date) => {
              show(date);
              heading.current?.focus();
            }}
            onHide={() => {
              go({ ...search, date: day, plan: undefined });
              heading.current?.focus();
            }}
            plan={plan}
            planId={planId}
          />
        ) : null}
        {view && view.couldNotRead.length > 0 ? (
          <CouldNotRead lines={view.couldNotRead} />
        ) : null}
        {view && calendar.isError ? (
          <p className="type-sub mb-3 px-1 text-duet-red" role="alert">
            {calendar.error.message} What's shown may be out of date.
          </p>
        ) : null}
        {view ? (
          <AllDayStrip
            dates={dates}
            key={dates.join(",")}
            mode={mode}
            view={view}
          />
        ) : null}
        {nothing ? (
          <NothingNote
            dates={dates}
            mode={mode}
            today={today}
            unread={Boolean(view?.couldNotRead.length)}
          />
        ) : null}
        {view ? (
          <AcademicCalendar
            blocks={view.blocks}
            /*
             * A length, not flex-1: a percentage basis in a column with no fixed height is read as
             * the content's, and the timeline's content is every hour, so the page scrolled instead.
             */
            className="min-h-[320px] flex-[1_1_320px]"
            classes={view.classes}
            day={day}
            events={view.events}
            mode={mode}
            nowMinute={now.minute}
            onOpenDay={(date) => go({ ...search, date, view: undefined })}
            onSelect={(item, button) => {
              pressed.current = { key: item.key, button };
              setSelected((current) =>
                current?.key === item.key ? null : item,
              );
            }}
            overlay={
              details ? (
                <ItemDetails
                  classes={view.classes}
                  item={details}
                  onClose={() => {
                    setSelected(null);
                    // The close button goes with the details: focus goes back to the item.
                    focusItem(details, pressed.current);
                  }}
                />
              ) : null
            }
            proposed={proposal?.blocks}
            provisional={calendar.isPlaceholderData}
            selectedKey={details?.key ?? null}
            today={now.day}
          />
        ) : (
          <CalendarPlaceholder
            error={calendar.isError ? calendar.error.message : null}
            onRetry={() => void calendar.refetch()}
          />
        )}
      </div>
    </ScreenScroll>
  );
}

/** Now, read again every half minute while the screen is open. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** The day an item is drawn on. */
function itemDate(item: CalendarItem): string {
  return item.kind === "event" ? item.event.date : item.block.date;
}

/** The earliest day a plan has a session on, or its first planned day when it has none. */
function firstDay(plan: StudyPlan): string | null {
  const days = plan.blocks
    .map((block) => block.date)
    .filter(isCalendarDate)
    .sort();
  const first = days[0] ?? plan.startDate;
  return isCalendarDate(first) ? first : null;
}

/** A week as "Nov 1 – 7", or "Oct 26 – Nov 1" across two months. */
function rangeLabel(dates: readonly string[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return "";
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return `${dayLabel(first, { month: "short", day: "numeric" })} – ${dayLabel(
    last,
    sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
  )}`;
}

/** Minutes of study as "45 min", "1 hr" or "1 hr 30 min". */
function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/**
 * The day or week shown, Today, the step back and forward, and Day or Week. It sticks under the
 * header when the page scrolls, as Tasks' switch does, and wraps rather than running off the screen
 * at a large text size.
 */
function CalendarToolbar({
  headingRef,
  label,
  mode,
  onMode,
  onStep,
  onToday,
}: {
  /** The heading, which takes focus when the control that had it goes away. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  label: string;
  mode: CalendarMode;
  onMode: (mode: CalendarMode) => void;
  onStep: (step: -1 | 1) => void;
  onToday: () => void;
}) {
  const unit = mode === "day" ? "day" : "week";
  return (
    <div
      className={cn(
        "sticky top-[-20px] z-30 -mx-4 mb-3 bg-duet-surface px-5 pt-1 pb-2",
        // Solid up to the header's discs, and a short fade under it, so rows don't show through.
        "before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-[14px] before:bg-duet-surface before:content-['']",
        "after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-[linear-gradient(var(--duet-surface),transparent)] after:content-['']",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Read out when it changes, so stepping a day says where it landed. */}
        <h1
          aria-live="polite"
          className="type-big min-w-0 font-semibold text-duet-ink tabular-nums outline-none"
          ref={headingRef}
          tabIndex={-1}
        >
          {label}
        </h1>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            className="duet-glass type-sub min-h-[44px] rounded-full px-4 font-medium text-duet-ink shadow-duet-glass transition-transform focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-violet/40 active:scale-95"
            onClick={onToday}
            type="button"
          >
            Today
          </button>
          <IconButton
            icon="chevronLeft"
            label={`Previous ${unit}`}
            onClick={() => onStep(-1)}
          />
          <IconButton
            icon="chevronRight"
            label={`Next ${unit}`}
            onClick={() => onStep(1)}
          />
        </div>
      </div>
      <div className="mt-2">
        <Segmented
          label="Calendar view"
          onChange={onMode}
          options={VIEWS}
          value={mode}
        />
      </div>
    </div>
  );
}

function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: DuetIconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      // 44px, the smallest tap target (parity-spec 2.11), and in pixels: an icon, as on Tasks.
      className="duet-glass grid size-[44px] place-items-center rounded-full text-duet-ink shadow-duet-glass transition-transform focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-violet/40 active:scale-95"
      onClick={onClick}
      title={label}
      type="button"
    >
      <DuetIcon name={icon} size={19} stroke={2} />
    </button>
  );
}

/** A pill for a card's own action: SmallPill's look, at its own width. */
function PillButton(props: ComponentProps<"button">) {
  return (
    <button
      className="type-sub min-h-11 shrink-0 rounded-full px-4 py-2 font-medium text-duet-ink shadow-[inset_0_0_0_1px_var(--duet-hair)] transition-[transform,background-color] hover:bg-duet-tile focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-violet/40 active:scale-[0.98] disabled:opacity-50"
      type="button"
      {...props}
    />
  );
}

/** What the plan in the address is, and what its dashed blocks mean. */
function planNote(
  plan: UseQueryResult<StudyPlan>,
  dates: readonly string[],
): {
  title: string;
  detail: string;
  first: string | null;
  /** Applied, so its sessions can come off the calendar from here. */
  removable: boolean;
} {
  if (!plan.data)
    return {
      title: "Couldn't open that plan",
      detail: `${plan.error?.message ?? "It isn't here anymore."} Ask in Chat for a fresh one.`,
      first: null,
      removable: false,
    };
  const { data } = plan;
  if (data.status === "applied")
    return {
      title: "Plan applied",
      detail: "Its sessions are on your Calendar tab.",
      first: null,
      removable: true,
    };
  if (data.status === "discarded")
    // Discarded after it was applied: it was taken off the calendar again.
    return data.appliedAt !== null
      ? {
          title: "Plan removed",
          detail: "Removed from your Calendar tab.",
          first: null,
          removable: false,
        }
      : {
          title: "Plan set aside",
          detail: "Nothing from it is on your calendar.",
          first: null,
          removable: false,
        };
  if (data.blocks.length === 0)
    return {
      title: "Proposed plan",
      detail: "No study time fit around your calendar in this plan.",
      first: null,
      removable: false,
    };
  const count = data.blocks.length;
  const sessions = `${count} ${count === 1 ? "session" : "sessions"}, ${minutesLabel(data.totalMinutes)}.`;
  // Offered only when none of its sessions is in view, so its dashed blocks are never missed.
  const first = data.blocks.some((block) => dates.includes(block.date))
    ? null
    : firstDay(data);
  return data.stale
    ? {
        title: "Proposed plan, out of date",
        detail: `${sessions} ${staleSentence(data)}`,
        first,
        removable: false,
      }
    : {
        title: "Proposed plan",
        detail: `${sessions} Dashed until you add it in Chat.`,
        first,
        removable: false,
      };
}

/**
 * The plan `?plan=` names: proposed and drawn dashed, or why nothing of it is drawn. An applied plan
 * can be taken off the calendar from here.
 */
function PlanNotice({
  planId,
  plan,
  dates,
  onGo,
  onHide,
}: {
  planId: string;
  plan: UseQueryResult<StudyPlan>;
  dates: readonly string[];
  onGo: (date: string) => void;
  onHide: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation(removePlanMutationOptions(queryClient, planId));
  // Removed, the button goes and the banner says so: focus moves onto what it says.
  const title = useRef<HTMLParagraphElement>(null);
  if (plan.isPending) return null;
  const note = planNote(plan, dates);
  const { first } = note;
  return (
    // Dismissed from its corner, so the banner costs the timeline as little room as it can.
    <DuetCard
      aria-label="Study plan"
      className="mb-3 flex items-start gap-1 py-3 pr-1.5 pl-4"
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p
          className="type-sub font-semibold text-duet-ink outline-none"
          ref={title}
          tabIndex={-1}
        >
          {note.title}
        </p>
        <p className="type-sub mt-0.5 text-duet-ink-2">{note.detail}</p>
        {first ? (
          <div className="mt-2.5 flex">
            <PillButton onClick={() => onGo(first)}>
              Show its first day
            </PillButton>
          </div>
        ) : null}
        {note.removable ? (
          <>
            {remove.isError ? (
              <p
                className="type-sub mt-2 text-duet-status-problem"
                role="alert"
              >
                {remove.error.message}
              </p>
            ) : null}
            <div className="mt-2.5 flex">
              <PillButton
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => title.current?.focus(),
                  })
                }
              >
                Remove from calendar
              </PillButton>
            </div>
          </>
        ) : null}
      </div>
      <button
        aria-label="Hide this plan"
        className="-mt-1.5 grid size-11 shrink-0 place-items-center rounded-full text-duet-ink-2 transition-colors hover:bg-duet-tile focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
        onClick={onHide}
        title="Hide this plan"
        type="button"
      >
        <DuetIcon name="x" size={18} stroke={2.2} />
      </button>
    </DuetCard>
  );
}

/**
 * What the calendar could not read, in the server's own sentences, which say what to do, and the
 * place where most of them are done. Quiet: the rest of the calendar is still worth reading.
 */
function CouldNotRead({ lines }: { lines: readonly string[] }) {
  return (
    <div
      aria-label="Not everything could be read"
      className="mb-3 flex gap-3 rounded-[var(--duet-radius-card)] bg-duet-tile px-4 py-3"
      role="note"
    >
      <DuetIcon
        className="mt-px shrink-0 text-duet-ink-2"
        name="alert"
        size={18}
      />
      <div className="min-w-0 flex-1">
        <p className="type-sub font-medium text-duet-ink">
          Not everything could be read
        </p>
        <ul className="mt-0.5">
          {[...new Set(lines)].map((line) => (
            <li
              className="type-sub text-duet-ink-2 [overflow-wrap:anywhere]"
              key={line}
            >
              {line}
            </li>
          ))}
        </ul>
        <Link
          className="type-sub -mb-2 inline-flex min-h-11 items-center rounded-full font-medium text-duet-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
          to="/connections"
        >
          Open Connections
        </Link>
      </div>
    </div>
  );
}

type StripLine = {
  key: string;
  date: string;
  /** Sorts a day's lines: all-day events first, then deadlines by time. */
  order: string;
  title: string;
  detail: string;
  /** A class's colour for a deadline; null for an all-day event, which has no class. */
  color: string | null;
  help: HelpLevel | null;
};

/** The visible days' all-day events and deadlines, in day order. */
function stripLines(
  view: CalendarView,
  dates: readonly string[],
  mode: CalendarMode,
): StripLine[] {
  const shown = new Set(dates);
  const weekday = (date: string) =>
    mode === "week" ? `${dayLabel(date, { weekday: "short" })} · ` : "";
  const classById = new Map(view.classes.map((entry) => [entry.id, entry]));
  return [
    ...view.allDay
      .filter((event) => shown.has(event.date))
      .map(
        (event): StripLine => ({
          key: `all-day:${event.date}:${event.id}`,
          date: event.date,
          order: "",
          title: event.title,
          detail: `${weekday(event.date)}All day`,
          color: null,
          help: null,
        }),
      ),
    ...view.deadlines
      .filter((deadline) => shown.has(deadline.date))
      .map((deadline): StripLine => {
        const owner = classById.get(deadline.classId);
        const word = KIND_WORD[deadline.kind];
        return {
          key: `deadline:${deadline.date}:${deadline.assignmentId}`,
          date: deadline.date,
          // A deadline with no time is due by the end of its day.
          order: deadline.time ?? "24:00",
          title: deadline.title,
          detail: `${weekday(deadline.date)}${[
            owner?.name,
            deadline.time ? `${word} ${clockLabel(deadline.time)}` : word,
          ]
            .filter(Boolean)
            .join(" · ")}`,
          color: classColor(owner?.color ?? "slate"),
          help: deadline.help,
        };
      }),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.order.localeCompare(b.order) ||
      a.title.localeCompare(b.title),
  );
}

/**
 * The visible days' all-day events and what is due, above the hours: the timeline has no all-day
 * lane. Each deadline carries its class's colour and the teacher's AI-help level, where the notice
 * gave one. A level the notice did not give is left out rather than guessed.
 */
function AllDayStrip({
  view,
  dates,
  mode,
}: {
  view: CalendarView;
  dates: readonly string[];
  mode: CalendarMode;
}) {
  const [open, setOpen] = useState(false);
  const lines = stripLines(view, dates, mode);
  if (lines.length === 0) return null;
  const visible =
    open || lines.length <= STRIP_LIMIT
      ? lines
      : lines.slice(0, STRIP_LIMIT - 1);
  return (
    <section aria-labelledby="calendar-all-day" className="mb-3">
      <h2 className="type-sub px-1 text-duet-ink-2" id="calendar-all-day">
        {mode === "day" ? "All day" : "All day this week"}
      </h2>
      <ul className="mt-1 flex flex-col">
        {visible.map((line) => (
          <li className="flex items-center gap-3 px-1 py-1.5" key={line.key}>
            <span
              aria-hidden
              className="grid w-3.5 shrink-0 place-items-center text-duet-ink-3"
            >
              {line.color ? (
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: line.color }}
                />
              ) : (
                <DuetIcon name="calendar" size={14} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="type-sub font-medium text-duet-ink [overflow-wrap:anywhere]">
                {line.title}
              </p>
              <p className="type-caption text-duet-ink-2">{line.detail}</p>
            </div>
            {line.help ? <HelpLabel level={line.help} /> : null}
          </li>
        ))}
      </ul>
      {visible.length < lines.length ? (
        <button
          className="type-sub min-h-11 rounded-full px-1 font-medium text-duet-ink-2 transition-colors hover:text-duet-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
          onClick={() => setOpen(true)}
          type="button"
        >
          Show {lines.length - visible.length} more
        </button>
      ) : null}
    </section>
  );
}

/** The teacher's AI-help level in its own words. Grey: a rule to know, not a status. */
function HelpLabel({ level }: { level: HelpLevel }) {
  return (
    <span className="type-caption inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-duet-tile px-2 py-1 font-medium text-duet-ink-2">
      {level === "none" ? <DuetIcon name="lock" size={12} stroke={2} /> : null}
      <span className="sr-only">AI help: </span>
      {HELP_LEVEL_LABEL[level]}
    </span>
  );
}

/**
 * Said when the days shown hold nothing at all, with where to go to fill them. When something could
 * not be read (`unread`), the days may not be empty, so it says only what was read.
 */
function NothingNote({
  dates,
  mode,
  today,
  unread,
}: {
  dates: readonly string[];
  mode: CalendarMode;
  today: string;
  unread: boolean;
}) {
  const first = dates[0] ?? today;
  const day =
    mode === "day" && first !== today
      ? dayLabel(first, { weekday: "long", month: "long", day: "numeric" })
      : null;
  const when =
    mode === "week"
      ? dates.includes(today)
        ? "this week"
        : "that week"
      : (day ?? "today");
  return (
    <p className="type-sub mb-3 px-1 text-duet-ink-2">
      {unread
        ? `Nothing we could read for ${when}.`
        : `Nothing on your calendar ${day ? `on ${day}` : when}.`}{" "}
      <Link
        className="font-medium text-duet-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
        to="/"
      >
        Plan study time in Chat
      </Link>
    </p>
  );
}

/** Where the timeline will be: a quiet card while it loads, or why it could not. */
function CalendarPlaceholder({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <DuetCard className="grid min-h-[320px] flex-[1_1_320px] place-items-center px-6 py-8 text-center">
      {error ? (
        <div role="alert">
          <p className="type-sub text-duet-red">{error}</p>
          <div className="mt-3 flex justify-center">
            <PillButton onClick={onRetry}>Try again</PillButton>
          </div>
        </div>
      ) : (
        <p className="type-sub text-duet-ink-2" role="status">
          Loading your calendar…
        </p>
      )}
    </DuetCard>
  );
}

/** The facts of the item the student pressed, in the card's words. */
function itemFacts(
  item: CalendarItem,
  classes: readonly SchoolClass[],
): {
  title: string;
  when: string;
  location: string | null;
  className: string | null;
  color: string;
  proposed: boolean;
  late: boolean;
} {
  const classId =
    item.kind === "event" ? item.event.classId : item.block.classId;
  const owner = classes.find((entry) => entry.id === classId);
  const range = item.kind === "event" ? item.event : item.block;
  return {
    title: range.title,
    when: `${dayLabel(range.date, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })} · ${clockLabel(range.start)} – ${clockLabel(range.end)}`,
    location: item.kind === "event" ? (item.event.location ?? null) : null,
    className: owner?.name ?? null,
    color: classColor(owner?.color ?? "slate"),
    proposed: item.kind === "block" && item.proposed,
    late: item.kind === "block" && item.block.late === true,
  };
}

/**
 * The pressed item's title, day and time, place and class, over the foot of the timeline. Escape,
 * the close button or pressing the item again puts it away, and focus goes back to the item.
 */
function ItemDetails({
  item,
  classes,
  onClose,
}: {
  item: CalendarItem;
  classes: readonly SchoolClass[];
  onClose: () => void;
}) {
  const facts = itemFacts(item, classes);
  return (
    <DuetCard
      aria-label={`${facts.title}, details`}
      aria-live="polite"
      className="calendar-detail-popover absolute inset-x-2 bottom-2 z-50 px-4 py-3"
      data-calendar-details=""
      raised
      role="region"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-[7px] size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: facts.color }}
        />
        <div className="min-w-0 flex-1">
          {facts.proposed ? (
            <p className="type-caption font-semibold text-duet-ink-2">
              Proposed, not on your calendar yet
            </p>
          ) : null}
          <p className="type-body font-semibold text-duet-ink [overflow-wrap:anywhere]">
            {facts.title}
          </p>
          <p className="type-sub text-duet-ink-2 tabular-nums">{facts.when}</p>
          {facts.location ? (
            <p className="type-sub text-duet-ink-2 [overflow-wrap:anywhere]">
              {facts.location}
            </p>
          ) : null}
          {facts.className ? (
            <p className="type-sub text-duet-ink-2">{facts.className}</p>
          ) : null}
          {facts.late ? (
            <p className="type-sub text-duet-status-needs">
              After its due date: time to catch up.
            </p>
          ) : null}
        </div>
        <button
          aria-label="Close details"
          className="-mt-1.5 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-duet-ink-2 transition-colors hover:bg-duet-tile focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
          onClick={onClose}
          type="button"
        >
          <DuetIcon name="x" size={18} stroke={2.2} />
        </button>
      </div>
    </DuetCard>
  );
}
