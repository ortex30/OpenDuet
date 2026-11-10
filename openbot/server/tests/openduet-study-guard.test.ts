import { describe, expect, spyOn, test } from "bun:test";
import {
  FLASHCARDS_TOOL,
  PLAN_TOOL,
  PROGRESS_TOOL,
  QUIZ_TOOL,
  readTeacherRuleBlock,
  type SchoolAssignment,
  type SchoolSnapshot,
} from "@openbot/shared/study";
import type { GrantedTool } from "@openbot/toolkit/granted-tool";
import { z } from "zod";
import type { AuditEventInput, AuditStore } from "../src/audit";
import {
  type RulesService,
  type SchoolService,
  type StudyContext,
  type StudyKind,
  StudyNotFoundError,
  type StudyRecord,
  type StudyStore,
} from "../src/openduet/study/contracts";
import { guardTeacherRules } from "../src/openduet/study/guard";
import { createRulesService } from "../src/openduet/study/rules";

/**
 * A teacher's No help, kept in code: make_quiz and make_flashcards are checked against the class's
 * rule each time they run, and refused with a reason the model must pass on and the card can draw.
 */

const NOW = new Date("2026-11-04T15:00:00.000Z");
const INITIATOR = { kind: "person" } as const;
const CONTEXT: StudyContext = {
  actorId: "jordan",
  botId: "academic-os",
  initiator: INITIATOR,
};

function work(
  fields: Pick<SchoolAssignment, "id" | "classId" | "title" | "help"> &
    Partial<SchoolAssignment>,
): SchoolAssignment {
  return {
    kind: "assignment",
    status: "open",
    due: null,
    dueDate: null,
    dueTime: null,
    points: null,
    grade: null,
    minutes: 30,
    link: null,
    noticeId: `notice-${fields.id}`,
    ...fields,
  };
}

const SNAPSHOT: SchoolSnapshot = {
  syncedAt: "2026-11-04T14:55:00.000Z",
  timeZone: "America/New_York",
  classes: [
    {
      id: "apush1",
      name: "AP US History",
      teacher: "Mr. Grant",
      period: "1",
      color: "sky",
    },
    {
      id: "chem2",
      name: "Chemistry",
      teacher: "Dr. Okoro",
      period: "2",
      color: "violet",
    },
    {
      id: "precalc4",
      name: "Precalculus",
      teacher: null,
      period: "4",
      color: "amber",
    },
  ],
  assignments: [
    work({
      id: "dbq3",
      classId: "apush1",
      title: "DBQ essay",
      due: "2026-11-06T13:00:00.000Z",
      help: "none",
    }),
    work({
      id: "lab6",
      classId: "chem2",
      title: "Lab 6 report",
      due: "2026-11-06T04:59:00.000Z",
      help: "hints",
    }),
    work({
      id: "quiz4",
      classId: "precalc4",
      title: "Unit 4 quiz",
      kind: "quiz",
      due: "2026-11-05T15:45:00.000Z",
      help: "full",
    }),
  ],
  couldNotRead: [],
};

/** An owner-scoped store kept in memory. */
function memoryStore(): StudyStore {
  const records = new Map<string, StudyRecord>();
  const keyOf = (owner: string, kind: StudyKind, id: string) =>
    `${owner}|${kind}|${id}`;
  return {
    async get(owner, kind, id) {
      return records.get(keyOf(owner, kind, id)) ?? null;
    },
    async put(owner, input) {
      const record: StudyRecord = {
        id: input.id,
        ownerUserId: owner,
        botId: input.botId ?? null,
        kind: input.kind,
        classId: input.classId ?? null,
        refId: input.refId ?? null,
        status: input.status ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        data: structuredClone(input.data),
        createdAt: NOW,
        updatedAt: NOW,
      };
      records.set(keyOf(owner, input.kind, input.id), record);
      return record;
    },
    async insertOnce(owner, input) {
      const existing = records.get(keyOf(owner, input.kind, input.id));
      if (existing) return { record: existing, created: false };
      return { record: await this.put(owner, input), created: true };
    },
    async list(owner, kind) {
      return [...records.values()].filter(
        (record) => record.ownerUserId === owner && record.kind === kind,
      );
    },
    async update(owner, kind, id, change) {
      const current = records.get(keyOf(owner, kind, id));
      if (!current) throw new StudyNotFoundError();
      const next = await change(current);
      const record = {
        ...current,
        ...(next.data ? { data: structuredClone(next.data) } : {}),
      };
      records.set(keyOf(owner, kind, id), record);
      return record;
    },
  };
}

/** The person's classes as the Classroom reader would answer, with every read it was asked for. */
function school(
  snapshot: SchoolSnapshot | null = SNAPSHOT,
  why: string | null = null,
) {
  const reads: StudyContext[] = [];
  const service: SchoolService = {
    async current(context) {
      reads.push(context);
      return { snapshot, why };
    },
    stored: async () => snapshot,
  };
  return { service, reads };
}

/** The four study tools as their factories would make them, each counting what it was asked. */
function studyTools() {
  const calls: { tool: string; args: unknown }[] = [];
  const tools: GrantedTool[] = [
    QUIZ_TOOL,
    FLASHCARDS_TOOL,
    PROGRESS_TOOL,
    PLAN_TOOL,
  ].map((name) => ({
    name,
    ref: `openduet/${name}`,
    description: `The ${name} tool.`,
    parameters: z.object({ class: z.string() }).passthrough(),
    initiator: INITIATOR,
    async execute(args) {
      calls.push({ tool: name, args });
      return JSON.stringify({ kind: name, id: `${name}-1` });
    },
  }));
  return { tools, calls };
}

function audit() {
  const rows: AuditEventInput[] = [];
  const store: AuditStore = {
    insert: async (event) => {
      rows.push(event);
    },
  };
  return { rows, store };
}

function guarded(
  options: {
    rules?: RulesService;
    school?: SchoolService;
    auditStore?: AuditStore;
  } = {},
) {
  const { tools, calls } = studyTools();
  const rules =
    options.rules ??
    createRulesService({ store: memoryStore(), now: () => NOW });
  const reader = school();
  const held = guardTeacherRules(tools, {
    ...CONTEXT,
    school: options.school ?? reader.service,
    rules,
    ...(options.auditStore ? { auditStore: options.auditStore } : {}),
    now: () => NOW,
  });
  const byName = (name: string) => {
    const tool = held.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`no ${name}`);
    return tool;
  };
  return { tools, held, calls, rules, reads: reader.reads, byName };
}

const ADVICE =
  "This is the teacher's rule, not an error: tell the student in one short sentence, offer to plan their time or help with a different class, and don't retry or quiz them on it another way.";

/** What the model is told for a level set on the Teacher rules screen, which no teacher posted. */
const SCREEN_ADVICE =
  "Tell the student in one short sentence that it was set there, offer to plan their time or help with a different class, and don't retry or quiz them on it another way.";

/** What `run` logged with console.error, each line read as the JSON it was written as, and silenced. */
async function logged(run: () => Promise<void>): Promise<unknown[]> {
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  try {
    await run();
    return quiet.mock.calls.map(([line]) => JSON.parse(String(line)));
  } finally {
    quiet.mockRestore();
  }
}

describe("the teacher-rule guard", () => {
  test("wraps only make_quiz and make_flashcards, keeping what the runtime and selection match on", () => {
    const { tools, held } = guarded();
    expect(held.map((tool) => tool.name)).toEqual(
      tools.map((tool) => tool.name),
    );
    for (const [index, tool] of held.entries()) {
      const original = tools[index]!;
      expect({
        name: tool.name,
        ref: tool.ref,
        initiator: tool.initiator,
        description: tool.description,
        parameters: tool.parameters,
      }).toEqual({
        name: original.name,
        ref: original.ref,
        initiator: original.initiator,
        description: original.description,
        parameters: original.parameters,
      });
    }
    // Planning and progress are never paused, so they are handed back untouched.
    expect(held[2]).toBe(tools[2]!);
    expect(held[3]).toBe(tools[3]!);
    expect(held[0]).not.toBe(tools[0]!);
    expect(held[1]).not.toBe(tools[1]!);
  });

  test("refuses under No help, says whose rule it is, records it, and the card reads it back", async () => {
    const trail = audit();
    const { byName, calls, reads } = guarded({ auditStore: trail.store });
    const answer = await byName(QUIZ_TOOL).execute({
      class: "APUSH",
      topic: "Causes of the Civil War",
    });
    expect(answer).toBe(
      `Refused. [teacher-rule]${JSON.stringify({
        classId: "apush1",
        className: "AP US History",
        level: "none",
        assignment: "DBQ essay",
        teacher: "Mr. Grant",
        source: "notice",
      })} Mr. Grant set AP US History to No help while "DBQ essay" is open, so nothing was made. ${ADVICE}`,
    );
    expect(readTeacherRuleBlock(answer)).toEqual({
      classId: "apush1",
      className: "AP US History",
      level: "none",
      assignment: "DBQ essay",
      teacher: "Mr. Grant",
      source: "notice",
    });
    expect(calls).toEqual([]);
    expect(reads).toEqual([CONTEXT]);
    expect(trail.rows).toEqual([
      {
        eventType: "openduet.tool_refused",
        targetType: "openduet_tool",
        targetId: "openduet/make_quiz",
        actorUserId: "jordan",
        initiator: INITIATOR,
        payload: {
          bot: "academic-os",
          tool: "make_quiz",
          refusal: "teacher_rule",
          level: "none",
          classId: "apush1",
          assignment: "DBQ essay",
          source: "notice",
        },
      },
    ]);
  });

  test("says whose rule paused it, and puts a level set on the Teacher rules screen in no teacher's name", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    await rules.change(
      "jordan",
      {
        classes: { precalc4: "none", chem2: "none" },
        assignments: { lab6: "none" },
      },
      { canLoosen: false, snapshot: SNAPSHOT },
    );
    const trail = audit();
    const { byName, calls } = guarded({ rules, auditStore: trail.store });
    const refusal = async (args: Record<string, unknown>) => {
      const answer = await byName(FLASHCARDS_TOOL).execute(args);
      expect(answer.startsWith("Refused. [teacher-rule]{")).toBe(true);
      return {
        block: readTeacherRuleBlock(answer),
        said: answer.slice(answer.indexOf("} ") + 2),
      };
    };
    expect(
      await refusal({ class: "AP US History", assignment: "DBQ" }),
    ).toEqual({
      block: {
        classId: "apush1",
        className: "AP US History",
        level: "none",
        assignment: "DBQ essay",
        teacher: "Mr. Grant",
        source: "notice",
      },
      said: `Mr. Grant set "DBQ essay" in AP US History to No help, so nothing was made. ${ADVICE}`,
    });
    // Set on the screen, not by Dr. Okoro: the facts name no teacher, and the words say where.
    expect(await refusal({ class: "Chemistry", assignment: "lab 6" })).toEqual({
      block: {
        classId: "chem2",
        className: "Chemistry",
        level: "none",
        assignment: "Lab 6 report",
        source: "override",
      },
      said: `"Lab 6 report" in Chemistry is set to No help on the Teacher rules screen, so nothing was made. ${SCREEN_ADVICE}`,
    });
    expect(await refusal({ class: "Chemistry" })).toEqual({
      block: {
        classId: "chem2",
        className: "Chemistry",
        level: "none",
        source: "override",
      },
      said: `Chemistry is set to No help on the Teacher rules screen, so nothing was made. ${SCREEN_ADVICE}`,
    });
    // A class with no teacher named in its notices, set stricter on the screen.
    expect(await refusal({ class: "precalc" })).toEqual({
      block: {
        classId: "precalc4",
        className: "Precalculus",
        level: "none",
        source: "override",
      },
      said: `Precalculus is set to No help on the Teacher rules screen, so nothing was made. ${SCREEN_ADVICE}`,
    });
    expect(calls).toEqual([]);
    // The trail still says where each rule came from.
    expect(
      trail.rows.map((row) => [
        row.payload.classId,
        row.payload.assignment,
        row.payload.source,
      ]),
    ).toEqual([
      ["apush1", "DBQ essay", "notice"],
      ["chem2", "Lab 6 report", "override"],
      ["chem2", null, "override"],
      ["precalc4", null, "override"],
    ]);
  });

  test("runs the tool under Hints only and Full help, with the call as it came", async () => {
    const trail = audit();
    const { byName, calls } = guarded({ auditStore: trail.store });
    const hints = { class: "Chemistry", assignment: "Lab 6", topic: "rates" };
    const full = { class: "Precalculus", topic: "identities" };
    expect(await byName(QUIZ_TOOL).execute(hints)).toBe(
      JSON.stringify({ kind: QUIZ_TOOL, id: `${QUIZ_TOOL}-1` }),
    );
    expect(await byName(FLASHCARDS_TOOL).execute(full)).toBe(
      JSON.stringify({ kind: FLASHCARDS_TOOL, id: `${FLASHCARDS_TOOL}-1` }),
    );
    expect(calls).toEqual([
      { tool: QUIZ_TOOL, args: hints },
      { tool: FLASHCARDS_TOOL, args: full },
    ]);
    expect(trail.rows).toEqual([]);
  });

  test("hands a call that names no class straight to the tool, whose own schema answers it", async () => {
    const { byName, calls, reads } = guarded();
    for (const args of [{}, null, { class: 42 }, { class: "   " }])
      await byName(QUIZ_TOOL).execute(args);
    expect(calls.map((call) => call.args)).toEqual([
      {},
      null,
      { class: 42 },
      { class: "   " },
    ]);
    expect(reads).toEqual([]);
  });

  test("refuses a class that isn't the student's, naming the ones the model can use", async () => {
    const trail = audit();
    const { byName, calls } = guarded({ auditStore: trail.store });
    expect(await byName(QUIZ_TOOL).execute({ class: "Biology" })).toBe(
      `Refused. "Biology" isn't one of the student's classes. Use one of: AP US History, Chemistry, Precalculus.`,
    );
    expect(calls).toEqual([]);
    expect(trail.rows).toEqual([]);
  });

  test("fails closed when the classes or the rule can't be read", async () => {
    const unreadable: SchoolService = {
      current: async () => {
        throw new Error("Gmail is down");
      },
      stored: async () => null,
    };
    const broken: RulesService = {
      ...createRulesService({ store: memoryStore() }),
      target: async () => {
        throw new Error("The saved teacher rules couldn't be read.");
      },
    };
    const refusal =
      "Refused. The class's AI help rule couldn't be checked, so nothing was made. Tell the student in one sentence and offer to try again.";
    const answers: string[] = [];
    const made: unknown[] = [];
    const lines = await logged(async () => {
      for (const options of [{ school: unreadable }, { rules: broken }]) {
        const { byName, calls } = guarded(options);
        answers.push(await byName(QUIZ_TOOL).execute({ class: "Chemistry" }));
        made.push(...calls);
      }
    });
    expect(answers).toEqual([refusal, refusal]);
    expect(made).toEqual([]);
    expect(lines).toEqual([
      {
        type: "openduet-teacher-rule-check-failed",
        tool: "make_quiz",
        error: "Error: Gmail is down",
      },
      {
        type: "openduet-teacher-rule-check-failed",
        tool: "make_quiz",
        error: "Error: The saved teacher rules couldn't be read.",
      },
    ]);
  });

  test("makes nothing when the student's classes were never read, and says why in Classroom's words", async () => {
    const why =
      "Gmail isn't connected, so your classes couldn't be read. Connect Google on the Connections page.";
    const after =
      "The class's AI help rule couldn't be checked, so nothing was made. Tell the student in one sentence what to connect or fix, then stop.";
    const trail = audit();
    const answers: string[] = [];
    const made: unknown[] = [];
    for (const [reader, tool] of [
      [school(null, why), QUIZ_TOOL],
      [school(null, why), FLASHCARDS_TOOL],
      [school(null, null), QUIZ_TOOL],
    ] as const) {
      const { byName, calls } = guarded({
        school: reader.service,
        auditStore: trail.store,
      });
      // The DBQ's No help can't be seen, so nothing is made under the default level instead.
      answers.push(
        await byName(tool).execute({
          class: "AP US History",
          assignment: "DBQ essay",
        }),
      );
      made.push(...calls);
    }
    expect(answers).toEqual([
      `Refused. ${why} ${after}`,
      `Refused. ${why} ${after}`,
      `Refused. The student's classes couldn't be read. ${after}`,
    ]);
    expect(made).toEqual([]);
    expect(trail.rows).toEqual([]);
  });

  test("runs at the default for a student whose Classroom has no notices yet", async () => {
    const empty: SchoolSnapshot = { ...SNAPSHOT, classes: [], assignments: [] };
    const { byName, calls } = guarded({ school: school(empty).service });
    const args = { class: "AP US History", topic: "Reconstruction" };
    expect(await byName(QUIZ_TOOL).execute(args)).toBe(
      JSON.stringify({ kind: QUIZ_TOOL, id: `${QUIZ_TOOL}-1` }),
    );
    expect(calls).toEqual([{ tool: QUIZ_TOOL, args }]);
  });

  test("still refuses when the audit write fails, or there is no trail to write to", async () => {
    const failing: AuditStore = {
      insert: async () => {
        throw new Error("audit store unavailable");
      },
    };
    const answers: string[] = [];
    const made: unknown[] = [];
    const lines = await logged(async () => {
      for (const options of [{ auditStore: failing }, {}]) {
        const { byName, calls } = guarded(options);
        answers.push(await byName(FLASHCARDS_TOOL).execute({ class: "APUSH" }));
        made.push(...calls);
      }
    });
    for (const answer of answers) {
      expect(answer.startsWith("Refused. [teacher-rule]")).toBe(true);
      expect(readTeacherRuleBlock(answer)).toMatchObject({
        classId: "apush1",
        level: "none",
      });
    }
    expect(answers).toHaveLength(2);
    expect(made).toEqual([]);
    expect(lines).toEqual([
      {
        type: "openduet-tool-refused-audit-write-failed",
        tool: "make_flashcards",
        error: "Error: audit store unavailable",
      },
    ]);
  });

  test("reads the rule when the tool runs, not when it was built", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    const { byName, calls } = guarded({ rules });
    const quiz = byName(QUIZ_TOOL);
    await quiz.execute({ class: "Precalculus" });
    await rules.change(
      "jordan",
      { classes: { precalc4: "none" } },
      { canLoosen: false, snapshot: SNAPSHOT },
    );
    const answer = await quiz.execute({ class: "Precalculus" });
    expect(readTeacherRuleBlock(answer)).toMatchObject({
      classId: "precalc4",
      source: "override",
    });
    expect(calls).toHaveLength(1);
  });

  test("reads the arguments leniently: an assignment that is not a string is none named", async () => {
    const { byName } = guarded();
    const answer = await byName(QUIZ_TOOL).execute({
      class: "APUSH",
      assignment: 7,
    });
    expect(readTeacherRuleBlock(answer)).toEqual({
      classId: "apush1",
      className: "AP US History",
      level: "none",
      assignment: "DBQ essay",
      teacher: "Mr. Grant",
      source: "notice",
    });
    expect(answer).toContain(
      'Mr. Grant set AP US History to No help while "DBQ essay" is open',
    );
  });
});
