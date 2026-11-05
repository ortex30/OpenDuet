import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import type { Message } from "@ag-ui/core";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PlanToolResult, StudyPlan } from "@openbot/shared/study";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { ConversationView } from "@/components/channels/conversation-view";
import { StudyPlanCard } from "@/components/duet/study";
import {
  readPlanResult,
  StudyPlanCardTool,
  todayIn,
} from "@/lib/copilot/study-plan-card-tool";
import { settleReactWork } from "./settle-react-work";

/**
 * The study plan card as the student meets it in Chat: drawn by the real renderer in the real
 * transcript, under the Bot's line about the plan, read from the server by the id the tool returned,
 * answered with Apply or Not now, and taken off the calendar again with Remove from calendar.
 */

const originalFetch = globalThis.fetch;
beforeAll(() => {
  // Wednesday, November 4, 2026, at 2:10 PM in Chicago, so "Today" never depends on the run.
  setSystemTime(new Date("2026-11-04T20:10:00.000Z"));
  GlobalRegistrator.register({ url: "http://localhost/" });
});
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  globalThis.fetch = originalFetch;
});
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
  setSystemTime();
});

const LATE =
  "Precalculus: Section 4.3 homework is scheduled after its original deadline (2026-11-03 23:59). The deadline has not changed.";

const block = (
  id: string,
  assignmentId: string,
  title: string,
  start: string,
  end: string,
  late = false,
) => ({
  id,
  assignmentId,
  classId: assignmentId.split("-")[0] ?? null,
  title,
  date: "2026-11-04",
  start,
  end,
  ...(late ? { late: true } : {}),
});

const PLAN: StudyPlan = {
  id: "plan-1",
  status: "proposed",
  reason: "The precalc quiz and the chem lab are due tomorrow.",
  timeZone: "America/Chicago",
  startDate: "2026-11-04",
  days: 1,
  blocks: [
    block(
      "b1",
      "precalc4-hw43",
      "Precalculus: Section 4.3 homework",
      "17:40",
      "18:25",
      true,
    ),
    block(
      "b2",
      "precalc4-quiz4",
      "Precalculus: Unit 4 quiz: Trig identities",
      "18:35",
      "19:20",
    ),
    block(
      "b3",
      "precalc4-quiz4",
      "Precalculus: Unit 4 quiz: Trig identities",
      "20:25",
      "20:40",
    ),
    block(
      "b4",
      "chem2-lab6",
      "Chemistry: Lab 6 report: Reaction Rates",
      "20:50",
      "21:35",
    ),
  ],
  remaining: [
    {
      assignmentId: "chem2-lab6",
      title: "Chemistry: Lab 6 report: Reaction Rates",
      minutes: 45,
      due: "2026-11-05",
    },
  ],
  warnings: [LATE],
  totalMinutes: 150,
  createdAt: "2026-11-04T20:10:00.000Z",
  appliedAt: null,
  stale: false,
  staleReason: null,
};

const RESULT: PlanToolResult = {
  kind: "plan",
  id: "plan-1",
  blocks: 4,
  totalMinutes: 150,
  remainingMinutes: 45,
  warnings: [LATE],
};

/** The Bot plans first and says its line after, as models usually do. */
function planned(result?: string): Message[] {
  return [
    { id: "u1", role: "user", content: "Plan my afternoon. I have 2.5 hours." },
    {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: "propose_study_plan",
            arguments: JSON.stringify({ minutes: 150, reason: PLAN.reason }),
          },
        },
      ],
    },
    ...(result === undefined
      ? []
      : ([
          { id: "t1", role: "tool", toolCallId: "call-1", content: result },
          {
            id: "a2",
            role: "assistant",
            content:
              "Homework first, then quiz prep and the lab. The rest of the lab didn't fit.",
          },
        ] satisfies Message[])),
  ];
}

type Asked = { method: string; path: string };

/**
 * The study plan routes as the server answers them. `answer` decides each POST; GETs answer the
 * plan as it stands. Anything else (the approvals inbox the transcript reads) is not here.
 */
function server(
  initial: StudyPlan = PLAN,
  answer: (
    path: string,
    plan: StudyPlan,
  ) => { status: number; body: unknown } | Promise<never> = (path, plan) => ({
    status: 200,
    body: {
      plan: path.endsWith("/apply")
        ? {
            ...plan,
            status: "applied",
            appliedAt: "2026-11-04T20:12:00.000Z",
          }
        : { ...plan, status: "discarded" },
    },
  }),
) {
  const state = { plan: initial, asked: [] as Asked[], reads: true };
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      state.asked.push({ method, path });
      if (!path.startsWith("/api/openduet/study/plans/plan-1"))
        return Response.json({ error: "Not found" }, { status: 404 });
      if (method === "GET")
        return state.reads
          ? Response.json({ plan: state.plan })
          : Response.json(
              { error: "That isn't here anymore." },
              { status: 404 },
            );
      const answered = await answer(path, state.plan);
      if (answered.status === 200)
        state.plan = (answered.body as { plan: StudyPlan }).plan;
      return Response.json(answered.body, { status: answered.status });
    },
    { preconnect: originalFetch.preconnect },
  );
  return state;
}

function Chat({ messages, busy }: { messages: Message[]; busy: boolean }) {
  return (
    <CopilotKitProvider>
      <StudyPlanCardTool />
      <ConversationView busy={busy} messages={messages} onSubmit={() => {}} />
    </CopilotKitProvider>
  );
}

/** The transcript inside a router, as Chat is, so the card's calendar links resolve. */
function renderChat(messages: Message[], busy = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <Chat busy={busy} messages={messages} />,
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

/**
 * The card once the plan itself is drawn. The loading card is a different element, so the card is
 * found again rather than held on to.
 */
async function planCard(view: ReturnType<typeof render>) {
  await view.findByText("Precalculus: Section 4.3 homework");
  return view.getByRole("region", { name: "Study plan" });
}

describe("the study plan card", () => {
  test("while the plan is being made, a line says so", async () => {
    server();
    const view = renderChat(planned(), true);
    expect(await view.findByText("Planning your study time")).toBeTruthy();
    expect(view.queryByRole("region", { name: "Study plan" })).toBeNull();
  });

  test("a refused call draws no card", async () => {
    const asked = server();
    const view = renderChat(
      planned(
        "Refused. Ask for between 15 and 600 minutes of study, as a whole number. Fix it and call propose_study_plan again.",
      ),
    );
    await view.findByText(/The rest of the lab didn't fit/);
    expect(view.queryByRole("region", { name: "Study plan" })).toBeNull();
    expect(
      asked.asked.filter((request) => request.path.includes("/study/")),
    ).toEqual([]);
  });

  test("reads the plan by its id and draws its sessions by day, with a preview on the calendar", async () => {
    const state = server();
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const card = await planCard(view);
    expect(card.textContent).toContain("4 sessions");
    // The student's own today, in Chicago.
    expect(within(card).getByText("Today")).toBeTruthy();
    expect(within(card).getByText(/5:40 – 6:25 PM/)).toBeTruthy();
    expect(within(card).getByText("Late")).toBeTruthy();
    expect(within(card).getByText(LATE)).toBeTruthy();
    expect(
      within(card).getByText(/Didn't fit: 45 min of Chemistry: Lab 6 report/),
    ).toBeTruthy();
    const preview = within(card).getByRole("link", {
      name: "Preview on calendar",
    });
    expect(preview.getAttribute("href")).toBe(
      "/calendar?plan=plan-1&date=2026-11-04",
    );
    expect(
      within(card).getByRole("button", { name: "Apply plan" }),
    ).toHaveProperty("disabled", false);
    expect(state.asked).toContainEqual({
      method: "GET",
      path: "/api/openduet/study/plans/plan-1",
    });
    // The card sits under the Bot's line about it.
    const line = view.getByText(/The rest of the lab didn't fit/);
    expect(
      line.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("while the plan loads, the card says how big it is from the tool's result", async () => {
    globalThis.fetch = Object.assign(
      async () => new Promise<Response>(() => {}),
      { preconnect: originalFetch.preconnect },
    );
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const card = await view.findByRole("region", { name: "Study plan" });
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(within(card).getByText(/4 sessions · 2 h 30 min/)).toBeTruthy();
    expect(within(card).queryByRole("button")).toBeNull();
  });

  test("Apply posts, then says it's on the Calendar tab with a link to it", async () => {
    const state = server();
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const card = await planCard(view);
    fireEvent.click(
      await within(card).findByRole("button", { name: "Apply plan" }),
    );
    expect(
      await within(card).findByText("Added to your Calendar tab"),
    ).toBeTruthy();
    expect(state.asked).toContainEqual({
      method: "POST",
      path: "/api/openduet/study/plans/plan-1/apply",
    });
    expect(
      within(card)
        .getByRole("link", { name: "View on calendar" })
        .getAttribute("href"),
    ).toBe("/calendar?plan=plan-1&date=2026-11-04");
    // Answered: the only button takes it off again, and there is no preview of it now.
    expect(
      within(card)
        .getAllByRole("button")
        .map((pressable) => pressable.textContent),
    ).toEqual(["Remove from calendar"]);
    expect(
      within(card).queryByRole("link", { name: "Preview on calendar" }),
    ).toBeNull();
  });

  test("Remove from calendar posts, then says the plan came off the Calendar tab", async () => {
    const state = server({
      ...PLAN,
      status: "applied",
      appliedAt: "2026-11-04T20:12:00.000Z",
    });
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const card = await planCard(view);
    fireEvent.click(
      await within(card).findByRole("button", {
        name: "Remove from calendar",
      }),
    );
    const status = await within(card).findByText(
      "Removed from your Calendar tab",
    );
    expect(state.asked).toContainEqual({
      method: "POST",
      path: "/api/openduet/study/plans/plan-1/remove",
    });
    // Its appliedAt is kept, which is how it reads as removed rather than never added.
    expect(state.plan).toMatchObject({
      status: "discarded",
      appliedAt: "2026-11-04T20:12:00.000Z",
    });
    expect(within(card).queryByRole("button")).toBeNull();
    expect(
      within(card).queryByRole("link", { name: "View on calendar" }),
    ).toBeNull();
    expect(document.activeElement).toBe(status);
  });

  test("a refused Remove says why, reads the plan again, and can be pressed again", async () => {
    const sentence = "Couldn't reach your study data. Try again.";
    const state = server(
      { ...PLAN, status: "applied", appliedAt: "2026-11-04T20:12:00.000Z" },
      () => ({ status: 503, body: { error: sentence } }),
    );
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const card = await planCard(view);
    fireEvent.click(
      await within(card).findByRole("button", {
        name: "Remove from calendar",
      }),
    );
    expect((await within(card).findByRole("alert")).textContent).toBe(sentence);
    await waitFor(() =>
      expect(
        state.asked.filter(
          (request) =>
            request.method === "GET" &&
            request.path === "/api/openduet/study/plans/plan-1",
        ).length,
      ).toBe(2),
    );
    expect(within(card).getByText("Added to your Calendar tab")).toBeTruthy();
    await waitFor(() =>
      expect(
        within(card).getByRole("button", { name: "Remove from calendar" }),
      ).toHaveProperty("disabled", false),
    );
  });

  test("applying one plan has an earlier one in the chat read again, and it says it's out of date", async () => {
    const plans: Record<string, StudyPlan> = {
      "plan-a": { ...PLAN, id: "plan-a" },
      "plan-b": {
        ...PLAN,
        id: "plan-b",
        createdAt: "2026-11-04T20:11:00.000Z",
      },
    };
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const id = String(input).match(/\/plans\/(plan-[ab])/)?.[1] ?? "";
        const found = plans[id];
        if (!found)
          return Response.json({ error: "Not found" }, { status: 404 });
        if ((init?.method ?? "GET") === "POST") {
          // Applying plan B leaves plan A, made before it, out of date.
          plans[id] = {
            ...found,
            status: "applied",
            appliedAt: "2026-11-04T20:12:00.000Z",
          };
          const other = plans["plan-a"];
          if (other)
            plans["plan-a"] = { ...other, stale: true, staleReason: "changed" };
        }
        return Response.json({ plan: plans[id] });
      },
      { preconnect: originalFetch.preconnect },
    );
    const call = (id: string, plan: string): Message[] => [
      {
        id: `a-${id}`,
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: `call-${id}`,
            type: "function",
            function: { name: "propose_study_plan", arguments: "{}" },
          },
        ],
      },
      {
        id: `t-${id}`,
        role: "tool",
        toolCallId: `call-${id}`,
        content: JSON.stringify({ ...RESULT, id: plan }),
      },
      { id: `r-${id}`, role: "assistant", content: `Here's plan ${id}.` },
    ];
    const view = renderChat([
      { id: "u1", role: "user", content: "Plan my afternoon." },
      ...call("a", "plan-a"),
      { id: "u2", role: "user", content: "Make it a little different." },
      ...call("b", "plan-b"),
    ]);
    await waitFor(() =>
      expect(
        view.getAllByText("Precalculus: Section 4.3 homework"),
      ).toHaveLength(2),
    );
    const [first, second] = view.getAllByRole("region", { name: "Study plan" });
    if (!first || !second) throw new Error("expected two plan cards");
    expect(
      within(first).getByRole("button", { name: "Apply plan" }),
    ).toHaveProperty("disabled", false);

    fireEvent.click(within(second).getByRole("button", { name: "Apply plan" }));
    expect(
      await within(second).findByText("Added to your Calendar tab"),
    ).toBeTruthy();
    expect(
      await within(first).findByText(
        "Your schedule changed since this plan was made. Ask for a fresh one.",
      ),
    ).toBeTruthy();
    expect(
      within(first).getByRole("button", { name: "Apply plan" }),
    ).toHaveProperty("disabled", true);
  });

  test("a refused Apply shows the server's sentence and keeps the card usable", async () => {
    let refuse = true;
    const sentence =
      "Something new is on your calendar at that time. Ask for a fresh plan.";
    const state = server(PLAN, (path, plan) =>
      refuse && path.endsWith("/apply")
        ? { status: 409, body: { error: sentence } }
        : { status: 200, body: { plan: { ...plan, status: "discarded" } } },
    );
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const card = await planCard(view);
    fireEvent.click(
      await within(card).findByRole("button", { name: "Apply plan" }),
    );
    expect((await within(card).findByRole("alert")).textContent).toBe(sentence);
    // The plan is read again, and is still waiting: both answers are still there to give.
    await waitFor(() =>
      expect(
        state.asked.filter(
          (request) =>
            request.method === "GET" &&
            request.path === "/api/openduet/study/plans/plan-1",
        ).length,
      ).toBe(2),
    );
    await waitFor(() =>
      expect(
        within(card).getByRole("button", { name: "Apply plan" }),
      ).toHaveProperty("disabled", false),
    );
    expect(within(card).getByRole("alert").textContent).toBe(sentence);
    refuse = false;
    fireEvent.click(within(card).getByRole("button", { name: "Not now" }));
    expect(await within(card).findByText("Not added")).toBeTruthy();
    expect(within(card).queryByRole("alert")).toBeNull();
  });

  test("an Apply refused because the plan went stale says so once, and Apply goes off", async () => {
    const changed =
      "Your schedule changed since this plan was made. Ask for a fresh one.";
    const state = server(PLAN, () => {
      // Another plan was applied in the meantime: read again, this one is stale.
      state.plan = { ...PLAN, stale: true, staleReason: "changed" };
      return { status: 409, body: { error: changed } };
    });
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const card = await planCard(view);
    fireEvent.click(within(card).getByRole("button", { name: "Apply plan" }));
    await waitFor(() =>
      expect(
        within(card).getByRole("button", { name: "Apply plan" }),
      ).toHaveProperty("disabled", true),
    );
    expect(
      within(card).getAllByText(
        /Your schedule changed since this plan was made/,
      ),
    ).toHaveLength(1);
    expect(within(card).queryByRole("alert")).toBeNull();
  });

  test("Not now dismisses it", async () => {
    const state = server();
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const card = await planCard(view);
    fireEvent.click(
      await within(card).findByRole("button", { name: "Not now" }),
    );
    expect(await within(card).findByText("Not added")).toBeTruthy();
    expect(state.asked).toContainEqual({
      method: "POST",
      path: "/api/openduet/study/plans/plan-1/discard",
    });
    expect(within(card).queryByRole("button")).toBeNull();
  });

  test("a stale plan says so once, and Apply stays off", async () => {
    server({ ...PLAN, stale: true, staleReason: "changed" });
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const card = await planCard(view);
    expect(
      within(card).getAllByText(
        /Your schedule changed since this plan was made/,
      ),
    ).toHaveLength(1);
    expect(
      within(card).getByRole("button", { name: "Apply plan" }),
    ).toHaveProperty("disabled", true);
    expect(
      within(card).getByRole("button", { name: "Not now" }),
    ).toHaveProperty("disabled", false);
  });

  test("an Apply refused because a session already began says that, once, not that the schedule changed", async () => {
    const started =
      "A session in this plan has already started. Ask for a fresh plan.";
    const state = server(PLAN, () => {
      // Time passed while the card was read: its first session's start went by.
      state.plan = { ...PLAN, stale: true, staleReason: "started" };
      return { status: 409, body: { error: started } };
    });
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const card = await planCard(view);
    fireEvent.click(within(card).getByRole("button", { name: "Apply plan" }));
    await waitFor(() =>
      expect(
        within(card).getByRole("button", { name: "Apply plan" }),
      ).toHaveProperty("disabled", true),
    );
    expect(within(card).getAllByText(started)).toHaveLength(1);
    expect(within(card).queryByText(/Your schedule changed/)).toBeNull();
    expect(within(card).queryByRole("alert")).toBeNull();
  });

  test("a plan that can't be read says why, and Try again reads it again", async () => {
    const state = server();
    state.reads = false;
    const view = renderChat(planned(JSON.stringify(RESULT)));
    const failed = await view.findByRole("region", { name: "Study plan" });
    expect((await within(failed).findByRole("alert")).textContent).toBe(
      "That isn't here anymore.",
    );
    expect(failed.textContent).toContain("4 sessions");
    state.reads = true;
    fireEvent.click(within(failed).getByRole("button", { name: "Try again" }));
    const card = await planCard(view);
    expect(within(card).queryByRole("alert")).toBeNull();
  });

  test("while the Bot is still writing, the card waits under its line", async () => {
    server();
    const view = renderChat(planned(JSON.stringify(RESULT)), true);
    await view.findByText(/The rest of the lab didn't fit/);
    const held = view.container.querySelector("[data-card-held]");
    expect(held?.textContent).toContain("Planned your study time");
    expect(held?.textContent).toMatch(/4 sessions · 2\s*h 30\s*min/);
    expect(view.queryByRole("region", { name: "Study plan" })).toBeNull();
  });
});

describe("the parts", () => {
  test("the tool's result is read, a refusal or anything else is not", () => {
    expect(readPlanResult(JSON.stringify(RESULT))).toEqual(RESULT);
    expect(readPlanResult(JSON.stringify(JSON.stringify(RESULT)))).toEqual(
      RESULT,
    );
    expect(readPlanResult("Refused. Ask for between 15 and 600 minutes.")).toBe(
      null,
    );
    expect(readPlanResult(JSON.stringify({ kind: "quiz", id: "q1" }))).toBe(
      null,
    );
  });

  test("today is the student's day in their zone, by this browser's clock", () => {
    // 9 PM Wednesday in Chicago is already Thursday in UTC.
    const evening = new Date("2026-11-05T03:00:00.000Z");
    expect(todayIn("America/Chicago", evening)).toBe("2026-11-04");
    expect(todayIn("UTC", evening)).toBe("2026-11-05");
    expect(todayIn("Mars/Olympus", evening)).toBeUndefined();
  });

  test("the preview link sits under the sessions while the plan waits, and goes once it's answered", () => {
    const draw = (plan: StudyPlan) =>
      render(
        <StudyPlanCard
          busy={false}
          error={null}
          onApply={() => {}}
          onDiscard={() => {}}
          plan={plan}
          previewLink={<a href="/calendar?plan=plan-1">Preview on calendar</a>}
        />,
      );
    const waiting = draw(PLAN);
    const link = waiting.getByRole("link", { name: "Preview on calendar" });
    const lastSession = waiting.getByText(
      "Chemistry: Lab 6 report: Reaction Rates",
      {
        selector: "p",
      },
    );
    const didntFit = waiting.getByText(/Didn't fit/);
    expect(
      lastSession.compareDocumentPosition(link) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      link.compareDocumentPosition(didntFit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    waiting.unmount();
    // Stale is still waiting for an answer, so it can still be seen on the calendar.
    const stale = draw({ ...PLAN, stale: true });
    expect(
      stale.getByRole("link", { name: "Preview on calendar" }),
    ).toBeTruthy();
    stale.unmount();
    for (const status of ["applied", "discarded"] as const) {
      const answered = draw({ ...PLAN, status });
      expect(
        answered.queryByRole("link", { name: "Preview on calendar" }),
      ).toBeNull();
      answered.unmount();
    }
  });
});
