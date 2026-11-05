import { describe, expect, spyOn, test } from "bun:test";
import type {
  PlanToolResult,
  SchoolAssignment,
  SchoolSnapshot,
  StudyPlan,
} from "@openbot/shared/study";
import { z } from "zod";
import { CALENDAR_LIST, type CallTool } from "../src/openduet/brief";
import type {
  SchoolRead,
  SchoolService,
  StudyContext,
  StudyRecord,
  StudyStore,
  StudyToolDeps,
} from "../src/openduet/study/contracts";
import { guardTeacherRules } from "../src/openduet/study/guard";
import { createMemoryStudyStore } from "../src/openduet/study/memory-store";
import { PLAN_TOOL_REF, planTools } from "../src/openduet/study/plan-tools";
import {
  busyFrom,
  isStale,
  planData,
  planFromRecord,
  resolvePriority,
  tasksFrom,
} from "../src/openduet/study/plans";
import { createRulesService } from "../src/openduet/study/rules";
import {
  addDays,
  weekdayOf,
  zonedInstant,
  zonedParts,
} from "../src/openduet/study/time";

/*
 * propose_study_plan on the demo student's Wednesday: their open work from the Classroom notices,
 * planned around their classes, soccer and debate prep, with the missing homework as late catch-up,
 * saved as a plan waiting for Apply, and answered in a few small numbers. Then the refusals, and the
 * glue (plans.ts) it is made of.
 */

const TZ = "America/Chicago";
const TODAY = "2026-11-04"; // a Wednesday
/** 2:10 PM in Chicago, school just out. */
const NOW = zonedInstant(TODAY, "14:10", TZ);
const CONTEXT: StudyContext = {
  actorId: "jordan",
  botId: "academic-os",
  initiator: { kind: "person" },
};

/* ------------------------------------------------------------------------------------------------
 * The demo student, as scripts/fake-google seeds them
 * ---------------------------------------------------------------------------------------------- */

function work(
  id: string,
  classId: string,
  title: string,
  kind: SchoolAssignment["kind"],
  status: SchoolAssignment["status"],
  due: [offset: number, time: string] | null,
  help: SchoolAssignment["help"],
  minutes: number,
): SchoolAssignment {
  const dueDate = due ? addDays(TODAY, due[0]) : null;
  return {
    id,
    classId,
    title,
    kind,
    status,
    due:
      due && dueDate ? zonedInstant(dueDate, due[1], TZ).toISOString() : null,
    dueDate,
    dueTime: due ? due[1] : null,
    points: null,
    grade: status === "returned" ? "34/40" : null,
    help,
    minutes,
    link: null,
    noticeId: `notice-${id}`,
  };
}

function demoSnapshot(): SchoolSnapshot {
  return {
    syncedAt: NOW.toISOString(),
    timeZone: TZ,
    classes: [
      ["apush1", "AP US History", "Mr. Grant", "sky"],
      ["chem2", "Chemistry", "Dr. Okoro", "violet"],
      ["eng11", "English 11", "Ms. Alvarez", "teal"],
      ["precalc4", "Precalculus", "Mr. Chen", "amber"],
      ["spanish5", "Spanish III", "Sra. Morales", "rose"],
    ].map(([id, name, teacher, color], index) => ({
      id: id as string,
      name: name as string,
      teacher: teacher as string,
      period: `Period ${index + 1}`,
      color: color as "sky",
    })),
    assignments: [
      work(
        "precalc4-hw43",
        "precalc4",
        "Section 4.3 homework",
        "assignment",
        "missing",
        [-1, "23:59"],
        "full",
        45,
      ),
      work(
        "precalc4-quiz4",
        "precalc4",
        "Unit 4 quiz: Trig identities",
        "quiz",
        "open",
        [1, "10:45"],
        "full",
        60,
      ),
      work(
        "chem2-lab6",
        "chem2",
        "Lab 6 report: Reaction Rates",
        "assignment",
        "open",
        [1, "23:59"],
        "hints",
        90,
      ),
      work(
        "apush1-dbq3",
        "apush1",
        "DBQ essay: Causes of the Civil War",
        "assignment",
        "open",
        [2, "08:00"],
        "none",
        120,
      ),
      work(
        "spanish5-u5test",
        "spanish5",
        "Unidad 5 vocab test: La comida y la salud",
        "test",
        "open",
        [3, "12:20"],
        "full",
        60,
      ),
      work(
        "eng11-gatsby",
        "eng11",
        "The Great Gatsby analytical essay",
        "assignment",
        "open",
        [6, "23:59"],
        "hints",
        150,
      ),
      work(
        "apush1-dbqdocs",
        "apush1",
        "DBQ documents and rubric",
        "material",
        "open",
        null,
        "none",
        0,
      ),
      work(
        "chem2-lab5",
        "chem2",
        "Lab 5 report: Concentration and Rate",
        "assignment",
        "returned",
        null,
        null,
        90,
      ),
    ],
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

/** The school service, answering with what it is given. */
function schoolWith(read: SchoolRead): SchoolService & { asked: number } {
  const school = {
    asked: 0,
    async current(context: StudyContext) {
      school.asked++;
      expect(context).toEqual(CONTEXT);
      return read;
    },
    async stored() {
      return read.snapshot;
    },
  };
  return school;
}

function setUp(
  options: {
    read?: SchoolRead;
    seeds?: Seed[];
    store?: StudyStore;
    now?: Date;
  } = {},
) {
  const now = options.now ?? NOW;
  const store = options.store ?? createMemoryStudyStore({ now: () => now });
  const google = calendarAdapter(options.seeds ?? demoWeek());
  const school = schoolWith(
    options.read ?? { snapshot: demoSnapshot(), why: null },
  );
  const deps: StudyToolDeps = {
    ...CONTEXT,
    store,
    school,
    rules: createRulesService({ store, now: () => now }),
    callTool: google.callTool,
    now: () => now,
  };
  const [tool] = planTools(deps);
  if (!tool) throw new Error("no plan tool");
  return { tool, store, google, school, deps };
}

/** The card's own fields, plus the first day planned, which only the model reads. */
const toolResultSchema = z
  .object({
    kind: z.literal("plan"),
    id: z.string(),
    startDate: z.string(),
    blocks: z.number(),
    totalMinutes: z.number(),
    remainingMinutes: z.number(),
    warnings: z.array(z.string()),
  })
  .strict() satisfies z.ZodType<PlanToolResult>;

async function proposed(store: StudyStore, id: string): Promise<StudyPlan> {
  const record = await store.get("jordan", "plan", id);
  if (!record) throw new Error(`no plan ${id}`);
  return planFromRecord(record);
}

const times = (plan: StudyPlan) =>
  plan.blocks.map(
    (block) =>
      `${block.date} ${block.start}-${block.end} ${block.assignmentId}${block.late ? " late" : ""}`,
  );

const LATE_HOMEWORK =
  "Precalculus: Section 4.3 homework is scheduled after its deadline (Tue, Nov\u00a03\u00a0at\u00a011:59\u00a0PM). The deadline has not changed.";

/** What every refusal about a day adds on the demo Wednesday: the model has no clock. */
const TODAY_IS = "Today is Wed, Nov 4 (2026-11-04).";

describe("propose_study_plan", () => {
  test("is held as the plan tool, with minutes and a reason required", () => {
    const { tool } = setUp();
    expect(tool.name).toBe("propose_study_plan");
    expect(tool.ref).toBe(PLAN_TOOL_REF);
    expect(PLAN_TOOL_REF).toBe("openduet/propose_study_plan");
    expect(tool.initiator).toEqual({ kind: "person" });
    const schema = z.toJSONSchema(tool.parameters) as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required?.sort()).toEqual(["minutes", "reason"]);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "days",
      "endTime",
      "minutes",
      "priority",
      "reason",
      "startDate",
      "startDay",
      "startInDays",
      "startTime",
    ]);
    // What the model is told: the card lists the sessions, and nothing is on the calendar yet.
    expect(tool.description).toContain("never list the sessions");
    expect(tool.description).toContain("until they press Apply");
    // And how to name a later day without knowing the date.
    expect(tool.description).toContain("startInDays (1 for tomorrow)");
    expect(tool.description).toContain(
      "startDay by name (tomorrow, or a weekday such as saturday)",
    );
  });

  test("plans the demo Wednesday around classes, soccer and debate, the missing homework first and late", async () => {
    const { tool, store, google } = setUp();
    const text = await tool.execute({
      minutes: 150,
      reason: "The precalc quiz and the chem lab are due tomorrow.",
    });
    const result = toolResultSchema.parse(JSON.parse(text));
    expect(result).toEqual({
      kind: "plan",
      id: result.id,
      startDate: TODAY,
      blocks: 4,
      totalMinutes: 150,
      // What did not fit: the rest of the lab, the DBQ, the Spanish test and the essay.
      remainingMinutes: 45 + 120 + 60 + 150,
      warnings: [LATE_HOMEWORK],
    });
    // Small, and never the sessions themselves: the card reads those by id.
    expect(text.length).toBeLessThan(400);
    expect(text).not.toContain("17:40");

    const plan = await proposed(store, result.id);
    expect(times(plan)).toEqual([
      // Soccer runs to 5:30, and ten minutes to get home from practice.
      "2026-11-04 17:40-18:25 precalc4-hw43 late",
      // Up to debate prep's buffer at 7:20, and on after it at 8:25.
      "2026-11-04 18:35-19:20 precalc4-quiz4",
      "2026-11-04 20:25-20:40 precalc4-quiz4",
      "2026-11-04 20:50-21:35 chem2-lab6",
    ]);
    expect(plan.blocks[0]).toEqual({
      id: plan.blocks[0]?.id,
      assignmentId: "precalc4-hw43",
      classId: "precalc4",
      title: "Precalculus: Section 4.3 homework",
      date: "2026-11-04",
      start: "17:40",
      end: "18:25",
      late: true,
    });
    expect(plan).toMatchObject({
      status: "proposed",
      reason: "The precalc quiz and the chem lab are due tomorrow.",
      timeZone: TZ,
      startDate: TODAY,
      days: 1,
      totalMinutes: 150,
      createdAt: NOW.toISOString(),
      appliedAt: null,
      stale: false,
      remaining: [
        {
          assignmentId: "chem2-lab6",
          title: "Chemistry: Lab 6 report: Reaction Rates",
          minutes: 45,
          due: "2026-11-05",
        },
        {
          assignmentId: "apush1-dbq3",
          title: "AP US History: DBQ essay: Causes of the Civil War",
          minutes: 120,
          due: "2026-11-06",
        },
        {
          assignmentId: "spanish5-u5test",
          title: "Spanish III: Unidad 5 vocab test: La comida y la salud",
          minutes: 60,
          due: "2026-11-07",
        },
        {
          assignmentId: "eng11-gatsby",
          title: "English 11: The Great Gatsby analytical essay",
          minutes: 150,
          due: "2026-11-10",
        },
      ],
    });
    // The record carries the span of its blocks, so the calendar can ask for a range.
    const record = await store.get("jordan", "plan", result.id);
    expect(record).toMatchObject({
      kind: "plan",
      status: "proposed",
      botId: "academic-os",
      startsAt: zonedInstant(TODAY, "17:40", TZ),
      endsAt: zonedInstant(TODAY, "21:35", TZ),
    });
    expect(record?.data).not.toHaveProperty("stale");
    // One day asked for, from its midnight to the next.
    expect(google.state.calls).toEqual([
      {
        timeMin: zonedInstant(TODAY, "00:00", TZ).toISOString(),
        timeMax: zonedInstant(TODAY, "24:00", TZ).toISOString(),
        maxResults: 50,
      },
    ]);
  });

  test("puts first what the student names, by title or by a short form of it", async () => {
    const { tool, store } = setUp();
    const result = toolResultSchema.parse(
      JSON.parse(
        await tool.execute({
          minutes: 150,
          priority: ["chem lab report"],
          reason: "The lab first, as you asked.",
        }),
      ),
    );
    expect(times(await proposed(store, result.id))).toEqual([
      "2026-11-04 17:40-18:25 chem2-lab6",
      "2026-11-04 18:35-19:20 chem2-lab6",
      "2026-11-04 20:25-21:10 precalc4-hw43 late",
      "2026-11-04 21:20-21:35 precalc4-quiz4",
    ]);
  });

  test("plans a No help assignment like any other: a teacher's rule never pauses planning", async () => {
    const { tool, store, deps } = setUp();
    const [guarded] = guardTeacherRules([tool], deps);
    // Returned as it came: only make_quiz and make_flashcards meet the rule.
    expect(guarded).toBe(tool);
    const result = toolResultSchema.parse(
      JSON.parse(
        await tool.execute({
          minutes: 60,
          priority: ["DBQ essay"],
          reason: "Your DBQ is due Friday morning.",
        }),
      ),
    );
    const plan = await proposed(store, result.id);
    expect(
      plan.blocks.every((block) => block.assignmentId === "apush1-dbq3"),
    ).toBe(true);
    expect(plan.totalMinutes).toBe(60);
  });

  test("several days stay clear of each day's classes and practice, and of a quiz already taken", async () => {
    const { tool, store, google } = setUp();
    const result = toolResultSchema.parse(
      JSON.parse(
        await tool.execute({
          minutes: 360,
          days: 2,
          reason: "Tonight and tomorrow.",
        }),
      ),
    );
    const plan = await proposed(store, result.id);
    const thursday = plan.blocks.filter((block) => block.date === "2026-11-05");
    expect(thursday.length).toBeGreaterThan(0);
    // Thursday's soccer ends at 5:30; nothing is planned before ten minutes after.
    expect(thursday.every((block) => block.start >= "17:40")).toBe(true);
    // The quiz is at 10:45 Thursday, in class: no study for it is planned after that.
    expect(
      thursday.some((block) => block.assignmentId === "precalc4-quiz4"),
    ).toBe(false);
    expect(google.state.calls).toHaveLength(2);
  });

  test("applied study time is left alone and counts toward its assignment", async () => {
    const { tool, store } = setUp();
    const first = toolResultSchema.parse(
      JSON.parse(await tool.execute({ minutes: 45, reason: "The homework." })),
    );
    // Applied, as the route does it.
    await store.update("jordan", "plan", first.id, (current) => ({
      status: "applied",
      data: {
        ...current.data,
        status: "applied",
        appliedAt: NOW.toISOString(),
      },
    }));
    const second = toolResultSchema.parse(
      JSON.parse(await tool.execute({ minutes: 60, reason: "More tonight." })),
    );
    expect(times(await proposed(store, second.id))).toEqual([
      // The homework is planned already, 5:40 to 6:25, and keeps its ten minutes of rest.
      "2026-11-04 18:35-19:20 precalc4-quiz4",
      "2026-11-04 20:25-20:40 precalc4-quiz4",
    ]);
  });

  test("models' blank arguments read as left out", async () => {
    const { tool } = setUp();
    const result = toolResultSchema.safeParse(
      JSON.parse(
        await tool.execute({
          minutes: 60,
          reason: "Tonight.",
          startTime: null,
          startDate: "",
          startInDays: null,
          priority: null,
          days: null,
        }),
      ),
    );
    expect(result.success).toBe(true);
    expect(result.data?.startDate).toBe(TODAY);
  });

  test("startInDays names a later day counted from the student's today, and wins over startDate", async () => {
    const { tool, store, google } = setUp();
    const tomorrow = toolResultSchema.parse(
      JSON.parse(
        await tool.execute({
          minutes: 45,
          startInDays: 1,
          // A date the model guessed: the day it counted from today is the one planned.
          startDate: "2026-11-20",
          reason: "Tomorrow after practice.",
        }),
      ),
    );
    expect(tomorrow.startDate).toBe("2026-11-05");
    const plan = await proposed(store, tomorrow.id);
    expect(plan.startDate).toBe("2026-11-05");
    expect(plan.blocks.length).toBeGreaterThan(0);
    expect(plan.blocks.every((block) => block.date === "2026-11-05")).toBe(
      true,
    );
    expect(google.state.calls).toEqual([
      {
        timeMin: zonedInstant("2026-11-05", "00:00", TZ).toISOString(),
        timeMax: zonedInstant("2026-11-05", "24:00", TZ).toISOString(),
        maxResults: 50,
      },
    ]);
  });

  test("startDay names a day the model can't count to: tomorrow, the next Saturday, or today's own weekday", async () => {
    // TODAY is Wednesday 2026-11-04 in Chicago.
    const firstDay = async (args: Record<string, unknown>) =>
      toolResultSchema.parse(
        JSON.parse(
          await setUp().tool.execute({
            minutes: 45,
            reason: "When they asked.",
            ...args,
          }),
        ),
      ).startDate;
    expect(await firstDay({ startDay: "today" })).toBe("2026-11-04");
    expect(await firstDay({ startDay: "tomorrow" })).toBe("2026-11-05");
    expect(await firstDay({ startDay: "saturday" })).toBe("2026-11-07");
    expect(await firstDay({ startDay: "wednesday" })).toBe("2026-11-04");
    expect(await firstDay({ startDay: "tuesday" })).toBe("2026-11-10");
    // A name counts over a count and a date the model also gave.
    expect(
      await firstDay({
        startDay: "friday",
        startInDays: 1,
        startDate: "2026-11-20",
      }),
    ).toBe("2026-11-06");
    expect(
      await setUp().tool.execute({
        minutes: 45,
        startDay: "someday",
        reason: "Later.",
      }),
    ).toBe(
      `Refused. Give startDay as today, tomorrow, or a weekday in lower case, such as saturday. ${TODAY_IS} Fix it and call propose_study_plan again.`,
    );
  });

  test("today is the student's own: at 11:30 PM in Chicago it is still Wednesday there", async () => {
    // Already Thursday in UTC.
    const late = zonedInstant(TODAY, "23:30", TZ);
    const { tool } = setUp({ now: late });
    const result = toolResultSchema.parse(
      JSON.parse(
        await tool.execute({ minutes: 60, startInDays: 0, reason: "Tonight." }),
      ),
    );
    expect(result.startDate).toBe(TODAY);
    expect(
      await tool.execute({
        minutes: 60,
        startDate: "2026-11-03",
        reason: "Tonight.",
      }),
    ).toBe(
      `Refused. Choose today or a later date to plan. ${TODAY_IS} Fix it and call propose_study_plan again.`,
    );
  });

  test("a quiz whose time has passed is not planned: it was taken in class", async () => {
    // Thursday at 3 PM, after the 10:45 Precalculus quiz. Its notice still says it is open.
    const thursday = zonedInstant("2026-11-05", "15:00", TZ);
    const { tool, store } = setUp({ now: thursday });
    const result = toolResultSchema.parse(
      JSON.parse(await tool.execute({ minutes: 180, reason: "Tonight." })),
    );
    const plan = await proposed(store, result.id);
    expect(plan.blocks.length).toBeGreaterThan(0);
    expect(
      plan.blocks.some((block) => block.assignmentId === "precalc4-quiz4"),
    ).toBe(false);
    expect(
      plan.remaining.some((item) => item.assignmentId === "precalc4-quiz4"),
    ).toBe(false);
    // Late homework can still be handed in, so it is still caught up, and is the only late work.
    expect(plan.blocks[0]).toMatchObject({
      assignmentId: "precalc4-hw43",
      late: true,
    });
    expect(result.warnings).toEqual([LATE_HOMEWORK]);
    // Nor can it be put first: it is no longer open work.
    expect(
      await tool.execute({
        minutes: 60,
        priority: ["Unit 4 quiz"],
        reason: "The quiz.",
      }),
    ).toStartWith(
      `Refused. "Unit 4 quiz" isn't one of the student's open assignments. Use one of: "Precalculus: Section 4.3 homework", "Chemistry: Lab 6 report: Reaction Rates",`,
    );
  });

  test("a calendar it couldn't read still gives a plan, with a warning that says why", async () => {
    const { tool, store, google } = setUp();
    google.state.fail =
      "Google Calendar refused this request (503): Backend Error.";
    const result = toolResultSchema.parse(
      JSON.parse(await tool.execute({ minutes: 45, reason: "Tonight." })),
    );
    expect(result.warnings).toEqual([
      LATE_HOMEWORK,
      "Your calendar couldn't be read from Google Calendar. Google Calendar refused this request (503): Backend Error.",
    ]);
    expect((await proposed(store, result.id)).warnings).toEqual(
      result.warnings,
    );
  });

  test("classes read from an older copy say so in the warnings", async () => {
    const why =
      "Gmail isn't connected, so your classes couldn't be read. Connect Google on the Connections page.";
    const { tool } = setUp({ read: { snapshot: demoSnapshot(), why } });
    const result = toolResultSchema.parse(
      JSON.parse(await tool.execute({ minutes: 45, reason: "Tonight." })),
    );
    expect(result.warnings).toContain(
      `Your assignments may be out of date. ${why}`,
    );
  });

  describe("refuses, saying what to fix", () => {
    test("with no classes to plan from, and reads nothing else", async () => {
      const why =
        "Gmail isn't connected, so your classes couldn't be read. Connect Google on the Connections page.";
      const { tool, store, google } = setUp({ read: { snapshot: null, why } });
      const text = await tool.execute({ minutes: 60, reason: "Tonight." });
      expect(text).toBe(
        `Refused. ${why} A plan is made from their classes, so tell the student in one sentence and don't call propose_study_plan again until that's fixed.`,
      );
      expect(google.state.calls).toEqual([]);
      expect(await store.list("jordan", "plan")).toEqual([]);
    });

    test("a priority that names no open assignment, listing the ones it could", async () => {
      const { tool, store, google } = setUp();
      const text = await tool.execute({
        minutes: 60,
        priority: ["Biology lab"],
        reason: "Tonight.",
      });
      expect(text).toStartWith(
        `Refused. "Biology lab" isn't one of the student's open assignments. Use one of: "Precalculus: Section 4.3 homework", "Precalculus: Unit 4 quiz: Trig identities", "Chemistry: Lab 6 report: Reaction Rates",`,
      );
      expect(text).toEndWith("Fix it and call propose_study_plan again.");
      // Returned and material work is not open work.
      expect(text).not.toContain("Lab 5");
      expect(text).not.toContain("DBQ documents");
      expect(google.state.calls).toEqual([]);
      expect(await store.list("jordan", "plan")).toEqual([]);
    });

    const minutes =
      "Refused. Ask for between 15 and 600 minutes of study, as a whole number. Fix it and call propose_study_plan again.";
    const cases: [string, Record<string, unknown>, string][] = [
      ["too few minutes", { minutes: 5 }, minutes],
      ["too many minutes", { minutes: 601 }, minutes],
      ["part of a minute", { minutes: 90.5 }, minutes],
      ["minutes in words", { minutes: "ninety" }, minutes],
      ["no minutes", { minutes: undefined }, minutes],
      [
        "a start time in words",
        { startTime: "4pm" },
        "Refused. Write startTime as HH:mm, such as 15:30. Fix it and call propose_study_plan again.",
      ],
      [
        "eight days",
        { days: 8 },
        "Refused. Plan between 1 and 7 days at a time. Fix it and call propose_study_plan again.",
      ],
      [
        "nine priorities",
        { priority: Array.from({ length: 9 }, (_, index) => `Task ${index}`) },
        "Refused. Name at most 8 assignments to do first, each by its title, or leave priority out. Fix it and call propose_study_plan again.",
      ],
      [
        "no reason",
        { reason: undefined },
        "Refused. Give a reason of one short sentence, under 300 characters. Fix it and call propose_study_plan again.",
      ],
      // Every refusal about a day says what today is, and an example is a real day from it.
      [
        "a day already gone",
        { startDate: "2026-11-03" },
        `Refused. Choose today or a later date to plan. ${TODAY_IS} Fix it and call propose_study_plan again.`,
      ],
      [
        "a day that isn't one",
        { startDate: "2026-02-30" },
        `Refused. Choose a real date to plan, written as YYYY-MM-DD. ${TODAY_IS} Fix it and call propose_study_plan again.`,
      ],
      [
        "a day too far ahead",
        { startDate: "2026-12-25" },
        `Refused. Plan within the next 30 days. ${TODAY_IS} Fix it and call propose_study_plan again.`,
      ],
      [
        "a day in words",
        { startDate: "tomorrow" },
        `Refused. Write startDate as YYYY-MM-DD, such as 2026-11-05, or give startInDays instead. ${TODAY_IS} Fix it and call propose_study_plan again.`,
      ],
      ...([-1, 31, 1.5, "1"] as const).map(
        (startInDays): [string, Record<string, unknown>, string] => [
          `startInDays ${JSON.stringify(startInDays)}`,
          { startInDays },
          `Refused. Give startInDays as a whole number of days from today, 0 to 30: 0 for today, 1 for tomorrow. ${TODAY_IS} Fix it and call propose_study_plan again.`,
        ],
      ),
      [
        "an end before the start",
        { startTime: "20:00", endTime: "19:00" },
        "Refused. Choose an end time later than the start time. Fix it and call propose_study_plan again.",
      ],
    ];
    for (const [name, change, refusal] of cases)
      test(name, async () => {
        const { tool, store, google } = setUp();
        const args: Record<string, unknown> = {
          minutes: 60,
          reason: "Tonight.",
          ...change,
        };
        for (const [key, value] of Object.entries(args))
          if (value === undefined) delete args[key];
        expect(await tool.execute(args)).toBe(refusal);
        // A request the planner refuses costs no calendar reads and saves nothing.
        expect(google.state.calls).toEqual([]);
        expect(await store.list("jordan", "plan")).toEqual([]);
      });

    test("when its study data fails, in words, and logs it", async () => {
      const store = createMemoryStudyStore({ now: () => NOW });
      const broken: StudyStore = {
        ...store,
        put: async () => {
          throw new Error("connection reset");
        },
      };
      const { tool } = setUp({ store: broken });
      const quiet = spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(await tool.execute({ minutes: 60, reason: "Tonight." })).toBe(
          "Refused. The plan couldn't be made just now. Tell the student in one sentence and offer to try again.",
        );
        expect(JSON.parse(String(quiet.mock.calls[0]?.[0]))).toMatchObject({
          type: "openduet-study-plan-failed",
          tool: "propose_study_plan",
          error: "Error",
        });
      } finally {
        quiet.mockRestore();
      }
    });
  });
});

describe("the plan's glue", () => {
  test("tasksFrom: open and missing work with time to spend, titled with its class", () => {
    const snapshot = demoSnapshot();
    snapshot.assignments.push(
      work(
        "chem2-ann",
        "chem2",
        "Lab safety reminder",
        "announcement",
        "open",
        null,
        null,
        10,
      ),
      work(
        "art-sketch",
        "art9",
        "Sketchbook",
        "assignment",
        "open",
        [2, "23:59"],
        null,
        30,
      ),
    );
    expect(
      tasksFrom(snapshot, NOW).map((task) => [
        task.id,
        task.title,
        task.minutes,
      ]),
    ).toEqual([
      ["precalc4-hw43", "Precalculus: Section 4.3 homework", 45],
      ["precalc4-quiz4", "Precalculus: Unit 4 quiz: Trig identities", 60],
      ["chem2-lab6", "Chemistry: Lab 6 report: Reaction Rates", 90],
      ["apush1-dbq3", "AP US History: DBQ essay: Causes of the Civil War", 120],
      [
        "spanish5-u5test",
        "Spanish III: Unidad 5 vocab test: La comida y la salud",
        60,
      ],
      ["eng11-gatsby", "English 11: The Great Gatsby analytical essay", 150],
      // A class the snapshot doesn't list keeps the bare title.
      ["art-sketch", "Sketchbook", 30],
    ]);
    expect(tasksFrom(snapshot, NOW)[1]).toEqual({
      id: "precalc4-quiz4",
      title: "Precalculus: Unit 4 quiz: Trig identities",
      classId: "precalc4",
      due: "2026-11-05",
      dueTime: "10:45",
      minutes: 60,
    });
  });

  test("tasksFrom: a quiz or test is left out from its due time on, late homework is not", () => {
    const snapshot = demoSnapshot();
    const ids = (date: string, time: string) =>
      tasksFrom(snapshot, zonedInstant(date, time, TZ)).map((task) => task.id);
    // A minute before the Precalculus quiz, there is still time to study for it.
    expect(ids("2026-11-05", "10:44")).toContain("precalc4-quiz4");
    // From the moment it starts, it is being taken or has been.
    expect(ids("2026-11-05", "10:45")).not.toContain("precalc4-quiz4");
    // The Spanish test likewise, at 12:20 on Saturday. Work handed in late stays, as catch-up.
    expect(ids("2026-11-07", "12:20")).toEqual([
      "precalc4-hw43",
      "chem2-lab6",
      "apush1-dbq3",
      "eng11-gatsby",
    ]);
  });

  test("busyFrom: events are commitments, applied blocks are study for their assignment", () => {
    expect(
      busyFrom(
        [
          {
            id: "soccer",
            title: "Soccer practice",
            date: TODAY,
            start: "15:30",
            end: "17:30",
          },
        ],
        [
          {
            blocks: [
              {
                id: "b1",
                assignmentId: "chem2-lab6",
                classId: "chem2",
                title: "Chemistry: Lab 6",
                date: "2026-11-07",
                start: "10:00",
                end: "10:45",
              },
            ],
          },
        ],
      ),
    ).toEqual([
      {
        id: "soccer",
        date: TODAY,
        start: "15:30",
        end: "17:30",
        kind: "commitment",
      },
      {
        id: "b1",
        date: "2026-11-07",
        start: "10:00",
        end: "10:45",
        kind: "study",
        assignmentId: "chem2-lab6",
      },
    ]);
  });

  test("resolvePriority: by id, by title with or without its class, and by a short form", () => {
    const tasks = tasksFrom(demoSnapshot(), NOW);
    const ids = (...names: string[]) => {
      const found = resolvePriority(names, tasks);
      return found.ok ? found.ids : found.reason;
    };
    expect(ids("chem2-lab6")).toEqual(["chem2-lab6"]);
    expect(ids("Lab 6 report: Reaction Rates")).toEqual(["chem2-lab6"]);
    expect(ids("Chemistry: Lab 6 report: Reaction Rates")).toEqual([
      "chem2-lab6",
    ]);
    expect(ids("precalc homework", "gatsby essay")).toEqual([
      "precalc4-hw43",
      "eng11-gatsby",
    ]);
    // A name that fits several puts them all first, soonest due first, each once.
    expect(ids("Precalculus", "precalc4-hw43")).toEqual([
      "precalc4-hw43",
      "precalc4-quiz4",
    ]);
    expect(ids("lab 6", "Unidad 5")).toEqual(["chem2-lab6", "spanish5-u5test"]);
    // Four letters or more can be the start of a word; fewer must be the whole word.
    expect(ids("chem")).toEqual(["chem2-lab6"]);
    expect(ids("pre")).toBe(
      `"pre" isn't one of the student's open assignments. Use one of: "Precalculus: Section 4.3 homework", "Precalculus: Unit 4 quiz: Trig identities", "Chemistry: Lab 6 report: Reaction Rates", "AP US History: DBQ essay: Causes of the Civil War", "Spanish III: Unidad 5 vocab test: La comida y la salud", "English 11: The Great Gatsby analytical essay".`,
    );
    expect(resolvePriority(["anything"], [])).toEqual({
      ok: false,
      reason: `"anything" isn't open: the student has no open assignments to put first, so leave priority out.`,
    });
    expect(resolvePriority([], tasks)).toEqual({ ok: true, ids: [] });
  });

  const plan = (change: Partial<StudyPlan> = {}): StudyPlan => ({
    id: "plan-1",
    status: "proposed",
    reason: "Tonight.",
    timeZone: TZ,
    startDate: TODAY,
    days: 1,
    blocks: [
      {
        id: "b1",
        assignmentId: "chem2-lab6",
        classId: "chem2",
        title: "Chemistry: Lab 6 report: Reaction Rates",
        date: TODAY,
        start: "17:40",
        end: "18:25",
      },
    ],
    remaining: [],
    warnings: [],
    totalMinutes: 45,
    createdAt: NOW.toISOString(),
    appliedAt: null,
    stale: false,
    staleReason: null,
    ...change,
  });

  test("isStale: only a waiting plan, saying why: another landed after it, or its first block started", () => {
    const later = new Date(NOW.getTime() + 60_000).toISOString();
    const earlier = new Date(NOW.getTime() - 60_000).toISOString();
    const other = (appliedAt: string | null) => ({ id: "plan-2", appliedAt });
    expect(isStale(plan(), [], NOW)).toBeNull();
    expect(isStale(plan(), [other(later)], NOW)).toBe("changed");
    // Applied before it was made: the plan tool saw it, so it was planned around.
    expect(isStale(plan(), [other(earlier)], NOW)).toBeNull();
    expect(isStale(plan(), [other(NOW.toISOString())], NOW)).toBeNull();
    expect(
      isStale(plan(), [{ id: "plan-1", appliedAt: later }], NOW),
    ).toBeNull();
    expect(isStale(plan(), [other("not a time")], NOW)).toBe("changed");
    // Its first block has begun: 5:41 PM. At 5:40 exactly it is about to.
    expect(isStale(plan(), [], zonedInstant(TODAY, "17:40", TZ))).toBeNull();
    const started = zonedInstant(TODAY, "17:41", TZ);
    expect(isStale(plan(), [], started)).toBe("started");
    // Both at once: the schedule changing is what it says.
    expect(isStale(plan(), [other(later)], started)).toBe("changed");
    expect(
      isStale(plan({ status: "applied" }), [other(later)], started),
    ).toBeNull();
    expect(isStale(plan({ status: "discarded" }), [], started)).toBeNull();
  });

  test("planFromRecord: the plan as stored, its status from the record, and only a waiting one stale", () => {
    const record = (
      status: string | null,
      data: Record<string, unknown>,
    ): StudyRecord => ({
      id: "plan-1",
      ownerUserId: "jordan",
      botId: "academic-os",
      kind: "plan",
      classId: null,
      refId: null,
      status,
      startsAt: null,
      endsAt: null,
      data,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const stored = JSON.parse(JSON.stringify(planData(plan())));
    expect(stored).not.toHaveProperty("stale");
    expect(stored).not.toHaveProperty("staleReason");
    expect(planFromRecord(record("proposed", stored))).toEqual(plan());
    expect(planFromRecord(record("proposed", stored), "started")).toEqual(
      plan({ stale: true, staleReason: "started" }),
    );
    expect(planFromRecord(record("proposed", stored), "changed")).toEqual(
      plan({ stale: true, staleReason: "changed" }),
    );
    expect(planFromRecord(record("applied", stored), "changed")).toEqual(
      plan({ status: "applied", stale: false, staleReason: null }),
    );
    // A record whose column was never written still has its status in its data.
    expect(planFromRecord(record(null, stored)).status).toBe("proposed");
    expect(() =>
      planFromRecord(record("proposed", { ...stored, blocks: "none" })),
    ).toThrow("A saved study plan couldn't be read.");
    expect(() =>
      planFromRecord(
        record("proposed", { ...stored, timeZone: "Mars/Olympus" }),
      ),
    ).toThrow("A saved study plan couldn't be read.");
  });
});
