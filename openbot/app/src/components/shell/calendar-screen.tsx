import {
  HELP_LEVEL_LABEL,
  type HelpLevel,
  type SchoolClass,
  type StudyPlan,
} from "@openbot/shared/study";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
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
  type ReactNode,
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
  deadlineWhen,
  deviceNow,
  isCalendarDate,
  itemButton,
  stepDay,
  visibleDates,
  weekDates,
  zonedNow,
} from "@/components/calendar/rebound/calendar-data";
import { DuetIcon } from "@/components/duet/icons";
import { staleSentence } from "@/components/duet/study/study-plan-card";
import {
  calendarQueryOptions,
  pendingPlanQueryOptions,
} from "@/lib/study/calendar";
import { removePlanMutationOptions } from "@/lib/study/plans";
import { cn } from "@/lib/utils";

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

/** What the Calendar screen reads from its address: a day, Day or Week, and a plan to lay over it. */
export type CalendarSearch = { date?: string; plan?: string; view?: string };

const VIEWS: readonly { value: CalendarMode; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
];

/**
 * A small control drawn smaller than a finger: an invisible ring around it takes the tap, so it
 * is still a 44px target (parity-spec 2.11) without looking like one.
 */
const TAP_AREA = "relative before:absolute before:content-['']";

/**
 * The Calendar screen, in Rebound's calendar look: one quiet toolbar (the step back and forward,
 * the day or week shown, Today, and Day or Week) over the timeline, which fills the rest. What owns
 * no hours, an all-day event or what is due, sits as chips under the day headings. It shows the
 * student's Google Calendar with the study blocks they applied, one day at a time by default or a
 * week. `?plan=<id>` lays a plan that is only proposed over it, dashed, until it is applied in Chat;
 * once applied, its bar can take it off again. The timeline is Rebound's own renderer, read-only
 * (components/calendar/rebound).
 *
 * The screen does not scroll: the timeline scrolls inside it, so the hours keep their place under
 * the toolbar. At a large text size the room runs out, and the screen scrolls with the toolbar
 * held at the top.
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
      // Escape puts the details away and nothing more: the panel the calendar is open in stays.
      event.preventDefault();
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
    <div className="academic-calendar-screen flex min-h-0 flex-1 flex-col overflow-y-auto bg-card pb-[env(safe-area-inset-bottom)] text-foreground">
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
        onToday={() => {
          show(today);
          // Today goes once today is shown: focus lands on the day it shows.
          heading.current?.focus();
        }}
        showToday={!shown.has(today)}
      />
      {planId ? (
        <PlanNotice
          dates={dates}
          // The pressed control goes with the bar or the day: focus lands on the day shown.
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
        <p
          className="type-caption border-border border-b px-4 py-2.5 text-duet-red"
          role="alert"
        >
          {calendar.error.message} What's shown may be out of date.
        </p>
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
          allDay={view.allDay}
          blocks={view.blocks}
          /*
           * A length, not flex-1: a percentage basis in a column with no fixed height is read as
           * the content's, and the timeline's content is every hour, so the screen scrolled instead.
           */
          className="min-h-[320px] flex-[1_1_320px]"
          classes={view.classes}
          day={day}
          deadlines={view.deadlines}
          events={view.events}
          mode={mode}
          nowMinute={now.minute}
          onOpenDay={(date) => go({ ...search, date, view: undefined })}
          onSelect={(item, button) => {
            pressed.current = { key: item.key, button };
            setSelected((current) => (current?.key === item.key ? null : item));
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
  switch (item.kind) {
    case "event":
    case "allDay":
      return item.event.date;
    case "block":
      return item.block.date;
    case "due":
      return item.deadline.date;
  }
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
 * Rebound's calendar toolbar, in one row: two round arrows, the day or week shown, Today (only
 * while today is out of view), and Day or Week at the end. It stays at the top when the screen
 * scrolls at a large text size, and wraps rather than running off a narrow screen.
 */
function CalendarToolbar({
  headingRef,
  label,
  mode,
  onMode,
  onStep,
  onToday,
  showToday,
}: {
  /** The heading, which takes focus when the control that had it goes away. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  label: string;
  mode: CalendarMode;
  onMode: (mode: CalendarMode) => void;
  onStep: (step: -1 | 1) => void;
  onToday: () => void;
  showToday: boolean;
}) {
  const unit = mode === "day" ? "day" : "week";
  return (
    <div className="sticky top-0 z-40 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-border border-b bg-card px-3 py-2 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <div className="flex shrink-0 items-center gap-1">
          <StepButton label={`Previous ${unit}`} onClick={() => onStep(-1)}>
            <IconArrowLeft aria-hidden size={16} stroke={1.75} />
          </StepButton>
          <StepButton label={`Next ${unit}`} onClick={() => onStep(1)}>
            <IconArrowRight aria-hidden size={16} stroke={1.75} />
          </StepButton>
        </div>
        {/* Read out when it changes, so stepping a day says where it landed. */}
        <h1
          aria-live="polite"
          className="ml-1 min-w-0 truncate font-semibold text-base tabular-nums tracking-tight outline-none sm:text-lg"
          ref={headingRef}
          tabIndex={-1}
        >
          {label}
        </h1>
        {showToday ? <TextButton onClick={onToday}>Today</TextButton> : null}
      </div>
      <ViewSwitch mode={mode} onMode={onMode} />
    </div>
  );
}

/** One of the toolbar's round arrows: 32px drawn, 44px to the touch. */
function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        TAP_AREA,
        "grid size-8 place-items-center rounded-full bg-accent text-primary outline-none transition-[background-color,transform] before:-inset-1.5 hover:bg-[color-mix(in_oklab,var(--primary)_16%,var(--card))] focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

/** A quiet action in the accent's ink, as Rebound draws Today. */
function TextButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cn(
        TAP_AREA,
        "type-caption h-8 shrink-0 whitespace-nowrap rounded-md px-2 font-medium text-primary outline-none transition-colors before:inset-x-0 before:-inset-y-1.5 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
      type="button"
      {...props}
    />
  );
}

/**
 * Day or Week, as one small switch: a radio group, so the arrow keys move between the two and the
 * view follows, as on a phone's segmented control.
 */
function ViewSwitch({
  mode,
  onMode,
}: {
  mode: CalendarMode;
  onMode: (mode: CalendarMode) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const choose = (next: CalendarMode, focus: boolean) => {
    onMode(next);
    if (focus)
      group.current
        ?.querySelector<HTMLElement>(`[data-calendar-view="${next}"]`)
        ?.focus();
  };
  return (
    <div
      aria-label="Calendar view"
      className="ml-auto flex shrink-0 rounded-lg bg-muted p-0.5"
      ref={group}
      role="radiogroup"
    >
      {VIEWS.map((option, index) => {
        const on = option.value === mode;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control, drawn as one capsule.
          <button
            aria-checked={on}
            className={cn(
              TAP_AREA,
              "type-caption h-7 min-w-12 rounded-md px-2.5 font-medium outline-none transition-colors before:inset-x-0 before:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/50",
              on
                ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_rgb(0_0_0/0.04)]"
                : "text-muted-foreground hover:text-foreground",
            )}
            data-calendar-view={option.value}
            key={option.value}
            onClick={() => choose(option.value, false)}
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              event.preventDefault();
              const next = VIEWS[(index + step + VIEWS.length) % VIEWS.length];
              if (next) choose(next.value, true);
            }}
            role="radio"
            tabIndex={on ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
      detail: "Its sessions are on your calendar.",
      first: null,
      removable: true,
    };
  if (data.status === "discarded")
    // Discarded after it was applied: it was taken off the calendar again.
    return data.appliedAt !== null
      ? {
          title: "Plan removed",
          detail: "Removed from your calendar.",
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
 * The plan `?plan=` names, as a thin bar under the toolbar: proposed and drawn dashed, or why
 * nothing of it is drawn. An applied plan can be taken off the calendar from here.
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
  // Removed, the button goes and the bar says so: focus moves onto what it says.
  const title = useRef<HTMLParagraphElement>(null);
  if (plan.isPending) return null;
  const note = planNote(plan, dates);
  const { first } = note;
  return (
    <div
      aria-label="Study plan"
      className="flex shrink-0 items-start gap-2 border-border border-b bg-[color-mix(in_oklab,var(--primary)_5%,var(--card))] py-2 pr-2 pl-4"
      role="status"
    >
      <div className="type-caption min-w-0 flex-1 py-1">
        <p
          className="font-semibold text-foreground outline-none"
          ref={title}
          tabIndex={-1}
        >
          {note.title}
        </p>
        <p className="mt-0.5 text-muted-foreground">{note.detail}</p>
        {note.removable && remove.isError ? (
          <p className="mt-1 text-duet-status-problem" role="alert">
            {remove.error.message}
          </p>
        ) : null}
        {first || note.removable ? (
          <div className="-ml-2 mt-1 flex flex-wrap gap-1">
            {first ? (
              <TextButton onClick={() => onGo(first)}>
                Show its first day
              </TextButton>
            ) : null}
            {note.removable ? (
              <TextButton
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => title.current?.focus(),
                  })
                }
              >
                Remove from calendar
              </TextButton>
            ) : null}
          </div>
        ) : null}
      </div>
      <button
        aria-label="Hide this plan"
        className={cn(
          TAP_AREA,
          "grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors before:-inset-1.5 hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
        onClick={onHide}
        title="Hide this plan"
        type="button"
      >
        <DuetIcon name="x" size={16} stroke={2.2} />
      </button>
    </div>
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
      className="flex shrink-0 gap-2.5 border-border border-b px-4 py-2.5"
      role="note"
    >
      <DuetIcon
        className="mt-px shrink-0 text-muted-foreground"
        name="alert"
        size={16}
      />
      <div className="type-caption min-w-0 flex-1">
        <p className="font-medium text-foreground">
          Not everything could be read
        </p>
        <ul className="mt-0.5 text-muted-foreground">
          {[...new Set(lines)].map((line) => (
            <li className="[overflow-wrap:anywhere]" key={line}>
              {line}
            </li>
          ))}
        </ul>
        <Link
          className={cn(
            TAP_AREA,
            "mt-1 inline-flex rounded-sm font-medium text-primary outline-none before:-inset-x-1 before:-inset-y-3.5 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
          to="/connections"
        >
          Open Connections
        </Link>
      </div>
    </div>
  );
}

/** The teacher's AI-help level in its own words. Grey: a rule to know, not a status. */
function HelpLabel({ level }: { level: HelpLevel }) {
  return (
    <span className="type-caption inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
      {level === "none" ? <DuetIcon name="lock" size={12} stroke={2} /> : null}
      AI help: {HELP_LEVEL_LABEL[level]}
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
    <p className="type-caption shrink-0 border-border border-b px-4 py-2.5 text-muted-foreground">
      {unread
        ? `Nothing we could read for ${when}.`
        : `Nothing on your calendar ${day ? `on ${day}` : when}.`}{" "}
      <Link
        className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        to="/"
      >
        Plan study time in Chat
      </Link>
    </p>
  );
}

/** Where the timeline will be: a quiet space while it loads, or why it could not. */
function CalendarPlaceholder({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="grid min-h-[320px] flex-[1_1_320px] place-items-center px-6 py-8 text-center">
      {error ? (
        <div role="alert">
          <p className="type-sub text-duet-red">{error}</p>
          <div className="mt-2 flex justify-center">
            <TextButton onClick={onRetry}>Try again</TextButton>
          </div>
        </div>
      ) : (
        <p className="type-sub text-duet-ink-2" role="status">
          Loading your calendar…
        </p>
      )}
    </div>
  );
}

/** The facts of the item the student pressed, in the card's words. */
type ItemFacts = {
  title: string;
  when: string;
  location: string | null;
  className: string | null;
  color: string;
  proposed: boolean;
  late: boolean;
  /** The teacher's AI-help level for what is due, where the notice gave one. */
  help: HelpLevel | null;
};

function itemFacts(
  item: CalendarItem,
  classes: readonly SchoolClass[],
): ItemFacts {
  const owner = (classId: string | null | undefined) =>
    classId ? classes.find((entry) => entry.id === classId) : undefined;
  const date = (day: string) =>
    dayLabel(day, { weekday: "short", month: "short", day: "numeric" });
  const quiet = {
    location: null,
    proposed: false,
    late: false,
    help: null,
  };
  if (item.kind === "due") {
    const { deadline } = item;
    const schoolClass = owner(deadline.classId);
    return {
      ...quiet,
      title: deadline.title,
      when: `${date(deadline.date)} · ${deadlineWhen(deadline)}`,
      className: schoolClass?.name ?? null,
      color: classColor(schoolClass?.color ?? "slate"),
      help: deadline.help,
    };
  }
  if (item.kind === "allDay")
    return {
      ...quiet,
      title: item.event.title,
      when: `${date(item.event.date)} · All day`,
      className: null,
      color: classColor("slate"),
    };
  const range = item.kind === "event" ? item.event : item.block;
  const schoolClass = owner(range.classId);
  return {
    title: range.title,
    when: `${date(range.date)} · ${clockLabel(range.start)} – ${clockLabel(range.end)}`,
    location: item.kind === "event" ? (item.event.location ?? null) : null,
    className: schoolClass?.name ?? null,
    color: classColor(schoolClass?.color ?? "slate"),
    proposed: item.kind === "block" && item.proposed,
    late: item.kind === "block" && item.block.late === true,
    help: null,
  };
}

/**
 * The pressed item's title, day and time, place and class, over the foot of the timeline: a sheet
 * along the bottom on a phone, a card in the corner on a wide screen. Escape, the close button or
 * pressing the item again puts it away, and focus goes back to the item.
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
    <section
      aria-label={`${facts.title}, details`}
      aria-live="polite"
      className="calendar-detail-popover absolute inset-x-2 bottom-2 z-50 rounded-xl border border-border bg-popover py-3 pr-2 pl-4 text-popover-foreground shadow-[var(--academic-calendar-elevation)] sm:inset-x-auto sm:right-3 sm:bottom-3 sm:w-[22rem]"
      data-calendar-details=""
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-[7px] size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: facts.color }}
        />
        <div className="type-caption min-w-0 flex-1 text-muted-foreground">
          {facts.proposed ? (
            <p className="font-semibold">Proposed, not on your calendar yet</p>
          ) : null}
          <p className="type-sub font-semibold text-foreground [overflow-wrap:anywhere]">
            {facts.title}
          </p>
          <p className="mt-0.5 tabular-nums">{facts.when}</p>
          {facts.location ? (
            <p className="[overflow-wrap:anywhere]">{facts.location}</p>
          ) : null}
          {facts.className ? <p>{facts.className}</p> : null}
          {facts.late ? (
            <p className="text-duet-status-needs">
              After its due date: time to catch up.
            </p>
          ) : null}
          {facts.help ? (
            <p className="mt-1.5">
              <HelpLabel level={facts.help} />
            </p>
          ) : null}
        </div>
        <button
          aria-label="Close details"
          className={cn(
            TAP_AREA,
            "-mt-1 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors before:-inset-1.5 hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
          onClick={onClose}
          type="button"
        >
          <DuetIcon name="x" size={16} stroke={2.2} />
        </button>
      </div>
    </section>
  );
}
