import {
  afterAll,
  afterEach,
  beforeAll,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { CalendarView, StudyPlan } from "@openbot/shared/study";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { UNCLASSED_COURSE_ID } from "@/components/calendar/rebound/calendar-data";
import {
  type CalendarSearch,
  CalendarScreen,
} from "@/components/shell/calendar-screen";
import { Route as CalendarRoute } from "@/routes/_authed/_app/calendar";
import { applyPlanMutationOptions } from "@/lib/study/plans";
import { settleReactWork } from "./settle-react-work";

/**
 * The Calendar screen over the demo student's week: Wednesday's classes and a study block on
 * Rebound's timeline, what is due as chips under the day headings with each teacher's AI-help level
 * in its details, Day and Week, stepping through days, what could not be read, and a proposed plan
 * laid over it from `?plan=`, applied in Chat or taken off again from its bar.
 */

beforeAll(() => {
  /*
   * Wednesday, November 4, 2026, at 4:10 PM in Chicago, the student's zone, so "today" and the now
   * line never depend on when or where the suite runs.
   */
  setSystemTime(new Date("2026-11-04T22:10:00.000Z"));
  GlobalRegistrator.register({ url: "http://localhost:3010" });
});
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
  setSystemTime();
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

const DAY = "2026-11-04";
const TOMORROW = "2026-11-05";

/** Jordan Rivera's week (scripts/fake-google): five classes, Wednesday's day, and what is due. */
function demoWeek(): CalendarView {
  const period = (
    id: string,
    title: string,
    start: string,
    end: string,
    location: string,
    classId?: string,
    date = DAY,
  ) => ({
    id,
    title,
    date,
    start,
    end,
    location,
    ...(classId ? { classId } : {}),
  });
  return {
    timeZone: "America/Chicago",
    today: DAY,
    nowMinute: 16 * 60 + 10,
    from: "2026-11-01",
    to: "2026-11-07",
    classes: [
      {
        id: "apush1",
        name: "AP US History",
        teacher: "Mr. Grant",
        period: "1",
        color: "rose",
      },
      {
        id: "chem2",
        name: "Chemistry",
        teacher: "Dr. Okoro",
        period: "2",
        color: "teal",
      },
      {
        id: "english3",
        name: "English 11",
        teacher: "Ms. Alvarez",
        period: "3",
        color: "violet",
      },
      {
        id: "precalc4",
        name: "Precalculus",
        teacher: "Mr. Chen",
        period: "4",
        color: "sky",
      },
      {
        id: "spanish5",
        name: "Spanish III",
        teacher: "Sra. Morales",
        period: "5",
        color: "amber",
      },
    ],
    events: [
      period(
        "period1apush",
        "AP US History (Mr. Grant)",
        "08:00",
        "08:50",
        "Room 214",
        "apush1",
      ),
      period(
        "period2chem",
        "Chemistry (Dr. Okoro)",
        "08:55",
        "09:45",
        "Lab 3",
        "chem2",
      ),
      period(
        "period3english",
        "English 11 (Ms. Alvarez)",
        "09:50",
        "10:40",
        "Room 108",
        "english3",
      ),
      period(
        "period4precalc",
        "Precalculus (Mr. Chen)",
        "10:45",
        "11:35",
        "Room 301",
        "precalc4",
      ),
      { id: "lunch", title: "Lunch", date: DAY, start: "11:40", end: "12:15" },
      period(
        "period5spanish",
        "Spanish III (Sra. Morales)",
        "12:20",
        "13:10",
        "Room 122",
        "spanish5",
      ),
      period("studyhall", "Study hall", "13:15", "14:05", "Library"),
      period("soccer", "Soccer practice", "15:30", "17:30", "Field B"),
      period("debateprep", "Debate club prep", "19:30", "20:15", "Google Meet"),
      period(
        "period4precalc_20261105",
        "Precalculus (Mr. Chen)",
        "10:45",
        "11:35",
        "Room 301",
        "precalc4",
        TOMORROW,
      ),
    ],
    allDay: [{ id: "retakes", title: "Picture retakes", date: TOMORROW }],
    blocks: [
      {
        id: "block-precalc",
        assignmentId: "quiz4",
        classId: "precalc4",
        title: "Study: Unit 4 trig identities",
        date: DAY,
        start: "18:00",
        end: "18:45",
      },
    ],
    deadlines: [
      {
        assignmentId: "dbq-docs",
        classId: "apush1",
        title: "DBQ documents and rubric",
        date: DAY,
        time: null,
        kind: "material",
        help: "none",
      },
      {
        assignmentId: "hw43",
        classId: "precalc4",
        title: "Unit 4 homework: section 4.3",
        date: DAY,
        time: "23:59",
        kind: "assignment",
        help: "full",
      },
      {
        assignmentId: "lab6",
        classId: "chem2",
        title: "Lab 6 report: Reaction Rates",
        date: TOMORROW,
        time: "23:59",
        kind: "assignment",
        help: "hints",
      },
      {
        assignmentId: "quiz4",
        classId: "precalc4",
        title: "Unit 4 quiz: trig identities",
        date: TOMORROW,
        time: null,
        kind: "quiz",
        help: "full",
      },
      {
        assignmentId: "dbq3",
        classId: "apush1",
        title: "DBQ essay: Causes of the Civil War",
        date: "2026-11-06",
        time: "08:00",
        kind: "assignment",
        help: "none",
      },
      {
        assignmentId: "vocab5",
        classId: "spanish5",
        title: "Vocab test: Unidad 5",
        date: "2026-11-06",
        time: null,
        kind: "test",
        help: null,
      },
    ],
    couldNotRead: [],
  };
}

function proposedPlan(overrides: Partial<StudyPlan> = {}): StudyPlan {
  return {
    id: "plan-1",
    status: "proposed",
    reason: "The lab report is due tomorrow night, so it comes first.",
    timeZone: "America/Chicago",
    startDate: DAY,
    days: 2,
    blocks: [
      {
        id: "p1",
        assignmentId: "lab6",
        classId: "chem2",
        title: "Lab 6 report: data table and graph",
        date: DAY,
        start: "20:30",
        end: "21:15",
      },
      {
        id: "p2",
        assignmentId: "lab6",
        classId: "chem2",
        title: "Lab 6 report: conclusion",
        date: TOMORROW,
        start: "16:00",
        end: "16:30",
      },
    ],
    remaining: [],
    warnings: [],
    totalMinutes: 75,
    createdAt: "2026-11-04T22:00:00.000Z",
    appliedAt: null,
    stale: false,
    staleReason: null,
    ...overrides,
  };
}

let calendar = demoWeek();
let failing = false;
let plans: Record<string, StudyPlan> = {};
/** While set, the calendar's answer waits for it, so a test can see the screen before it lands. */
let gate: Promise<void> | null = null;
/** Every request the screen made, path and query, in order. */
const requests: string[] = [];
/**
 * The study routes as the server answers them: the calendar for the range asked, only what falls in
 * it, and a plan by id, applied or taken off the calendar again by a POST.
 */
function serving() {
  requests.length = 0;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost:3010");
    requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/openduet/study/calendar") {
      if (gate) await gate;
      if (failing)
        return Response.json(
          { error: "Google Calendar didn't answer. Try again in a minute." },
          { status: 502 },
        );
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const inRange = (item: { date: string }) =>
        item.date >= from && item.date <= to;
      return Response.json({
        calendar: {
          ...calendar,
          from,
          to,
          events: calendar.events.filter(inRange),
          allDay: calendar.allDay.filter(inRange),
          blocks: calendar.blocks.filter(inRange),
          deadlines: calendar.deadlines.filter(inRange),
        },
      });
    }
    const plan = url.pathname.match(
      /^\/api\/openduet\/study\/plans\/([^/]+)(?:\/(apply|remove))?$/,
    );
    if (plan) {
      const id = decodeURIComponent(plan[1] ?? "");
      const found = plans[id];
      if (!found)
        return Response.json(
          { error: "That isn't here anymore." },
          { status: 404 },
        );
      const others = calendar.blocks.filter(
        (block) => !found.blocks.some((mine) => mine.id === block.id),
      );
      if (plan[2] === "apply") {
        plans[id] = {
          ...found,
          status: "applied",
          appliedAt: "2026-11-04T22:10:00.000Z",
        };
        calendar = { ...calendar, blocks: [...others, ...found.blocks] };
      } else if (plan[2] === "remove") {
        if (failing)
          return Response.json(
            { error: "Couldn't reach your study data. Try again." },
            { status: 503 },
          );
        plans[id] = { ...found, status: "discarded" };
        calendar = { ...calendar, blocks: others };
      }
      return Response.json({ plan: plans[id] });
    }
    return Response.json({});
  }) as unknown as typeof fetch;
}
afterEach(() => {
  calendar = demoWeek();
  failing = false;
  plans = {};
  gate = null;
});

/** The tab under a router, its address kept in state as the route keeps it in the URL. */
function Harness({
  initial,
  seen,
}: {
  initial: CalendarSearch;
  seen: CalendarSearch[];
}) {
  const [search, setSearch] = useState(initial);
  return (
    <CalendarScreen
      onSearch={(next) => {
        seen.push(next);
        setSearch(next);
      }}
      search={search}
    />
  );
}

function draw(initial: CalendarSearch = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const seen: CalendarSearch[] = [];
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <Harness initial={initial} seen={seen} />,
    }),
    history: createMemoryHistory({ initialEntries: ["/calendar"] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { view, seen, client, user: userEvent.setup({ document }) };
}

const heading = (view: ReturnType<typeof render>) =>
  view.getByRole("heading", { level: 1 }).textContent;
/** The row under a day's heading, where what owns no hours sits. */
const lane = (view: ReturnType<typeof render>, date: string) => {
  const found = view.container.querySelector<HTMLElement>(
    `[data-calendar-all-day='${date}']`,
  );
  if (!found) throw new Error(`no all-day row for ${date}`);
  return found;
};
/** A day's chips, as they are said; "+N more" is not one. */
const chips = (view: ReturnType<typeof render>, date: string) =>
  Array.from(
    lane(view, date).querySelectorAll<HTMLElement>("[data-calendar-item-id]"),
  );
const chipNames = (view: ReturnType<typeof render>, date: string) =>
  chips(view, date).map((chip) => chip.getAttribute("aria-label"));

test("opens on the student's today: its classes, a study block, and what is due with each help level", async () => {
  let land = () => {};
  gate = new Promise<void>((resolve) => {
    land = resolve;
  });
  serving();
  const { view, user } = draw();
  expect(await view.findByText("Loading your calendar…")).toBeTruthy();
  land();

  const apush = await view.findByRole("button", {
    name: /^AP US History \(Mr\. Grant\), 8 AM to 8:50 AM/,
  });
  expect(heading(view)).toBe("Wed, Nov 4");
  // A whole week is read once, even in Day view.
  expect(requests).toEqual([
    "GET /api/openduet/study/calendar?from=2026-11-01&to=2026-11-07",
  ]);
  // Each class keeps its own colour; what has no class is drawn neutral.
  expect(apush.getAttribute("data-calendar-course-id")).toBe("apush1");
  expect(
    view
      .getByRole("button", { name: /^Lunch, 11:40 AM to 12:15 PM/ })
      .getAttribute("data-calendar-course-id"),
  ).toBe(UNCLASSED_COURSE_ID);
  const block = view.getByRole("button", {
    name: /^Study: Unit 4 trig identities, 6 PM to 6:45 PM/,
  });
  expect(block.getAttribute("data-calendar-course-id")).toBe("precalc4");
  expect(
    view.container.querySelector("[data-calendar-now-time='true']")
      ?.textContent,
  ).toBe("4:10 PM");
  // Read-only: no item can be picked up, and nothing can be resized.
  const items = view.container.querySelectorAll("[data-calendar-item-id]");
  expect(items.length).toBeGreaterThan(8);
  for (const item of items)
    expect(item.getAttribute("data-calendar-flexible")).toBe("false");
  expect(
    view.container.querySelectorAll("[data-calendar-resize-handle]"),
  ).toHaveLength(0);
  // Only Wednesday is drawn.
  expect(
    view.container.querySelectorAll("section[data-calendar-date]"),
  ).toHaveLength(1);
  expect(view.queryByText("Picture retakes")).toBeNull();

  // What is due sits as chips under the day's heading, each in its class, by time, no time last.
  expect(chipNames(view, DAY)).toEqual([
    "Due: Unit 4 homework: section 4.3",
    "Material: DBQ documents and rubric",
  ]);
  expect(
    chips(view, DAY).map((chip) => [
      chip.getAttribute("data-calendar-course-id"),
      chip.getAttribute("title"),
    ]),
  ).toEqual([
    ["precalc4", "Unit 4 homework: section 4.3 · Due 11:59 PM"],
    ["apush1", "DBQ documents and rubric · Material"],
  ]);
  // Pressed, a chip says when, the class, and the teacher's AI-help level.
  const homework = view.getByRole("button", {
    name: "Due: Unit 4 homework: section 4.3",
  });
  await user.click(homework);
  expect(homework.getAttribute("aria-pressed")).toBe("true");
  const details = view.getByRole("region", {
    name: "Unit 4 homework: section 4.3, details",
  });
  expect(within(details).getByText("Wed, Nov 4 · Due 11:59 PM")).toBeTruthy();
  expect(within(details).getByText("Precalculus")).toBeTruthy();
  expect(within(details).getByText("AI help: Full help")).toBeTruthy();
  await user.click(
    view.getByRole("button", { name: "Material: DBQ documents and rubric" }),
  );
  const rubric = view.getByRole("region", {
    name: "DBQ documents and rubric, details",
  });
  expect(within(rubric).getByText("Wed, Nov 4 · Material")).toBeTruthy();
  expect(within(rubric).getByText("AI help: No help")).toBeTruthy();
  // One card at a time.
  expect(view.queryByRole("region", { name: /homework.*details$/ })).toBeNull();
});

test("Week shows the seven days and the week's deadlines, and a day's heading opens that day", async () => {
  serving();
  const { view, seen, user } = draw();
  await view.findByRole("button", { name: /^AP US History/ });

  await user.click(view.getByRole("radio", { name: "Week" }));
  expect(seen.at(-1)).toEqual({ date: DAY, view: "week" });
  expect(
    view.container.querySelectorAll("section[data-calendar-date]"),
  ).toHaveLength(7);
  expect(heading(view)).toBe("Nov 1 – 7");
  expect(view.getByRole("button", { name: "Previous week" })).toBeTruthy();

  // Each day's chips under its heading: two a day in a week, all-day events first.
  expect(chipNames(view, DAY)).toEqual([
    "Due: Unit 4 homework: section 4.3",
    "Material: DBQ documents and rubric",
  ]);
  expect(chipNames(view, "2026-11-06")).toEqual([
    "Due: DBQ essay: Causes of the Civil War",
    "Test: Vocab test: Unidad 5",
  ]);
  expect(chipNames(view, "2026-11-02")).toEqual([]);
  // The notice gave no level, so none is shown rather than one guessed.
  await user.click(
    view.getByRole("button", { name: "Test: Vocab test: Unidad 5" }),
  );
  const vocab = view.getByRole("region", {
    name: "Vocab test: Unidad 5, details",
  });
  expect(within(vocab).getByText("Fri, Nov 6 · Test")).toBeTruthy();
  expect(within(vocab).getByText("Spanish III")).toBeTruthy();
  expect(within(vocab).queryByText(/AI help/)).toBeNull();
  // Three on Thursday is more than a week's row holds: one, and how many more, which opens the day.
  expect(chipNames(view, TOMORROW)).toEqual(["All day: Picture retakes"]);
  await user.click(
    within(lane(view, TOMORROW)).getByRole("button", {
      name: "2 more on Thursday, November 5",
    }),
  );
  expect(seen.at(-1)).toMatchObject({ date: TOMORROW });
  expect(seen.at(-1)?.view ?? "day").toBe("day");
  expect(heading(view)).toBe("Thu, Nov 5");
  // One day lays them all side by side.
  expect(chipNames(view, TOMORROW)).toEqual([
    "All day: Picture retakes",
    "Due: Lab 6 report: Reaction Rates",
    "Quiz: Unit 4 quiz: trig identities",
  ]);

  await user.click(view.getByRole("radio", { name: "Week" }));
  await user.click(
    view.getByRole("button", { name: "Open Thursday, November 5" }),
  );
  expect(seen.at(-1)).toMatchObject({ date: TOMORROW });
  expect(
    view.container.querySelectorAll("section[data-calendar-date]"),
  ).toHaveLength(1);
  expect(heading(view)).toBe("Thu, Nov 5");
  expect(
    view.getByRole("radio", { name: "Day" }).getAttribute("aria-checked"),
  ).toBe("true");

  await user.click(view.getByRole("radio", { name: "Week" }));
  await user.click(view.getByRole("radio", { name: "Day" }));
  expect(
    view.container.querySelectorAll("section[data-calendar-date]"),
  ).toHaveLength(1);
  expect(heading(view)).toBe("Thu, Nov 5");
});

test("stepping through days reads a new week only on leaving this one, and Today comes back", async () => {
  serving();
  const { view, user } = draw();
  await view.findByRole("button", { name: /^AP US History/ });

  await user.click(view.getByRole("button", { name: "Next day" }));
  expect(heading(view)).toBe("Thu, Nov 5");
  expect(
    view.getByRole("button", {
      name: /^Precalculus \(Mr\. Chen\), 10:45 AM to 11:35 AM/,
    }),
  ).toBeTruthy();
  expect(view.queryByRole("button", { name: /^AP US History/ })).toBeNull();
  expect(chipNames(view, TOMORROW)).toEqual([
    "All day: Picture retakes",
    "Due: Lab 6 report: Reaction Rates",
    "Quiz: Unit 4 quiz: trig identities",
  ]);

  for (let step = 0; step < 4; step++)
    await user.click(view.getByRole("button", { name: "Previous day" }));
  expect(heading(view)).toBe("Sun, Nov 1");
  expect(requests).toEqual([
    "GET /api/openduet/study/calendar?from=2026-11-01&to=2026-11-07",
  ]);

  await user.click(view.getByRole("button", { name: "Previous day" }));
  expect(heading(view)).toBe("Sat, Oct 31");
  expect(
    await view.findByText(
      /^Nothing on your calendar on Saturday, October 31\./,
    ),
  ).toBeTruthy();
  expect(
    view
      .getByRole("link", { name: "Plan study time in Chat" })
      .getAttribute("href"),
  ).toBe("/");
  expect(requests).toEqual([
    "GET /api/openduet/study/calendar?from=2026-11-01&to=2026-11-07",
    "GET /api/openduet/study/calendar?from=2026-10-25&to=2026-10-31",
  ]);

  await user.click(view.getByRole("button", { name: "Today" }));
  expect(heading(view)).toBe("Wed, Nov 4");
  expect(
    await view.findByRole("button", { name: /^AP US History/ }),
  ).toBeTruthy();
  // That week was read already.
  expect(requests).toHaveLength(2);
});

test("what could not be read is said quietly, with where to fix it, over the rest of the calendar", async () => {
  calendar = {
    ...demoWeek(),
    couldNotRead: [
      "Couldn't read your Classroom notices: Gmail isn't connected. Connect Google in Connections.",
    ],
  };
  serving();
  const { view } = draw();
  const notice = await view.findByRole("note", {
    name: "Not everything could be read",
  });
  expect(
    within(notice).getByText(
      "Couldn't read your Classroom notices: Gmail isn't connected. Connect Google in Connections.",
    ),
  ).toBeTruthy();
  expect(
    within(notice)
      .getByRole("link", { name: "Open Connections" })
      .getAttribute("href"),
  ).toBe("/connections");
  // Quiet: not an alert, and the calendar is still there under it.
  expect(view.queryByRole("alert")).toBeNull();
  expect(view.getByRole("button", { name: /^AP US History/ })).toBeTruthy();
});

test("a day that shows nothing while something couldn't be read says only that nothing was read for it", async () => {
  calendar = {
    ...demoWeek(),
    events: [],
    allDay: [],
    blocks: [],
    deadlines: [],
    couldNotRead: [
      "This Bot hasn't been given your Google Calendar. Grant it in Connections.",
    ],
  };
  serving();
  const { view, user } = draw();
  expect(
    await view.findByText(/^Nothing we could read for today\./),
  ).toBeTruthy();
  expect(view.queryByText(/Nothing on your calendar/)).toBeNull();
  await user.click(view.getByRole("button", { name: "Next day" }));
  expect(
    await view.findByText(/^Nothing we could read for Thursday, November 5\./),
  ).toBeTruthy();
  await user.click(view.getByRole("radio", { name: "Week" }));
  expect(
    await view.findByText(/^Nothing we could read for this week\./),
  ).toBeTruthy();
});

test("?plan= lays a proposed plan over the calendar, dashed and named, beside what is applied", async () => {
  plans = { "plan-1": proposedPlan() };
  serving();
  const { view, seen, user } = draw({ plan: "plan-1" });

  const banner = await view.findByRole("status", { name: "Study plan" });
  expect(within(banner).getByText("Proposed plan")).toBeTruthy();
  expect(banner.textContent).toContain(
    "2 sessions, 1 hr 15 min. Dashed until you add it in Chat.",
  );
  const proposed = await view.findByRole("button", {
    name: /^Proposed: Lab 6 report: data table and graph, 8:30 PM to 9:15 PM/,
  });
  expect(proposed.getAttribute("data-calendar-item-id")).toBe("proposed:p1");
  expect(proposed.getAttribute("data-calendar-course-id")).toBe("chem2");
  // What is applied stays where it is, and tomorrow's proposed session is on tomorrow.
  expect(
    view.getByRole("button", { name: /^Study: Unit 4 trig identities/ }),
  ).toBeTruthy();
  expect(
    view.queryByRole("button", { name: /^Proposed: Lab 6 report: conclusion/ }),
  ).toBeNull();
  expect(requests).toContain("GET /api/openduet/study/plans/plan-1");

  await user.click(proposed);
  const details = view.getByRole("region", {
    name: "Lab 6 report: data table and graph, details",
  });
  expect(
    within(details).getByText("Proposed, not on your calendar yet"),
  ).toBeTruthy();
  expect(
    within(details).getByText("Wed, Nov 4 · 8:30 PM – 9:15 PM"),
  ).toBeTruthy();
  expect(within(details).getByText("Chemistry")).toBeTruthy();

  await user.click(
    within(banner).getByRole("button", { name: "Hide this plan" }),
  );
  expect(seen.at(-1)).toMatchObject({ date: DAY });
  expect(seen.at(-1)?.plan ?? "cleared").toBe("cleared");
  expect(view.queryByRole("status", { name: "Study plan" })).toBeNull();
  expect(view.queryByRole("button", { name: /^Proposed:/ })).toBeNull();
  expect(
    view.getByRole("button", { name: /^Study: Unit 4 trig identities/ }),
  ).toBeTruthy();
  // The button went with the banner: focus lands on the day shown, not on the page.
  expect(document.activeElement).toBe(view.getByRole("heading", { level: 1 }));
});

test("Show its first day goes there, and focus lands on the day it shows", async () => {
  plans = {
    "plan-1": proposedPlan({
      blocks: proposedPlan().blocks.filter((block) => block.date === TOMORROW),
      totalMinutes: 30,
    }),
  };
  serving();
  const { view, user } = draw({ plan: "plan-1", date: DAY });
  const banner = await view.findByRole("status", { name: "Study plan" });
  await user.click(
    within(banner).getByRole("button", { name: "Show its first day" }),
  );
  expect(heading(view)).toBe("Thu, Nov 5");
  expect(
    await view.findByRole("button", { name: /^Proposed: Lab 6 report/ }),
  ).toBeTruthy();
  // Its session is in view now, so the pill that was pressed is gone.
  expect(
    within(banner).queryByRole("button", { name: "Show its first day" }),
  ).toBeNull();
  expect(document.activeElement).toBe(view.getByRole("heading", { level: 1 }));
});

test("a plan link with no day opens on the plan's first session", async () => {
  plans = {
    "plan-1": proposedPlan({
      startDate: DAY,
      blocks: proposedPlan().blocks.filter((block) => block.date === TOMORROW),
      totalMinutes: 30,
    }),
  };
  serving();
  const { view } = draw({ plan: "plan-1" });
  expect(
    await view.findByRole("button", {
      name: /^Proposed: Lab 6 report: conclusion, 4 PM to 4:30 PM/,
    }),
  ).toBeTruthy();
  expect(heading(view)).toBe("Thu, Nov 5");
});

test("an applied plan is already on the calendar, so nothing of it is drawn a second time", async () => {
  plans = {
    "plan-1": proposedPlan({
      status: "applied",
      appliedAt: "2026-11-04T22:05:00.000Z",
    }),
  };
  serving();
  const { view } = draw({ plan: "plan-1" });
  const banner = await view.findByRole("status", { name: "Study plan" });
  expect(banner.textContent).toContain("Plan applied");
  // The Calendar tab, which is where it is: nothing is written to Google Calendar.
  expect(banner.textContent).toContain("Its sessions are on your calendar.");
  await view.findByRole("button", { name: /^AP US History/ });
  expect(view.queryByRole("button", { name: /^Proposed:/ })).toBeNull();
});

test("a plan applied in Chat is drawn at once on a week already read, before it is read again", async () => {
  plans = { "plan-1": proposedPlan() };
  calendar = { ...demoWeek(), blocks: [] };
  serving();
  const { view, client } = draw({ plan: "plan-1" });
  expect(
    await view.findByRole("button", { name: /^Proposed: Lab 6 report/ }),
  ).toBeTruthy();

  // The calendar's next read waits, as a real one takes a moment.
  let land = () => {};
  gate = new Promise<void>((resolve) => {
    land = resolve;
  });
  await act(async () => {
    await client
      .getMutationCache()
      .build(client, applyPlanMutationOptions(client, "plan-1"))
      .execute(undefined);
  });
  const banner = await view.findByText("Plan applied");
  expect(banner).toBeTruthy();
  const drawn = () =>
    Array.from(
      view.container.querySelectorAll("[data-calendar-item-id^='block:']"),
      (item) => item.getAttribute("data-calendar-item-id"),
    );
  // Solid, not dashed, while the calendar is still being read again.
  expect(drawn()).toEqual(["block:p1"]);
  expect(view.queryByRole("button", { name: /^Proposed:/ })).toBeNull();
  expect(
    requests.filter((request) => request.includes("/study/calendar")),
  ).toHaveLength(2);
  land();
  await waitFor(() => expect(view.queryByText(/^Nothing/)).toBeNull());
  expect(drawn()).toEqual(["block:p1"]);
});

test("an applied plan comes off the calendar from its banner, at once, and the banner says so", async () => {
  const applied = proposedPlan({
    status: "applied",
    appliedAt: "2026-11-04T22:05:00.000Z",
  });
  plans = { "plan-1": applied };
  calendar = { ...demoWeek(), blocks: applied.blocks };
  serving();
  const { view, user } = draw({ plan: "plan-1" });
  const banner = await view.findByRole("status", { name: "Study plan" });
  expect(
    await view.findByRole("button", { name: /^Lab 6 report: data table/ }),
  ).toBeTruthy();

  let land = () => {};
  gate = new Promise<void>((resolve) => {
    land = resolve;
  });
  await user.click(
    within(banner).getByRole("button", { name: "Remove from calendar" }),
  );
  expect(await within(banner).findByText("Plan removed")).toBeTruthy();
  expect(banner.textContent).toContain("Removed from your calendar.");
  expect(requests).toContain("POST /api/openduet/study/plans/plan-1/remove");
  // Off the timeline before the calendar is read again.
  expect(
    view.queryByRole("button", { name: /^Lab 6 report: data table/ }),
  ).toBeNull();
  expect(
    within(banner).queryByRole("button", { name: "Remove from calendar" }),
  ).toBeNull();
  // The pressed button went: focus moves onto what the banner says now.
  expect(document.activeElement).toBe(within(banner).getByText("Plan removed"));
  land();
  await waitFor(() =>
    expect(
      requests.filter((request) => request.includes("/study/calendar")),
    ).toHaveLength(2),
  );
  expect(
    view.queryByRole("button", { name: /^Lab 6 report: data table/ }),
  ).toBeNull();
});

test("a removal that fails says why on the banner, and the plan stays on the calendar", async () => {
  const applied = proposedPlan({
    status: "applied",
    appliedAt: "2026-11-04T22:05:00.000Z",
  });
  plans = { "plan-1": applied };
  calendar = { ...demoWeek(), blocks: applied.blocks };
  serving();
  const { view, user } = draw({ plan: "plan-1" });
  const banner = await view.findByRole("status", { name: "Study plan" });
  await view.findByRole("button", { name: /^Lab 6 report: data table/ });
  failing = true;
  await user.click(
    within(banner).getByRole("button", { name: "Remove from calendar" }),
  );
  expect((await within(banner).findByRole("alert")).textContent).toBe(
    "Couldn't reach your study data. Try again.",
  );
  expect(within(banner).getByText("Plan applied")).toBeTruthy();
  expect(
    view.getByRole("button", { name: /^Lab 6 report: data table/ }),
  ).toBeTruthy();
  await waitFor(() =>
    expect(
      within(banner).getByRole("button", { name: "Remove from calendar" }),
    ).toHaveProperty("disabled", false),
  );
});

test("a proposal overtaken by another plan is still drawn, and says it can't be applied", async () => {
  plans = {
    "plan-1": proposedPlan({ stale: true, staleReason: "changed" }),
  };
  serving();
  const { view } = draw({ plan: "plan-1" });
  const banner = await view.findByRole("status", { name: "Study plan" });
  expect(within(banner).getByText("Proposed plan, out of date")).toBeTruthy();
  expect(banner.textContent).toContain(
    "2 sessions, 1 hr 15 min. Your schedule changed since this plan was made. Ask for a fresh one.",
  );
  expect(
    await view.findByRole("button", {
      name: /^Proposed: Lab 6 report: data table and graph/,
    }),
  ).toBeTruthy();
});

test("a proposal whose session has already begun says that, not that the schedule changed", async () => {
  plans = {
    "plan-1": proposedPlan({ stale: true, staleReason: "started" }),
  };
  serving();
  const { view } = draw({ plan: "plan-1" });
  const banner = await view.findByRole("status", { name: "Study plan" });
  expect(within(banner).getByText("Proposed plan, out of date")).toBeTruthy();
  expect(banner.textContent).toContain(
    "2 sessions, 1 hr 15 min. A session in this plan has already started. Ask for a fresh plan.",
  );
  expect(banner.textContent).not.toContain("Your schedule changed");
});

test("a plan that is gone says so, and the calendar is drawn as it is", async () => {
  serving();
  const { view } = draw({ plan: "missing" });
  const banner = await view.findByRole("status", { name: "Study plan" });
  expect(within(banner).getByText("Couldn't open that plan")).toBeTruthy();
  expect(banner.textContent).toContain(
    "That isn't here anymore. Ask in Chat for a fresh one.",
  );
  expect(
    await view.findByRole("button", { name: /^AP US History/ }),
  ).toBeTruthy();
});

test("pressing an item shows its details, and Escape, Close or pressing it again puts them away", async () => {
  serving();
  const { view, user } = draw();
  const apush = await view.findByRole("button", { name: /^AP US History/ });

  await user.click(apush);
  const details = view.getByRole("region", {
    name: "AP US History (Mr. Grant), details",
  });
  expect(within(details).getByText("Wed, Nov 4 · 8 AM – 8:50 AM")).toBeTruthy();
  expect(within(details).getByText("Room 214")).toBeTruthy();
  expect(within(details).getByText("AP US History")).toBeTruthy();
  expect(apush.getAttribute("aria-pressed")).toBe("true");

  await user.keyboard("{Escape}");
  expect(view.queryByRole("region", { name: /, details$/ })).toBeNull();
  expect(document.activeElement).toBe(apush);

  // Closed with its own button, which goes with it: focus goes back to the item.
  await user.click(apush);
  await user.click(view.getByRole("button", { name: "Close details" }));
  expect(view.queryByRole("region", { name: /, details$/ })).toBeNull();
  expect(document.activeElement).toBe(apush);

  // Escape from inside the details does the same.
  await user.click(apush);
  view.getByRole("button", { name: "Close details" }).focus();
  await user.keyboard("{Escape}");
  expect(view.queryByRole("region", { name: /, details$/ })).toBeNull();
  expect(document.activeElement).toBe(apush);

  await user.click(apush);
  await user.click(apush);
  expect(view.queryByRole("region", { name: /, details$/ })).toBeNull();
  expect(apush.getAttribute("aria-pressed")).toBe("false");
});

test("closing the details finds the item again when its button was drawn anew", async () => {
  serving();
  const { view, user } = draw();
  const apush = await view.findByRole("button", { name: /^AP US History/ });
  await user.click(apush);
  // Drawn anew, as a re-render that replaces the timeline's buttons would.
  const fresh = apush.cloneNode(true) as HTMLElement;
  apush.replaceWith(fresh);
  await user.click(view.getByRole("button", { name: "Close details" }));
  expect(document.activeElement).toBe(fresh);
});

test("an event that runs to midnight ends at 12 AM wherever its time is written", async () => {
  calendar = {
    ...demoWeek(),
    events: [
      ...demoWeek().events,
      {
        id: "movie",
        title: "Movie night",
        date: DAY,
        start: "23:00",
        end: "24:00",
      },
      // Four hours or more: drawn as a quiet wash with its own label.
      {
        id: "lockin",
        title: "Lock-in",
        date: TOMORROW,
        start: "19:00",
        end: "24:00",
      },
    ],
  };
  serving();
  const { view, user } = draw();
  const movie = await view.findByRole("button", {
    name: /^Movie night, 11 PM to 12 AM/,
  });
  expect(movie.getAttribute("title")).toBe("Movie night · 11 PM – 12 AM");
  await user.click(movie);
  expect(
    within(
      view.getByRole("region", { name: "Movie night, details" }),
    ).getByText("Wed, Nov 4 · 11 PM – 12 AM"),
  ).toBeTruthy();

  await user.click(view.getByRole("button", { name: "Next day" }));
  const lockin = await view.findByRole("button", {
    name: /^Lock-in, 7 PM to 12 AM/,
  });
  expect(lockin.getAttribute("data-calendar-busy-wash")).toBe("true");
  expect(lockin.getAttribute("title")).toBe("Lock-in · 7 PM – 12 AM");
  expect(lockin.querySelector("time")?.textContent).toBe("7 PM – 12 AM");
  // The hours run to midnight too, and their last mark is midnight, as Rebound writes the hours.
  const hours = Array.from(
    view.container.querySelectorAll("time[datetime]"),
    (mark) => mark.textContent,
  );
  expect(hours.at(-1)).toBe("12am");
  expect(hours).not.toContain("11:59pm");
  expect(hours.at(-2)).toBe("11pm");
});

test("while a week holding today loads, the now line keeps the student's time, and the view comes back to now once it lands", async () => {
  serving();
  // Opened on next week, as a link to a plan that starts then would.
  const { view, user } = draw({ date: "2026-11-12" });
  await view.findByRole("heading", { level: 1, name: "Thu, Nov 12" });
  await waitFor(() =>
    expect(view.queryByText("Loading your calendar…")).toBeNull(),
  );

  let land = () => {};
  gate = new Promise<void>((resolve) => {
    land = resolve;
  });
  await user.click(view.getByRole("button", { name: "Today" }));
  expect(heading(view)).toBe("Wed, Nov 4");
  // Next week's answer stands in while this one is read: none of today's items yet.
  expect(view.queryByRole("button", { name: /^AP US History/ })).toBeNull();
  const now = () =>
    view.container.querySelector<HTMLElement>(
      "[data-calendar-now-time='true']",
    );
  expect(now()?.textContent).toBe("4:10 PM");
  const scrollport = view.container.querySelector<HTMLElement>(
    "[data-calendar-scrollport='true']",
  );
  if (!scrollport) throw new Error("no timeline scrollport");
  // The timeline jumps to 180px above the now line.
  const target = () =>
    Number.parseFloat(now()?.parentElement?.style.top ?? "") - 180;
  expect(target()).toBeGreaterThan(0);
  expect(scrollport.scrollTop).toBeCloseTo(target());

  // Moved off now while the week loads; once it lands, the view comes back to now.
  scrollport.scrollTop = 0;
  land();
  expect(
    await view.findByRole("button", { name: /^AP US History/ }),
  ).toBeTruthy();
  expect(now()?.textContent).toBe("4:10 PM");
  expect(scrollport.scrollTop).toBeCloseTo(target());
});

test("the now line is this device's clock in the student's own zone, not the minute the calendar was read", async () => {
  // 1:30 AM Thursday in Tokyo, the student's zone; the calendar it shows was read at 1 AM.
  calendar = {
    ...demoWeek(),
    timeZone: "Asia/Tokyo",
    today: TOMORROW,
    nowMinute: 60,
    events: [
      {
        id: "early",
        title: "Early practice",
        date: TOMORROW,
        start: "06:00",
        end: "07:00",
      },
    ],
    blocks: [],
    deadlines: [],
    allDay: [],
  };
  setSystemTime(new Date("2026-11-04T16:30:00.000Z"));
  try {
    serving();
    const { view } = draw();
    expect(
      await view.findByRole("button", {
        name: /^Early practice, 6 AM to 7 AM/,
      }),
    ).toBeTruthy();
    expect(heading(view)).toBe("Thu, Nov 5");
    expect(
      view.container.querySelector("[data-calendar-now-time='true']")
        ?.textContent,
    ).toBe("1:30 AM");
  } finally {
    setSystemTime(new Date("2026-11-04T22:10:00.000Z"));
  }
});

test("a zone this browser doesn't know keeps the calendar's own reading of now", async () => {
  calendar = { ...demoWeek(), timeZone: "Mars/Olympus", nowMinute: 9 * 60 };
  serving();
  const { view } = draw();
  await view.findByRole("button", { name: /^AP US History/ });
  expect(heading(view)).toBe("Wed, Nov 4");
  expect(
    view.container.querySelector("[data-calendar-now-time='true']")
      ?.textContent,
  ).toBe("9 AM");
});

test("a calendar that can't be read says why, and Try again reads it again", async () => {
  failing = true;
  serving();
  const { view, user } = draw();
  const alert = await view.findByRole("alert");
  expect(alert.textContent).toContain(
    "Google Calendar didn't answer. Try again in a minute.",
  );
  failing = false;
  await user.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(
    await view.findByRole("button", { name: /^AP US History/ }),
  ).toBeTruthy();
  expect(requests).toEqual([
    "GET /api/openduet/study/calendar?from=2026-11-01&to=2026-11-07",
    "GET /api/openduet/study/calendar?from=2026-11-01&to=2026-11-07",
  ]);
});

test("the route reads its day, plan and view as the text they were in the address", () => {
  const validate = CalendarRoute.options.validateSearch as (
    search: Record<string, unknown>,
  ) => CalendarSearch;
  expect(validate({})).toEqual({});
  expect(
    validate({ date: "2026-11-05", plan: 12345, view: "week", page: "x" }),
  ).toEqual({
    date: "2026-11-05",
    plan: "12345",
    view: "week",
  });
});
