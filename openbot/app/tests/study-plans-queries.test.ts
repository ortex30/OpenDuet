import { afterEach, describe, expect, test } from "bun:test";
import type { CalendarView, StudyPlan } from "@openbot/shared/study";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import {
  calendarQueryOptions,
  pendingPlanQueryOptions,
} from "@/lib/study/calendar";
import { studyKeys } from "@/lib/study/keys";
import {
  applyPlanMutationOptions,
  discardPlanMutationOptions,
  planQueryOptions,
  removePlanMutationOptions,
} from "@/lib/study/plans";

/**
 * A study plan's read and its answers: one key and one parse for the plan card and the Calendar
 * tab, Apply, Not now and Remove posted one at a time and never replayed, and an answer that
 * refreshes the plan where it is drawn, the student's other plans, and every calendar range, with
 * the plan's sessions put on or taken off the ranges already read so they show at once.
 */

const originalFetch = globalThis.fetch;
const clients: QueryClient[] = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const client of clients.splice(0)) client.clear();
});

const plan: StudyPlan = {
  id: "plan/1",
  status: "proposed",
  reason: "The lab report is due first.",
  timeZone: "America/Chicago",
  startDate: "2026-11-04",
  days: 1,
  blocks: [
    {
      id: "b1",
      assignmentId: "chem2-lab6",
      classId: "chem2",
      title: "Chemistry: Lab 6 report: Reaction Rates",
      date: "2026-11-04",
      start: "17:40",
      end: "18:25",
    },
  ],
  remaining: [],
  warnings: [],
  totalMinutes: 45,
  createdAt: "2026-11-04T20:10:00.000Z",
  appliedAt: null,
  stale: false,
  staleReason: null,
};
const applied: StudyPlan = {
  ...plan,
  status: "applied",
  appliedAt: "2026-11-04T20:12:00.000Z",
};

type Asked = { method: string; path: string; credentials?: RequestCredentials };

/** Answers each request with what `respond` says, and notes what was asked. */
function answering(
  respond: (asked: Asked) => Promise<Response> | Response,
): Asked[] {
  const asked: Asked[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = {
        method: init?.method ?? "GET",
        path: String(input),
        credentials: init?.credentials,
      };
      asked.push(request);
      return respond(request);
    },
    { preconnect: originalFetch.preconnect },
  );
  return asked;
}

function fresh() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return client;
}

const week: CalendarView = {
  timeZone: "America/Chicago",
  today: "2026-11-04",
  nowMinute: 850,
  from: "2026-11-01",
  to: "2026-11-07",
  classes: [],
  events: [],
  allDay: [],
  blocks: [],
  deadlines: [],
  couldNotRead: [],
};

describe("the plan's query", () => {
  test("is keyed by the plan, asks its route by its encoded id, and unwraps { plan }", async () => {
    const asked = answering(() => Response.json({ plan }));
    const options = planQueryOptions("plan/1");
    // Spread, because the key is typed with the data it holds and the expectation is a bare key.
    expect([...options.queryKey]).toEqual([...studyKeys.plan("plan/1")]);
    expect(await fresh().fetchQuery(options)).toEqual(plan);
    expect(asked).toEqual([
      {
        method: "GET",
        path: "/api/openduet/study/plans/plan%2F1",
        credentials: "include",
      },
    ]);
  });

  test("is the Calendar tab's read of a proposed plan too: one definition", () => {
    expect(pendingPlanQueryOptions).toBe(planQueryOptions);
  });

  test("says what went wrong: the server's sentence, or a plan it can't read", async () => {
    answering(() =>
      Response.json({ error: "That isn't here anymore." }, { status: 404 }),
    );
    await expect(fresh().fetchQuery(planQueryOptions("gone"))).rejects.toThrow(
      "That isn't here anymore.",
    );
    answering(() => Response.json({ plan: { ...plan, status: "maybe" } }));
    await expect(
      fresh().fetchQuery(planQueryOptions("plan/1")),
    ).rejects.toThrow("Couldn't read that plan. Ask in Chat for a fresh one.");
  });
});

/** Another plan of the student's, made a little earlier, still proposed. */
const sibling: StudyPlan = {
  ...plan,
  id: "plan/2",
  createdAt: "2026-11-04T20:05:00.000Z",
};
/** A study block already on the calendar from a plan applied before. */
const earlier = {
  id: "b0",
  assignmentId: null,
  classId: null,
  title: "Review notes",
  date: "2026-11-03",
  start: "19:00",
  end: "19:30",
};
const nextWeek: CalendarView = {
  ...week,
  from: "2026-11-08",
  to: "2026-11-14",
};
const THIS_WEEK = studyKeys.calendar("2026-11-01", "2026-11-07");
const NEXT_WEEK = studyKeys.calendar("2026-11-08", "2026-11-14");

describe("Apply, Not now and Remove", () => {
  test("are one answer at a time per plan, never retried", () => {
    const client = fresh();
    for (const options of [
      applyPlanMutationOptions(client, "plan/1"),
      discardPlanMutationOptions(client, "plan/1"),
      removePlanMutationOptions(client, "plan/1"),
    ]) {
      expect(options.scope).toEqual({ id: "plan:plan/1" });
      expect(options.retry).toBe(false);
    }
  });

  test("Apply posts, puts the answer where the plan is drawn, and refreshes every calendar range", async () => {
    const asked = answering(() => Response.json({ plan: applied }));
    const client = fresh();
    client.setQueryData(studyKeys.plan("plan/1"), plan);
    client.setQueryData(THIS_WEEK, week);
    client.setQueryData(studyKeys.rules, { classes: [] });
    const answer = await new MutationObserver(
      client,
      applyPlanMutationOptions(client, "plan/1"),
    ).mutate();
    expect(answer).toEqual(applied);
    expect(asked).toEqual([
      {
        method: "POST",
        path: "/api/openduet/study/plans/plan%2F1/apply",
        credentials: "include",
      },
    ]);
    expect(client.getQueryData<StudyPlan>(studyKeys.plan("plan/1"))).toEqual(
      applied,
    );
    expect(client.getQueryState(THIS_WEEK)?.isInvalidated).toBe(true);
    // Only what an applied plan changes.
    expect(client.getQueryState(studyKeys.rules)?.isInvalidated).toBe(false);
    expect(client.getQueryState(studyKeys.plan("plan/1"))?.isInvalidated).toBe(
      false,
    );
  });

  test("Apply puts the plan's sessions on each range already read that holds their days, before it is read again", async () => {
    answering(() => Response.json({ plan: applied }));
    const client = fresh();
    client.setQueryData(THIS_WEEK, { ...week, blocks: [earlier] });
    client.setQueryData(NEXT_WEEK, nextWeek);
    await new MutationObserver(
      client,
      applyPlanMutationOptions(client, "plan/1"),
    ).mutate();
    expect(client.getQueryData<CalendarView>(THIS_WEEK)?.blocks).toEqual([
      earlier,
      ...applied.blocks,
    ]);
    // Nothing of the plan falls in next week: it is left as it was, and still read again.
    expect(client.getQueryData<CalendarView>(NEXT_WEEK)).toBe(nextWeek);
    expect(client.getQueryState(NEXT_WEEK)?.isInvalidated).toBe(true);
  });

  test("Apply puts a session on a range once, however often it is answered", async () => {
    answering(() => Response.json({ plan: applied }));
    const client = fresh();
    client.setQueryData(THIS_WEEK, { ...week, blocks: applied.blocks });
    await new MutationObserver(
      client,
      applyPlanMutationOptions(client, "plan/1"),
    ).mutate();
    expect(client.getQueryData<CalendarView>(THIS_WEEK)?.blocks).toEqual(
      applied.blocks,
    );
  });

  test("Apply has the student's other plans read again, so one it made out of date says so", async () => {
    answering(() => Response.json({ plan: applied }));
    const client = fresh();
    client.setQueryData(studyKeys.plan("plan/1"), plan);
    client.setQueryData(studyKeys.plan("plan/2"), sibling);
    await new MutationObserver(
      client,
      applyPlanMutationOptions(client, "plan/1"),
    ).mutate();
    expect(client.getQueryState(studyKeys.plan("plan/2"))?.isInvalidated).toBe(
      true,
    );
    // Its own answer is already where it is drawn.
    expect(client.getQueryState(studyKeys.plan("plan/1"))?.isInvalidated).toBe(
      false,
    );
  });

  test("a calendar read that set off before Apply can't land after it without the plan's sessions", async () => {
    let release: (response: Response) => void = () => {};
    answering(({ method }) =>
      method === "POST"
        ? Response.json({ plan: applied })
        : new Promise<Response>((resolve) => {
            release = resolve;
          }),
    );
    const client = fresh();
    client.setQueryData(THIS_WEEK, week);
    // Started, and still on its way when Apply answers.
    const reading = client
      .fetchQuery({
        ...calendarQueryOptions("2026-11-01", "2026-11-07"),
        staleTime: 0,
      })
      .catch(() => null);
    await new MutationObserver(
      client,
      applyPlanMutationOptions(client, "plan/1"),
    ).mutate();
    release(Response.json({ calendar: week }));
    await reading;
    expect(client.getQueryData<CalendarView>(THIS_WEEK)?.blocks).toEqual(
      applied.blocks,
    );
  });

  test("Remove posts, keeps the plan as removed, and takes its sessions off every range already read", async () => {
    const removed: StudyPlan = { ...applied, status: "discarded" };
    const asked = answering(() => Response.json({ plan: removed }));
    const client = fresh();
    client.setQueryData(studyKeys.plan("plan/1"), applied);
    client.setQueryData(studyKeys.plan("plan/2"), sibling);
    client.setQueryData(THIS_WEEK, {
      ...week,
      blocks: [earlier, ...applied.blocks],
    });
    client.setQueryData(NEXT_WEEK, nextWeek);
    const answer = await new MutationObserver(
      client,
      removePlanMutationOptions(client, "plan/1"),
    ).mutate();
    expect(answer).toEqual(removed);
    expect(asked).toEqual([
      {
        method: "POST",
        path: "/api/openduet/study/plans/plan%2F1/remove",
        credentials: "include",
      },
    ]);
    expect(client.getQueryData<StudyPlan>(studyKeys.plan("plan/1"))).toEqual(
      removed,
    );
    // Its sessions are gone at once; what other plans put there stays.
    expect(client.getQueryData<CalendarView>(THIS_WEEK)?.blocks).toEqual([
      earlier,
    ]);
    expect(client.getQueryData<CalendarView>(NEXT_WEEK)).toBe(nextWeek);
    for (const key of [THIS_WEEK, NEXT_WEEK, studyKeys.plan("plan/2")])
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(studyKeys.plan("plan/1"))?.isInvalidated).toBe(
      false,
    );
  });

  test("a refused Remove carries the server's sentence, reads the plan again, and leaves the calendar alone", async () => {
    answering(({ method }) =>
      method === "POST"
        ? Response.json(
            { error: "This plan isn't on your calendar." },
            { status: 409 },
          )
        : new Promise<Response>(() => {}),
    );
    const client = fresh();
    client.setQueryData(studyKeys.plan("plan/1"), applied);
    client.setQueryData(THIS_WEEK, { ...week, blocks: applied.blocks });
    await expect(
      new MutationObserver(
        client,
        removePlanMutationOptions(client, "plan/1"),
      ).mutate(),
    ).rejects.toThrow("This plan isn't on your calendar.");
    expect(client.getQueryState(studyKeys.plan("plan/1"))?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryData<CalendarView>(THIS_WEEK)?.blocks).toEqual(
      applied.blocks,
    );
    expect(client.getQueryState(THIS_WEEK)?.isInvalidated).toBe(false);
  });

  test("Not now posts to discard and keeps the dismissed plan", async () => {
    const dismissed: StudyPlan = { ...plan, status: "discarded" };
    const asked = answering(() => Response.json({ plan: dismissed }));
    const client = fresh();
    client.setQueryData(studyKeys.plan("plan/2"), sibling);
    const shown: CalendarView = { ...week, blocks: [earlier] };
    client.setQueryData(THIS_WEEK, shown);
    await new MutationObserver(
      client,
      discardPlanMutationOptions(client, "plan/1"),
    ).mutate();
    expect(asked.map((request) => `${request.method} ${request.path}`)).toEqual(
      ["POST /api/openduet/study/plans/plan%2F1/discard"],
    );
    expect(client.getQueryData<StudyPlan>(studyKeys.plan("plan/1"))).toEqual(
      dismissed,
    );
    // A proposal set aside never reached the calendar: nothing on it changes, nor any other plan.
    expect(client.getQueryData<CalendarView>(THIS_WEEK)).toBe(shown);
    expect(client.getQueryState(studyKeys.plan("plan/2"))?.isInvalidated).toBe(
      false,
    );
  });

  test("a refusal carries the server's sentence and reads the plan again", async () => {
    answering(({ method }) =>
      method === "POST"
        ? Response.json(
            {
              error:
                "Something new is on your calendar at that time. Ask for a fresh plan.",
            },
            { status: 409 },
          )
        : new Promise<Response>(() => {}),
    );
    const client = fresh();
    client.setQueryData(studyKeys.plan("plan/1"), plan);
    client.setQueryData(studyKeys.calendar("2026-11-01", "2026-11-07"), week);
    await expect(
      new MutationObserver(
        client,
        applyPlanMutationOptions(client, "plan/1"),
      ).mutate(),
    ).rejects.toThrow(
      "Something new is on your calendar at that time. Ask for a fresh plan.",
    );
    expect(client.getQueryState(studyKeys.plan("plan/1"))?.isInvalidated).toBe(
      true,
    );
    // Nothing reached the calendar, so nothing on it is refreshed.
    expect(
      client.getQueryState(studyKeys.calendar("2026-11-01", "2026-11-07"))
        ?.isInvalidated,
    ).toBe(false);
  });

  test("a read that set off before the answer can't land after it with the plan as it was", async () => {
    let release: (response: Response) => void = () => {};
    answering(({ method }) =>
      method === "POST"
        ? Response.json({ plan: applied })
        : new Promise<Response>((resolve) => {
            release = resolve;
          }),
    );
    const client = fresh();
    // Started, and still on its way when Apply answers.
    const reading = client
      .fetchQuery(planQueryOptions("plan/1"))
      .catch(() => null);
    await new MutationObserver(
      client,
      applyPlanMutationOptions(client, "plan/1"),
    ).mutate();
    release(Response.json({ plan }));
    await reading;
    expect(client.getQueryData<StudyPlan>(studyKeys.plan("plan/1"))).toEqual(
      applied,
    );
  });
});
