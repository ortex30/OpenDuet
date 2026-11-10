import { describe, expect, test } from "bun:test";
import {
  type CalendarView,
  type ClassRules,
  type DeckToolResult,
  type FlashcardDeck,
  PROGRESS_NOTE,
  type PlanToolResult,
  type ProgressSummary,
  type ProgressToolResult,
  type QuizAttempt,
  type QuizPublic,
  type QuizToolResult,
  type RulesChange,
  type RulesView,
  type SchoolAssignment,
  type SchoolClass,
  type SchoolSnapshot,
  type StudyBlock,
  type StudyPlan,
  teacherRuleText,
} from "@openbot/shared/study";
import type { z } from "zod";
import { studyKeys } from "@/lib/study/keys";
import {
  calendarViewSchema,
  classRulesSchema,
  deckToolResultSchema,
  flashcardDeckSchema,
  planToolResultSchema,
  progressSummarySchema,
  progressToolResultSchema,
  quizAttemptSchema,
  quizPublicSchema,
  quizToolResultSchema,
  readToolResult,
  rulesChangeSchema,
  rulesViewSchema,
  schoolAssignmentSchema,
  schoolClassSchema,
  schoolSnapshotSchema,
  studyBlockSchema,
  studyPlanSchema,
} from "@/lib/study/schemas";

/**
 * The app's schemas for what /api/openduet/study and the study tools send. Each reads a realistic
 * record of its shared type back whole, refuses a value its type does not allow, and a tool's result
 * is read however many times the runtime encoded it, with a refusal read as nothing.
 */

const chemistry: SchoolClass = {
  id: "chem2",
  name: "Chemistry",
  teacher: "Dr. Okoro",
  period: "2",
  color: "teal",
};

const lab: SchoolAssignment = {
  id: "lab6",
  classId: "chem2",
  title: "Lab 6 report: Reaction Rates",
  kind: "assignment",
  status: "open",
  due: "2026-11-06T05:59:00.000Z",
  dueDate: "2026-11-05",
  dueTime: "23:59",
  points: 40,
  grade: null,
  help: "hints",
  minutes: 90,
  link: "https://classroom.google.com/c/chem2/a/lab6",
  noticeId: "s01",
};

const snapshot: SchoolSnapshot = {
  syncedAt: "2026-11-04T13:20:00.000Z",
  timeZone: "America/Chicago",
  classes: [chemistry],
  assignments: [
    lab,
    {
      ...lab,
      id: "lab5",
      title: "Lab 5 report",
      status: "returned",
      due: null,
      dueDate: null,
      dueTime: null,
      points: null,
      grade: "34/40",
      help: null,
      link: null,
      noticeId: "s06",
    },
  ],
  couldNotRead: [],
};

const rules: ClassRules = {
  classId: "chem2",
  className: "Chemistry",
  teacher: "Dr. Okoro",
  level: "hints",
  source: "notice",
  override: null,
  assignments: [
    {
      assignmentId: "lab6",
      title: "Lab 6 report: Reaction Rates",
      due: "2026-11-06T05:59:00.000Z",
      status: "open",
      notice: "hints",
      override: "none",
      level: "none",
      source: "override",
    },
  ],
};

const rulesView: RulesView = {
  timeZone: "America/Chicago",
  classes: [rules],
  canLoosen: false,
  syncedAt: "2026-11-04T13:20:00.000Z",
  couldNotRead: [
    "Couldn't read one notice from Mr. Chen: it had no class name.",
  ],
};

const quiz: QuizPublic = {
  id: "quiz-1",
  title: "Reaction rates check",
  classId: "chem2",
  className: "Chemistry",
  assignmentId: "lab6",
  questions: [
    {
      id: "q1",
      question: "Raising the temperature speeds a reaction mostly because",
      choices: [
        "particles collide more often and harder",
        "the activation energy drops",
        "the products are more stable",
        "the volume shrinks",
      ],
      topic: "Collision theory",
    },
  ],
  createdAt: "2026-11-04T22:10:00.000Z",
};

const attempt: QuizAttempt = {
  id: "attempt-quiz-1",
  quizId: "quiz-1",
  classId: "chem2",
  results: [
    {
      questionId: "q1",
      topic: "Collision theory",
      question: "Raising the temperature speeds a reaction mostly because",
      choices: (quiz.questions[0] as QuizPublic["questions"][number]).choices,
      selected: 1,
      correctIndex: 0,
      correct: false,
      explanation:
        "More energetic particles collide more often, and more of them clear Ea.",
    },
  ],
  correct: 0,
  total: 1,
  at: "2026-11-04T22:14:00.000Z",
  reviewTaskAdded: true,
};

const deck: FlashcardDeck = {
  id: "deck-1",
  title: "Unidad 5 vocabulary",
  classId: "spanish5",
  className: "Spanish III",
  assignmentId: null,
  cards: [
    { front: "la receta", back: "the recipe" },
    { front: "hervir", back: "to boil" },
  ],
  createdAt: "2026-11-04T22:30:00.000Z",
};

const progress: ProgressSummary = {
  classId: null,
  attempts: 1,
  answered: 1,
  correct: 0,
  topics: [
    {
      classId: "chem2",
      className: "Chemistry",
      topic: "Collision theory",
      correct: 0,
      total: 1,
    },
  ],
  recentMisses: [
    {
      quizId: "quiz-1",
      classId: "chem2",
      topic: "Collision theory",
      question: "Raising the temperature speeds a reaction mostly because",
      at: "2026-11-04T22:14:00.000Z",
    },
  ],
  note: PROGRESS_NOTE,
};

const block: StudyBlock = {
  id: "b1",
  assignmentId: "lab6",
  classId: "chem2",
  title: "Lab 6 report: rate graph",
  date: "2026-11-04",
  start: "19:00",
  end: "19:45",
};

const plan: StudyPlan = {
  id: "plan-1",
  status: "proposed",
  reason: "The lab report is due tomorrow night, so it goes first.",
  timeZone: "America/Chicago",
  startDate: "2026-11-04",
  days: 2,
  blocks: [block, { ...block, id: "b2", date: "2026-11-05", late: true }],
  remaining: [
    {
      assignmentId: "dbq3",
      title: "DBQ essay",
      minutes: 60,
      due: "2026-11-06T14:00:00.000Z",
    },
  ],
  warnings: ["Lab 6 report: rate graph is scheduled after its deadline."],
  totalMinutes: 90,
  createdAt: "2026-11-04T22:40:00.000Z",
  appliedAt: null,
  stale: false,
  staleReason: null,
};

const calendar: CalendarView = {
  timeZone: "America/Chicago",
  today: "2026-11-04",
  nowMinute: 970,
  from: "2026-11-01",
  to: "2026-11-07",
  classes: [chemistry],
  events: [
    {
      id: "period2chem",
      title: "Chemistry (Dr. Okoro)",
      date: "2026-11-04",
      start: "08:55",
      end: "09:45",
      location: "Lab 3",
      classId: "chem2",
    },
    {
      id: "lunch",
      title: "Lunch",
      date: "2026-11-04",
      start: "11:40",
      end: "12:15",
    },
  ],
  allDay: [{ id: "retakes", title: "Picture retakes", date: "2026-11-05" }],
  blocks: [block],
  deadlines: [
    {
      assignmentId: "lab6",
      classId: "chem2",
      title: "Lab 6 report: Reaction Rates",
      date: "2026-11-05",
      time: "23:59",
      kind: "assignment",
      help: "hints",
    },
    {
      assignmentId: "quiz4",
      classId: "precalc4",
      title: "Unit 4 quiz",
      date: "2026-11-05",
      time: null,
      kind: "quiz",
      help: null,
    },
  ],
  couldNotRead: [],
};

const quizResult: QuizToolResult = {
  kind: "quiz",
  id: "quiz-1",
  title: "Reaction rates check",
  className: "Chemistry",
  count: 1,
};
const deckResult: DeckToolResult = {
  kind: "deck",
  id: "deck-1",
  title: "Unidad 5 vocabulary",
  className: "Spanish III",
  count: 2,
};
const progressResult: ProgressToolResult = {
  kind: "progress",
  summary: progress,
};
const planResult: PlanToolResult = {
  kind: "plan",
  id: "plan-1",
  blocks: 2,
  totalMinutes: 90,
  remainingMinutes: 60,
  warnings: [],
};

const change: RulesChange = {
  classes: { chem2: "none" },
  assignments: { lab6: null },
};

describe("each schema reads a record of its shared type back whole", () => {
  const cases: [string, z.ZodType, unknown][] = [
    ["SchoolClass", schoolClassSchema, chemistry],
    ["SchoolAssignment", schoolAssignmentSchema, lab],
    ["SchoolSnapshot", schoolSnapshotSchema, snapshot],
    ["ClassRules", classRulesSchema, rules],
    ["RulesView", rulesViewSchema, rulesView],
    ["RulesChange", rulesChangeSchema, change],
    ["QuizPublic", quizPublicSchema, quiz],
    ["QuizAttempt", quizAttemptSchema, attempt],
    ["FlashcardDeck", flashcardDeckSchema, deck],
    ["ProgressSummary", progressSummarySchema, progress],
    ["StudyBlock", studyBlockSchema, block],
    ["StudyPlan", studyPlanSchema, plan],
    ["CalendarView", calendarViewSchema, calendar],
    ["QuizToolResult", quizToolResultSchema, quizResult],
    ["DeckToolResult", deckToolResultSchema, deckResult],
    ["ProgressToolResult", progressToolResultSchema, progressResult],
    ["PlanToolResult", planToolResultSchema, planResult],
  ];
  for (const [name, schema, record] of cases)
    test(name, () => {
      // Through JSON, as the route sends it: nothing is lost on the way and nothing is added.
      expect(schema.parse(JSON.parse(JSON.stringify(record)))).toEqual(record);
    });

  test("an empty rules change is a change of nothing", () => {
    expect(rulesChangeSchema.parse({})).toEqual({});
  });
});

describe("and refuses what its type does not allow", () => {
  test("a colour, level, kind or status outside the contract's lists", () => {
    expect(
      schoolClassSchema.safeParse({ ...chemistry, color: "blue" }).success,
    ).toBe(false);
    expect(
      schoolAssignmentSchema.safeParse({ ...lab, help: "some" }).success,
    ).toBe(false);
    expect(
      schoolAssignmentSchema.safeParse({ ...lab, kind: "essay" }).success,
    ).toBe(false);
    expect(
      studyPlanSchema.safeParse({ ...plan, status: "pending" }).success,
    ).toBe(false);
  });

  test("a field missing, or null where the type says it is always there", () => {
    const { stale: _stale, ...unstale } = plan;
    expect(studyPlanSchema.safeParse(unstale).success).toBe(false);
    expect(
      calendarViewSchema.safeParse({ ...calendar, blocks: null }).success,
    ).toBe(false);
    expect(
      calendarViewSchema.safeParse({
        ...calendar,
        events: [{ ...calendar.events[0], location: null }],
      }).success,
    ).toBe(false);
  });

  test("a tool result of another kind", () => {
    expect(quizToolResultSchema.safeParse(deckResult).success).toBe(false);
  });
});

describe("readToolResult", () => {
  const refusal =
    "Refused. That class isn't one of yours. Your classes are Chemistry.";

  test("reads the tool's JSON, encoded once more on the way, or already parsed", () => {
    expect(
      readToolResult(JSON.stringify(quizResult), quizToolResultSchema),
    ).toEqual(quizResult);
    expect(
      readToolResult(
        JSON.stringify(JSON.stringify(planResult)),
        planToolResultSchema,
      ),
    ).toEqual(planResult);
    expect(readToolResult(progressResult, progressToolResultSchema)).toEqual(
      progressResult,
    );
  });

  test("reads a refusal as nothing, plain, encoded, or a teacher's rule", () => {
    const rule = `Refused. ${teacherRuleText(
      {
        classId: "apush1",
        className: "AP US History",
        level: "none",
        source: "notice",
      },
      "Mr. Grant set AP US History to No help, so quizzes are paused for it.",
    )}`;
    for (const result of [
      refusal,
      `  ${refusal}`,
      JSON.stringify(refusal),
      JSON.stringify(JSON.stringify(refusal)),
      rule,
      JSON.stringify(rule),
    ])
      expect([result, readToolResult(result, quizToolResultSchema)]).toEqual([
        result,
        null,
      ]);
  });

  test("reads anything that is not the record as nothing", () => {
    for (const result of [
      "Saved.",
      "",
      "{",
      JSON.stringify(deckResult),
      JSON.stringify({ ...quizResult, count: "1" }),
      // Encoded three times is past what the runtime does.
      JSON.stringify(JSON.stringify(JSON.stringify(quizResult))),
      undefined,
      null,
      42,
    ])
      expect([result, readToolResult(result, quizToolResultSchema)]).toEqual([
        result,
        null,
      ]);
  });
});

describe("study keys", () => {
  test("sit under one root, and every calendar range under the prefix Apply invalidates", () => {
    expect(studyKeys.all).toEqual(["openduet-study"]);
    expect(studyKeys.quiz("q")).toEqual(["openduet-study", "quiz", "q"]);
    expect(studyKeys.deck("d")).toEqual(["openduet-study", "deck", "d"]);
    expect(studyKeys.progress(null)).toEqual([
      "openduet-study",
      "progress",
      "all",
    ]);
    expect(studyKeys.progress("chem2")).toEqual([
      "openduet-study",
      "progress",
      "chem2",
    ]);
    expect(studyKeys.plan("p")).toEqual(["openduet-study", "plan", "p"]);
    expect(studyKeys.rules).toEqual(["openduet-study", "rules"]);
    expect(studyKeys.school).toEqual(["openduet-study", "school"]);
    const range = studyKeys.calendar("2026-11-01", "2026-11-07");
    expect(range).toEqual([
      "openduet-study",
      "calendar",
      "2026-11-01",
      "2026-11-07",
    ]);
    expect(range.slice(0, studyKeys.calendarAll.length)).toEqual([
      ...studyKeys.calendarAll,
    ]);
    for (const key of [
      studyKeys.quiz("q"),
      studyKeys.calendarAll,
      studyKeys.rules,
    ])
      expect(key[0]).toBe(studyKeys.all[0]);
  });
});
