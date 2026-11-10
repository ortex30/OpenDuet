import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LearnScreen } from "@/components/learn/learn-screen";
import { agentKeys } from "@/lib/agents/queries";
import { STUDY_ASKS, type StudyOverview } from "@/lib/learn/queries";
import { settleReactWork } from "./settle-react-work";

/*
 * The Learn tab draws the student's study memory (server/src/openduet/study-memory.ts): mastery per
 * class, what is due for spaced review and the mistakes still open, and its buttons start the
 * matching learning skill as a task.
 */

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:3010" }));
afterEach(cleanup);
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

const topic = (
  overrides: Partial<StudyOverview["topics"][number]> & {
    id: string;
    subject: string;
    topic: string;
  },
) => ({
  box: 1,
  mastery: 20,
  level: "shaky" as const,
  correctCount: 1,
  partlyCount: 0,
  missedCount: 2,
  lastResult: "missed" as const,
  lastActivity: "quiz",
  openMistakes: [],
  fixedMistakes: 0,
  due: false,
  dueAt: "2099-01-01T09:00:00.000Z",
  lastPracticedAt: "2026-11-04T09:00:00.000Z",
  ...overrides,
});

const doubleAngle = topic({
  id: "t-double",
  subject: "Precalculus",
  topic: "Double-angle formulas",
  due: true,
  dueAt: "2026-11-05T09:00:00.000Z",
  openMistakes: ["Writes sin 2x as 2 sin x"],
});
const pythagorean = topic({
  id: "t-pyth",
  subject: "Precalculus",
  topic: "Pythagorean identities",
  box: 4,
  mastery: 82,
  level: "strong",
  correctCount: 4,
  missedCount: 0,
  lastResult: "correct",
});
const mandatos = topic({
  id: "t-mand",
  subject: "Spanish III",
  topic: "Mandatos",
  box: 3,
  mastery: 60,
  level: "getting-there",
  lastResult: "partly",
});

const overview: StudyOverview = {
  totals: {
    topics: 3,
    due: 1,
    strong: 1,
    openMistakes: 1,
    practicedThisWeek: 3,
  },
  subjects: [
    {
      subject: "Precalculus",
      mastery: 51,
      topics: 2,
      due: 1,
      openMistakes: 1,
    },
    { subject: "Spanish III", mastery: 60, topics: 1, due: 0, openMistakes: 0 },
  ],
  due: [doubleAngle],
  weakest: [doubleAngle, mandatos, pythagorean],
  mistakes: [
    {
      topicId: "t-double",
      subject: "Precalculus",
      topic: "Double-angle formulas",
      note: "Writes sin 2x as 2 sin x",
    },
  ],
  topics: [doubleAngle, pythagorean, mandatos],
};

const empty: StudyOverview = {
  totals: {
    topics: 0,
    due: 0,
    strong: 0,
    openMistakes: 0,
    practicedThisWeek: 0,
  },
  subjects: [],
  due: [],
  weakest: [],
  mistakes: [],
  topics: [],
};

type Call = { url: string; method: string; body: unknown };

function serving(study: StudyOverview) {
  const calls: Call[] = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.startsWith("/api/agents")) {
      return Response.json({
        agents: [
          {
            id: "openduet",
            name: "Academic OS",
            title: "Your study coach",
            roleDescription: "",
            visibility: "public",
          },
        ],
      });
    }
    if (url === "/api/openduet/memory" && method === "GET")
      return Response.json({ overview: study });
    if (url.endsWith("/fixed"))
      return Response.json({ topic: { ...doubleAngle, openMistakes: [] } });
    if (url === "/api/openduet/tasks" && method === "POST")
      return Response.json({ task: { id: "task-1", title: "Review" } });
    return Response.json({});
  }) as unknown as typeof fetch;
  return calls;
}

function draw() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(agentKeys.list(), [
    {
      id: "openduet",
      name: "Academic OS",
      title: "Your study coach",
      roleDescription: "",
      visibility: "public",
    },
  ]);
  const root = createRootRoute({ component: () => <Outlet /> });
  const learn = createRoute({
    getParentRoute: () => root,
    path: "/learn",
    component: LearnScreen,
  });
  const task = createRoute({
    getParentRoute: () => root,
    path: "/tasks/$taskId",
    component: () => <p>Task open</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([learn, task]),
    history: createMemoryHistory({ initialEntries: ["/learn"] }),
  });
  return {
    router,
    view: render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>,
    ),
  };
}

test("an empty study memory offers a quiz to start it", async () => {
  const calls = serving(empty);
  const { view, router } = draw();
  await view.findByText("Nothing practiced yet");
  await userEvent.click(
    view.getByRole("button", { name: "Start with a quiz" }),
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/tasks/task-1"),
  );
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({
    botId: "openduet",
    instruction: STUDY_ASKS.start,
  });
});

test("the totals, each class's mastery, what is due and the open mistakes", async () => {
  serving(overview);
  const { view } = draw();
  const today = await waitFor(() => {
    const found = document.querySelector("[data-learn-today]");
    if (!found) throw new Error("not drawn yet");
    return found as HTMLElement;
  });
  expect(
    within(today).getByText("Due today").previousSibling?.textContent,
  ).toBe("1");
  expect(within(today).getByText("Strong").previousSibling?.textContent).toBe(
    "1",
  );
  expect(
    within(today).getByRole("button", { name: "Review 1 topic" }),
  ).toBeTruthy();

  const classes = [...document.querySelectorAll("[data-learn-subject]")].map(
    (card) => card.getAttribute("data-learn-subject"),
  );
  expect(classes).toEqual(["Precalculus", "Spanish III"]);
  const bars = view.getAllByRole("progressbar");
  expect(bars.map((bar) => bar.getAttribute("aria-valuenow"))).toEqual([
    "51",
    "60",
  ]);

  // The due list names the topic and how it went last time.
  expect(view.getByText("Precalculus · last time missed")).toBeTruthy();
  // And the mistake is listed with its class and topic.
  const mistake = document.querySelector("[data-learn-mistake]") as HTMLElement;
  expect(within(mistake).getByText("Writes sin 2x as 2 sin x")).toBeTruthy();
});

test("a class opens to its topics, weakest first, with their Leitner box", async () => {
  serving(overview);
  const { view } = draw();
  const precalc = await view.findByRole("button", { name: /Precalculus/ });
  expect(precalc.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(precalc);
  expect(precalc.getAttribute("aria-expanded")).toBe("true");
  const panel = document.getElementById(
    precalc.getAttribute("aria-controls") ?? "",
  ) as HTMLElement;
  const rows = within(panel).getAllByRole("listitem");
  expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
    "Double-angle formulas",
    "Pythagorean identities",
  ]);
  expect(
    within(rows[1] as HTMLElement)
      .getByRole("img")
      .getAttribute("aria-label"),
  ).toBe("Box 4 of 5");
  expect(within(rows[1] as HTMLElement).getByText("Strong")).toBeTruthy();
  expect(
    within(panel).getByRole("button", { name: "Practice Precalculus" }),
  ).toBeTruthy();
});

test("Got it marks the topic's mistakes fixed, and Review starts the review skill", async () => {
  const calls = serving(overview);
  const { view, router } = draw();
  await userEvent.click(await view.findByRole("button", { name: "Got it" }));
  await waitFor(() =>
    expect(
      calls.some(
        (call) =>
          call.url === "/api/openduet/memory/topics/t-double/fixed" &&
          call.method === "POST",
      ),
    ).toBe(true),
  );
  await userEvent.click(view.getByRole("button", { name: "Review 1 topic" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/tasks/task-1"),
  );
  expect(
    calls.find((call) => call.url === "/api/openduet/tasks")?.body,
  ).toEqual({ botId: "openduet", instruction: STUDY_ASKS.review });
});
