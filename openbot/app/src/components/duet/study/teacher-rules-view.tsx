import {
  type ClassRules,
  DEFAULT_HELP_LEVEL,
  HELP_LEVEL_LABEL,
  HELP_LEVELS,
  type HelpLevel,
  helpLevelRank,
  type RulesChange,
  type RulesView,
} from "@openbot/shared/study";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { PageSection } from "@/components/layout/page-shell";
import { agoShort } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { DuetIcon } from "../icons";
import { DuetCard, Rule } from "../kit";
import { dayLabel } from "./format";
import { HelpLevelPill } from "./help-level-pill";

/*
 * The Teacher rules page's body: each class's AI-help level and each assignment's, where each one
 * came from, and a control to make one stricter (anybody) or looser (an admin). Props only, so it can
 * be drawn and tested alone; the route reads the rules and owns the requests.
 *
 * The server decides every level (server/src/openduet/study/rules.ts). What this works out for itself
 * is only for the words and the controls: which notice decided a class, which choices this person can
 * make, and which overrides an admin set to loosen a rule. The server checks every change again, and
 * its refusal is shown as it said it.
 */

type Kind = "classes" | "assignments";
type AssignmentRules = ClassRules["assignments"][number];

const ONLY_STRICTER = "Only a teacher or an admin can loosen this.";
const ADMIN_LOOSENED =
  "An admin loosened this rule, so only an admin can change it.";

const PILL =
  "type-sub inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 font-medium transition-[filter,transform,background-color] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 active:scale-[0.98] aria-disabled:opacity-50";
const QUIET =
  "text-duet-ink shadow-[inset_0_0_0_1px_var(--duet-hair)] hover:bg-duet-tile";
const PRIMARY = "bg-duet-black text-duet-on-black hover:brightness-125";

const LINK =
  "type-sub -mb-2 inline-flex min-h-11 items-center rounded-full font-medium text-duet-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40";

export type TeacherRulesViewProps = {
  /** The screen, or null until it first loads. */
  rules: RulesView | null;
  /** Why the screen couldn't load, when there is nothing to show. */
  loadError: string | null;
  onReload: () => void;
  /** Sets a level, or clears an override with null. */
  onChange: (change: RulesChange) => void;
  /** Changes still on their way to the server, oldest first. Each shows as chosen until it lands. */
  saving: readonly RulesChange[];
  /** The last change the server refused, and the sentence it gave. */
  failed: { change: RulesChange; message: string } | null;
  onRefresh: () => void;
  refreshing: boolean;
  refreshError: string | null;
  /** Draws the link to the Connections page, so this needs no router of its own. */
  connections: (link: { className: string; children: ReactNode }) => ReactNode;
  /** The browser's clock unless given. */
  now?: Date;
  /** The zone due times are read in: the student's, from `rules.timeZone`, unless given. */
  timeZone?: string;
};

/** One change that sets (or clears) one class's or one assignment's level. */
function changeOf(
  kind: Kind,
  id: string,
  level: HelpLevel | null,
): RulesChange {
  return kind === "classes"
    ? { classes: { [id]: level } }
    : { assignments: { [id]: level } };
}

/** Whether a change names this class or assignment. */
function names(change: RulesChange, kind: Kind, id: string): boolean {
  const levels = change[kind];
  return levels !== undefined && Object.hasOwn(levels, id);
}

/** The newest level still being saved for it, null for a clear, or undefined when none is. */
function savingFor(
  saving: readonly RulesChange[],
  kind: Kind,
  id: string,
): HelpLevel | null | undefined {
  let found: HelpLevel | null | undefined;
  for (const change of saving)
    if (names(change, kind, id)) found = change[kind]?.[id] ?? null;
  return found;
}

/** Still to do and not past due, as the server judges which notices count for a class. */
function isLive(row: AssignmentRules, now: Date): boolean {
  if (row.status !== "open" && row.status !== "missing") return false;
  if (row.due === null) return true;
  const due = Date.parse(row.due);
  return Number.isNaN(due) || due >= now.getTime();
}

/**
 * What a class's notices alone give it, and the assignment that decides it: the strictest notice
 * still to do, the soonest due on a tie (the rows already come soonest first), else the default.
 */
function fromNotices(
  rules: ClassRules,
  now: Date,
): { level: HelpLevel; decidedBy: string | null } {
  let level: HelpLevel | null = null;
  let decidedBy: string | null = null;
  for (const row of rules.assignments)
    if (
      row.notice !== null &&
      // As on the server: a material's or announcement's rule covers that item, not the class.
      row.kind !== "material" &&
      row.kind !== "announcement" &&
      isLive(row, now) &&
      (level === null || helpLevelRank(row.notice) > helpLevelRank(level))
    ) {
      level = row.notice;
      decidedBy = row.title;
    }
  return level === null
    ? { level: DEFAULT_HELP_LEVEL, decidedBy: null }
    : { level, decidedBy };
}

/**
 * Where a loosening came from. The rules are the viewer's own, so an admin set it themselves; a
 * student sees one only from a time they were an admin, and the words say why it is locked.
 */
const loosenedBy = (canLoosen: boolean) =>
  canLoosen ? "Loosened here" : "Loosened by an admin";

/** "Mr. Grant's", or "your teacher's" when the notices named nobody. */
const whose = (teacher: string | null) =>
  teacher ? `${teacher}'s` : "your teacher's";

/** Worth listing: it has a rule of its own, or it is still to do. */
const listed = (row: AssignmentRules) =>
  row.notice !== null || row.override !== null || row.status !== "returned";

const NBSP = "\u00a0";

/** The day ("YYYY-MM-DD") and minute of the day an instant falls on in a time zone. */
function zoned(
  instant: Date,
  timeZone: string,
): { date: string; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((candidate) => candidate.type === type)?.value ?? "";
    return {
      date: `${part("year")}-${part("month")}-${part("day")}`,
      minutes: Number(part("hour")) * 60 + Number(part("minute")),
    };
  } catch {
    // A zone the browser doesn't know: the due line says less rather than the wrong day.
    return null;
  }
}

/** "11:59 PM", held together by a no-break space as the study cards' times are. */
function clockText(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const rest = String(minutes % 60).padStart(2, "0");
  return `${hours % 12 === 0 ? 12 : hours % 12}:${rest}${NBSP}${hours < 12 ? "AM" : "PM"}`;
}

/** "Due tomorrow, 10:45 AM", "Missing · was due Tue, Nov 3, 11:59 PM", "No due date". */
function dueText(row: AssignmentRules, now: Date, timeZone: string): string {
  if (row.status === "returned") return "Returned";
  const due = row.due === null ? Number.NaN : Date.parse(row.due);
  if (Number.isNaN(due))
    return row.status === "missing" ? "Missing" : "No due date";
  const at = zoned(new Date(due), timeZone);
  if (!at) return row.status === "missing" ? "Missing" : "Has a due date";
  const day = dayLabel(at.date, zoned(now, timeZone)?.date);
  const when = `${day === "Today" || day === "Tomorrow" ? day.toLowerCase() : day}, ${clockText(at.minutes)}`;
  if (row.status === "missing") return `Missing · was due ${when}`;
  return due < now.getTime() ? `Was due ${when}` : `Due ${when}`;
}

export function TeacherRulesView({
  rules,
  loadError,
  onReload,
  onChange,
  saving,
  failed,
  onRefresh,
  refreshing,
  refreshError,
  connections,
  now = new Date(),
  timeZone: givenZone,
}: TeacherRulesViewProps) {
  /** A student's stricter choice, waiting on "Make it …": they can't undo it themselves. */
  const [proposal, setProposal] = useState<{
    key: string;
    level: HelpLevel;
  } | null>(null);

  if (!rules) {
    if (!loadError)
      return (
        <p className="type-sub mt-8 text-duet-ink-2" role="status">
          Loading your teacher rules…
        </p>
      );
    return (
      <div className="mt-8">
        <p className="type-sub text-duet-status-problem" role="alert">
          {loadError}
        </p>
        <button
          className={cn(PILL, QUIET, "mt-3")}
          onClick={onReload}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  // The student's zone, as the Calendar tab reads their due times, never this device's.
  const timeZone = givenZone ?? rules.timeZone;

  const control = (
    kind: Kind,
    id: string,
  ): Pick<
    RuleControlProps,
    "kind" | "id" | "saving" | "failed" | "proposal" | "onPropose" | "onChange"
  > => {
    const key = `${kind}:${id}`;
    return {
      kind,
      id,
      saving,
      failed: failed && names(failed.change, kind, id) ? failed.message : null,
      proposal: proposal?.key === key ? proposal.level : null,
      onPropose: (level) => setProposal(level ? { key, level } : null),
      onChange,
    };
  };

  return (
    <>
      <div className="mt-6 flex max-w-prose flex-col gap-2">
        <p className="type-sub text-pretty text-duet-ink-2">
          No help turns off AI quizzes and flashcards for that assignment.
          {rules.canLoosen ? "" : " Only a teacher can loosen a rule."}
        </p>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          aria-disabled={refreshing || undefined}
          className={cn(PILL, QUIET)}
          onClick={() => {
            if (!refreshing) onRefresh();
          }}
          type="button"
        >
          <DuetIcon name="repeat" size={18} />
          {refreshing ? "Refreshing…" : "Refresh from Classroom"}
        </button>
        <p aria-live="polite" className="type-sub text-duet-ink-2">
          {rules.syncedAt
            ? `Last read ${agoShort(rules.syncedAt, now.getTime())}`
            : "Not read yet"}
        </p>
      </div>
      {refreshError ? (
        <p className="type-sub mt-2 text-duet-status-problem" role="alert">
          {refreshError}
        </p>
      ) : null}
      {rules.couldNotRead.length > 0 ? (
        <CouldNotRead connections={connections} lines={rules.couldNotRead} />
      ) : null}
      {rules.classes.length === 0 ? (
        <NoClasses
          connections={connections}
          // The box above already says why, with its own link.
          linked={rules.couldNotRead.length > 0}
          read={rules.syncedAt !== null}
        />
      ) : (
        rules.classes.map((rulesForClass) => (
          <ClassSection
            canLoosen={rules.canLoosen}
            control={control}
            key={rulesForClass.classId}
            now={now}
            rules={rulesForClass}
            timeZone={timeZone}
          />
        ))
      )}
    </>
  );
}

function CouldNotRead({
  lines,
  connections,
}: {
  lines: readonly string[];
  connections: TeacherRulesViewProps["connections"];
}) {
  return (
    <div
      aria-label="Not everything could be read"
      className="mt-5 flex gap-3 rounded-[var(--duet-radius-card)] bg-duet-tile px-4 py-3"
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
        {connections({ className: LINK, children: "Open Connections" })}
      </div>
    </div>
  );
}

function NoClasses({
  read,
  linked,
  connections,
}: {
  read: boolean;
  linked: boolean;
  connections: TeacherRulesViewProps["connections"];
}) {
  return (
    <div className="mt-8 max-w-prose">
      <p className="type-body font-medium text-duet-ink">
        {read ? "No classes found yet" : "Your classes haven't been read yet"}
      </p>
      <p className="type-sub mt-1 text-pretty text-duet-ink-2">
        {read
          ? "Your Gmail has no Google Classroom emails from the last 30 days. If your school uses a different Google account, connect that one."
          : "Connect the Google account your school uses, then refresh from Classroom. Your classes and their rules show up here."}
      </p>
      {linked
        ? null
        : connections({ className: LINK, children: "Open Connections" })}
    </div>
  );
}

function ClassSection({
  rules,
  canLoosen,
  control,
  now,
  timeZone,
}: {
  rules: ClassRules;
  canLoosen: boolean;
  control: (
    kind: Kind,
    id: string,
  ) => Pick<
    RuleControlProps,
    "kind" | "id" | "saving" | "failed" | "proposal" | "onPropose" | "onChange"
  >;
  now: Date;
  timeZone: string;
}) {
  const notices = fromNotices(rules, now);
  // A student's override only ever adds to the notices, so one the class obeys although it is
  // looser than they are can only be an admin's loosening.
  const loosened =
    rules.source === "override" &&
    rules.override !== null &&
    helpLevelRank(rules.override) < helpLevelRank(notices.level);
  const source =
    rules.source === "override"
      ? loosened
        ? loosenedBy(canLoosen)
        : "Set here"
      : rules.source === "notice"
        ? notices.decidedBy && notices.level === rules.level
          ? `From ${whose(rules.teacher)} post: ${notices.decidedBy}`
          : `From ${whose(rules.teacher)} Classroom posts`
        : `Default: ${HELP_LEVEL_LABEL[DEFAULT_HELP_LEVEL]}`;
  const rows = rules.assignments.filter(listed);
  return (
    <PageSection
      action={<HelpLevelPill level={rules.level} />}
      className="mt-10"
      description={rules.teacher ?? undefined}
      title={rules.className}
    >
      <DuetCard className="mt-3">
        <div className="px-4 py-4">
          <h3 className="type-body font-medium text-duet-ink">Whole class</h3>
          <RuleControl
            {...control("classes", rules.classId)}
            also={
              rules.override !== null && rules.source !== "override"
                ? `Also set here: ${HELP_LEVEL_LABEL[rules.override]}`
                : null
            }
            canClear={
              !loosened &&
              helpLevelRank(notices.level) >= helpLevelRank(rules.level)
            }
            canLoosen={canLoosen}
            loosened={loosened}
            name={rules.className}
            override={rules.override}
            question={rules.className}
            serverLevel={rules.level}
            source={source}
          />
        </div>
        {rows.length > 0 ? (
          <ul aria-label={`${rules.className} assignments`}>
            {rows.map((row) => (
              <li key={row.assignmentId}>
                <Rule />
                <AssignmentBlock
                  canLoosen={canLoosen}
                  control={control("assignments", row.assignmentId)}
                  due={dueText(row, now, timeZone)}
                  row={row}
                  teacher={rules.teacher}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </DuetCard>
    </PageSection>
  );
}

function AssignmentBlock({
  row,
  teacher,
  due,
  canLoosen,
  control,
}: {
  row: AssignmentRules;
  teacher: string | null;
  due: string;
  canLoosen: boolean;
  control: Pick<
    RuleControlProps,
    "kind" | "id" | "saving" | "failed" | "proposal" | "onPropose" | "onChange"
  >;
}) {
  // As for a class: an override the assignment obeys although it is looser than its own notice can
  // only be an admin's loosening, since a student's adds to the notice instead.
  const loosened =
    row.override !== null &&
    row.notice !== null &&
    row.level === row.override &&
    helpLevelRank(row.override) < helpLevelRank(row.notice);
  const decides =
    row.override !== null &&
    row.source === "override" &&
    row.level === row.override;
  const source = loosened
    ? loosenedBy(canLoosen)
    : decides
      ? "Set here"
      : row.notice !== null &&
          row.source === "notice" &&
          row.level === row.notice
        ? `From ${whose(teacher)} post`
        : "Same as the whole class";
  return (
    <div className="px-4 py-4">
      <h3 className="type-body font-medium text-duet-ink [overflow-wrap:anywhere]">
        {row.title}
      </h3>
      <p className="type-sub mt-0.5 text-duet-ink-2">{due}</p>
      {/* A line of its own, so a phone never breaks it from the date at a dangling dot. */}
      {row.notice ? (
        <p className="type-sub mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-duet-ink-2">
          Teacher's rule
          <HelpLevelPill level={row.notice} />
        </p>
      ) : (
        <p className="type-sub mt-1.5 text-duet-ink-2">
          No rule in the teacher's post
        </p>
      )}
      <RuleControl
        {...control}
        also={
          row.override !== null && !decides && !loosened
            ? `Also set here: ${HELP_LEVEL_LABEL[row.override]}`
            : null
        }
        // Clearing leaves its own notice: allowed when the override adds nothing to that.
        canClear={
          !loosened &&
          row.override !== null &&
          helpLevelRank(row.override) <= helpLevelRank(row.notice ?? "full")
        }
        canLoosen={canLoosen}
        loosened={loosened}
        name={row.title}
        override={row.override}
        question={`“${row.title}”`}
        serverLevel={row.level}
        source={source}
      />
    </div>
  );
}

type RuleControlProps = {
  kind: Kind;
  id: string;
  /** What the level is for, in the control's name: "AI help for Chemistry". */
  name: string;
  /** How the confirming question names it: Chemistry, or an assignment's title in quotes. */
  question: string;
  /** What the study tools obey now. */
  serverLevel: HelpLevel;
  override: HelpLevel | null;
  source: string;
  /** An override that is set but isn't what decides, said under the source. */
  also: string | null;
  canLoosen: boolean;
  /** Whether this person may clear the override without loosening anything. */
  canClear: boolean;
  /** An admin set this override to loosen a rule. */
  loosened: boolean;
  saving: readonly RulesChange[];
  failed: string | null;
  proposal: HelpLevel | null;
  onPropose: (level: HelpLevel | null) => void;
  onChange: (change: RulesChange) => void;
};

/**
 * One level and its controls: the choice, where the level came from, why some choices are off, the
 * question a student answers before a change they can't undo, Use the teacher's rule, and the
 * server's answer when it refused.
 */
function RuleControl({
  kind,
  id,
  name,
  question,
  serverLevel,
  override,
  source,
  also,
  canLoosen,
  canClear,
  loosened,
  saving,
  failed,
  proposal,
  onPropose,
  onChange,
}: RuleControlProps) {
  const ids = useId();
  const group = useRef<HTMLDivElement>(null);
  /*
   * The buttons that had focus go away when a change is sent or the question is answered, so focus
   * goes back to the choice: the level just sent, which is the one being saved before the screen
   * shows it chosen, or else whichever is chosen.
   */
  const [focusTo, setFocusTo] = useState<HelpLevel | "chosen" | null>(null);
  useEffect(() => {
    if (focusTo === null) return;
    setFocusTo(null);
    group.current
      ?.querySelector<HTMLElement>(
        focusTo === "chosen"
          ? '[role="radio"][aria-checked="true"]'
          : `[data-level="${focusTo}"]`,
      )
      ?.focus();
  }, [focusTo]);

  const pending = savingFor(saving, kind, id);
  const busy = pending !== undefined;
  const shown = proposal ?? pending ?? serverLevel;
  const locked = (level: HelpLevel) =>
    !canLoosen &&
    (loosened
      ? level !== serverLevel
      : helpLevelRank(level) < helpLevelRank(serverLevel));
  const reason = canLoosen
    ? null
    : loosened
      ? ADMIN_LOOSENED
      : serverLevel !== "full"
        ? ONLY_STRICTER
        : null;

  const send = (level: HelpLevel | null) => {
    onPropose(null);
    onChange(changeOf(kind, id, level));
    setFocusTo(level ?? "chosen");
  };
  const pick = (level: HelpLevel) => {
    if (busy) return;
    if (level === serverLevel) onPropose(null);
    // An admin can always change it back, so their choice goes straight through.
    else if (canLoosen) send(level);
    else onPropose(level);
  };

  return (
    <>
      <LevelChoice
        busy={busy}
        describedBy={[`${ids}-source`, reason ? `${ids}-reason` : null]
          .filter(Boolean)
          .join(" ")}
        group={group}
        label={`AI help for ${name}`}
        locked={locked}
        onPick={pick}
        value={shown}
      />
      <p className="type-sub mt-2 text-duet-ink-2" id={`${ids}-source`}>
        {busy ? "Saving…" : source}
      </p>
      {also ? (
        <p className="type-caption mt-0.5 text-duet-ink-3">{also}</p>
      ) : null}
      {reason ? (
        <p className="type-caption mt-0.5 text-duet-ink-3" id={`${ids}-reason`}>
          {reason}
        </p>
      ) : null}
      {/* Live, so the question is read out when it appears without taking focus from the choice. */}
      <div aria-live="polite">
        {proposal ? (
          <div className="mt-3 rounded-[16px] bg-duet-tile p-3">
            <p className="type-sub text-pretty text-duet-ink">
              Make {question} {HELP_LEVEL_LABEL[proposal]}? Only a teacher or an
              admin can undo it.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                className={cn(PILL, QUIET)}
                onClick={() => {
                  onPropose(null);
                  setFocusTo("chosen");
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className={cn(PILL, PRIMARY)}
                onClick={() => send(proposal)}
                type="button"
              >
                Make it {HELP_LEVEL_LABEL[proposal]}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {override !== null && (canLoosen || canClear) && !busy && !proposal ? (
        <button
          className={cn(PILL, QUIET, "mt-3")}
          onClick={() => send(null)}
          type="button"
        >
          Use the teacher's rule<span className="sr-only"> for {name}</span>
        </button>
      ) : null}
      {failed ? (
        <p className="type-sub mt-2 text-duet-status-problem" role="alert">
          {failed}
        </p>
      ) : null}
    </>
  );
}

/**
 * Full help, Hints only, No help, side by side: the kit's Segmented, with choices this person can't
 * make drawn and announced as unavailable, and arrow keys that skip them and keep focus on the
 * choice they move to. A radio group to assistive technology.
 */
function LevelChoice({
  label,
  value,
  locked,
  busy,
  describedBy,
  group,
  onPick,
}: {
  label: string;
  value: HelpLevel;
  locked: (level: HelpLevel) => boolean;
  busy: boolean;
  describedBy: string;
  group: RefObject<HTMLDivElement | null>;
  onPick: (level: HelpLevel) => void;
}) {
  const open = HELP_LEVELS.filter((level) => level === value || !locked(level));
  const move = (from: HelpLevel, step: number) => {
    const at = open.indexOf(from);
    const next = open[(at + step + open.length) % open.length];
    if (!next || next === from || busy) return;
    onPick(next);
    group.current
      ?.querySelector<HTMLElement>(`[data-level="${next}"]`)
      ?.focus();
  };
  return (
    <div
      aria-busy={busy || undefined}
      aria-describedby={describedBy}
      aria-label={label}
      // Wraps onto a second line at a large text size rather than running off the screen. Each
      // choice starts narrower than the kit's 7rem, so all three fit one line inside a phone's card.
      className="duet-face mt-3 flex w-full flex-wrap gap-1 rounded-[26px] bg-duet-tile p-1"
      ref={group}
      role="radiogroup"
    >
      {HELP_LEVELS.map((level) => {
        const on = level === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control, drawn as one capsule.
          <button
            aria-checked={on}
            className={cn(
              "type-sub flex min-h-11 flex-[1_1_5rem] items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 font-medium transition-colors duration-[var(--duet-dur-swap)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 disabled:cursor-not-allowed disabled:opacity-45",
              on
                ? "bg-duet-card text-duet-ink shadow-duet-float"
                : "text-duet-ink-2 enabled:hover:text-duet-ink",
            )}
            data-level={level}
            disabled={!on && locked(level)}
            key={level}
            onClick={() => {
              if (!busy) onPick(level);
            }}
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (step === 0) return;
              event.preventDefault();
              move(level, step);
            }}
            role="radio"
            tabIndex={on ? 0 : -1}
            type="button"
          >
            {HELP_LEVEL_LABEL[level]}
          </button>
        );
      })}
    </div>
  );
}
