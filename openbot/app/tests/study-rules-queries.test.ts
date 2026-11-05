import { afterEach, describe, expect, test } from "bun:test";
import type { RulesView, SchoolSnapshot } from "@openbot/shared/study";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { studyKeys } from "@/lib/study/keys";
import {
  changeRulesMutationOptions,
  rulesChangeKey,
  rulesQueryOptions,
  syncSchoolMutationOptions,
} from "@/lib/study/rules";

/**
 * The Teacher rules screen's reads and writes: what each asks the server, how each answer reaches
 * the cache, and the sentence a refusal or a broken answer turns into.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Sent = { url: string; method: string; body?: unknown };

function answering(status: number, body: unknown) {
  const sent: Sent[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      // A request with no body is recorded with no `body` key, so its absence can be asserted.
      sent.push({
        url: String(input),
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      return Response.json(body, { status });
    },
    { preconnect: realFetch.preconnect },
  );
  return sent;
}

const view: RulesView = {
  timeZone: "America/Chicago",
  classes: [
    {
      classId: "chem2",
      className: "Chemistry",
      teacher: "Dr. Okoro",
      level: "hints",
      source: "notice",
      override: null,
      assignments: [
        {
          assignmentId: "chem2-lab6",
          title: "Lab 6 report",
          due: "2026-11-06T05:59:00.000Z",
          status: "open",
          notice: "hints",
          override: null,
          level: "hints",
          source: "notice",
        },
      ],
    },
  ],
  canLoosen: false,
  syncedAt: "2026-11-04T21:05:00.000Z",
  couldNotRead: [],
};

const stricter: RulesView = {
  ...view,
  classes: view.classes.map((rules) => ({
    ...rules,
    level: "none",
    source: "override",
    override: "none",
  })),
};

const school: SchoolSnapshot = {
  syncedAt: "2026-11-04T21:10:00.000Z",
  timeZone: "America/Chicago",
  classes: [],
  assignments: [],
  couldNotRead: [],
};

/** A client whose writes are counted, with a calendar range and the rules already cached. */
function seeded() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(studyKeys.rules, view);
  queryClient.setQueryData(studyKeys.calendar("2026-11-01", "2026-11-07"), {
    seeded: true,
  });
  const invalidated: unknown[] = [];
  const invalidate = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters: never) => {
    invalidated.push(filters);
    return invalidate(filters);
  }) as typeof queryClient.invalidateQueries;
  return { queryClient, invalidated };
}

/** The screen in the cache. Typed here, because the study keys carry no data type of their own. */
const cachedRules = (queryClient: QueryClient) =>
  queryClient.getQueryData<RulesView>(studyKeys.rules);

const calendarStale = (queryClient: QueryClient) =>
  queryClient
    .getQueryCache()
    .find({ queryKey: studyKeys.calendar("2026-11-01", "2026-11-07") })?.state
    .isInvalidated;

describe("rulesQueryOptions", () => {
  test("asks for the rules under their key and unwraps { rules }", async () => {
    const sent = answering(200, { rules: view });
    const options = rulesQueryOptions();
    // Spread, because the key is typed with the data it holds and the expectation is a bare key.
    expect([...options.queryKey]).toEqual([...studyKeys.rules]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    expect(await queryClient.fetchQuery(options)).toEqual(view);
    expect(sent).toEqual([{ url: "/api/openduet/study/rules", method: "GET" }]);
  });

  test("a body of the wrong shape is a failed read, in words, and a refusal keeps its own", async () => {
    const fresh = () =>
      new QueryClient({ defaultOptions: { queries: { retry: false } } });
    answering(200, { rules: { ...view, canLoosen: "no" } });
    await expect(fresh().fetchQuery(rulesQueryOptions())).rejects.toThrow(
      "Couldn't read your teacher rules. Reload the page to try again.",
    );
    answering(503, { error: "Couldn't reach your study data. Try again." });
    await expect(fresh().fetchQuery(rulesQueryOptions())).rejects.toThrow(
      "Couldn't reach your study data. Try again.",
    );
  });
});

describe("changeRulesMutationOptions", () => {
  test("puts the change, keeps the screen it answers, and refreshes the calendar", async () => {
    const sent = answering(200, { rules: stricter });
    const { queryClient, invalidated } = seeded();
    const options = changeRulesMutationOptions(queryClient);
    // Never sent twice, and queued behind any other change or sync.
    expect(options.retry).toBe(false);
    expect(options.mutationKey).toEqual(rulesChangeKey);
    expect(options.scope).toEqual({ id: "openduet-study-rules" });
    expect(syncSchoolMutationOptions(queryClient).scope?.id ?? null).toBe(
      "openduet-study-rules",
    );
    const result = await new MutationObserver(queryClient, options).mutate({
      classes: { chem2: "none" },
    });
    expect(result).toEqual(stricter);
    expect(sent).toEqual([
      {
        url: "/api/openduet/study/rules",
        method: "PUT",
        body: { classes: { chem2: "none" } },
      },
    ]);
    expect(cachedRules(queryClient)).toEqual(stricter);
    expect(invalidated).toEqual([{ queryKey: studyKeys.calendarAll }]);
    expect(calendarStale(queryClient)).toBe(true);
  });

  test("a refusal reaches the screen in the server's words, once, and changes nothing", async () => {
    const refusal =
      "Only a teacher or an admin can loosen a teacher's rule. You can make it stricter.";
    const sent = answering(403, { error: refusal });
    const { queryClient, invalidated } = seeded();
    const error = await new MutationObserver(
      queryClient,
      changeRulesMutationOptions(queryClient),
    )
      .mutate({ classes: { chem2: "full" } })
      .catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(refusal);
    expect(sent).toHaveLength(1);
    expect(cachedRules(queryClient)).toEqual(view);
    expect(invalidated).toEqual([]);
    expect(calendarStale(queryClient)).toBe(false);
  });

  test("an answer of the wrong shape is a failed save, in words", async () => {
    answering(200, { rules: { classes: "none" } });
    const { queryClient } = seeded();
    await expect(
      new MutationObserver(
        queryClient,
        changeRulesMutationOptions(queryClient),
      ).mutate({ classes: { chem2: null } }),
    ).rejects.toThrow(
      "Couldn't read your teacher rules. Reload the page to try again.",
    );
    expect(cachedRules(queryClient)).toEqual(view);
  });
});

describe("syncSchoolMutationOptions", () => {
  test("posts the sync with no body, and keeps the screen it answers", async () => {
    const why =
      "Gmail needs reconnecting, so your classes couldn't be read. Reconnect Google on the Connections page.";
    const after: RulesView = { ...stricter, couldNotRead: [why] };
    const sent = answering(200, { school, why, rules: after });
    const { queryClient, invalidated } = seeded();
    const result = await new MutationObserver(
      queryClient,
      syncSchoolMutationOptions(queryClient),
    ).mutate();
    expect(result).toEqual({ school, why, rules: after });
    expect(sent).toEqual([
      { url: "/api/openduet/study/school/sync", method: "POST" },
    ]);
    expect(cachedRules(queryClient)).toEqual(after);
    expect(invalidated).toEqual([{ queryKey: studyKeys.calendarAll }]);
  });

  test("never read before is an answer too: no classes, and why", async () => {
    const why =
      "Gmail isn't connected, so your classes couldn't be read. Connect Google on the Connections page.";
    const empty: RulesView = {
      timeZone: "UTC",
      classes: [],
      canLoosen: false,
      syncedAt: null,
      couldNotRead: [why],
    };
    answering(200, { school: null, why, rules: empty });
    const { queryClient } = seeded();
    expect(
      await new MutationObserver(
        queryClient,
        syncSchoolMutationOptions(queryClient),
      ).mutate(),
    ).toEqual({ school: null, why, rules: empty });
    expect(cachedRules(queryClient)).toEqual(empty);
  });

  test("a failed sync says why, and a broken answer is a failed read", async () => {
    answering(503, { error: "Couldn't reach your study data. Try again." });
    const { queryClient } = seeded();
    const sync = () =>
      new MutationObserver(
        queryClient,
        syncSchoolMutationOptions(queryClient),
      ).mutate();
    await expect(sync()).rejects.toThrow(
      "Couldn't reach your study data. Try again.",
    );
    answering(200, { school, why: null });
    await expect(sync()).rejects.toThrow(
      "Couldn't read your teacher rules. Reload the page to try again.",
    );
    expect(cachedRules(queryClient)).toEqual(view);
  });
});
