import { useRenderTool } from "@copilotkit/react-core/v2";
import { PLAN_TOOL, type PlanToolResult } from "@openbot/shared/study";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod";
import { ToolLine } from "@/components/channels/tool-line";
import { DuetCard } from "@/components/duet/kit";
import {
  formatMinutes,
  plural,
  StudyPlanCard,
  studyLinkClassName,
} from "@/components/duet/study";
import { SmallPill } from "@/components/shell/suggestion-card";
import { readToolName } from "@/lib/plugins/tool-name";
import {
  applyPlanMutationOptions,
  discardPlanMutationOptions,
  planQueryOptions,
  removePlanMutationOptions,
} from "@/lib/study/plans";
import { planToolResultSchema, readToolResult } from "@/lib/study/schemas";
import { HeldUntilReplied } from "./page-card-tool";

/*
 * Draws the server's `propose_study_plan` (server/src/openduet/study/plan-tools.ts) as the plan card
 * under the Bot's line about it: the sessions by day, what did not fit, and Not now or Apply plan.
 *
 * The tool's result is a few numbers and an id, because it is replayed to the model on every turn;
 * the card reads the plan itself by id, so a plan answered here, in another tab or on the Calendar
 * tab reads the same wherever it is drawn, and one that went stale says so instead of offering Apply.
 * Nothing is on the calendar until Apply, which the server checks against the calendar as it is then.
 */

const parameters = z.object({
  minutes: z.number().optional(),
  reason: z.string().optional(),
});

/** The tool's result, or null for a refusal or anything that is not a proposed plan. */
export function readPlanResult(result: unknown): PlanToolResult | null {
  return readToolResult(result, planToolResultSchema);
}

/**
 * The student's day, "YYYY-MM-DD", where the plan was made, by this browser's clock: so "Today" on
 * the card is their today, not the browser's or UTC's. Undefined for a zone this browser doesn't
 * know, and the card names each day by its date instead.
 */
export function todayIn(
  timeZone: string,
  now: Date = new Date(),
): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((piece) => piece.type === type)?.value;
    const [year, month, day] = [part("year"), part("month"), part("day")];
    return year && month && day ? `${year}-${month}-${day}` : undefined;
  } catch {
    return undefined;
  }
}

/** "3 sessions · 2 h 30 min", as the tool's result says, for the line that holds the card's place. */
function summaryOf(result: PlanToolResult): string {
  return result.blocks > 0
    ? `${plural(result.blocks, "session", "sessions")} · ${formatMinutes(result.totalMinutes)}`
    : "No sessions fit in the time you have.";
}

/** The card's header alone, while the plan is on its way or could not be read. */
function PlanShell({
  summary,
  children,
}: {
  summary: string;
  children?: ReactNode;
}) {
  return (
    <DuetCard
      aria-busy={children ? undefined : true}
      aria-label="Study plan"
      role="region"
    >
      <div className="px-4 pt-[18px] pb-4">
        <p className="type-row font-semibold">Study plan</p>
        <p className="type-sub text-duet-ink-2 tabular-nums">{summary}</p>
        {children}
      </div>
    </DuetCard>
  );
}

/**
 * A proposed plan, read by its id and answered with Apply or Not now, and taken off the calendar
 * again with Remove from calendar once it is applied.
 */
export function ProposedPlanCard({ proposed }: { proposed: PlanToolResult }) {
  const queryClient = useQueryClient();
  const read = useQuery(planQueryOptions(proposed.id));
  const apply = useMutation(applyPlanMutationOptions(queryClient, proposed.id));
  const discard = useMutation(
    discardPlanMutationOptions(queryClient, proposed.id),
  );
  const remove = useMutation(
    removePlanMutationOptions(queryClient, proposed.id),
  );
  const summary = summaryOf(proposed);
  const plan = read.data;

  let card: ReactNode;
  if (plan) {
    // The answer pressed last is the one whose trouble to show.
    const last = [discard, remove].reduce(
      (latest, answer) =>
        answer.submittedAt > latest.submittedAt ? answer : latest,
      apply,
    );
    /*
     * An Apply refused because the plan went stale reads its plan again, and the card's own line
     * then says so; the same words twice would be one too many.
     */
    const error =
      last === apply && plan.stale ? null : (last.error?.message ?? null);
    const calendar = (label: string) => (
      <Link
        className={studyLinkClassName}
        search={{ plan: plan.id, date: plan.startDate }}
        to="/calendar"
      >
        {label}
      </Link>
    );
    card = (
      <StudyPlanCard
        busy={apply.isPending || discard.isPending || remove.isPending}
        calendarLink={calendar("View on calendar")}
        error={error}
        onApply={() => apply.mutate()}
        onDiscard={() => discard.mutate()}
        onRemove={() => remove.mutate()}
        plan={plan}
        previewLink={calendar("Preview on calendar")}
        today={todayIn(plan.timeZone)}
      />
    );
  } else if (read.isError)
    card = (
      <PlanShell summary={summary}>
        <p className="type-sub mt-2 text-duet-status-problem" role="alert">
          {read.error.message}
        </p>
        <div className="mt-3 flex">
          <SmallPill
            disabled={read.isFetching}
            onClick={() => void read.refetch()}
          >
            Try again
          </SmallPill>
        </div>
      </PlanShell>
    );
  else card = <PlanShell summary={summary} />;

  return (
    <HeldUntilReplied title={summary} tool={PLAN_TOOL}>
      {card}
    </HeldUntilReplied>
  );
}

export function StudyPlanCardTool() {
  useRenderTool({
    name: PLAN_TOOL,
    parameters,
    render: ({ result, status }) => {
      if (status !== "complete" && result === undefined)
        return <ToolLine label={readToolName(PLAN_TOOL, true).label} running />;
      const proposed = readPlanResult(result);
      /*
       * Nothing for a refusal. The Bot is told what to fix and tries again, or tells the student why
       * there is no plan; a card saying so would show the person the Bot's mistake.
       */
      return proposed ? <ProposedPlanCard proposed={proposed} /> : null;
    },
  });
  return null;
}
