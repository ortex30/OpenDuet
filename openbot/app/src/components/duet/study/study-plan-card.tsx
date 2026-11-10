import type {
  PlanStatus,
  SchoolClass,
  StudyBlock,
  StudyPlan,
} from "@openbot/shared/study";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { SmallPill } from "@/components/shell/suggestion-card";
import { BuildIn } from "../build-in";
import { DuetIcon } from "../icons";
import { DuetCard, Rule, SectionLabel } from "../kit";
import {
  blockMinutes,
  classColorVar,
  clockMinutes,
  dayLabel,
  formatMinutes,
  formatTimeRange,
  plural,
} from "./format";

/**
 * The look of a text link on these cards, such as "View on calendar" beside an applied plan: the
 * brief's "Show N more" line, accent and 44px to tap. The caller draws its own router link with it.
 */
export const studyLinkClassName =
  "type-sub -mx-2 inline-flex h-11 items-center gap-1 rounded-full px-2 font-medium text-duet-accent transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 active:opacity-60";

/**
 * Why a stale plan can't be applied, in the words the card and the Calendar tab both use: another
 * plan went on the calendar after it was made, or one of its sessions has already begun.
 */
export function staleSentence(plan: Pick<StudyPlan, "staleReason">): string {
  return plan.staleReason === "started"
    ? "A session in this plan has already started. Ask for a fresh plan."
    : "Your schedule changed since this plan was made. Ask for a fresh one.";
}

/** The plan's blocks by day: days in order, and each day's blocks by start time. */
export function blocksByDay(
  blocks: readonly StudyBlock[],
): { date: string; blocks: StudyBlock[] }[] {
  const sorted = [...blocks].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (clockMinutes(a.start) ?? 0) - (clockMinutes(b.start) ?? 0) ||
      a.title.localeCompare(b.title),
  );
  const days = new Map<string, StudyBlock[]>();
  for (const block of sorted) {
    const day = days.get(block.date);
    if (day) day.push(block);
    else days.set(block.date, [block]);
  }
  return Array.from(days, ([date, list]) => ({ date, blocks: list }));
}

/**
 * A study plan the Bot proposed, as one card: how many sessions and how long, the sessions by day,
 * what did not fit, and Not now or Apply plan.
 *
 * Nothing is on the calendar until Apply. Once it was answered, anywhere, the buttons give way to a
 * line saying which, as a suggestion's do. An applied plan can still come off the calendar with
 * `onRemove`. A plan made before another one was applied, or one whose first session has begun, is
 * stale: it says why, and Apply stays off until the Bot makes a fresh one.
 *
 * `today` is the student's own day, "YYYY-MM-DD", for "Today" and "Tomorrow"; without it each day is
 * named by its date. `classes` adds each class's colour beside its sessions.
 */
export function StudyPlanCard({
  plan,
  onApply,
  onDiscard,
  onRemove,
  busy,
  error,
  calendarLink,
  previewLink,
  classes,
  today,
}: {
  plan: StudyPlan;
  onApply: () => void;
  onDiscard: () => void;
  /** Takes an applied plan's sessions off the calendar. Without it, an applied plan offers nothing. */
  onRemove?: () => void;
  /** True while an answer is on its way. */
  busy: boolean;
  error: string | null;
  /** Drawn beside "On your calendar", such as a link to the Calendar tab. */
  calendarLink?: ReactNode;
  /** Drawn under the sessions while the plan waits for an answer, such as a link to see it laid over the calendar. */
  previewLink?: ReactNode;
  classes?: SchoolClass[];
  today?: string;
}) {
  const days = blocksByDay(plan.blocks);
  const minutes = plan.blocks.reduce(
    (sum, block) => sum + blockMinutes(block.start, block.end),
    0,
  );
  const byId = new Map((classes ?? []).map((item) => [item.id, item]));
  const dots = byId.size > 0;
  const warnings = Array.from(new Set(plan.warnings));
  const preview = plan.status === "proposed" ? (previewLink ?? null) : null;
  /** Where the pieces after the sessions come in the build-in, one beat later with a preview. */
  const after = days.length + (preview ? 2 : 1);
  // A plan discarded after it was on the calendar (it has an appliedAt) was taken off again.
  const state =
    plan.status === "applied"
      ? "applied"
      : plan.status === "discarded"
        ? plan.appliedAt === null
          ? "discarded"
          : "removed"
        : plan.stale
          ? "stale"
          : "proposed";
  /*
   * Answered here, the buttons go and the line saying what happened takes their place, so focus
   * moves onto that line rather than falling to the page. Kept is the status the answer was given
   * from, so the move waits for the plan to leave it.
   */
  const [answered, setAnswered] = useState<PlanStatus | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (answered === null || plan.status === answered) return;
    status.current?.focus();
    setAnswered(null);
  }, [answered, plan.status]);
  return (
    <BuildIn order={0}>
      <DuetCard aria-label="Study plan" role="region">
        <BuildIn className="px-4 pt-[18px]" order={0}>
          <div className="flex items-center justify-between gap-3">
            <p className="type-row font-semibold">Your plan</p>
            {plan.blocks.length > 0 ? (
              <span className="type-caption inline-flex h-6 shrink-0 items-center rounded-full bg-duet-pop-a-soft px-2.5 font-semibold text-duet-pop-a tabular-nums">
                {`${plural(plan.blocks.length, "session", "sessions")} · ${formatMinutes(minutes)}`}
              </span>
            ) : null}
          </div>
          {plan.blocks.length === 0 ? (
            <p className="type-sub text-duet-ink-2">
              Nothing fit in that time.
            </p>
          ) : null}
          {plan.reason ? (
            <p className="type-sub mt-2 text-duet-ink-2 [overflow-wrap:anywhere]">
              {plan.reason}
            </p>
          ) : null}
        </BuildIn>
        {days.map((day, index) => (
          <BuildIn key={day.date} order={index + 1}>
            <section className="mt-4">
              <SectionLabel>{dayLabel(day.date, today)}</SectionLabel>
              <ul className="mt-0.5">
                {day.blocks.map((block, row) => (
                  <li key={block.id}>
                    {row > 0 ? <Rule /> : null}
                    <BlockRow
                      block={block}
                      dots={dots}
                      schoolClass={
                        block.classId ? byId.get(block.classId) : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          </BuildIn>
        ))}
        {preview ? (
          <BuildIn className="px-4 pt-1" order={days.length + 1}>
            {preview}
          </BuildIn>
        ) : null}
        {plan.remaining.length > 0 || warnings.length > 0 ? (
          <BuildIn className="px-4 pt-3" order={after}>
            <ul className="flex flex-col gap-1.5">
              {plan.remaining.length > 0 ? (
                <li className="type-sub flex gap-2 text-duet-ink-2">
                  <DuetIcon
                    className="mt-0.5 shrink-0 text-duet-status-needs"
                    name="clock"
                    size={16}
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">Didn't fit</span>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {plan.remaining.slice(0, 4).map((item) => (
                        <li
                          className="[overflow-wrap:anywhere]"
                          key={item.assignmentId}
                        >
                          {`${item.minutes} min of ${item.title}`}
                        </li>
                      ))}
                      {plan.remaining.length > 4 ? (
                        <li>{`${plan.remaining.length - 4} more`}</li>
                      ) : null}
                    </ul>
                  </span>
                </li>
              ) : null}
              {warnings.map((warning) => (
                <li
                  className="type-sub flex gap-2 text-duet-ink-2"
                  key={warning}
                >
                  <DuetIcon
                    className="mt-0.5 shrink-0 text-duet-status-needs"
                    name="alert"
                    size={16}
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {warning}
                  </span>
                </li>
              ))}
            </ul>
          </BuildIn>
        ) : null}
        <BuildIn className="px-4 pt-3 pb-4" order={after + 1}>
          {state === "applied" ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-3">
                <p
                  className="type-sub inline-flex min-h-11 items-center gap-1.5 font-semibold text-duet-status-done outline-none"
                  ref={status}
                  role="status"
                  tabIndex={-1}
                >
                  <DuetIcon name="check" size={16} stroke={2.6} />
                  On your calendar
                </p>
                {calendarLink ?? null}
              </div>
              {error ? (
                <p
                  className="type-sub mt-1 text-duet-status-problem"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              {onRemove ? (
                <div className="mt-2 flex">
                  <SmallPill
                    disabled={busy}
                    onClick={() => {
                      setAnswered(plan.status);
                      onRemove();
                    }}
                  >
                    Remove from calendar
                  </SmallPill>
                </div>
              ) : null}
            </>
          ) : state === "discarded" || state === "removed" ? (
            <p
              className="type-sub flex min-h-11 items-center font-medium text-duet-ink-3 outline-none"
              ref={status}
              role="status"
              tabIndex={-1}
            >
              {state === "removed" ? "Removed from your calendar" : "Not added"}
            </p>
          ) : (
            <>
              {state === "stale" ? (
                <p
                  className="type-sub flex gap-2 text-duet-ink-2"
                  role="status"
                >
                  <DuetIcon
                    className="mt-0.5 shrink-0 text-duet-status-needs"
                    name="alert"
                    size={16}
                  />
                  {staleSentence(plan)}
                </p>
              ) : null}
              {error ? (
                <p
                  className="type-sub mt-2 text-duet-status-problem"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <SmallPill
                  disabled={busy}
                  onClick={() => {
                    setAnswered(plan.status);
                    onDiscard();
                  }}
                >
                  Skip
                </SmallPill>
                <SmallPill
                  disabled={
                    busy || state === "stale" || plan.blocks.length === 0
                  }
                  onClick={() => {
                    setAnswered(plan.status);
                    onApply();
                  }}
                  primary
                >
                  Add to calendar
                </SmallPill>
              </div>
            </>
          )}
        </BuildIn>
      </DuetCard>
    </BuildIn>
  );
}

function BlockRow({
  block,
  schoolClass,
  dots,
}: {
  block: StudyBlock;
  schoolClass: SchoolClass | undefined;
  /** Whether the card shows class colours, so every row keeps the dot's column. */
  dots: boolean;
}) {
  const time = formatTimeRange(block.start, block.end);
  return (
    <div className="flex items-start gap-3 px-4 py-2.5" data-block={block.id}>
      {dots ? (
        // One line tall, so the dot sits on the title's first line however the title wraps.
        <span
          aria-hidden
          className="type-body flex h-[1lh] shrink-0 items-center"
        >
          <span
            className="size-3 rounded-full"
            data-class-color={schoolClass?.color ?? "none"}
            style={{
              backgroundColor: schoolClass
                ? classColorVar(schoolClass.color)
                : "transparent",
            }}
          />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="type-body font-medium [overflow-wrap:anywhere]">
          {block.title}
        </p>
        <p className="type-sub text-duet-ink-2 tabular-nums [overflow-wrap:anywhere]">
          {schoolClass ? `${time} · ${schoolClass.name}` : time}
        </p>
      </div>
      {block.late ? (
        <span className="type-caption mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full bg-duet-status-needs-soft px-2 font-medium text-duet-status-needs">
          Late
          <span className="sr-only">, after it was due</span>
        </span>
      ) : null}
    </div>
  );
}
