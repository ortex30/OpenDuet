import { describe, expect, test } from "bun:test";
import type {
  CalendarView,
  SchoolAssignment,
  SchoolSnapshot,
  StudyPlan,
} from "@openbot/shared/study";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppVariables } from "../src/auth/guards";
import { CALENDAR_LIST, type CallTool } from "../src/openduet/brief";
import type {
  SchoolRead,
  SchoolService,
  StudyContext,
  StudyRouteDeps,
} from "../src/openduet/study/contracts";
import { createMemoryStudyStore } from "../src/openduet/study/memory-store";
import { planRoutes } from "../src/openduet/study/plan-routes";
import { planTools } from "../src/openduet/study/plan-tools";
import {
  createStudyRoutes,
  mountStudyRoutes,
} from "../src/openduet/study/routes";
import { createRulesService } from "../src/openduet/study/rules";
import {
  addDays,
  weekdayOf,
  zonedInstant,
  zonedParts,
} from "../src/openduet/study/time";

/*
 * A study plan after the tool made it: read back with whether it went stale, applied only against
 * the calendar as it is when Apply is pressed, dismissed with Not now, and the Calendar tab's view
 * of a range of days, with each deadline's AI help level as the teacher rules resolve it.
 */

const PATH = "/api/openduet/study";
const TZ = "America/Chicago";
const TODAY = "2026-11-04"; // a Wednesday
const NOW = zonedInstant(TODAY, "14:10", TZ);
const CONTEXT: StudyContext = {
  actorId: "jordan",
  botId: "academic-os",
  initiator: { kind: "person" },
};

const CHANGED =
  "Your schedule changed since this plan was made. Ask for a fresh one.";
const PASSED =
  "This plan includes a time that has already passed. Ask for a fresh plan.";

/* ------------------------------------------------------------------------------------------------
 * The demo student, as scripts/fake-google seeds them
 * ---------------------------------------------------------------------------------------------- */

const WORK: [
  id: string,
  classId: string,
  title: string,
  kind: SchoolAssignment["kind"],
  status: SchoolAssignment["status"],
  due: [offset: number, time: string] | null,
  help: SchoolAssignment["help"],
  minutes: number,
][] = [
  [
    "precalc4-hw43",
    "precalc4",
    "Section 4.3 homework",
    "assignment",
    "missing",
    [-1, "23:59"],
    "full",
    45,
  ],
  [
    "precalc4-quiz4",
    "precalc4",
    "Unit 4 quiz: Trig identities",
    "quiz",
    "open",
    [1, "10:45"],
    "full",
    60,
  ],
  [
    "chem2-lab6",
    "chem2",
    "Lab 6 report: Reaction Rates",
    "assignment",
    "open",
    [1, "23:59"],
    "hints",
    90,
  ],
  [
    "apush1-dbq3",
    "apush1",
    "DBQ essay: Causes of the Civil War",
    "assignment",
    "open",
    [2, "08:00"],
    "none",
    120,
  ],
  [
    "spanish5-u5test",
    "spanish5",
    "Unidad 5 vocab test: La comida y la salud",
    "test",
    "open",
    [3, "12:20"],
    "full",
    60,
  ],
  [
    "eng11-gatsby",
    "eng11",
    "The Great Gatsby analytical essay",
    "assignment",
    "open",
    [6, "23:59"],
    "hints",
    150,
  ],
  [
    "apush1-dbqdocs",
    "apush1",
    "DBQ documents and rubric",
    "material",
    "open",
    null,
    "none",
    0,
  ],
  // Dated here, though its notice had no due date, to show returned work is not a deadline.
  [
    "chem2-lab5",
    "chem2",
    "Lab 5 report: Concentration and Rate",
    "assignment",
    "returned",
    [-2, "23:59"],
    null,
    90,
  ],
];

function demoSnapshot(): SchoolSnapshot {
  return {
    syncedAt: NOW.toISOString(),
    timeZone: TZ,
    classes: (
      [
        ["apush1", "AP US History", "Mr. Grant", "sky"],
        ["chem2", "Chemistry", "Dr. Okoro", "violet"],
        ["eng11", "English 11", "Ms. Alvarez", "teal"],
        ["precalc4", "Precalculus", "Mr. Chen", "amber"],
        ["spanish5", "Spanish III", "Sra. Morales", "rose"],
      ] as const
    ).map(([id, name, teacher, color], index) => ({
      id,
      name,
      teacher,
      period: `Period ${index + 1}`,
      color,
    })),
    assignments: WORK.map(
      ([id, classId, title, kind, status, due, help, minutes]) => {
        const dueDate = due ? addDays(TODAY, due[0]) : null;
        return {
          id,
          classId,
          title,
          kind,
          status,
          due:
            due && dueDate
              ? zonedInstant(dueDate, due[1], TZ).toISOString()
              : null,
          dueDate,
          dueTime: due ? due[1] : null,
          points: null,
          grade: status === "returned" ? "34/40" : null,
          help,
          minutes,
          link: null,
          noticeId: `notice-${id}`,
        };
      },
    ),
    couldNotRead: [],
  };
}

type Seed = {
  id: string;
  summary: string;
  start: string;
  end: string;
  status?: "confirmed" | "tentative" | "cancelled";
};

const at = (
  date: string,
  start: string,
  end: string,
  id: string,
  summary: string,
): Seed => ({
  id,
  summary,
  start: zonedInstant(date, start, TZ).toISOString(),
  end: zonedInstant(date, end, TZ).toISOString(),
});

const PERIODS = [
  ["period1apush", "AP US History (Mr. Grant)", "08:00", "08:50"],
  ["period2chem", "Chemistry (Dr. Okoro)", "08:55", "09:45"],
  ["period3english", "English 11 (Ms. Alvarez)", "09:50", "10:40"],
  ["period4precalc", "Precalculus (Mr. Chen)", "10:45", "11:35"],
  ["lunch", "Lunch", "11:40", "12:15"],
  ["period5spanish", "Spanish III (Sra. Morales)", "12:20", "13:10"],
  ["studyhall", "Study hall", "13:15", "14:05"],
] as const;

/** Jordan's school week, from yesterday to six days on, as the fake Google's student persona has it. */
function demoWeek(): Seed[] {
  const seeds: Seed[] = [];
  for (let offset = -1; offset <= 6; offset++) {
    const date = addDays(TODAY, offset);
    const day = date.replaceAll("-", "");
    const weekday = weekdayOf(date);
    if (weekday >= 1 && weekday <= 5)
      for (const [id, title, start, end] of PERIODS)
        seeds.push(at(date, start, end, `${id}${day}`, title));
    if (weekday >= 1 && weekday <= 4)
      seeds.push(at(date, "15:30", "17:30", `soccer${day}`, "Soccer practice"));
  }
  seeds.push(
    at(TODAY, "14:45", "15:15", "chemhelp", "Chem lab help session"),
    {
      ...at(TODAY, "19:30", "20:15", "debateprep", "Debate club prep"),
      status: "tentative",
    },
    at(addDays(TODAY, 2), "16:15", "17:00", "dentist", "Dentist appointment"),
  );
  for (const [id, summary, offset] of [
    ["precalcquiz", "Precalc quiz: Unit 4 trig identities", 1],
    ["chemlabdue", "Chem lab report due", 1],
    ["apushdbq", "APUSH DBQ essay due", 2],
  ] as const)
    seeds.push({
      id,
      summary,
      start: addDays(TODAY, offset),
      end: addDays(TODAY, offset + 1),
    });
  return seeds;
}

/**
 * A stand-in for the plugin store's callTool over the Calendar adapter: Google's bounds, start
 * order, maxResults 25 by default and 50 at most, and the zone named only when timeMax is left out.
 */
function calendarAdapter(seeds: Seed[]) {
  const state = {
    calls: [] as Record<string, unknown>[],
    fail: null as string | null,
    /** While set, every read waits for it: a Google that is slow to answer. */
    gate: null as Promise<void> | null,
  };
  const span = (seed: Seed): [number, number] =>
    seed.start.length === 10
      ? [
          zonedInstant(seed.start, "00:00", TZ).getTime(),
          zonedInstant(seed.end, "00:00", TZ).getTime(),
        ]
      : [Date.parse(seed.start), Date.parse(seed.end)];
  const callTool: CallTool = async (input) => {
    state.calls.push(input.args);
    if (state.gate) await state.gate;
    expect(input.ref).toBe(CALENDAR_LIST);
    expect(input).toMatchObject(CONTEXT);
    if (state.fail) return { text: state.fail, isError: true };
    const max = Number(input.args.maxResults ?? 25);
    if (!Number.isInteger(max) || max < 1 || max > 50)
      return {
        text: "maxResults must be a number from 1 to 50.",
        isError: true,
      };
    const timeMin = Date.parse(String(input.args.timeMin ?? NOW.toISOString()));
    const timeMax =
      typeof input.args.timeMax === "string"
        ? Date.parse(input.args.timeMax)
        : zonedInstant(
            zonedParts(new Date(timeMin), TZ).date,
            "24:00",
            TZ,
          ).getTime();
    const events = seeds
      .filter((seed) => span(seed)[1] > timeMin && span(seed)[0] < timeMax)
      .sort((a, b) => span(a)[0] - span(b)[0])
      .slice(0, max)
      .map((seed) => ({
        ...seed,
        attendees: [],
        status: seed.status ?? "confirmed",
      }));
    return {
      text: JSON.stringify({
        ...(typeof input.args.timeMax === "string" ? {} : { timeZone: TZ }),
        events,
      }),
      isError: false,
    };
  };
  return { state, callTool };
}

function signedIn(
  userId: string,
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    context.set("actor", {
      id: userId,
      email: `${userId}@example.com`,
      role: "user",
    });
    await next();
  };
}

function setUp() {
  let time = NOW.getTime();
  const clock = () => new Date(time);
  const store = createMemoryStudyStore({ now: clock });
  const seeds = demoWeek();
  const google = calendarAdapter(seeds);
  const reading: { read: SchoolRead } = {
    read: { snapshot: demoSnapshot(), why: null },
  };
  const school: SchoolService = {
    async current(context) {
      expect(context).toEqual(CONTEXT);
      return reading.read;
    },
    async stored() {
      return reading.read.snapshot;
    },
  };
  const rules = createRulesService({ store, now: clock });
  const deps: StudyRouteDeps = {
    store,
    school,
    rules,
    callTool: google.callTool,
    upNext: async () => [],
    primaryBot: "academic-os",
    now: clock,
  };
  const routes = planRoutes(deps);
  const appFor = (userId: string) =>
    new Hono().route(PATH, mountStudyRoutes([routes], signedIn(userId)));
  const app = appFor("jordan");
  const [tool] = planTools({
    ...CONTEXT,
    store,
    school,
    rules,
    callTool: google.callTool,
    now: clock,
  });
  if (!tool) throw new Error("no plan tool");

  /** A plan, made the way the Bot makes one. */
  async function propose(
    args: Record<string, unknown> = { minutes: 150, reason: "Tonight." },
  ): Promise<string> {
    const answer = JSON.parse(await tool.execute(args)) as { id: string };
    return answer.id;
  }
  async function send(
    method: "GET" | "POST",
    path: string,
    as = app,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await as.request(`${PATH}${path}`, { method });
    return { status: response.status, body: await response.json() };
  }
  const planIn = (body: Record<string, unknown>) => body.plan as StudyPlan;
  return {
    store,
    seeds,
    google,
    reading,
    rules,
    deps,
    appFor,
    propose,
    send,
    planIn,
    advance(minutes: number) {
      time += minutes * 60_000;
    },
    clock,
  };
}

describe("a study plan", () => {
  test("is read back by its id, and only by its owner", async () => {
    const { propose, send, planIn, appFor } = setUp();
    const id = await propose();
    const read = await send("GET", `/plans/${id}`);
    expect(read.status).toBe(200);
    expect(planIn(read.body)).toMatchObject({
      id,
      status: "proposed",
      stale: false,
      staleReason: null,
      totalMinutes: 150,
    });
    expect(planIn(read.body).blocks).toHaveLength(4);
    for (const [as, path] of [
      [appFor("sam"), `/plans/${id}`],
      [appFor("jordan"), "/plans/no-such-plan"],
    ] as const)
      expect(await send("GET", path, as)).toEqual({
        status: 404,
        body: { error: "That isn't here anymore." },
      });
  });

  test("Apply puts it on the calendar once, however many times it is pressed", async () => {
    const { propose, send, planIn, google, store, advance, clock } = setUp();
    const id = await propose();
    advance(2);
    const calls = google.state.calls.length;
    const first = await send("POST", `/plans/${id}/apply`);
    expect(first.status).toBe(200);
    expect(planIn(first.body)).toMatchObject({
      id,
      status: "applied",
      appliedAt: clock().toISOString(),
      stale: false,
      staleReason: null,
    });
    // Its one day read again, as it is now.
    expect(google.state.calls.length).toBe(calls + 1);

    advance(1);
    const again = await send("POST", `/plans/${id}/apply`);
    expect(again).toEqual(first);
    expect(google.state.calls.length).toBe(calls + 1);
    expect((await store.get("jordan", "plan", id))?.status).toBe("applied");
    expect(planIn((await send("GET", `/plans/${id}`)).body).status).toBe(
      "applied",
    );
  });

  test("Apply is refused once another plan was applied after it was made", async () => {
    const { propose, send, planIn, store, advance } = setUp();
    const first = await propose();
    const second = await propose();
    advance(1);
    expect((await send("POST", `/plans/${first}/apply`)).status).toBe(200);
    expect(planIn((await send("GET", `/plans/${second}`)).body)).toMatchObject({
      stale: true,
      staleReason: "changed",
    });
    expect(await send("POST", `/plans/${second}/apply`)).toEqual({
      status: 409,
      body: { error: CHANGED },
    });
    expect((await store.get("jordan", "plan", second))?.status).toBe(
      "proposed",
    );
    // A plan made after that one was applied is planned around it, and is not stale.
    advance(1);
    const third = await propose();
    expect(planIn((await send("GET", `/plans/${third}`)).body).stale).toBe(
      false,
    );
  });

  test("Apply is refused, with what clashed, when something new is on the calendar", async () => {
    const { propose, send, seeds, store } = setUp();
    const id = await propose();
    seeds.push(at(TODAY, "18:00", "19:00", "tutoring", "Math tutoring"));
    expect(await send("POST", `/plans/${id}/apply`)).toEqual({
      status: 409,
      body: {
        error:
          "Something new is on your calendar at that time. Ask for a fresh plan.",
      },
    });
    expect((await store.get("jordan", "plan", id))?.status).toBe("proposed");
    // The plan is still there to apply once the clash is gone.
    seeds.pop();
    expect((await send("POST", `/plans/${id}/apply`)).status).toBe(200);
  });

  test("Apply is refused when it would land on study time already applied", async () => {
    const { propose, send, store, planIn } = setUp();
    const id = await propose();
    const plan = planIn((await send("GET", `/plans/${id}`)).body);
    // Applied before this plan was made, yet not planned around (it was unreadable then, say).
    const [block] = plan.blocks;
    if (!block) throw new Error("no block");
    await store.put("jordan", {
      id: "older",
      kind: "plan",
      status: "applied",
      startsAt: zonedInstant(block.date, block.start, TZ),
      endsAt: zonedInstant(block.date, block.end, TZ),
      data: {
        ...plan,
        id: "older",
        status: "applied",
        createdAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
        appliedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        blocks: [{ ...block, id: "older-block" }],
      },
    });
    expect(planIn((await send("GET", `/plans/${id}`)).body).stale).toBe(false);
    expect(await send("POST", `/plans/${id}/apply`)).toEqual({
      status: 409,
      body: {
        error:
          "Something new is on your calendar at that time. Ask for a fresh plan.",
      },
    });
  });

  test("Apply is refused once one of its sessions has started, saying time passed, not that the schedule changed", async () => {
    const { propose, send, planIn, advance, store } = setUp();
    const id = await propose();
    // 5:45 PM: the 5:40 session has begun, and nothing else has happened.
    advance(215);
    expect(planIn((await send("GET", `/plans/${id}`)).body)).toMatchObject({
      status: "proposed",
      stale: true,
      staleReason: "started",
    });
    expect(await send("POST", `/plans/${id}/apply`)).toEqual({
      status: 409,
      body: { error: PASSED },
    });
    expect((await store.get("jordan", "plan", id))?.status).toBe("proposed");
  });

  test("Apply adds nothing when the calendar can't be checked", async () => {
    const { propose, send, google, store } = setUp();
    const id = await propose();
    google.state.fail =
      "Google Calendar refused this request (503): Backend Error.";
    expect(await send("POST", `/plans/${id}/apply`)).toEqual({
      status: 409,
      body: {
        error:
          "Your calendar couldn't be read from Google Calendar. Google Calendar refused this request (503): Backend Error. Nothing was added to your calendar.",
      },
    });
    expect((await store.get("jordan", "plan", id))?.status).toBe("proposed");
  });

  test("a plan with no sessions in it can't be applied", async () => {
    const { propose, send, planIn } = setUp();
    const id = await propose({
      minutes: 30,
      startTime: "21:50",
      reason: "Late tonight.",
    });
    expect(planIn((await send("GET", `/plans/${id}`)).body).blocks).toEqual([]);
    expect(await send("POST", `/plans/${id}/apply`)).toEqual({
      status: 409,
      body: { error: "Nothing in this plan fits on your calendar." },
    });
  });

  test("Not now dismisses a waiting plan, once; an applied plan stays", async () => {
    const { propose, send, planIn } = setUp();
    const id = await propose();
    const dismissed = await send("POST", `/plans/${id}/discard`);
    expect(dismissed.status).toBe(200);
    expect(planIn(dismissed.body)).toMatchObject({
      id,
      status: "discarded",
      stale: false,
    });
    expect(await send("POST", `/plans/${id}/discard`)).toEqual(dismissed);
    expect(await send("POST", `/plans/${id}/apply`)).toEqual({
      status: 409,
      body: { error: "You dismissed this plan. Ask for a new one." },
    });

    const applied = await propose();
    expect((await send("POST", `/plans/${applied}/apply`)).status).toBe(200);
    expect(await send("POST", `/plans/${applied}/discard`)).toEqual({
      status: 409,
      body: { error: "This plan is already on your calendar." },
    });
    expect((await send("POST", "/plans/no-such-plan/discard")).status).toBe(
      404,
    );
  });

  test("two Applies at once put one plan on the calendar", async () => {
    const { propose, send, store, advance } = setUp();
    const first = await propose();
    const second = await propose();
    advance(1);
    const answers = await Promise.all([
      send("POST", `/plans/${first}/apply`),
      send("POST", `/plans/${second}/apply`),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)?.body).toEqual({
      error: CHANGED,
    });
    expect(
      (await store.list("jordan", "plan", { status: "applied" })).length,
    ).toBe(1);

    // The same plan from two tabs: both see it applied, at the one time.
    const third = await propose();
    advance(1);
    const twice = await Promise.all([
      send("POST", `/plans/${third}/apply`),
      send("POST", `/plans/${third}/apply`),
    ]);
    expect(twice[0]).toEqual(twice[1]);
    expect(twice[0]?.status).toBe(200);
  });
});

describe("removing a plan", () => {
  const sessions = (plan: StudyPlan) =>
    plan.blocks.map(
      (block) =>
        `${block.date} ${block.start}-${block.end} ${block.assignmentId}`,
    );

  test("takes an applied plan off the calendar, and gives later plans its time back", async () => {
    const { propose, send, planIn, store, advance, clock } = setUp();
    const id = await propose();
    // Made before that one is applied, so out of date once it is.
    const waiting = await propose();
    advance(1);
    const applied = planIn((await send("POST", `/plans/${id}/apply`)).body);
    expect(planIn((await send("GET", `/plans/${waiting}`)).body)).toMatchObject(
      { stale: true, staleReason: "changed" },
    );

    advance(1);
    const removed = await send("POST", `/plans/${id}/remove`);
    expect(removed.status).toBe(200);
    // Dismissed, and still saying it was applied, so the card can say it was taken off.
    expect(planIn(removed.body)).toMatchObject({
      id,
      status: "discarded",
      appliedAt: applied.appliedAt,
      stale: false,
      staleReason: null,
    });
    const record = await store.get("jordan", "plan", id);
    expect(record?.status).toBe("discarded");
    expect(record?.data.removedAt).toBe(clock().toISOString());
    // Pressed again, from another tab: the same answer.
    advance(1);
    expect(await send("POST", `/plans/${id}/remove`)).toEqual(removed);
    expect(planIn((await send("GET", `/plans/${id}`)).body)).toEqual(
      planIn(removed.body),
    );

    // Its sessions are off the Calendar tab.
    const today = (await send("GET", "/calendar?from=2026-11-04&to=2026-11-04"))
      .body.calendar as CalendarView;
    expect(today.blocks).toEqual([]);
    // They no longer take the time or count toward the work: a new plan gets the same sessions.
    const again = await propose();
    expect(
      sessions(planIn((await send("GET", `/plans/${again}`)).body)),
    ).toEqual(sessions(applied));
    // And the plan made before it was applied is in date again.
    expect(planIn((await send("GET", `/plans/${waiting}`)).body)).toMatchObject(
      { stale: false, staleReason: null },
    );
    // A removed plan can't go back on: the student asks for a new one.
    expect(await send("POST", `/plans/${id}/apply`)).toEqual({
      status: 409,
      body: {
        error: "You took this plan off your calendar. Ask for a new one.",
      },
    });
    expect((await send("POST", `/plans/${id}/discard`)).body).toEqual(
      removed.body,
    );
  });

  test("of a plan never applied just dismisses it; somebody else's, or none, is not found", async () => {
    const { propose, send, planIn, store, appFor } = setUp();
    const id = await propose();
    for (const [as, path] of [
      [appFor("sam"), `/plans/${id}/remove`],
      [appFor("jordan"), "/plans/no-such-plan/remove"],
    ] as const)
      expect(await send("POST", path, as)).toEqual({
        status: 404,
        body: { error: "That isn't here anymore." },
      });
    expect((await store.get("jordan", "plan", id))?.status).toBe("proposed");

    const removed = await send("POST", `/plans/${id}/remove`);
    expect(removed.status).toBe(200);
    expect(planIn(removed.body)).toMatchObject({
      id,
      status: "discarded",
      appliedAt: null,
      stale: false,
      staleReason: null,
    });
    expect((await store.get("jordan", "plan", id))?.data).not.toHaveProperty(
      "removedAt",
    );
    expect(await send("POST", `/plans/${id}/apply`)).toEqual({
      status: 409,
      body: { error: "You dismissed this plan. Ask for a new one." },
    });
  });

  test("waits for an Apply already under way, then takes the plan off", async () => {
    const { propose, send, planIn, store, google } = setUp();
    const id = await propose();
    let release: () => void = () => {};
    google.state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const reads = google.state.calls.length;
    const applying = send("POST", `/plans/${id}/apply`);
    // The Apply is reading the calendar, which has not answered yet.
    for (let turn = 0; turn < 20 && google.state.calls.length === reads; turn++)
      await settle();
    expect(google.state.calls.length).toBe(reads + 1);
    let removedYet = false;
    const removing = send("POST", `/plans/${id}/remove`).then((answer) => {
      removedYet = true;
      return answer;
    });
    await settle();
    await settle();
    // Behind the Apply, not around it: had it run, the Apply would land on a dismissed plan.
    expect(removedYet).toBe(false);
    expect((await store.get("jordan", "plan", id))?.status).toBe("proposed");

    release();
    const [applied, removed] = await Promise.all([applying, removing]);
    expect(applied.status).toBe(200);
    expect(planIn(applied.body).status).toBe("applied");
    expect(removed.status).toBe(200);
    expect(planIn(removed.body)).toMatchObject({
      status: "discarded",
      appliedAt: planIn(applied.body).appliedAt,
    });
  });
});

describe("the calendar", () => {
  const ranges: [string, string, string][] = [
    ["", "from no days", "Choose the days to show, written as YYYY-MM-DD."],
    [
      "?from=2026-11-01",
      "from no last day",
      "Choose the days to show, written as YYYY-MM-DD.",
    ],
    [
      "?from=2026-11-01&to=2026-11-31",
      "to a day that isn't one",
      "Choose the days to show, written as YYYY-MM-DD.",
    ],
    [
      "?from=2026-11-07&to=2026-11-01",
      "backwards",
      "Choose a first day that comes before the last one.",
    ],
    [
      "?from=2026-11-01&to=2026-11-15",
      "over two weeks",
      "Show at most 14 days at a time.",
    ],
  ];
  for (const [query, name, error] of ranges)
    test(`is refused ${name}`, async () => {
      const { send, google } = setUp();
      expect(await send("GET", `/calendar${query}`)).toEqual({
        status: 400,
        body: { error },
      });
      expect(google.state.calls).toEqual([]);
    });

  test("shows two weeks, a day at a time", async () => {
    const { send, google } = setUp();
    const shown = await send("GET", "/calendar?from=2026-11-01&to=2026-11-14");
    expect(shown.status).toBe(200);
    expect(google.state.calls).toHaveLength(14);
  });

  test("is the week's events, deadlines with the help level the rules resolve, and the applied blocks", async () => {
    const { propose, send, rules } = setUp();
    const id = await propose();
    const applied = (await send("POST", `/plans/${id}/apply`)).body
      .plan as StudyPlan;
    // A stricter rule for Precalculus, set on the Teacher rules screen, beats the notices' Full help.
    await rules.change(
      "jordan",
      { classes: { precalc4: "hints" } },
      { canLoosen: false, snapshot: demoSnapshot(), now: NOW },
    );
    const { status, body } = await send(
      "GET",
      "/calendar?from=2026-11-01&to=2026-11-07",
    );
    expect(status).toBe(200);
    const calendar = body.calendar as CalendarView;
    expect(calendar).toMatchObject({
      timeZone: TZ,
      today: TODAY,
      nowMinute: 14 * 60 + 10,
      from: "2026-11-01",
      to: "2026-11-07",
      classes: demoSnapshot().classes,
      couldNotRead: [],
    });
    const perDay = (date: string) =>
      calendar.events.filter((event) => event.date === date).length;
    expect(
      [
        "2026-11-03",
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
        "2026-11-07",
      ].map(perDay),
    ).toEqual([8, 10, 8, 8, 0]);
    expect(
      calendar.events.find((event) => event.id === "period1apush20261104"),
    ).toEqual({
      id: "period1apush20261104",
      title: "AP US History (Mr. Grant)",
      date: TODAY,
      start: "08:00",
      end: "08:50",
      classId: "apush1",
    });
    expect(calendar.allDay).toEqual([
      { id: "chemlabdue", title: "Chem lab report due", date: "2026-11-05" },
      {
        id: "precalcquiz",
        title: "Precalc quiz: Unit 4 trig identities",
        date: "2026-11-05",
      },
      { id: "apushdbq", title: "APUSH DBQ essay due", date: "2026-11-06" },
    ]);
    expect(calendar.blocks).toEqual(applied.blocks);
    expect(calendar.deadlines).toEqual([
      {
        assignmentId: "precalc4-hw43",
        classId: "precalc4",
        title: "Section 4.3 homework",
        date: "2026-11-03",
        time: "23:59",
        kind: "assignment",
        help: "hints",
      },
      {
        assignmentId: "precalc4-quiz4",
        classId: "precalc4",
        title: "Unit 4 quiz: Trig identities",
        date: "2026-11-05",
        time: "10:45",
        kind: "quiz",
        help: "hints",
      },
      {
        assignmentId: "chem2-lab6",
        classId: "chem2",
        title: "Lab 6 report: Reaction Rates",
        date: "2026-11-05",
        time: "23:59",
        kind: "assignment",
        help: "hints",
      },
      {
        assignmentId: "apush1-dbq3",
        classId: "apush1",
        title: "DBQ essay: Causes of the Civil War",
        date: "2026-11-06",
        time: "08:00",
        kind: "assignment",
        help: "none",
      },
      {
        assignmentId: "spanish5-u5test",
        classId: "spanish5",
        title: "Unidad 5 vocab test: La comida y la salud",
        date: "2026-11-07",
        time: "12:20",
        kind: "test",
        help: "full",
      },
    ]);
  });

  test("leaves out applied blocks on days it wasn't asked for, and proposed plans altogether", async () => {
    const { propose, send } = setUp();
    const id = await propose();
    await propose({ minutes: 60, days: 2, reason: "Tomorrow too." });
    expect((await send("POST", `/plans/${id}/apply`)).status).toBe(200);
    const tomorrow = (
      await send("GET", "/calendar?from=2026-11-05&to=2026-11-06")
    ).body.calendar as CalendarView;
    expect(tomorrow.blocks).toEqual([]);
    const today = (await send("GET", "/calendar?from=2026-11-04&to=2026-11-04"))
      .body.calendar as CalendarView;
    expect(today.blocks).toHaveLength(4);
  });

  test("still shows the calendar when the classes can't be read, and says why", async () => {
    const { send, reading, google } = setUp();
    const why =
      "Gmail isn't connected, so your classes couldn't be read. Connect Google on the Connections page.";
    reading.read = { snapshot: null, why };
    const { status, body } = await send(
      "GET",
      "/calendar?from=2026-11-04&to=2026-11-04",
    );
    expect(status).toBe(200);
    const calendar = body.calendar as CalendarView;
    expect(calendar).toMatchObject({
      timeZone: TZ,
      classes: [],
      deadlines: [],
      couldNotRead: [why],
    });
    expect(calendar.events).toHaveLength(10);
    // With no snapshot to say where the student is, the calendar is asked its zone first.
    expect(google.state.calls[0]).toEqual({ maxResults: 1 });
  });

  test("answers behind the real study routes", async () => {
    const { deps } = setUp();
    const app = new Hono().route(
      PATH,
      createStudyRoutes(deps, signedIn("jordan")),
    );
    const response = await app.request(
      `${PATH}/calendar?from=2026-11-04&to=2026-11-04`,
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { calendar: CalendarView }).calendar.today,
    ).toBe(TODAY);
    expect((await app.request(`${PATH}/plans`)).status).toBe(404);
  });
});
