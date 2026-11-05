import type { CalendarView } from "@openbot/shared/study";
import { queryOptions } from "@tanstack/react-query";
import type { z } from "zod";
import { client } from "@/lib/client";
import { studyKeys } from "./keys";
import { planQueryOptions } from "./plans";
import { calendarViewSchema } from "./schemas";

/*
 * The Calendar tab's reads: the student's calendar for a range of days, and a study plan by id, so a
 * plan that is only proposed can be laid over the calendar before anyone applies it.
 */

/**
 * The payload, checked. A body of the wrong shape is a failed read, said in a sentence the person can
 * act on, rather than a list of zod issues on the screen.
 */
function checked<T>(schema: z.ZodType<T>, value: unknown, failure: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(failure);
  return parsed.data;
}

/**
 * GET /api/openduet/study/calendar for `from` to `to`, both "YYYY-MM-DD" and inclusive: the student's
 * Google Calendar, the study blocks they applied and what is due, in their own time zone.
 */
export function calendarQueryOptions(from: string, to: string) {
  return queryOptions({
    queryKey: studyKeys.calendar(from, to),
    queryFn: async ({ signal }): Promise<CalendarView> =>
      checked(
        calendarViewSchema,
        await client<unknown>(
          `/api/openduet/study/calendar?${new URLSearchParams({ from, to })}`,
          "calendar",
          { fallback: "Couldn't load your calendar.", signal },
        ),
        "Couldn't read your calendar. Reload the page to try again.",
      ),
    // A calendar should be current when the person comes back to it, which the app's default is not.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
}

/**
 * GET /api/openduet/study/plans/:id. The Calendar tab reads it for `?plan=`, to draw a proposed plan's
 * blocks over the calendar. It is the plan card's own query (plans.ts), one key and one parse, so an
 * Apply in Chat redraws the overlay here.
 */
export const pendingPlanQueryOptions = planQueryOptions;
