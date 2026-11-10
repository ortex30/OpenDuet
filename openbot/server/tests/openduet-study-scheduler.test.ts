import { describe, expect, test } from "bun:test";
import type { StudyBlock } from "@openbot/shared/study";
import { StudyInputError } from "../src/openduet/study/contracts";
import {
  type BusyEvent,
  checkApply,
  DEFAULT_CLASS_BUFFER_MIN,
  type DayWindow,
  defaultAvailability,
  makePlan,
  PlanDateError,
  type PlanInput,
  type PlanTask,
} from "../src/openduet/study/scheduler";

const PASSED =
  "This plan includes a time that has already passed. Ask for a fresh plan.";
const CONFLICT =
  "Something new is on your calendar at that time. Ask for a fresh plan.";

/** Block ids b1, b2, ... in the order the planner asks for them. */
function counter(): { newId(): string } {
  let count = 0;
  return { newId: () => `b${++count}` };
}

function minuteOf(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function lengthOf(block: StudyBlock): number {
  return minuteOf(block.end) - minuteOf(block.start);
}

/** One line per block, so a test can state a whole plan at a glance. */
function timetable(blocks: StudyBlock[]): string[] {
  return blocks.map(
    (block) =>
      `${block.date} ${block.start}-${block.end} ${block.assignmentId}${block.late ? " late" : ""}`,
  );
}

function task(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: id,
    classId: null,
    due: null,
    dueTime: null,
    minutes: 30,
    ...overrides,
  };
}

function every(hours: Partial<DayWindow> = {}): () => DayWindow {
  const day: DayWindow = {
    enabled: true,
    start: "17:00",
    end: "23:00",
    cap: 180,
    focus: 45,
    rest: 10,
    ...hours,
  };
  return () => ({ ...day });
}

/** Wednesday 2026-10-07, asked at 00:30: free 17:00 to 23:00, 180 minutes a day, 45-minute focus. */
function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    today: "2026-10-07",
    nowMinute: 30,
    tasks: [],
    busy: [],
    availability: every(),
    classBufferMin: DEFAULT_CLASS_BUFFER_MIN,
    minutes: 600,
    ...overrides,
  };
}

function commitment(
  id: string,
  date: string,
  start: string,
  end: string,
): BusyEvent {
  return { id, date, start, end, kind: "commitment" };
}

/** A plan's blocks as they sit on the calendar once applied. */
function applied(blocks: StudyBlock[]): BusyEvent[] {
  return blocks.map((block) => ({
    id: block.id,
    date: block.date,
    start: block.start,
    end: block.end,
    kind: "study",
    assignmentId: block.assignmentId,
  }));
}

function overlaps(block: StudyBlock, event: BusyEvent): boolean {
  return (
    block.date === event.date &&
    minuteOf(block.start) < minuteOf(event.end) &&
    minuteOf(event.start) < minuteOf(block.end)
  );
}

/** profile.test.mjs's student: free 07:30 to 23:00, 90 minutes a day, 30-minute focus, a class at 9. */
function profileFixture(overrides: Partial<PlanInput> = {}): PlanInput {
  return input({
    nowMinute: 8 * 60,
    tasks: [
      task("reading", {
        title: "Reading",
        classId: "english",
        due: "2026-10-07",
        dueTime: "10:00",
        minutes: 60,
      }),
      task("math", {
        title: "Math",
        classId: "math",
        due: "2026-10-09",
        dueTime: "09:00",
        minutes: 120,
      }),
    ],
    busy: [commitment("class", "2026-10-07", "09:00", "10:00")],
    availability: every({ start: "07:30", cap: 90, focus: 30, rest: 10 }),
    minutes: 180,
    startTime: "07:30",
    startDate: "2026-10-07",
    days: 3,
    ...overrides,
  });
}

/** domain.test.mjs's sample student on Tuesday 2026-10-06: practice until 18:00, dinner at 19:00. */
function sampleFixture(overrides: Partial<PlanInput> = {}): PlanInput {
  return input({
    today: "2026-10-06",
    nowMinute: 12 * 60,
    tasks: [
      task("p-quiz", {
        title: "Prepare for the heat transfer quiz",
        classId: "physics",
        due: "2026-10-07",
        minutes: 30,
      }),
      task("p-lab", {
        title: "Finish the calorimetry lab reflection",
        classId: "physics",
        due: "2026-10-07",
        minutes: 25,
      }),
      task("e-read", {
        title: "Read Chapter 8 and collect two passages",
        classId: "english",
        due: "2026-10-07",
        minutes: 35,
      }),
      task("l-vocab", {
        title: "Review participles and vocabulary",
        classId: "latin",
        due: "2026-10-08",
        minutes: 20,
      }),
      task("e-outline", {
        title: "Outline the symbolism paragraph",
        classId: "english",
        due: "2026-10-09",
        minutes: 25,
      }),
      task("sat", {
        title: "Practice linear equations",
        classId: "test-prep",
        due: "2026-10-11",
        minutes: 15,
      }),
    ],
    busy: [
      commitment("practice", "2026-10-06", "16:00", "18:00"),
      commitment("dinner", "2026-10-06", "19:00", "19:30"),
    ],
    availability: every({
      start: "18:00",
      end: "22:00",
      cap: 480,
      focus: 30,
      rest: 5,
    }),
    minutes: 90,
    startTime: "18:00",
    ...overrides,
  });
}

describe("makePlan: the prototype's personal planner", () => {
  test("respects now, a precise deadline, classes, rests and the daily cap", () => {
    const plan = makePlan(profileFixture(), counter());
    expect(timetable(plan.blocks)).toEqual([
      "2026-10-07 08:05-08:35 reading",
      "2026-10-07 10:10-10:40 math",
      "2026-10-07 10:50-11:20 math",
      "2026-10-08 07:30-08:00 math",
      "2026-10-08 08:10-08:40 math",
    ]);
    const today = plan.blocks.filter((block) => block.date === "2026-10-07");
    expect(today.every((block) => minuteOf(block.start) >= 8 * 60 + 5)).toBe(
      true,
    );
    expect(
      today.every(
        (block) =>
          minuteOf(block.end) <= 9 * 60 || minuteOf(block.start) >= 10 * 60,
      ),
    ).toBe(true);
    const reading = plan.blocks.filter(
      (block) => block.assignmentId === "reading",
    );
    expect(
      reading.every(
        (block) =>
          block.date === "2026-10-07" && minuteOf(block.end) <= 10 * 60,
      ),
    ).toBe(true);
    // The reading it missed before its 10:00 deadline is reported, not planned afterwards.
    expect(plan.remaining).toEqual([
      {
        assignmentId: "reading",
        title: "Reading",
        minutes: 30,
        due: "2026-10-07",
      },
    ]);
    for (const day of new Set(plan.blocks.map((block) => block.date))) {
      const blocks = plan.blocks.filter((block) => block.date === day);
      expect(
        blocks.reduce((sum, block) => sum + lengthOf(block), 0),
      ).toBeLessThanOrEqual(90);
      for (let index = 1; index < blocks.length; index++)
        expect(
          minuteOf(blocks[index].start) - minuteOf(blocks[index - 1].end),
        ).toBeGreaterThanOrEqual(10);
    }
    expect(plan.totalMinutes).toBe(150);
    expect(plan.warnings).toEqual([]);
  });

  test("keeps a class's buffer clear and never splits a task into scraps", () => {
    const plan = makePlan(profileFixture(), counter());
    for (const block of plan.blocks) {
      expect(lengthOf(block)).toBeGreaterThanOrEqual(15);
      if (block.date === "2026-10-07")
        expect(
          minuteOf(block.end) <= 8 * 60 + 50 ||
            minuteOf(block.start) >= 10 * 60 + 10,
        ).toBe(true);
    }
  });

  test("plans overdue work as catch-up and leaves its deadline alone", () => {
    const fixture = profileFixture({
      tasks: [
        task("old", {
          title: "Late homework",
          due: "2026-10-02",
          dueTime: "09:00",
          minutes: 30,
        }),
      ],
    });
    const plan = makePlan(fixture, counter());
    expect(timetable(plan.blocks)).toEqual(["2026-10-07 08:05-08:35 old late"]);
    expect(plan.blocks.every((block) => block.late === true)).toBe(true);
    expect(plan.warnings).toEqual([
      "Late homework is scheduled after its deadline (Fri, Oct\u00a02\u00a0at\u00a09:00\u00a0AM). The deadline has not changed.",
    ]);
    expect(fixture.tasks[0].due).toBe("2026-10-02");
  });

  test("never treats a day with no study hours as free", () => {
    const plan = makePlan(
      profileFixture({ availability: every({ enabled: false }) }),
      counter(),
    );
    expect(plan.blocks).toEqual([]);
    expect(plan.totalMinutes).toBe(0);
    expect(plan.remaining.map((item) => item.minutes)).toEqual([60, 120]);
  });

  test("a same-day deadline it cannot meet needs an explicit catch-up, and the deadline stays", () => {
    const essay = task("essay", {
      title: "Reading",
      due: "2026-10-07",
      dueTime: "13:10",
      minutes: 60,
    });
    const afternoons = input({
      tasks: [essay],
      startTime: "07:30",
      startDate: "2026-10-07",
      days: 7,
    });
    const strict = makePlan(afternoons, counter());
    expect(strict.blocks).toEqual([]);
    expect(strict.remaining[0]?.minutes).toBe(60);

    const catchUp = makePlan(
      { ...afternoons, lateTaskIds: ["essay"] },
      counter(),
    );
    expect(timetable(catchUp.blocks)).toEqual([
      "2026-10-07 17:00-17:45 essay late",
      "2026-10-07 17:55-18:10 essay late",
    ]);
    expect(catchUp.warnings).toEqual([
      "Reading is scheduled after its deadline (Wed, Oct\u00a07\u00a0at\u00a01:10\u00a0PM). The deadline has not changed.",
    ]);
    expect(essay.dueTime).toBe("13:10");
  });

  test("a three-hour practice test gets one unbroken block, past the focus span", () => {
    const plan = makePlan(
      input({
        tasks: [
          task("act", {
            title: "ACT practice",
            due: "2026-10-10",
            dueTime: "23:00",
            dateKind: "target",
            contiguous: true,
            minutes: 180,
          }),
        ],
        startTime: "07:30",
        days: 7,
      }),
      counter(),
    );
    expect(timetable(plan.blocks)).toEqual(["2026-10-07 17:00-20:00 act"]);
    expect(plan.remaining).toEqual([]);
  });

  test("a practice test is not split when no window is long enough", () => {
    const plan = makePlan(
      input({
        tasks: [
          task("act", { due: "2026-10-10", contiguous: true, minutes: 180 }),
        ],
        availability: every({ end: "19:00" }),
        days: 7,
      }),
      counter(),
    );
    expect(plan.blocks).toEqual([]);
    expect(plan.remaining).toEqual([
      { assignmentId: "act", title: "act", minutes: 180, due: "2026-10-10" },
    ]);
  });

  test("proposing changes nothing it was given, and one input makes one plan", () => {
    const fixture = sampleFixture();
    const before = structuredClone({
      tasks: fixture.tasks,
      busy: fixture.busy,
    });
    const first = makePlan(fixture, counter());
    expect({ tasks: fixture.tasks, busy: fixture.busy }).toEqual(before);
    expect(makePlan(fixture, counter())).toEqual(first);
  });

  test("plans around every event, uses what was asked for and says what is left", () => {
    const fixture = sampleFixture();
    const plan = makePlan(fixture, counter());
    expect(timetable(plan.blocks)).toEqual([
      "2026-10-06 18:10-18:40 p-quiz",
      "2026-10-06 19:40-20:05 p-lab",
      "2026-10-06 20:10-20:30 e-read",
      "2026-10-06 20:35-20:50 e-read",
    ]);
    expect(plan.totalMinutes).toBe(90);
    for (const block of plan.blocks)
      for (const event of fixture.busy)
        expect(overlaps(block, event)).toBe(false);
    expect(plan.remaining.map((item) => item.assignmentId)).toEqual([
      "l-vocab",
      "e-outline",
      "sat",
    ]);
  });

  test("work already applied is not planned again, and new blocks keep clear of it", () => {
    const fixture = sampleFixture();
    const first = makePlan(fixture, counter());
    expect(
      checkApply({
        today: fixture.today,
        nowMinute: fixture.nowMinute,
        blocks: first.blocks,
        busy: fixture.busy,
      }),
    ).toBe(null);
    const busy = [...fixture.busy, ...applied(first.blocks)];
    // Applying is idempotent: the plan's own blocks on the calendar do not refuse it.
    expect(
      checkApply({
        today: fixture.today,
        nowMinute: fixture.nowMinute,
        blocks: first.blocks,
        busy,
      }),
    ).toBe(null);

    const second = makePlan({ ...fixture, busy }, counter());
    const done = new Set(["p-quiz", "p-lab", "e-read"]);
    expect(
      second.blocks.some((block) => done.has(block.assignmentId ?? "")),
    ).toBe(false);
    expect(timetable(second.blocks)).toEqual([
      "2026-10-06 20:55-21:15 l-vocab",
      "2026-10-06 21:20-21:45 e-outline",
    ]);
    for (const block of second.blocks)
      for (const event of busy) expect(overlaps(block, event)).toBe(false);
    expect(
      checkApply({
        today: fixture.today,
        nowMinute: fixture.nowMinute,
        blocks: second.blocks,
        busy,
      }),
    ).toBe(null);
  });

  test("a late start reports a shortfall and never runs past the end of the day", () => {
    const plan = makePlan(sampleFixture({ startTime: "21:40" }), counter());
    expect(timetable(plan.blocks)).toEqual(["2026-10-06 21:40-21:55 p-quiz"]);
    expect(plan.totalMinutes).toBe(15);
    expect(plan.remaining.length).toBeGreaterThan(0);
    expect(plan.blocks.every((block) => minuteOf(block.end) <= 22 * 60)).toBe(
      true,
    );
  });

  test("unknown tasks and unreadable times fail closed", () => {
    expect(() =>
      makePlan(sampleFixture({ priority: ["invented"] }), counter()),
    ).toThrow(/no longer exists/);
    expect(() =>
      makePlan(sampleFixture({ lateTaskIds: ["invented"] }), counter()),
    ).toThrow(/no longer exists/);
    expect(() =>
      makePlan(sampleFixture({ startTime: "99:80" }), counter()),
    ).toThrow(StudyInputError);
  });
});

describe("makePlan: what the student asks for", () => {
  test("endTime lowers every day's end", () => {
    const plan = makePlan(
      input({
        tasks: [task("big", { minutes: 300 })],
        endTime: "20:00",
        days: 2,
      }),
      counter(),
    );
    expect(timetable(plan.blocks)).toEqual([
      "2026-10-07 17:00-17:45 big",
      "2026-10-07 17:55-18:40 big",
      "2026-10-07 18:50-19:35 big",
      "2026-10-07 19:45-20:00 big",
      "2026-10-08 17:00-17:45 big",
      "2026-10-08 17:55-18:40 big",
      "2026-10-08 18:50-19:35 big",
      "2026-10-08 19:45-20:00 big",
    ]);
    expect(plan.totalMinutes).toBe(300);
  });

  test("startTime raises only the first day's start", () => {
    const plan = makePlan(
      input({
        tasks: [task("big", { minutes: 120 })],
        startTime: "19:00",
        days: 2,
        availability: every({ cap: 60 }),
      }),
      counter(),
    );
    expect(timetable(plan.blocks)).toEqual([
      "2026-10-07 19:00-19:45 big",
      "2026-10-07 19:55-20:10 big",
      "2026-10-08 17:00-17:45 big",
      "2026-10-08 17:55-18:10 big",
    ]);
  });

  test("today starts at least five minutes from now, on a five-minute mark", () => {
    const startAt = (nowMinute: number) =>
      makePlan(
        input({ nowMinute, tasks: [task("t", { minutes: 15 })] }),
        counter(),
      ).blocks[0]?.start;
    expect(startAt(16 * 60)).toBe("17:00");
    expect(startAt(17 * 60 + 20)).toBe("17:25");
    expect(startAt(17 * 60 + 21)).toBe("17:30");
    // Tomorrow's plan starts when tomorrow's study hours do, whatever the time now.
    expect(
      makePlan(
        input({
          nowMinute: 22 * 60,
          startDate: "2026-10-08",
          tasks: [task("t", { minutes: 15 })],
        }),
        counter(),
      ).blocks[0]?.start,
    ).toBe("17:00");
  });

  test("tasks to put first come first, then the rest by due date and time", () => {
    const tasks = [
      task("a", { due: "2026-10-09", minutes: 15 }),
      task("b", { due: "2026-10-08", minutes: 15 }),
      task("c", { due: "2026-10-08", dueTime: "18:00", minutes: 15 }),
      task("d", { minutes: 15 }),
    ];
    const order = (priority?: string[]) =>
      makePlan(input({ tasks, priority }), counter()).blocks.map(
        (block) => block.assignmentId,
      );
    // A due date with no time counts as due at the end of that day.
    expect(order()).toEqual(["c", "b", "a", "d"]);
    expect(order(["d"])).toEqual(["d", "c", "b", "a"]);
    expect(order(["a", "d"])).toEqual(["a", "d", "c", "b"]);
    expect(
      timetable(makePlan(input({ tasks, priority: ["d"] }), counter()).blocks),
    ).toEqual([
      "2026-10-07 17:00-17:15 d",
      "2026-10-07 17:25-17:40 c",
      "2026-10-07 17:50-18:05 b",
      "2026-10-07 18:15-18:30 a",
    ]);
  });

  test("a commitment keeps the class buffer clear on both sides", () => {
    const plan = (classBufferMin: number) =>
      timetable(
        makePlan(
          input({
            tasks: [task("t", { minutes: 120 })],
            busy: [commitment("club", "2026-10-07", "18:00", "19:00")],
            availability: every({ start: "17:10", focus: 50 }),
            classBufferMin,
          }),
          counter(),
        ).blocks,
      );
    expect(plan(10)).toEqual([
      "2026-10-07 17:10-17:50 t",
      "2026-10-07 19:10-20:00 t",
      "2026-10-07 20:10-20:40 t",
    ]);
    expect(plan(0)).toEqual([
      "2026-10-07 17:10-18:00 t",
      "2026-10-07 19:00-19:50 t",
      "2026-10-07 20:00-20:20 t",
    ]);
  });

  test("a contiguous task waits for a gap long enough, and the day's cursor follows it", () => {
    const plan = makePlan(
      input({
        tasks: [
          task("test", { contiguous: true, minutes: 120 }),
          task("homework", { minutes: 30 }),
        ],
        busy: [commitment("club", "2026-10-07", "18:00", "18:30")],
        priority: ["test"],
      }),
      counter(),
    );
    expect(timetable(plan.blocks)).toEqual([
      "2026-10-07 18:40-20:40 test",
      "2026-10-07 20:50-21:20 homework",
    ]);
  });

  test("a task that fits nowhere leaves the time it skipped to the tasks after it", () => {
    // The prototype moved the shared cursor while the practice test searched, so the homework
    // started at 18:40 and lost the hour before the club.
    const plan = makePlan(
      input({
        tasks: [
          task("test", { contiguous: true, minutes: 180 }),
          task("homework", { minutes: 30 }),
        ],
        busy: [commitment("club", "2026-10-07", "18:00", "18:30")],
        availability: every({ end: "20:00" }),
        priority: ["test"],
      }),
      counter(),
    );
    expect(timetable(plan.blocks)).toEqual(["2026-10-07 17:00-17:30 homework"]);
    expect(plan.remaining.map((item) => item.assignmentId)).toEqual(["test"]);
  });

  test("lateTaskIds plans past the deadline, marks only the late blocks, and warns once per task", () => {
    const tasks = [
      task("lab", {
        title: "Lab write-up",
        due: "2026-10-07",
        dueTime: "18:00",
        minutes: 90,
      }),
      task("missing", {
        title: "Missing worksheet",
        due: "2026-10-06",
        minutes: 60,
      }),
    ];
    // The lab goes first: by due date alone the overdue worksheet would take the time before 18:00.
    const strict = makePlan(input({ tasks, priority: ["lab"] }), counter());
    expect(timetable(strict.blocks)).toEqual([
      "2026-10-07 17:00-17:45 lab",
      "2026-10-07 17:55-18:40 missing late",
      "2026-10-07 18:50-19:05 missing late",
    ]);
    expect(strict.remaining).toEqual([
      {
        assignmentId: "lab",
        title: "Lab write-up",
        minutes: 45,
        due: "2026-10-07",
      },
    ]);

    const catchUp = makePlan(
      input({ tasks, priority: ["lab"], lateTaskIds: ["lab"] }),
      counter(),
    );
    expect(timetable(catchUp.blocks)).toEqual([
      "2026-10-07 17:00-17:45 lab",
      "2026-10-07 17:55-18:40 lab late",
      "2026-10-07 18:50-19:35 missing late",
      "2026-10-07 19:45-20:00 missing late",
    ]);
    expect("late" in catchUp.blocks[0]).toBe(false);
    expect(catchUp.blocks[1].late).toBe(true);
    expect(catchUp.warnings).toEqual([
      "Lab write-up is scheduled after its deadline (Wed, Oct\u00a07\u00a0at\u00a06:00\u00a0PM). The deadline has not changed.",
      "Missing worksheet is scheduled after its deadline (Tue, Oct\u00a06). The deadline has not changed.",
    ]);
    expect(catchUp.remaining).toEqual([]);
  });

  test("a late warning names the deadline as the cards do, on a 12-hour clock, and never halves an emoji", () => {
    // A teacher's long title with an emoji across the 85th character, as UTF-16 counts them.
    const long = `${"Unit 3 kinetics: read sections 3.1 to 3.4 and answer every review question".padEnd(84, " ")}📚 at the end`;
    const plan = makePlan(
      input({
        tasks: [
          task("midnight", {
            title: long,
            due: "2026-10-06",
            dueTime: "00:00",
          }),
          task("noon", {
            title: "Noon quiz corrections",
            due: "2026-10-06",
            dueTime: "12:30",
          }),
        ],
      }),
      counter(),
    );
    expect(plan.warnings).toEqual([
      `${long.slice(0, 84)}📚 is scheduled after its deadline (Tue, Oct\u00a06\u00a0at\u00a012:00\u00a0AM). The deadline has not changed.`,
      "Noon quiz corrections is scheduled after its deadline (Tue, Oct\u00a06\u00a0at\u00a012:30\u00a0PM). The deadline has not changed.",
    ]);
    // Cut at 85 UTF-16 units, the emoji would be half there: text Postgres refuses to store.
    expect(long.slice(0, 85).isWellFormed()).toBe(false);
    expect(plan.warnings.every((warning) => warning.isWellFormed())).toBe(true);
  });

  test("work after a target date is planned but not marked late", () => {
    const plan = makePlan(
      input({
        tasks: [
          task("goal", { due: "2026-10-06", dateKind: "target", minutes: 30 }),
        ],
      }),
      counter(),
    );
    expect(timetable(plan.blocks)).toEqual(["2026-10-07 17:00-17:30 goal"]);
    expect(plan.warnings).toEqual([]);
  });

  test("blocks keep to the focus span with a rest after each, and no block is a scrap", () => {
    const plan = makePlan(
      input({ tasks: [task("t", { minutes: 100 })] }),
      counter(),
    );
    // 45 + 45 would leave a 10-minute scrap, so the second block stops at 40 and leaves 15.
    expect(timetable(plan.blocks)).toEqual([
      "2026-10-07 17:00-17:45 t",
      "2026-10-07 17:55-18:35 t",
      "2026-10-07 18:45-19:00 t",
    ]);
    expect(
      makePlan(
        input({ tasks: [task("t", { minutes: 50 })] }),
        counter(),
      ).blocks.map(lengthOf),
    ).toEqual([35, 15]);
  });

  test("regression: a task between the focus span and 30 minutes is planned in one sitting", () => {
    // The prototype's probe: focus 20 and a 25-minute task planned nothing and said nothing.
    const short = makePlan(
      input({
        tasks: [task("t", { minutes: 25 })],
        availability: every({ focus: 20 }),
      }),
      counter(),
    );
    expect(timetable(short.blocks)).toEqual(["2026-10-07 17:00-17:25 t"]);
    expect(short.remaining).toEqual([]);

    expect(
      makePlan(
        input({
          tasks: [task("t", { minutes: 29 })],
          availability: every({ focus: 15 }),
        }),
        counter(),
      ).blocks.map(lengthOf),
    ).toEqual([29]);

    // When the gap before a commitment is too short for all of it, it moves past the commitment
    // whole instead of leaving a scrap behind.
    const gap = makePlan(
      input({
        tasks: [task("t", { minutes: 25 })],
        busy: [commitment("club", "2026-10-07", "17:30", "18:00")],
        availability: every({ focus: 20 }),
      }),
      counter(),
    );
    expect(timetable(gap.blocks)).toEqual(["2026-10-07 18:10-18:35 t"]);
  });

  test("the daily cap counts applied study blocks, which keep a rest around them", () => {
    const plan = makePlan(
      input({
        tasks: [task("t", { minutes: 200 })],
        busy: [
          {
            id: "earlier",
            date: "2026-10-07",
            start: "17:00",
            end: "17:45",
            kind: "study",
            assignmentId: null,
          },
        ],
        availability: every({ cap: 120 }),
      }),
      counter(),
    );
    expect(timetable(plan.blocks)).toEqual([
      "2026-10-07 17:55-18:40 t",
      "2026-10-07 18:50-19:20 t",
    ]);
    expect(plan.totalMinutes).toBe(75);
    expect(plan.remaining[0]?.minutes).toBe(125);
  });

  test("the last few minutes of a mostly applied task can still be planned", () => {
    const plan = makePlan(
      input({
        tasks: [task("t", { minutes: 60 })],
        busy: [
          {
            id: "tomorrow",
            date: "2026-10-08",
            start: "17:00",
            end: "17:50",
            kind: "study",
            assignmentId: "t",
          },
        ],
      }),
      counter(),
    );
    expect(timetable(plan.blocks)).toEqual(["2026-10-07 17:00-17:10 t"]);
    expect(plan.remaining).toEqual([]);
  });

  test("an applied block that already ended does not count as done", () => {
    const plan = makePlan(
      input({
        nowMinute: 12 * 60,
        tasks: [task("t", { minutes: 30 })],
        busy: [
          {
            id: "morning",
            date: "2026-10-07",
            start: "08:00",
            end: "08:30",
            kind: "study",
            assignmentId: "t",
          },
        ],
      }),
      counter(),
    );
    expect(plan.totalMinutes).toBe(30);
  });

  test("an event past midnight blocks the rest of its day", () => {
    for (const end of ["00:30", "24:00"]) {
      const plan = makePlan(
        input({
          tasks: [task("t", { minutes: 120 })],
          busy: [commitment("late show", "2026-10-07", "22:30", end)],
          availability: every({ start: "21:00", end: "23:30" }),
          classBufferMin: 0,
        }),
        counter(),
      );
      expect(timetable(plan.blocks)).toEqual([
        "2026-10-07 21:00-21:45 t",
        "2026-10-07 21:55-22:30 t",
      ]);
    }
  });

  test("blocks carry ids from the caller and the task's title, assignment and class", () => {
    const plan = makePlan(
      input({
        tasks: [
          task("apush-dbq", {
            title: "APUSH DBQ",
            classId: "apush",
            minutes: 60,
          }),
        ],
        minutes: 600,
      }),
      counter(),
    );
    expect(plan).toEqual({
      startDate: "2026-10-07",
      days: 1,
      blocks: [
        {
          id: "b1",
          assignmentId: "apush-dbq",
          classId: "apush",
          title: "APUSH DBQ",
          date: "2026-10-07",
          start: "17:00",
          end: "17:45",
        },
        {
          id: "b2",
          assignmentId: "apush-dbq",
          classId: "apush",
          title: "APUSH DBQ",
          date: "2026-10-07",
          start: "17:55",
          end: "18:10",
        },
      ],
      remaining: [],
      warnings: [],
      totalMinutes: 60,
    });
  });

  test("a task with no minutes is not planned or listed, but may still be named", () => {
    const plan = makePlan(
      input({ tasks: [task("done", { minutes: 0 })], priority: ["done"] }),
      counter(),
    );
    expect(plan.blocks).toEqual([]);
    expect(plan.remaining).toEqual([]);
  });
});

describe("makePlan: refusals", () => {
  const refusal = (overrides: Partial<PlanInput>): string => {
    try {
      makePlan(input({ tasks: [task("t")], ...overrides }), counter());
    } catch (error) {
      expect(error).toBeInstanceOf(StudyInputError);
      // Only a wrong first day is a PlanDateError: the plan tool adds today's date to those alone.
      expect(error instanceof PlanDateError).toBe("startDate" in overrides);
      return (error as Error).message;
    }
    throw new Error("Expected a refusal.");
  };

  test("an invalid, past or far-off start date", () => {
    expect(refusal({ startDate: "2026-02-30" })).toBe(
      "Choose a real date to plan, written as YYYY-MM-DD.",
    );
    expect(refusal({ startDate: "next week" })).toBe(
      "Choose a real date to plan, written as YYYY-MM-DD.",
    );
    expect(refusal({ startDate: "2026-10-06" })).toBe(
      "Choose today or a later date to plan.",
    );
    expect(refusal({ startDate: "2026-11-07" })).toBe(
      "Plan within the next 30 days.",
    );
    expect(
      makePlan(
        input({ tasks: [task("t")], startDate: "2026-11-06" }),
        counter(),
      ).startDate,
    ).toBe("2026-11-06");
  });

  test("days outside 1 to 7", () => {
    for (const days of [0, 8, 1.5])
      expect(refusal({ days })).toBe("Plan between 1 and 7 days at a time.");
  });

  test("minutes outside 15 to 600", () => {
    for (const minutes of [14, 601, 20.5])
      expect(refusal({ minutes })).toBe(
        "Ask for between 15 and 600 minutes of study.",
      );
  });

  test("times not written as HH:mm, and an end before the start", () => {
    for (const startTime of ["7:30", "24:00", "noon"])
      expect(refusal({ startTime })).toBe(
        "Write the start time as HH:mm, such as 15:30.",
      );
    expect(refusal({ endTime: "18:60" })).toBe(
      "Write the end time as HH:mm, such as 21:00.",
    );
    expect(refusal({ startTime: "20:00", endTime: "19:00" })).toBe(
      "Choose an end time later than the start time.",
    );
  });

  test("calendar, task or study-hour data it cannot read is a plain error, not a refusal", () => {
    const broken: Partial<PlanInput>[] = [
      { today: "2026-13-01" },
      { nowMinute: 1440 },
      { classBufferMin: -5 },
      { busy: [commitment("x", "2026-10-07", "9:00", "10:00")] },
      { tasks: [task("t", { dueTime: "25:00" })] },
      { tasks: [task("t"), task("t")] },
      { availability: every({ cap: 1.5 }) },
    ];
    for (const overrides of broken) {
      let caught: unknown = null;
      try {
        makePlan(input({ tasks: [task("t")], ...overrides }), counter());
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(StudyInputError);
    }
  });
});

describe("checkApply", () => {
  const block = (overrides: Partial<StudyBlock> = {}): StudyBlock => ({
    id: "b1",
    assignmentId: "t",
    classId: null,
    title: "t",
    date: "2026-10-07",
    start: "17:00",
    end: "18:00",
    ...overrides,
  });
  const check = (blocks: StudyBlock[], busy: BusyEvent[], nowMinute = 600) =>
    checkApply({ today: "2026-10-07", nowMinute, blocks, busy });

  test("a plan on a clear calendar can be applied, even touching an event's edges", () => {
    expect(check([block()], [])).toBe(null);
    expect(
      check(
        [block()],
        [
          commitment("before", "2026-10-07", "16:00", "17:00"),
          commitment("after", "2026-10-07", "18:00", "19:00"),
          commitment("other day", "2026-10-08", "17:00", "18:00"),
        ],
      ),
    ).toBe(null);
  });

  test("a block whose time has passed is refused", () => {
    expect(check([block()], [], 17 * 60 + 1)).toBe(PASSED);
    expect(check([block({ date: "2026-10-06" })], [])).toBe(PASSED);
    expect(check([block()], [], 17 * 60)).toBe(null);
    // The prototype's case: a draft left open until 23:00.
    const fixture = profileFixture();
    const plan = makePlan(fixture, counter());
    expect(
      checkApply({
        today: fixture.today,
        nowMinute: 23 * 60,
        blocks: plan.blocks,
        busy: fixture.busy,
      }),
    ).toBe(PASSED);
  });

  test("a block that now overlaps a commitment or an applied study block is refused", () => {
    expect(
      check([block()], [commitment("new", "2026-10-07", "17:30", "17:45")]),
    ).toBe(CONFLICT);
    expect(
      check(
        [block()],
        [
          {
            id: "other plan",
            date: "2026-10-07",
            start: "17:50",
            end: "18:30",
            kind: "study",
            assignmentId: "u",
          },
        ],
      ),
    ).toBe(CONFLICT);
    expect(check([block()], applied([block()]))).toBe(null);
  });

  test("a passed time is reported before a conflict", () => {
    expect(
      check(
        [block(), block({ id: "b2", date: "2026-10-06" })],
        [commitment("new", "2026-10-07", "17:30", "17:45")],
      ),
    ).toBe(PASSED);
  });
});

describe("defaults", () => {
  test("a student's default study hours: weekday evenings, longer weekend days", () => {
    const weekday = {
      enabled: true,
      start: "15:30",
      end: "22:00",
      cap: 180,
      focus: 45,
      rest: 10,
    };
    const weekend = {
      enabled: true,
      start: "10:00",
      end: "21:00",
      cap: 240,
      focus: 50,
      rest: 10,
    };
    expect(defaultAvailability("2026-11-02")).toEqual(weekday);
    expect(defaultAvailability("2026-11-06")).toEqual(weekday);
    expect(defaultAvailability("2026-11-07")).toEqual(weekend);
    expect(defaultAvailability("2026-11-08")).toEqual(weekend);
    expect(() => defaultAvailability("2026-11-31")).toThrow();
    expect(DEFAULT_CLASS_BUFFER_MIN).toBe(10);
  });
});

describe("a demo-shaped school day", () => {
  test("after classes, chem help, soccer and debate, 150 minutes from 15:00 go to the most urgent work", () => {
    const plan = makePlan(
      {
        today: "2026-11-04",
        nowMinute: 14 * 60 + 10,
        tasks: [
          task("chem-lab", {
            title: "Chemistry lab",
            classId: "chem",
            due: "2026-11-05",
            dueTime: "23:59",
            minutes: 90,
          }),
          task("apush-dbq", {
            title: "APUSH DBQ",
            classId: "apush",
            due: "2026-11-06",
            dueTime: "08:00",
            minutes: 120,
          }),
          task("precalc-quiz", {
            title: "Precalc quiz study",
            classId: "precalc",
            due: "2026-11-05",
            dueTime: "10:45",
            minutes: 60,
          }),
          task("precalc-hw", {
            title: "Precalc homework",
            classId: "precalc",
            due: "2026-11-03",
            dueTime: "23:59",
            minutes: 45,
          }),
        ],
        busy: [
          commitment("classes", "2026-11-04", "08:00", "14:05"),
          commitment("chem-help", "2026-11-04", "14:45", "15:15"),
          commitment("soccer", "2026-11-04", "15:30", "17:30"),
          commitment("debate", "2026-11-04", "19:30", "20:15"),
        ],
        availability: defaultAvailability,
        classBufferMin: DEFAULT_CLASS_BUFFER_MIN,
        minutes: 150,
        startTime: "15:00",
      },
      counter(),
    );
    expect(plan).toEqual({
      startDate: "2026-11-04",
      days: 1,
      blocks: [
        {
          id: "b1",
          assignmentId: "precalc-hw",
          classId: "precalc",
          title: "Precalc homework",
          date: "2026-11-04",
          start: "17:40",
          end: "18:25",
          late: true,
        },
        {
          id: "b2",
          assignmentId: "precalc-quiz",
          classId: "precalc",
          title: "Precalc quiz study",
          date: "2026-11-04",
          start: "18:35",
          end: "19:20",
        },
        {
          id: "b3",
          assignmentId: "precalc-quiz",
          classId: "precalc",
          title: "Precalc quiz study",
          date: "2026-11-04",
          start: "20:25",
          end: "20:40",
        },
        {
          id: "b4",
          assignmentId: "chem-lab",
          classId: "chem",
          title: "Chemistry lab",
          date: "2026-11-04",
          start: "20:50",
          end: "21:35",
        },
      ],
      remaining: [
        {
          assignmentId: "chem-lab",
          title: "Chemistry lab",
          minutes: 45,
          due: "2026-11-05",
        },
        {
          assignmentId: "apush-dbq",
          title: "APUSH DBQ",
          minutes: 120,
          due: "2026-11-06",
        },
      ],
      warnings: [
        "Precalc homework is scheduled after its deadline (Tue, Nov\u00a03\u00a0at\u00a011:59\u00a0PM). The deadline has not changed.",
      ],
      totalMinutes: 150,
    });
  });
});
