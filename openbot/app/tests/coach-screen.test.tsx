import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoachScreen } from "@/components/coach/coach-screen";
import { agentKeys } from "@/lib/agents/queries";
import { authKeys } from "@/lib/auth/queries";
import {
  COACH_STORAGE_KEY,
  getCoachState,
  getTimer,
  logSession,
  resetCoachCache,
  restartWithDemo,
  setTimer,
  updateCoach,
} from "@/lib/coach/store";
import { settleReactWork } from "./settle-react-work";

/*
 * The Coach tab, drawn whole on the demo week: what it shows on first open, and each thing a
 * student does there (check in, finish work, focus, hand work to the coach, the report, setup).
 */

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:3010" }));
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

const originalFetch = global.fetch;
let posted: { url: string; body: unknown }[] = [];
beforeEach(() => {
  window.localStorage.clear();
  resetCoachCache();
  restartWithDemo();
  posted = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ task: { id: "task-1", title: "x" } });
    }
    if (url === "/api/openduet/tasks") return Response.json({ tasks: [] });
    return Response.json({});
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  setTimer(null);
  global.fetch = originalFetch;
});

/** The Coach screen, signed in as an account with no name unless one is given. */
function draw(account: { name?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
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
  client.setQueryData(authKeys.currentUser(), {
    id: "student-1",
    email: "student@example.com",
    role: "user",
    onboarding: null,
    ...account,
  });
  const router = createRouter({
    routeTree: createRootRoute({ component: CoachScreen }),
    history: createMemoryHistory({ initialEntries: ["/coach"] }),
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

test("first open shows the demo week: goal, streak, do next, catch-up, load, assignments and badges", async () => {
  const view = draw();
  await view.findByRole("heading", { name: "Coach" });
  expect(view.getByText(/Jordan\./)).toBeTruthy();
  expect(view.getByText(/This is a sample week\./)).toBeTruthy();
  expect(view.queryByText(/demo week/)).toBeNull();
  expect(view.getByTestId("streak").textContent).toMatch(/\d+-day streak/);
  expect(view.getByTestId("do-next-title").textContent).toBeTruthy();
  expect(view.getByLabelText("Catch-up mode").textContent).toContain(
    "Section 4.3 problems",
  );
  expect(view.getByLabelText("Workload radar")).toBeTruthy();
  expect(
    within(view.getByLabelText("Assignments")).getByText(
      "DBQ essay: Causes of the Civil War",
    ),
  ).toBeTruthy();
  // The seeded history has earned some badges already, stamped quietly on open.
  await waitFor(() =>
    expect(getCoachState().unlocked["first-focus"]).toBeTruthy(),
  );
  expect(view.queryByTestId("celebration")).toBeNull();
});

test("the sample week greets the signed-in student by their first name", async () => {
  const view = draw({ name: "Viren Shah" });
  expect(await view.findByText(/Viren\./)).toBeTruthy();
  expect(view.queryByText(/Jordan/)).toBeNull();
  expect(getCoachState().profile.name).toBe("Viren");
});

test("a sample week saved in the old colours takes the calendar's", async () => {
  updateCoach((s) => ({
    ...s,
    classes: s.classes.map((c) =>
      c.id === "apush" ? { ...c, color: "red" } : c,
    ),
  }));
  draw();
  await waitFor(() =>
    expect(getCoachState().classes.find((c) => c.id === "apush")?.color).toBe(
      "blue",
    ),
  );
});

test("the check-in sets today's pace", async () => {
  const user = userEvent.setup({ document });
  const view = draw();
  const card = await view.findByLabelText("Daily check-in");
  // Energy and sleep appear once a mood is picked, so the card starts small.
  expect(within(card).queryByText("Energy")).toBeNull();
  await user.click(within(card).getByRole("button", { name: "🙂" }));
  const button = within(card).getByRole("button", {
    name: "Set my pace",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await user.click(within(card).getByRole("button", { name: "Low" }));
  await user.click(within(card).getByRole("button", { name: "<6h" }));
  await user.click(button);
  const pace = await view.findByLabelText("Today's check-in");
  expect(pace.textContent).toContain("20-minute sessions");
  expect(getCoachState().checkIns.at(-1)).toMatchObject({
    mood: 4,
    energy: 2,
    sleepHours: 5,
  });
  // The focus button follows the new pace.
  expect(view.getByRole("button", { name: /Focus 20 min/ })).toBeTruthy();
});

test("turning in the late homework clears catch-up mode and celebrates the badges", async () => {
  const user = userEvent.setup({ document });
  const view = draw();
  await view.findByLabelText("Catch-up mode");
  await user.click(
    view.getByRole("button", {
      name: "Mark Section 4.3 problems 1-25 odd done",
    }),
  );
  await waitFor(() =>
    expect(view.queryByLabelText("Catch-up mode")).toBeNull(),
  );
  const celebration = await view.findByTestId("celebration");
  expect(celebration.textContent).toContain("Comeback");
  expect(getCoachState().unlocked["clean-slate"]).toBeTruthy();
});

test("focus mode covers the screen and shows the teacher's rule; finishing closes it", async () => {
  const user = userEvent.setup({ document });
  const view = draw();
  await user.click(await view.findByRole("button", { name: /Focus 25 min/ }));
  const focus = await view.findByRole("dialog", { name: "Focus mode" });
  expect(focus.textContent).toMatch(/AI help: (Full help|Hints only|No help)/);
  expect(focus.textContent).toMatch(/2[45]:\d\d/);
  await user.click(within(focus).getByRole("button", { name: "Pause" }));
  expect(within(focus).getByText("Paused")).toBeTruthy();
  await user.click(within(focus).getByRole("button", { name: "Finish" }));
  await waitFor(() =>
    expect(view.queryByRole("dialog", { name: "Focus mode" })).toBeNull(),
  );
  expect(getTimer()).toBeNull();
});

test("a finished focus phase logs its minutes and starts a break", async () => {
  const before = getCoachState().sessions.length;
  const view = draw();
  await view.findByRole("heading", { name: "Coach" });
  act(() =>
    setTimer({
      assignmentId: "chem-lab6",
      phase: "focus",
      lengthMin: 25,
      startedAt: new Date(Date.now() - 26 * 60_000).toISOString(),
      endsAt: new Date(Date.now() - 1000).toISOString(),
      pausedLeftMs: null,
    }),
  );
  await view.findByRole("dialog", { name: "Break" });
  const state = getCoachState();
  expect(state.sessions.length).toBe(before + 1);
  expect(state.assignments.find((a) => a.id === "chem-lab6")?.spentMin).toBe(
    35 + 25,
  );
});

test("handing work to the coach starts a task with the teacher's rule in it", async () => {
  const user = userEvent.setup({ document });
  const view = draw();
  const card = await view.findByLabelText("Do next");
  const button = within(card).getByRole("button", {
    name: /Coach me|Plan my time/,
  });
  await user.click(button);
  await view.findByRole("dialog", { name: "Get help with this" });
  const field = (await view.findByLabelText(
    "What to ask",
  )) as HTMLTextAreaElement;
  // The written-out request is folded away until the student opens it.
  expect(field.closest("details")?.open).toBe(false);
  expect(field.value).toMatch(/AI help: (Full help|Hints only|No help)\./);
  await user.click(view.getByRole("button", { name: "Start" }));
  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0]).toMatchObject({
    url: "/api/openduet/tasks",
    body: { botId: "openduet", instruction: field.value.trim() },
  });
});

test("catch-up hands the coach a plan request that asks before sending anything", async () => {
  const user = userEvent.setup({ document });
  const view = draw();
  await user.click(
    await view.findByRole("button", { name: /Make me a catch-up plan/ }),
  );
  const field = (await view.findByLabelText(
    "What to ask",
  )) as HTMLTextAreaElement;
  expect(field.value).toContain("catch-up plan");
  expect(field.value).toContain("Section 4.3 problems 1-25 odd");
  expect(field.value).toContain("late credit 70%");
});

test("the weekly report adds up the week and leaves mood out until asked", async () => {
  const user = userEvent.setup({ document });
  const view = draw();
  await user.click(await view.findByRole("button", { name: "Weekly report" }));
  const text = await view.findByTestId("report-text");
  expect(text.textContent).toContain("Jordan's week");
  expect(text.textContent).not.toContain("mood");
  await user.click(view.getByLabelText("Include my sleep and mood check-ins"));
  expect(view.getByTestId("report-text").textContent).toContain("mood");
});

test("setup saves the name, goal and a new class", async () => {
  const user = userEvent.setup({ document });
  const view = draw();
  await user.click(await view.findByRole("button", { name: "Set up" }));
  const name = await view.findByLabelText("Your first name");
  await user.clear(name);
  await user.type(name, "Ava");
  await user.type(view.getByLabelText("New class name"), "Robotics{Enter}");
  await user.click(view.getByRole("button", { name: "90m" }));
  await user.click(view.getByRole("button", { name: "Let's go" }));
  await waitFor(() => expect(view.getByText(/Ava\./)).toBeTruthy());
  const state = getCoachState();
  expect(state.profile).toMatchObject({
    name: "Ava",
    dailyGoalMin: 90,
    setupDone: true,
  });
  expect(state.classes.map((c) => c.name)).toContain("Robotics");
  expect(view.queryByText(/sample week/)).toBeNull();
  // Saved to this browser for next time.
  expect(window.localStorage.getItem(COACH_STORAGE_KEY)).toContain("Robotics");
});

test("adding an assignment puts it on the list and into the plan", async () => {
  const user = userEvent.setup({ document });
  const view = draw();
  const list = await view.findByLabelText("Assignments");
  await user.click(within(list).getByRole("button", { name: "Add" }));
  await user.type(
    await view.findByLabelText("What is it?"),
    "Robotics build log",
  );
  await user.click(view.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(
      within(view.getByLabelText("Assignments")).getByText(
        "Robotics build log",
      ),
    ).toBeTruthy(),
  );
  expect(
    getCoachState().assignments.some((a) => a.title === "Robotics build log"),
  ).toBe(true);
});

test("logging a session moves an untouched assignment to in progress", () => {
  logSession("apush-dbq", 30, new Date());
  const dbq = getCoachState().assignments.find((a) => a.id === "apush-dbq");
  expect(dbq).toMatchObject({ status: "doing", spentMin: 30 });
});
