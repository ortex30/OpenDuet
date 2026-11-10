import { afterEach, describe, expect, test } from "bun:test";
import type { CalendarView, StudyPlan } from "@openbot/shared/study";
import { QueryClient } from "@tanstack/react-query";
import {
  calendarQueryOptions,
  pendingPlanQueryOptions,
} from "@/lib/study/calendar";
import { studyKeys } from "@/lib/study/keys";

/**
 * The Calendar tab's two reads: the calendar for a range, and a plan by id. Each asks the route its
 * shared type names, unwraps its envelope, and turns a body of the wrong shape into a sentence.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const asked: string[] = [];
function answering(status: number, body: unknown) {
  asked.length = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return Response.json(body, { status });
    },
    { preconnect: originalFetch.preconnect },
  );
}

const view: CalendarView = {
  timeZone: "America/Chicago",
  today: "2026-11-04",
  nowMinute: 970,
  from: "2026-11-01",
  to: "2026-11-07",
  classes: [],
  events: [],
  allDay: [],
  blocks: [],
  deadlines: [],
  couldNotRead: [],
};

const plan: StudyPlan = {
  id: "plan/1",
  status: "proposed",
  reason: "The lab report is due first.",
  timeZone: "America/Chicago",
  startDate: "2026-11-04",
  days: 1,
  blocks: [],
  remaining: [],
  warnings: [],
  totalMinutes: 0,
  createdAt: "2026-11-04T22:40:00.000Z",
  appliedAt: null,
  stale: false,
  staleReason: null,
};

const fresh = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("calendarQueryOptions", () => {
  test("asks for the range, inclusive, under the calendar prefix, and unwraps { calendar }", async () => {
    answering(200, { calendar: view });
    const options = calendarQueryOptions("2026-11-01", "2026-11-07");
    // Spread, because the key is typed with the data it holds and the expectation is a bare key.
    expect([...options.queryKey]).toEqual([
      ...studyKeys.calendar("2026-11-01", "2026-11-07"),
    ]);
    expect(await fresh().fetchQuery(options)).toEqual(view);
    expect(asked).toEqual([
      "/api/openduet/study/calendar?from=2026-11-01&to=2026-11-07",
    ]);
  });

  test("a body of the wrong shape is a failed read, in words", async () => {
    answering(200, { calendar: { ...view, events: "none" } });
    await expect(
      fresh().fetchQuery(calendarQueryOptions("2026-11-01", "2026-11-07")),
    ).rejects.toThrow(
      "Couldn't read your calendar. Reload the page to try again.",
    );
  });

  test("the server's own reason comes through when it refuses", async () => {
    answering(502, { error: "Google Calendar didn't answer. Try again." });
    await expect(
      fresh().fetchQuery(calendarQueryOptions("2026-11-01", "2026-11-07")),
    ).rejects.toThrow("Google Calendar didn't answer. Try again.");
  });
});

describe("pendingPlanQueryOptions", () => {
  test("asks for the plan by its id, encoded, under the plan's key, and unwraps { plan }", async () => {
    answering(200, { plan });
    const options = pendingPlanQueryOptions("plan/1");
    expect([...options.queryKey]).toEqual([...studyKeys.plan("plan/1")]);
    expect(await fresh().fetchQuery(options)).toEqual(plan);
    expect(asked).toEqual(["/api/openduet/study/plans/plan%2F1"]);
  });

  test("a plan that is not there says so, and one of the wrong shape is a failed read", async () => {
    answering(404, { error: "That isn't here anymore." });
    await expect(
      fresh().fetchQuery(pendingPlanQueryOptions("gone")),
    ).rejects.toThrow("That isn't here anymore.");
    answering(200, { plan: { ...plan, status: "maybe" } });
    await expect(
      fresh().fetchQuery(pendingPlanQueryOptions("plan/1")),
    ).rejects.toThrow("Couldn't read that plan. Ask in Chat for a fresh one.");
  });
});
