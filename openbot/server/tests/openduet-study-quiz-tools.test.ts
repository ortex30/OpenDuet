import { describe, expect, spyOn, test } from "bun:test";
import {
  FLASHCARDS_TOOL,
  PROGRESS_NOTE,
  PROGRESS_TOOL,
  type ProgressToolResult,
  QUIZ_TOOL,
  type QuizAttempt,
  type QuizToolResult,
  type RuleOverrides,
  readTeacherRuleBlock,
  type SchoolAssignment,
  type SchoolSnapshot,
} from "@openbot/shared/study";
import type { GrantedTool } from "@openbot/toolkit/granted-tool";
import { z } from "zod";
import type { AuditEventInput, AuditStore } from "../src/audit";
import type {
  RulesService,
  SchoolService,
  StudyContext,
  StudyStore,
  StudyToolDeps,
} from "../src/openduet/study/contracts";
import { guardTeacherRules } from "../src/openduet/study/guard";
import { createMemoryStudyStore } from "../src/openduet/study/memory-store";
import { quizTools } from "../src/openduet/study/quiz-tools";
import {
  attemptData,
  attemptIdOf,
  deckFromRecord,
  gradeQuiz,
  progressSummary,
  publicQuiz,
  quizFromRecord,
  reviewTaskFor,
  type StoredQuiz,
} from "../src/openduet/study/quizzes";
import { resolveStudyTarget } from "../src/openduet/study/rules";

/**
 * make_quiz, make_flashcards and show_progress over the demo student's classes: what each takes and
 * refuses, what it saves, and that its answer to the model never carries a quiz's answers. Then the
 * grading and the practice summary they stand on, and the teacher's No help in front of them.
 */

/** Wednesday 09:00 in Chicago: the DBQ is due Friday morning, the trig quiz tomorrow. */
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

/** The demo student's classes and work, as school.ts reads them from their Classroom notices. */
const SNAPSHOT: SchoolSnapshot = {
  syncedAt: "2026-11-04T14:55:00.000Z",
  timeZone: "America/Chicago",
  classes: [
    {
      id: "apush1",
      name: "AP US History",
      teacher: "Mr. Grant",
      period: "Period 1",
      color: "sky",
    },
    {
      id: "chem2",
      name: "Chemistry",
      teacher: "Dr. Okoro",
      period: "Period 2",
      color: "violet",
    },
    {
      id: "eng11",
      name: "English 11",
      teacher: "Ms. Alvarez",
      period: "Period 3",
      color: "teal",
    },
    {
      id: "precalc4",
      name: "Precalculus",
      teacher: "Mr. Chen",
      period: "Period 4",
      color: "amber",
    },
    {
      id: "spanish5",
      name: "Spanish III",
      teacher: "Sra. Morales",
      period: "Period 5",
      color: "rose",
    },
  ],
  assignments: [
    work({
      id: "precalc4-hw43",
      classId: "precalc4",
      title: "Section 4.3 homework",
      status: "missing",
      due: "2026-11-04T05:59:00.000Z",
      help: "full",
      minutes: 45,
    }),
    work({
      id: "precalc4-quiz4",
      classId: "precalc4",
      title: "Unit 4 quiz: Trig identities",
      kind: "quiz",
      due: "2026-11-05T16:45:00.000Z",
      help: "full",
      minutes: 60,
    }),
    work({
      id: "chem2-lab6",
      classId: "chem2",
      title: "Lab 6 report: Reaction Rates",
      due: "2026-11-06T05:59:00.000Z",
      help: "hints",
      minutes: 90,
    }),
    work({
      id: "apush1-dbq3",
      classId: "apush1",
      title: "DBQ essay: Causes of the Civil War",
      due: "2026-11-06T14:00:00.000Z",
      help: "none",
      minutes: 120,
    }),
    work({
      id: "spanish5-u5test",
      classId: "spanish5",
      title: "Unidad 5 vocab test: La comida y la salud",
      kind: "test",
      due: "2026-11-07T18:20:00.000Z",
      help: "full",
      minutes: 60,
    }),
    work({
      id: "eng11-gatsby",
      classId: "eng11",
      title: "The Great Gatsby analytical essay",
      due: "2026-11-11T05:59:00.000Z",
      help: "hints",
      minutes: 150,
    }),
    work({
      id: "apush1-dbqdocs",
      classId: "apush1",
      title: "DBQ documents and rubric",
      kind: "material",
      help: "none",
      minutes: 0,
    }),
    work({
      id: "chem2-lab5",
      classId: "chem2",
      title: "Lab 5 report: Concentration and Rate",
      status: "returned",
      grade: "34/40",
      help: null,
      minutes: 90,
    }),
  ],
  couldNotRead: [],
};

const CLASS_LIST =
  "AP US History, Chemistry, English 11, Precalculus, Spanish III";

/** The Classroom reader, answering with the demo's classes, and every read it was asked for. */
function schoolOf(
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

/** What the model is told to do with a teacher's notice, and with a level set on Teacher rules. */
const TEACHER_ADVICE =
  "This is the teacher's rule, not an error: tell the student in one short sentence, offer to plan their time or help with a different class, and don't retry or quiz them on it another way.";
const SCREEN_ADVICE =
  "Tell the student in one short sentence that it was set there, offer to plan their time or help with a different class, and don't retry or quiz them on it another way.";

/** What follows why the classes couldn't be read, when no rule could be checked. */
const UNCHECKED =
  "The class's AI help rule couldn't be checked, so nothing was made. Tell the student in one sentence what to connect or fix, then stop.";

/** The teacher's rules as rules.ts works them out from the notices, with these overrides saved. */
function rulesOf(
  overrides: RuleOverrides = { classes: {}, assignments: {} },
): RulesService {
  return {
    overrides: async () => overrides,
    change: async () => overrides,
    view: async () => ({
      timeZone: "America/Chicago",
      classes: [],
      canLoosen: false,
      syncedAt: null,
      couldNotRead: [],
    }),
    target: async (_owner, snapshot, named, now) =>
      resolveStudyTarget(snapshot, overrides, named, now ?? NOW),
  };
}

function setup(options: { school?: SchoolService; rules?: RulesService } = {}) {
  const store = createMemoryStudyStore({ now: () => NOW });
  const reader = schoolOf();
  const deps: StudyToolDeps = {
    ...CONTEXT,
    store,
    school: options.school ?? reader.service,
    rules: options.rules ?? rulesOf(),
    callTool: async () => {
      throw new Error("The study tools call no connector.");
    },
    now: () => NOW,
  };
  const tools = quizTools(deps);
  const tool = (name: string): GrantedTool => {
    const found = tools.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  return { store, deps, tools, tool, reads: reader.reads };
}

/** Three questions on trig identities, for the Precalculus quiz due tomorrow. */
const TRIG = {
  class: "Precalculus",
  assignment: "Unit 4 quiz",
  title: "Trig identities",
  questions: [
    {
      question: "What is sin²x + cos²x?",
      choices: ["0", "1", "tan x", "2"],
      answer: 1,
      explanation: "It's the Pythagorean identity: the two squares add to 1.",
      topic: "Pythagorean identities",
    },
    {
      question: "Which one equals tan x?",
      choices: ["cos x / sin x", "1 / cos x", "sin x / cos x", "sin x · cos x"],
      answer: 2,
      explanation: "Tangent is sine over cosine.",
      topic: "Quotient identities",
    },
    {
      question: "What is 1 + tan²x?",
      choices: ["sec²x", "csc²x", "cot²x", "1"],
      answer: 0,
      explanation: "Divide sin²x + cos²x = 1 by cos²x.",
      topic: "Pythagorean identities",
    },
  ],
};

type Question = (typeof TRIG.questions)[number];

/** The trig quiz with `count` questions, cycling through the three. */
function questions(count: number): Question[] {
  return Array.from({ length: count }, (_, index) => {
    const base = TRIG.questions[index % TRIG.questions.length]!;
    return { ...base, question: `${base.question} (${index + 1})` };
  });
}

/** Twelve Spanish vocab cards. */
const VOCAB = {
  class: "Spanish III",
  assignment: "Unidad 5 vocab test",
  title: "La comida y la salud",
  cards: [
    ["la manzana", "the apple"],
    ["el pescado", "the fish"],
    ["la verdura", "the vegetable"],
    ["el desayuno", "breakfast"],
    ["el almuerzo", "lunch"],
    ["la cena", "dinner"],
    ["sano", "healthy"],
    ["la proteína", "protein"],
    ["el azúcar", "sugar"],
    ["hacer ejercicio", "to exercise"],
    ["la receta", "the recipe"],
    ["tener hambre", "to be hungry"],
  ].map(([front, back]) => ({ front: front ?? "", back: back ?? "" })),
};

describe("the quiz tools", () => {
  test("are make_quiz, make_flashcards and show_progress, under openduet refs, for this person", () => {
    const { tools } = setup();
    expect(tools.map((tool) => [tool.name, tool.ref, tool.initiator])).toEqual([
      [QUIZ_TOOL, "openduet/make_quiz", INITIATOR],
      [FLASHCARDS_TOOL, "openduet/make_flashcards", INITIATOR],
      [PROGRESS_TOOL, "openduet/show_progress", INITIATOR],
    ]);
  });

  test("offer the model the limits they ask for, with the class required and never blank", () => {
    const { tool } = setup();
    const quiz = z.toJSONSchema(tool(QUIZ_TOOL).parameters) as {
      required: string[];
      properties: Record<string, Record<string, unknown>>;
    };
    expect(quiz.required).toEqual(["class", "title", "questions"]);
    expect(quiz.properties.class).toMatchObject({
      type: "string",
      pattern: "\\S",
      maxLength: 100,
    });
    expect(quiz.properties.questions).toMatchObject({
      minItems: 3,
      maxItems: 6,
    });
    const deck = z.toJSONSchema(tool(FLASHCARDS_TOOL).parameters) as {
      required: string[];
      properties: Record<string, Record<string, unknown>>;
    };
    expect(deck.required).toEqual(["class", "title", "cards"]);
    expect(deck.properties.cards).toMatchObject({ minItems: 8, maxItems: 20 });
    // The runtime itself turns away a call with no class or a blank one.
    expect(
      tool(QUIZ_TOOL).parameters.safeParse({ ...TRIG, class: "  " }).success,
    ).toBe(false);
    expect(
      tool(FLASHCARDS_TOOL).parameters.safeParse({ ...VOCAB, class: undefined })
        .success,
    ).toBe(false);
    // Over a limit is the tool's to refuse, in words the model can act on.
    expect(
      tool(QUIZ_TOOL).parameters.safeParse({ ...TRIG, questions: questions(9) })
        .success,
    ).toBe(true);
    for (const described of [tool(QUIZ_TOOL), tool(FLASHCARDS_TOOL)]) {
      expect(described.description).toContain("never");
      expect(described.description).toContain("teacher's rule");
      expect(described.description).toContain("one short sentence");
    }
    expect(tool(QUIZ_TOOL).description).toContain(
      "the card runs the quiz and grades it",
    );
  });
});

describe("make_quiz", () => {
  test("saves the quiz with its answers, and tells the model only what the card needs", async () => {
    const { tool, store, reads } = setup();
    const answer = await tool(QUIZ_TOOL).execute(TRIG);
    const made = JSON.parse(answer) as QuizToolResult;
    expect(made).toEqual({
      kind: "quiz",
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      title: "Trig identities",
      className: "Precalculus",
      count: 3,
    });
    // The answer is replayed to the model every turn after: no answers, no explanations.
    expect(answer).not.toContain("explanation");
    expect(answer).not.toContain("Tangent is sine over cosine");
    expect(answer).not.toContain('"answer"');
    expect(reads).toEqual([CONTEXT]);

    const record = await store.get("jordan", "quiz", made.id);
    expect(record).toMatchObject({
      id: made.id,
      ownerUserId: "jordan",
      botId: "academic-os",
      kind: "quiz",
      classId: "precalc4",
    });
    if (!record) throw new Error("no quiz saved");
    const quiz = quizFromRecord(record);
    expect(quiz).toEqual({
      id: made.id,
      title: "Trig identities",
      classId: "precalc4",
      className: "Precalculus",
      assignmentId: "precalc4-quiz4",
      questions: TRIG.questions.map((question, index) => ({
        id: `q${index + 1}`,
        ...question,
      })),
      createdAt: NOW.toISOString(),
    });
    // Nobody else's quizzes hold it.
    expect(await store.get("riley", "quiz", made.id)).toBeNull();
  });

  test("names the class as the notices do, whatever the model called it, and trims what it wrote", async () => {
    const { tool, store } = setup();
    const made = JSON.parse(
      await tool(QUIZ_TOOL).execute({
        ...TRIG,
        class: "  pre-calc ",
        assignment: "",
        title: "  Trig identities  ",
      }),
    ) as QuizToolResult;
    expect(made).toMatchObject({
      className: "Precalculus",
      title: "Trig identities",
    });
    const record = await store.get("jordan", "quiz", made.id);
    if (!record) throw new Error("no quiz saved");
    // A blank assignment is no assignment, not a refusal.
    expect(quizFromRecord(record)).toMatchObject({
      classId: "precalc4",
      assignmentId: null,
    });
  });

  test("reads a null assignment as none, so the model never writes the whole quiz again", async () => {
    const { tool, store } = setup();
    const quiz = JSON.parse(
      await tool(QUIZ_TOOL).execute({ ...TRIG, assignment: null }),
    ) as QuizToolResult;
    const deck = JSON.parse(
      await tool(FLASHCARDS_TOOL).execute({ ...VOCAB, assignment: null }),
    ) as { id: string };
    const quizRecord = await store.get("jordan", "quiz", quiz.id);
    const deckRecord = await store.get("jordan", "deck", deck.id);
    if (!quizRecord || !deckRecord) throw new Error("nothing saved");
    expect(quizFromRecord(quizRecord)).toMatchObject({
      classId: "precalc4",
      assignmentId: null,
    });
    expect(deckFromRecord(deckRecord)).toMatchObject({
      classId: "spanish5",
      assignmentId: null,
    });
    // The class is required, so a null one is still refused, with what to fix.
    expect(await tool(QUIZ_TOOL).execute({ ...TRIG, class: null })).toStartWith(
      "Refused. make_quiz couldn't make this quiz. class: Name the class this is for",
    );
  });

  test("takes 2 to 8 questions, though it offers 3 to 6", async () => {
    const { tool } = setup();
    for (const count of [2, 8]) {
      const made = JSON.parse(
        await tool(QUIZ_TOOL).execute({ ...TRIG, questions: questions(count) }),
      ) as QuizToolResult;
      expect(made.count).toBe(count);
    }
  });

  test("refuses a quiz it can't make, saying what to fix, and saves nothing", async () => {
    const { tool, store } = setup();
    const [first] = TRIG.questions;
    if (!first) throw new Error("no question");
    const cases: [unknown, string][] = [
      [{ ...TRIG, class: undefined }, "class: Name the class this is for"],
      [{ ...TRIG, class: "   " }, "class: Name the class this is for"],
      [
        { ...TRIG, questions: questions(1) },
        "questions: Write 3 to 6 questions.",
      ],
      [
        { ...TRIG, questions: questions(9) },
        "questions: Write 3 to 6 questions.",
      ],
      [
        { ...TRIG, questions: [{ ...first, choices: ["0", "1", "2"] }, first] },
        "questions.0.choices: Give exactly 4 choices",
      ],
      [
        {
          ...TRIG,
          questions: [{ ...first, choices: ["1", "0", " 1 ", "2"] }, first],
        },
        "questions.0.choices: Make the 4 choices different from each other.",
      ],
      [
        { ...TRIG, questions: [first, { ...first, answer: 4 }] },
        "questions.1.answer: Give the index of the right choice: 0, 1, 2 or 3.",
      ],
      [
        { ...TRIG, questions: [first, { ...first, answer: 1.5 }] },
        "questions.1.answer: Give the index of the right choice",
      ],
      [
        { ...TRIG, questions: [first, { ...first, explanation: "" }] },
        "questions.1.explanation: Explain each answer in one sentence",
      ],
      [
        { ...TRIG, questions: [first, { ...first, topic: "x".repeat(81) }] },
        "questions.1.topic: Name each question's topic in 1 to 80 characters.",
      ],
      [{ ...TRIG, title: "" }, "title: Give the quiz a short title"],
      [
        { ...TRIG, difficulty: "hard" },
        'Leave out "difficulty"; make_quiz doesn\'t take it.',
      ],
    ];
    for (const [args, fix] of cases) {
      const answer = await tool(QUIZ_TOOL).execute(args);
      expect(answer).toStartWith("Refused. make_quiz couldn't make this quiz.");
      expect(answer).toContain(fix);
      expect(answer).toEndWith(
        "and call make_quiz again, without mentioning this to the student.",
      );
    }
    expect(await tool(QUIZ_TOOL).execute(undefined)).toStartWith(
      "Refused. make_quiz couldn't make this quiz. class: Name the class",
    );
    expect(await store.list("jordan", "quiz")).toEqual([]);
  });

  test("refuses a class that isn't the student's, naming theirs, and saves nothing", async () => {
    const { tool, store } = setup();
    expect(await tool(QUIZ_TOOL).execute({ ...TRIG, class: "Biology" })).toBe(
      `Refused. "Biology" isn't one of the student's classes. Use one of: ${CLASS_LIST}.`,
    );
    expect(await store.list("jordan", "quiz")).toEqual([]);
  });

  test("makes nothing when the classes can't be read", async () => {
    const broken: SchoolService = {
      current: async () => {
        throw new Error("connection reset");
      },
      stored: async () => null,
    };
    const { tool, store } = setup({ school: broken });
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await tool(QUIZ_TOOL).execute(TRIG)).toBe(
        "Refused. The student's classes couldn't be read just now, so nothing was made. Tell them in one sentence and offer to try again.",
      );
      expect(
        quiet.mock.calls.map(([line]) => JSON.parse(String(line))),
      ).toEqual([
        {
          type: "openduet-study-class-read-failed",
          tool: QUIZ_TOOL,
          error: "Error: connection reset",
        },
      ]);
    } finally {
      quiet.mockRestore();
    }
    expect(await store.list("jordan", "quiz")).toEqual([]);
  });

  test("makes no quiz or deck when the classes were never read, and says why, as the guard does", async () => {
    const why =
      "This Bot hasn't been given Gmail, so your classes couldn't be read. Ask an admin to give it Gmail.";
    const { tool, store } = setup({ school: schoolOf(null, why).service });
    // The DBQ's No help can't be seen, so nothing is made under the default level instead.
    expect(
      await tool(QUIZ_TOOL).execute({
        ...TRIG,
        class: "AP US History",
        assignment: "DBQ essay",
      }),
    ).toBe(`Refused. ${why} ${UNCHECKED}`);
    expect(await tool(FLASHCARDS_TOOL).execute(VOCAB)).toBe(
      `Refused. ${why} ${UNCHECKED}`,
    );
    const unsaid = setup({ school: schoolOf(null).service });
    expect(await unsaid.tool(QUIZ_TOOL).execute(TRIG)).toBe(
      `Refused. The student's classes couldn't be read. ${UNCHECKED}`,
    );
    expect(await store.list("jordan", "quiz")).toEqual([]);
    expect(await store.list("jordan", "deck")).toEqual([]);
    expect(await unsaid.store.list("jordan", "quiz")).toEqual([]);
    // Progress is a count of practice, not help, so it still answers, for a class or every class.
    expect(
      JSON.parse(await tool(PROGRESS_TOOL).execute({ class: "Precalculus" })),
    ).toMatchObject({
      kind: "progress",
      summary: { classId: "precalculus", attempts: 0 },
    });
    expect(JSON.parse(await tool(PROGRESS_TOOL).execute({}))).toMatchObject({
      kind: "progress",
      summary: { classId: null, attempts: 0 },
    });
  });

  test("makes a quiz at the default, under the class as named, for a student with no Classroom notices yet", async () => {
    const empty: SchoolSnapshot = { ...SNAPSHOT, classes: [], assignments: [] };
    const { tool, store } = setup({ school: schoolOf(empty).service });
    const made = JSON.parse(
      await tool(QUIZ_TOOL).execute(TRIG),
    ) as QuizToolResult;
    expect(made).toMatchObject({ className: "Precalculus", count: 3 });
    const record = await store.get("jordan", "quiz", made.id);
    if (!record) throw new Error("no quiz saved");
    expect(quizFromRecord(record)).toMatchObject({
      classId: "precalculus",
      assignmentId: null,
    });
  });

  test("never makes a No-help quiz, even when it is held without the guard", async () => {
    const { tool, store } = setup();
    const answer = await tool(QUIZ_TOOL).execute({
      ...TRIG,
      class: "AP US History",
      title: "Causes of the Civil War",
    });
    expect(answer).toStartWith("Refused. [teacher-rule]");
    expect(readTeacherRuleBlock(answer)).toEqual({
      classId: "apush1",
      className: "AP US History",
      level: "none",
      assignment: "DBQ essay: Causes of the Civil War",
      teacher: "Mr. Grant",
      source: "notice",
    });
    // In the guard's words, so the Bot says the same whichever lock answered.
    expect(answer).toEndWith(
      `} Mr. Grant set AP US History to No help while "DBQ essay: Causes of the Civil War" is open, so nothing was made. ${TEACHER_ADVICE}`,
    );
    expect(await store.list("jordan", "quiz")).toEqual([]);
  });

  test("says a No help set on the Teacher rules screen was set there, in no teacher's name", async () => {
    const { tool, store } = setup({
      rules: rulesOf({
        classes: {
          chem2: {
            level: "none",
            setBy: "jordan",
            setAt: "2026-11-04T14:00:00.000Z",
            loosens: false,
          },
        },
        assignments: {},
      }),
    });
    const answer = await tool(FLASHCARDS_TOOL).execute({
      ...VOCAB,
      class: "Chemistry",
      assignment: undefined,
    });
    expect(answer).toBe(
      `Refused. [teacher-rule]${JSON.stringify({
        classId: "chem2",
        className: "Chemistry",
        level: "none",
        source: "override",
      })} Chemistry is set to No help on the Teacher rules screen, so nothing was made. ${SCREEN_ADVICE}`,
    );
    expect(await store.list("jordan", "deck")).toEqual([]);
  });
});

describe("make_flashcards", () => {
  test("saves the deck, and tells the model its id, title, class and size", async () => {
    const { tool, store } = setup();
    const answer = await tool(FLASHCARDS_TOOL).execute(VOCAB);
    const made = JSON.parse(answer) as { id: string };
    expect(JSON.parse(answer)).toEqual({
      kind: "deck",
      id: made.id,
      title: "La comida y la salud",
      className: "Spanish III",
      count: 12,
    });
    // The cards are the card's to show, not the model's to read back.
    expect(answer).not.toContain("la manzana");
    const record = await store.get("jordan", "deck", made.id);
    expect(record).toMatchObject({ botId: "academic-os", classId: "spanish5" });
    if (!record) throw new Error("no deck saved");
    expect(deckFromRecord(record)).toEqual({
      id: made.id,
      title: "La comida y la salud",
      classId: "spanish5",
      className: "Spanish III",
      assignmentId: "spanish5-u5test",
      cards: VOCAB.cards,
      createdAt: NOW.toISOString(),
    });
  });

  test("takes 3 to 30 cards, though it offers 8 to 20, and refuses the rest with what to fix", async () => {
    const { tool, store } = setup();
    const cards = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        front: `card ${index + 1}`,
        back: `back ${index + 1}`,
      }));
    for (const count of [3, 30])
      expect(
        JSON.parse(
          await tool(FLASHCARDS_TOOL).execute({
            ...VOCAB,
            cards: cards(count),
          }),
        ),
      ).toMatchObject({ count });
    const refusals = [
      [{ ...VOCAB, cards: cards(2) }, "cards: Make 8 to 20 cards."],
      [{ ...VOCAB, cards: cards(31) }, "cards: Make 8 to 20 cards."],
      [
        { ...VOCAB, cards: [...cards(3), { front: "", back: "x" }] },
        "cards.3.front: Write each card's front in 1 to 200 characters.",
      ],
      [
        {
          ...VOCAB,
          cards: [...cards(3), { front: "x", back: "y".repeat(301) }],
        },
        "cards.3.back: Write each card's back in 1 to 300 characters.",
      ],
      [{ ...VOCAB, class: "" }, "class: Name the class this is for"],
    ] as const;
    for (const [args, fix] of refusals) {
      const answer = await tool(FLASHCARDS_TOOL).execute(args);
      expect(answer).toStartWith(
        "Refused. make_flashcards couldn't make this deck.",
      );
      expect(answer).toContain(fix);
    }
    expect(await store.list("jordan", "deck")).toHaveLength(2);
  });
});

describe("show_progress", () => {
  /** An attempt as the route stores it, `minutes` after NOW. */
  async function practised(
    store: StudyStore,
    quiz: StoredQuiz,
    answers: number[],
    minutes: number,
  ) {
    const id = attemptIdOf(quiz.id);
    const attempt = gradeQuiz(quiz, answers, {
      id,
      at: new Date(NOW.getTime() + minutes * 60_000),
    });
    await store.put("jordan", {
      id,
      kind: "attempt",
      classId: quiz.classId,
      refId: quiz.id,
      data: attemptData(attempt, quiz.className),
    });
    return attempt;
  }

  async function quizMade(
    tool: (name: string) => GrantedTool,
    store: StudyStore,
    args: unknown,
  ): Promise<StoredQuiz> {
    const made = JSON.parse(await tool(QUIZ_TOOL).execute(args)) as {
      id: string;
    };
    const record = await store.get("jordan", "quiz", made.id);
    if (!record) throw new Error("no quiz saved");
    return quizFromRecord(record);
  }

  test("before any practice: nothing counted, and the note", async () => {
    const { tool } = setup();
    expect(JSON.parse(await tool(PROGRESS_TOOL).execute({}))).toEqual({
      kind: "progress",
      summary: {
        classId: null,
        attempts: 0,
        answered: 0,
        correct: 0,
        topics: [],
        recentMisses: [],
        note: PROGRESS_NOTE,
      },
    } satisfies ProgressToolResult);
  });

  test("counts every class, or the one named, and refuses a class that isn't theirs", async () => {
    const { tool, store } = setup();
    const trig = await quizMade(tool, store, TRIG);
    const chem = await quizMade(tool, store, {
      class: "Chemistry",
      title: "Reaction rates",
      questions: TRIG.questions.map((question) => ({
        ...question,
        topic: "Rate laws",
      })),
    });
    await practised(store, trig, [1, 0, 0], 5);
    await practised(store, chem, [0, 2, 0], 10);

    const every = JSON.parse(
      await tool(PROGRESS_TOOL).execute({}),
    ) as ProgressToolResult;
    expect(every.summary).toMatchObject({
      classId: null,
      attempts: 2,
      answered: 6,
      correct: 4,
    });
    expect(every.summary.topics).toEqual([
      {
        classId: "precalc4",
        className: "Precalculus",
        topic: "Quotient identities",
        correct: 0,
        total: 1,
      },
      {
        classId: "chem2",
        className: "Chemistry",
        topic: "Rate laws",
        correct: 2,
        total: 3,
      },
      {
        classId: "precalc4",
        className: "Precalculus",
        topic: "Pythagorean identities",
        correct: 2,
        total: 2,
      },
    ]);
    // "all" is every class too, and so is a class left null.
    expect(
      JSON.parse(await tool(PROGRESS_TOOL).execute({ class: "all" })),
    ).toEqual(every);
    expect(
      JSON.parse(await tool(PROGRESS_TOOL).execute({ class: null })),
    ).toEqual(every);

    const chemistry = JSON.parse(
      await tool(PROGRESS_TOOL).execute({ class: "chem" }),
    ) as ProgressToolResult;
    expect(chemistry.summary).toMatchObject({
      classId: "chem2",
      attempts: 1,
      answered: 3,
      correct: 2,
      recentMisses: [
        {
          quizId: chem.id,
          classId: "chem2",
          topic: "Rate laws",
          question: "What is sin²x + cos²x?",
        },
      ],
    });
    expect(await tool(PROGRESS_TOOL).execute({ class: "Biology" })).toBe(
      `Refused. "Biology" isn't one of the student's classes. Use one of: ${CLASS_LIST}.`,
    );
  });

  test("still counts every class when the classes can't be read, by the names kept with each attempt", async () => {
    const working = setup();
    const trig = await quizMade(working.tool, working.store, TRIG);
    await practised(working.store, trig, [1, 2, 1], 5);
    const tools = quizTools({
      ...working.deps,
      school: {
        current: async () => {
          throw new Error("connection reset");
        },
        stored: async () => null,
      },
    });
    const progress = tools.find(
      (candidate) => candidate.name === PROGRESS_TOOL,
    );
    if (!progress) throw new Error("no show_progress");
    const shown = JSON.parse(await progress.execute({})) as ProgressToolResult;
    expect(shown.summary.topics.map((topic) => topic.className)).toEqual([
      "Precalculus",
      "Precalculus",
    ]);
  });
});

describe("the teacher's No help, in front of the real tools", () => {
  function guarded() {
    const { tools, store } = setup();
    const rows: AuditEventInput[] = [];
    const auditStore: AuditStore = {
      insert: async (event) => {
        rows.push(event);
      },
    };
    const held = guardTeacherRules(tools, {
      ...CONTEXT,
      school: schoolOf().service,
      rules: rulesOf(),
      auditStore,
      now: () => NOW,
    });
    const tool = (name: string) => {
      const found = held.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`no ${name}`);
      return found;
    };
    return { tools, held, tool, store, rows };
  }

  test("refuses a quiz or flashcards for AP US History while the DBQ is open, and makes nothing", async () => {
    const { tool, store, rows } = guarded();
    const quiz = await tool(QUIZ_TOOL).execute({
      ...TRIG,
      class: "AP US History",
      assignment: undefined,
      title: "Causes of the Civil War",
    });
    expect(quiz).toStartWith(
      'Refused. [teacher-rule]{"classId":"apush1","className":"AP US History","level":"none","assignment":"DBQ essay: Causes of the Civil War","teacher":"Mr. Grant","source":"notice"} Mr. Grant set AP US History to No help while "DBQ essay: Causes of the Civil War" is open, so nothing was made.',
    );
    const deck = await tool(FLASHCARDS_TOOL).execute({
      ...VOCAB,
      class: "APUSH",
      assignment: undefined,
    });
    expect(readTeacherRuleBlock(deck)).toMatchObject({
      classId: "apush1",
      level: "none",
    });
    expect(await store.list("jordan", "quiz")).toEqual([]);
    expect(await store.list("jordan", "deck")).toEqual([]);
    expect(rows.map((row) => [row.eventType, row.targetId])).toEqual([
      ["openduet.tool_refused", "openduet/make_quiz"],
      ["openduet.tool_refused", "openduet/make_flashcards"],
    ]);
  });

  test("lets Precalculus through, and never pauses show_progress", async () => {
    const { tools, held, tool, store, rows } = guarded();
    const made = JSON.parse(await tool(QUIZ_TOOL).execute(TRIG)) as {
      id: string;
    };
    expect(await store.get("jordan", "quiz", made.id)).not.toBeNull();
    expect(rows).toEqual([]);
    expect(held[2]).toBe(tools[2]!);
    expect(
      JSON.parse(await tool(PROGRESS_TOOL).execute({ class: "AP US History" })),
    ).toMatchObject({ kind: "progress", summary: { classId: "apush1" } });
  });

  test("a call that names no class reaches the tool, which refuses it", async () => {
    const { tool, store } = guarded();
    expect(
      await tool(QUIZ_TOOL).execute({ ...TRIG, class: undefined }),
    ).toStartWith("Refused. make_quiz couldn't make this quiz. class:");
    expect(await store.list("jordan", "quiz")).toEqual([]);
  });

  test("a null assignment is none on both sides of the guard: the class's rule decides", async () => {
    const { tool, store } = guarded();
    const made = JSON.parse(
      await tool(QUIZ_TOOL).execute({ ...TRIG, assignment: null }),
    ) as { id: string };
    expect(await store.get("jordan", "quiz", made.id)).not.toBeNull();
    expect(
      readTeacherRuleBlock(
        await tool(FLASHCARDS_TOOL).execute({
          ...VOCAB,
          class: "APUSH",
          assignment: null,
        }),
      ),
    ).toMatchObject({ classId: "apush1", level: "none", source: "notice" });
    expect(await store.list("jordan", "deck")).toEqual([]);
  });
});

describe("grading", () => {
  const quiz: StoredQuiz = {
    id: "quiz-1",
    title: "Trig identities",
    classId: "precalc4",
    className: "Precalculus",
    assignmentId: "precalc4-quiz4",
    questions: TRIG.questions.map((question, index) => ({
      id: `q${index + 1}`,
      ...question,
    })),
    createdAt: NOW.toISOString(),
  };

  test("shows a quiz without its answers or explanations", () => {
    const shown = publicQuiz(quiz);
    expect(shown.questions).toEqual(
      TRIG.questions.map((question, index) => ({
        id: `q${index + 1}`,
        question: question.question,
        choices: question.choices,
        topic: question.topic,
      })),
    );
    expect(JSON.stringify(shown)).not.toContain("explanation");
    expect(JSON.stringify(shown)).not.toContain('"answer"');
  });

  test("grades the same answers the same way every time, question by question", () => {
    const stamp = { id: attemptIdOf(quiz.id), at: NOW };
    const attempt = gradeQuiz(quiz, [1, 0, 0], stamp);
    expect(attempt).toEqual({
      id: "attempt:quiz-1",
      quizId: "quiz-1",
      classId: "precalc4",
      results: [
        {
          questionId: "q1",
          topic: "Pythagorean identities",
          question: "What is sin²x + cos²x?",
          choices: ["0", "1", "tan x", "2"],
          selected: 1,
          correctIndex: 1,
          correct: true,
          explanation:
            "It's the Pythagorean identity: the two squares add to 1.",
        },
        {
          questionId: "q2",
          topic: "Quotient identities",
          question: "Which one equals tan x?",
          choices: [
            "cos x / sin x",
            "1 / cos x",
            "sin x / cos x",
            "sin x · cos x",
          ],
          selected: 0,
          correctIndex: 2,
          correct: false,
          explanation: "Tangent is sine over cosine.",
        },
        {
          questionId: "q3",
          topic: "Pythagorean identities",
          question: "What is 1 + tan²x?",
          choices: ["sec²x", "csc²x", "cot²x", "1"],
          selected: 0,
          correctIndex: 0,
          correct: true,
          explanation: "Divide sin²x + cos²x = 1 by cos²x.",
        },
      ],
      correct: 2,
      total: 3,
      at: NOW.toISOString(),
      reviewTaskAdded: false,
    } satisfies QuizAttempt);
    expect(gradeQuiz(quiz, [1, 0, 0], stamp)).toEqual(attempt);
  });

  test("won't grade anything but one choice, 0 to 3, for every question", () => {
    const stamp = { id: "attempt:quiz-1", at: NOW };
    for (const answers of [
      [],
      [1, 0],
      [1, 0, 0, 2],
      [1, 0, 4],
      [1, 0, -1],
      [1, 0, 0.5],
    ])
      expect(() => gradeQuiz(quiz, answers, stamp)).toThrow(
        "Answer every question before checking your work.",
      );
  });

  test("a quiz with misses asks for ten minutes on the missed topics, named once each", () => {
    const missed = gradeQuiz(quiz, [0, 0, 1], { id: "a", at: NOW });
    expect(reviewTaskFor(quiz, missed)).toEqual({
      title: "Review: Pythagorean identities, Quotient identities",
      detail:
        '10 minutes. You missed 3 on "Trig identities" in Precalculus. Next: reread the explanations, then ask for 3 practice questions on it.',
    });
    expect(
      reviewTaskFor(quiz, gradeQuiz(quiz, [1, 2, 0], { id: "a", at: NOW })),
    ).toBeNull();
  });

  test("a review's topics stop at 80 characters, at a whole topic", () => {
    const long: StoredQuiz = {
      ...quiz,
      questions: [
        "Sum and difference formulas",
        "Double-angle formulas",
        "Half-angle formulas",
        "Product-to-sum formulas",
        "sum and difference formulas",
      ].map((topic, index) => ({
        ...quiz.questions[0]!,
        id: `q${index + 1}`,
        topic,
      })),
    };
    const task = reviewTaskFor(
      long,
      gradeQuiz(long, [0, 0, 0, 0, 0], { id: "a", at: NOW }),
    );
    if (!task) throw new Error("no review task");
    expect(task.title).toBe(
      "Review: Sum and difference formulas, Double-angle formulas, Half-angle formulas…",
    );
    expect(task.title.length - "Review: ".length).toBeLessThanOrEqual(80);
    const one: StoredQuiz = {
      ...quiz,
      questions: [{ ...quiz.questions[0]!, topic: "y".repeat(100) }],
    };
    expect(
      reviewTaskFor(one, gradeQuiz(one, [0], { id: "a", at: NOW }))?.title,
    ).toBe(`Review: ${"y".repeat(79)}…`);
  });
});

describe("practice so far", () => {
  const names = new Map([
    ["precalc4", "Precalculus"],
    ["chem2", "Chemistry"],
  ]);

  /** An attempt at minute `minute`, one result per [topic, correct] pair. */
  function attempt(
    id: string,
    classId: string,
    minute: number,
    results: [string, boolean][],
  ): QuizAttempt {
    return {
      id: `attempt:${id}`,
      quizId: id,
      classId,
      results: results.map(([topic, correct], index) => ({
        questionId: `q${index + 1}`,
        topic,
        question: `${id} question ${index + 1}`,
        choices: ["a", "b", "c", "d"],
        selected: correct ? 0 : 1,
        correctIndex: 0,
        correct,
        explanation: "Because.",
      })),
      correct: results.filter(([, correct]) => correct).length,
      total: results.length,
      at: new Date(NOW.getTime() + minute * 60_000).toISOString(),
      reviewTaskAdded: false,
    };
  }

  test("adds up quizzes, questions and right answers, and counts each class's topics apart", () => {
    const attempts = [
      attempt("trig", "precalc4", 1, [
        ["Identities", true],
        ["identities ", false],
        ["Unit circle", true],
      ]),
      attempt("rates", "chem2", 2, [
        ["Identities", false],
        ["Rate laws", true],
      ]),
    ];
    const summary = progressSummary(attempts, names, null);
    expect(summary).toEqual({
      classId: null,
      attempts: 2,
      answered: 5,
      correct: 3,
      topics: [
        {
          classId: "chem2",
          className: "Chemistry",
          topic: "Identities",
          correct: 0,
          total: 1,
        },
        {
          classId: "precalc4",
          className: "Precalculus",
          topic: "Identities",
          correct: 1,
          total: 2,
        },
        {
          classId: "chem2",
          className: "Chemistry",
          topic: "Rate laws",
          correct: 1,
          total: 1,
        },
        {
          classId: "precalc4",
          className: "Precalculus",
          topic: "Unit circle",
          correct: 1,
          total: 1,
        },
      ],
      recentMisses: [
        {
          quizId: "rates",
          classId: "chem2",
          topic: "Identities",
          question: "rates question 1",
          at: attempts[1]!.at,
        },
        {
          quizId: "trig",
          classId: "precalc4",
          topic: "identities",
          question: "trig question 2",
          at: attempts[0]!.at,
        },
      ],
      note: PROGRESS_NOTE,
    });
    expect(progressSummary(attempts, names, "chem2")).toMatchObject({
      classId: "chem2",
      attempts: 1,
      answered: 2,
      correct: 1,
    });
    // A class with no name it knows is shown by its id.
    expect(
      progressSummary(attempts, new Map(), "chem2").topics[0]?.className,
    ).toBe("chem2");
  });

  test("lists at most 12 topics, the weakest, and the 8 latest misses, newest first", () => {
    const attempts = Array.from({ length: 10 }, (_, index) =>
      attempt(`quiz-${index}`, "precalc4", index, [
        [`Topic ${String(index).padStart(2, "0")}`, false],
        [`Strong ${String(index).padStart(2, "0")}`, true],
      ]),
    );
    const summary = progressSummary(attempts, names, null);
    expect(summary.topics).toHaveLength(12);
    expect(summary.topics.slice(0, 10).map((topic) => topic.topic)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Topic 0${index}`),
    );
    expect(summary.topics.slice(10).map((topic) => topic.correct)).toEqual([
      1, 1,
    ]);
    expect(summary.recentMisses.map((miss) => miss.quizId)).toEqual([
      "quiz-9",
      "quiz-8",
      "quiz-7",
      "quiz-6",
      "quiz-5",
      "quiz-4",
      "quiz-3",
      "quiz-2",
    ]);
  });
});
