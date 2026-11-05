import type { RulesChange, RulesView } from "@openbot/shared/study";
import {
  mutationOptions,
  type QueryClient,
  queryOptions,
} from "@tanstack/react-query";
import { z } from "zod";
import { client } from "@/lib/client";
import { studyKeys } from "./keys";
import { rulesViewSchema, schoolSnapshotSchema } from "./schemas";

/*
 * The Teacher rules screen's reads and writes: the rules as the screen shows them, a change to them,
 * and reading Classroom again. Every answer carries the whole screen, so each write puts it straight
 * into the cache rather than asking for it again.
 */

/** POST /api/openduet/study/school/sync's answer: the fresh read, why it fell back, and the screen. */
const schoolSyncSchema = z.object({
  school: schoolSnapshotSchema.nullable(),
  why: z.string().nullable(),
  rules: rulesViewSchema,
});

export type SchoolSync = z.output<typeof schoolSyncSchema>;

/**
 * Changes and syncs share one queue, so each answer lands in the order they were asked and an older
 * screen never replaces a newer one. The key is how the screen finds the changes still on their way.
 */
export const rulesChangeKey = [...studyKeys.rules, "change"] as const;
const RULES_QUEUE = { id: "openduet-study-rules" };

const UNREADABLE =
  "Couldn't read your teacher rules. Reload the page to try again.";

/**
 * The payload, checked. A body of the wrong shape is a failed read, said in a sentence the person can
 * act on, rather than a list of zod issues on the screen.
 */
function checked<T>(schema: z.ZodType<T>, value: unknown, failure: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(failure);
  return parsed.data;
}

/** The screen from a write's answer, once any read still running can no longer land on top of it. */
async function keep(queryClient: QueryClient, rules: RulesView) {
  await queryClient.cancelQueries({ queryKey: studyKeys.rules, exact: true });
  queryClient.setQueryData(studyKeys.rules, rules);
}

/** GET /api/openduet/study/rules: every class's AI-help level, and where each one came from. */
export function rulesQueryOptions() {
  return queryOptions({
    queryKey: studyKeys.rules,
    queryFn: async ({ signal }): Promise<RulesView> =>
      checked(
        rulesViewSchema,
        await client<unknown>("/api/openduet/study/rules", "rules", {
          fallback: "Couldn't load your teacher rules.",
          signal,
        }),
        UNREADABLE,
      ),
  });
}

/**
 * PUT /api/openduet/study/rules: a level to set, or null to clear an override. A refusal (a student
 * loosening a rule) is the answer, so it is never sent again.
 */
export function changeRulesMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: rulesChangeKey,
    scope: RULES_QUEUE,
    retry: false,
    mutationFn: async (change: RulesChange): Promise<RulesView> =>
      checked(
        rulesViewSchema,
        await client<unknown>("/api/openduet/study/rules", "rules", {
          method: "PUT",
          body: change,
          fallback: "Couldn't save that rule. Try again.",
        }),
        UNREADABLE,
      ),
    onSuccess: async (rules) => {
      await keep(queryClient, rules);
      // The calendar shows each deadline's help level, which this may have changed.
      await queryClient.invalidateQueries({ queryKey: studyKeys.calendarAll });
    },
  });
}

/**
 * POST /api/openduet/study/school/sync: reads the student's Classroom notices again now. The answer
 * says why when Gmail could not be read and the stored copy was kept instead.
 */
export function syncSchoolMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    scope: RULES_QUEUE,
    retry: false,
    mutationFn: async (): Promise<SchoolSync> => {
      // Three keys, so the envelope is read here rather than unwrapped by `client`.
      const response = await client("/api/openduet/study/school/sync", {
        method: "POST",
        fallback: "Couldn't read Classroom just now. Try again.",
      });
      return checked(
        schoolSyncSchema,
        await response.json().catch(() => null),
        UNREADABLE,
      );
    },
    onSuccess: async ({ rules }) => {
      await keep(queryClient, rules);
      // New notices can move a deadline or its help level, which the calendar shows.
      await queryClient.invalidateQueries({ queryKey: studyKeys.calendarAll });
    },
  });
}
