import type { CalendarView, StudyPlan } from "@openbot/shared/study";
import {
  mutationOptions,
  type QueryClient,
  queryOptions,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { studyKeys } from "./keys";
import { studyPlanSchema } from "./schemas";

/*
 * A study plan by id and its answers: Apply, Not now, and Remove from calendar once it is applied
 * (server/src/openduet/study/plan-routes.ts). The plan card in Chat reads and answers it here; the
 * Calendar tab reads the same query to lay a proposed plan over the calendar (calendar.ts), so both
 * draw one record under one key and an answer given in either place shows in both.
 */

type Answer = "apply" | "discard" | "remove";

/** The prefix of every plan's key, studyKeys.plan(id) without the id. */
const PLANS = [...studyKeys.all, "plan"] as const;

function planPath(id: string, answer?: Answer): string {
  const path = `/api/openduet/study/plans/${encodeURIComponent(id)}`;
  return answer ? `${path}/${answer}` : path;
}

/**
 * The plan in an answer, checked. A body of the wrong shape is a failed read, said in a sentence the
 * student can act on, rather than a list of zod issues on the card.
 */
function readPlan(value: unknown): StudyPlan {
  const parsed = studyPlanSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("Couldn't read that plan. Ask in Chat for a fresh one.");
  return parsed.data;
}

/** GET /api/openduet/study/plans/:id, with `stale` worked out by the server as it answers. */
export function planQueryOptions(id: string) {
  return queryOptions({
    queryKey: studyKeys.plan(id),
    queryFn: async ({ signal }): Promise<StudyPlan> =>
      readPlan(
        await client<unknown>(planPath(id), "plan", {
          fallback: "Couldn't open that plan.",
          signal,
        }),
      ),
  });
}

/**
 * A range of the Calendar tab with the plan's sessions put on it (`on`) or taken off, so the
 * calendar shows an answer at once instead of after its next read. Only the sessions that fall in
 * the range go on, and a session already there is never drawn twice.
 */
function withSessions(
  view: CalendarView | undefined,
  plan: StudyPlan,
  on: boolean,
): CalendarView | undefined {
  if (!view) return view;
  const ids = new Set(plan.blocks.map((block) => block.id));
  const kept = view.blocks.filter((block) => !ids.has(block.id));
  const added = on
    ? plan.blocks.filter(
        (block) => block.date >= view.from && block.date <= view.to,
      )
    : [];
  if (added.length === 0 && kept.length === view.blocks.length) return view;
  return { ...view, blocks: [...kept, ...added] };
}

function answerOptions(
  queryClient: QueryClient,
  id: string,
  answer: Answer,
  fallback: string,
) {
  // Apply and Remove change what is on the calendar; Not now only answers a proposal.
  const moves = answer !== "discard";
  return mutationOptions({
    // One answer at a time for a plan: an Apply and a Not now never cross on their way.
    scope: { id: `plan:${id}` },
    // A refusal is the server's word on the plan as it is now. Sent again, it says the same.
    retry: false,
    mutationFn: async (): Promise<StudyPlan> =>
      readPlan(
        await client<unknown>(planPath(id, answer), "plan", {
          method: "POST",
          fallback,
        }),
      ),
    onSuccess: async (plan) => {
      // A read that set off before the answer must not land after it with the plan as it was.
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: studyKeys.plan(id),
          exact: true,
        }),
        ...(moves
          ? [queryClient.cancelQueries({ queryKey: studyKeys.calendarAll })]
          : []),
      ]);
      queryClient.setQueryData(studyKeys.plan(id), plan);
      if (moves) {
        // Drawn at once on every range already read; the reads below then bring the server's copy.
        queryClient.setQueriesData<CalendarView>(
          { queryKey: studyKeys.calendarAll },
          (view) => withSessions(view, plan, answer === "apply"),
        );
        /*
         * The student's other plans: one made before this Apply is out of date now, and one made
         * out of date by it may not be once it is removed. Read again, each card says which.
         */
        void queryClient.invalidateQueries({
          queryKey: PLANS,
          predicate: (query) => query.queryKey[2] !== id,
        });
      }
      // Every range of the Calendar tab, so it shows the plan's sessions as the server has them.
      void queryClient.invalidateQueries({ queryKey: studyKeys.calendarAll });
    },
    onError: () => {
      // Refused because the plan moved on, stale or answered in another tab: read it again, so the
      // card says what it is now.
      void queryClient.invalidateQueries({
        queryKey: studyKeys.plan(id),
        exact: true,
      });
    },
  });
}

/** POST /api/openduet/study/plans/:id/apply: the plan's sessions go on the calendar. */
export function applyPlanMutationOptions(queryClient: QueryClient, id: string) {
  return answerOptions(
    queryClient,
    id,
    "apply",
    "Couldn't add the plan to your calendar. Try again.",
  );
}

/** POST /api/openduet/study/plans/:id/discard: Not now. */
export function discardPlanMutationOptions(
  queryClient: QueryClient,
  id: string,
) {
  return answerOptions(
    queryClient,
    id,
    "discard",
    "Couldn't dismiss the plan. Try again.",
  );
}

/**
 * POST /api/openduet/study/plans/:id/remove: an applied plan's sessions come off the calendar. The
 * plan answers as discarded with its appliedAt kept, which is how it reads as removed.
 */
export function removePlanMutationOptions(
  queryClient: QueryClient,
  id: string,
) {
  return answerOptions(
    queryClient,
    id,
    "remove",
    "Couldn't take the plan off your calendar. Try again.",
  );
}
