import { describe, expect, spyOn, test } from "bun:test";
import {
  FLASHCARDS_TOOL,
  PROGRESS_NOTE,
  type QuizAttempt,
  type QuizPublic,
  QUIZ_TOOL,
  type SchoolAssignment,
  type SchoolSnapshot,
} from "@openbot/shared/study";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppVariables } from "../src/auth/guards";
import type {
  RulesService,
  SchoolService,
  StudyContext,
  StudyRouteDeps,
  StudyStore,
  UpNextSink,
} from "../src/openduet/study/contracts";
import { createMemoryStudyStore } from "../src/openduet/study/memory-store";
import { quizRoutes } from "../src/openduet/study/quiz-routes";
import { quizTools } from "../src/openduet/study/quiz-tools";
import { quizData } from "../src/openduet/study/quizzes";
import { mountStudyRoutes } from "../src/openduet/study/routes";
import { resolveStudyTarget } from "../src/openduet/study/rules";

/**
 * /api/openduet/study's quiz routes, as the quiz card calls them: a quiz without its answers, an
 * attempt graded here once and only once, the review task a miss puts on Up next, a deck, and the
 * practice so far. Quizzes and decks are made by the real tools, so the routes read what they save.
 */

const PATH = "/api/openduet/study";
/** Wednesday 09:00 in Chicago. */
const NOW = new Date("2026-11-04T15:00:00.000Z");
const CONTEXT: StudyContext = {
  actorId: "jordan",
  botId: "academic-os",
  initiator: { kind: "person" },
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

/** The demo student's classes, with the work a quiz or a deck here is for. */
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
      id: "precalc4-quiz4",
      classId: "precalc4",
      title: "Unit 4 quiz: Trig identities",
      kind: "quiz",
      due: "2026-11-05T16:45:00.000Z",
      help: "full",
    }),
    work({
      id: "chem2-lab6",
      classId: "chem2",
      title: "Lab 6 report: Reaction Rates",
      due: "2026-11-06T05:59:00.000Z",
      help: "hints",
    }),
    work({
      id: "apush1-dbq3",
      classId: "apush1",
      title: "DBQ essay: Causes of the Civil War",
      due: "2026-11-06T14:00:00.000Z",
      help: "none",
    }),
    work({
      id: "spanish5-u5test",
      classId: "spanish5",
      title: "Unidad 5 vocab test: La comida y la salud",
      kind: "test",
      due: "2026-11-07T18:20:00.000Z",
      help: "full",
    }),
  ],
  couldNotRead: [],
};

const school: SchoolService = {
  current: async () => ({ snapshot: SNAPSHOT, why: null }),
  stored: async () => SNAPSHOT,
};

const rules: RulesService = {
  overrides: async () => ({ classes: {}, assignments: {} }),
  change: async () => ({ classes: {}, assignments: {} }),
  view: async () => ({
    timeZone: "America/Chicago",
    classes: [],
    canLoosen: false,
    syncedAt: null,
    couldNotRead: [],
  }),
  target: async (_owner, snapshot, named, now) =>
    resolveStudyTarget(
      snapshot,
      { classes: {}, assignments: {} },
      named,
      now ?? NOW,
    ),
};

const unused = async (): Promise<never> => {
  throw new Error("not used");
};

/** Signs in as the given person, the way the app's guard sets the actor. */
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

/** Up next as wiring.ts's createUpNext takes cards, keeping what it was asked to add. */
function upNextSink(fail = false) {
  const added: Parameters<UpNextSink>[0][] = [];
  const sink: UpNextSink = async (input) => {
    if (fail) throw new Error("proactive store unavailable");
    added.push(input);
    return input.cards.map((card, index) => ({
      id: `card-${index + 1}`,
      title: card.title,
    }));
  };
  return { added, sink };
}

function setup(options: { upNext?: UpNextSink; store?: StudyStore } = {}) {
  const store = options.store ?? createMemoryStudyStore({ now: () => NOW });
  const up = upNextSink();
  const deps: StudyRouteDeps = {
    store,
    school,
    rules,
    callTool: unused,
    upNext: options.upNext ?? up.sink,
    primaryBot: "primary-bot",
    now: () => NOW,
  };
  /** The study routes as the person `as` reaches them, under a parent app with its own onError. */
  const as = (userId: string) => {
    const app = new Hono();
    app.onError((_error, context) => context.json({ error: "parent" }, 500));
    return app.route(
      PATH,
      mountStudyRoutes([quizRoutes(deps)], signedIn(userId)),
    );
  };
  const tools = quizTools({
    ...CONTEXT,
    store,
    school,
    rules,
    callTool: unused,
    now: () => NOW,
  });
  const make = async (name: string, args: unknown) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`no ${name}`);
    const answer = await tool.execute(args);
    return (JSON.parse(answer) as { id: string }).id;
  };
  return { store, deps, as, make, added: up.added };
}

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

async function read(response: Response) {
  return { status: response.status, body: await response.json() };
}

async function post(
  app: Hono,
  quizId: string,
  body: unknown,
): Promise<Response> {
  return app.request(`${PATH}/quizzes/${quizId}/attempts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** What `run` logged with console.error, each line read as JSON, silenced. */
async function logged<T>(
  run: () => Promise<T>,
): Promise<{ answer: T; lines: unknown[] }> {
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  try {
    const answer = await run();
    return {
      answer,
      lines: quiet.mock.calls.map(([line]) => JSON.parse(String(line))),
    };
  } finally {
    quiet.mockRestore();
  }
}

describe("a quiz, as its card reads it", () => {
  test("comes without its answers or explanations, and with no attempt yet", async () => {
    const { as, make } = setup();
    const id = await make(QUIZ_TOOL, TRIG);
    const response = await as("jordan").request(`${PATH}/quizzes/${id}`);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      quiz: {
        id,
        title: "Trig identities",
        classId: "precalc4",
        className: "Precalculus",
        assignmentId: "precalc4-quiz4",
        questions: TRIG.questions.map((question, index) => ({
          id: `q${index + 1}`,
          question: question.question,
          choices: question.choices,
          topic: question.topic,
        })),
        createdAt: NOW.toISOString(),
      } satisfies QuizPublic,
      attempt: null,
    });
    expect(text).not.toContain("explanation");
    expect(text).not.toContain("correctIndex");
    expect(text).not.toContain('"answer"');
    expect(text).not.toContain("Tangent is sine over cosine");
  });

  test("is nobody else's: another person's quiz, or none, is not found", async () => {
    const { as, make, store } = setup();
    const id = await make(QUIZ_TOOL, TRIG);
    expect(
      await read(await as("riley").request(`${PATH}/quizzes/${id}`)),
    ).toEqual({
      status: 404,
      body: { error: "That quiz isn't here anymore." },
    });
    expect(
      await read(await post(as("riley"), id, { answers: [1, 2, 0] })),
    ).toEqual({
      status: 404,
      body: { error: "That quiz isn't here anymore." },
    });
    expect(
      (await as("jordan").request(`${PATH}/quizzes/no-such-quiz`)).status,
    ).toBe(404);
    expect(
      (await as("jordan").request(`${PATH}/quizzes/${"x".repeat(300)}`)).status,
    ).toBe(404);
    // Riley's try left nothing behind.
    expect(await store.list("jordan", "attempt")).toEqual([]);
    expect(await store.list("riley", "attempt")).toEqual([]);
  });
});

describe("checking a quiz", () => {
  const graded = (id: string, reviewTaskAdded: boolean): QuizAttempt => ({
    id: `attempt:${id}`,
    quizId: id,
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
        explanation: "It's the Pythagorean identity: the two squares add to 1.",
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
    reviewTaskAdded,
  });

  test("grades it here, keeps the attempt, and puts one review on Up next for a miss", async () => {
    const { as, make, added, store } = setup();
    const id = await make(QUIZ_TOOL, TRIG);
    const app = as("jordan");
    expect(await read(await post(app, id, { answers: [1, 0, 0] }))).toEqual({
      status: 201,
      body: { attempt: graded(id, true) },
    });
    expect(added).toEqual([
      {
        ownerUserId: "jordan",
        agentId: "academic-os",
        cards: [
          {
            title: "Review: Quotient identities",
            detail:
              '10 minutes. You missed 1 on "Trig identities" in Precalculus. Next: reread the explanations, then ask for 3 practice questions on it.',
            sourceApp: null,
            sourceLink: null,
          },
        ],
      },
    ]);
    expect(await store.get("jordan", "attempt", `attempt:${id}`)).toMatchObject(
      {
        kind: "attempt",
        classId: "precalc4",
        refId: id,
        botId: "academic-os",
      },
    );
    // Read back with the quiz from now on, so the card opens on the results after a reload.
    expect(
      await read(await app.request(`${PATH}/quizzes/${id}`)),
    ).toMatchObject({
      status: 200,
      body: { attempt: graded(id, true) },
    });
  });

  test("answers a second check with the first attempt, never grading again or adding a second review", async () => {
    const { as, make, added } = setup();
    const id = await make(QUIZ_TOOL, TRIG);
    const app = as("jordan");
    const first = await read(await post(app, id, { answers: [1, 0, 0] }));
    // Every answer right this time: still the first attempt, as it was graded.
    const again = await read(await post(app, id, { answers: [1, 2, 0] }));
    expect(first.status).toBe(201);
    expect(again).toEqual({ status: 200, body: first.body });
    expect(added).toHaveLength(1);
  });

  test("two checks at once store one attempt and add one review", async () => {
    const { as, make, added } = setup();
    const id = await make(QUIZ_TOOL, TRIG);
    const app = as("jordan");
    const answers = await Promise.all([
      post(app, id, { answers: [1, 0, 0] }).then(read),
      post(app, id, { answers: [0, 0, 0] }).then(read),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 201]);
    // The same attempt, graded once: whichever was stored first.
    const [one, other] = answers.map(
      (answer) => answer.body.attempt as QuizAttempt,
    );
    expect(one!.id).toBe(`attempt:${id}`);
    expect(other!.results).toEqual(one!.results);
    expect(added).toHaveLength(1);
  });

  test("adds no review when every answer was right", async () => {
    const { as, make, added } = setup();
    const id = await make(QUIZ_TOOL, TRIG);
    const { status, body } = await read(
      await post(as("jordan"), id, { answers: [1, 2, 0] }),
    );
    expect(status).toBe(201);
    expect(body.attempt).toMatchObject({
      correct: 3,
      total: 3,
      reviewTaskAdded: false,
    });
    expect(added).toEqual([]);
  });

  test("still grades when Up next can't take the review, and says none was added", async () => {
    const failing = upNextSink(true);
    const { as, make } = setup({ upNext: failing.sink });
    const id = await make(QUIZ_TOOL, TRIG);
    const { answer, lines } = await logged(async () =>
      read(await post(as("jordan"), id, { answers: [1, 0, 0] })),
    );
    expect(answer).toEqual({
      status: 201,
      body: { attempt: graded(id, false) },
    });
    expect(lines).toEqual([
      {
        type: "openduet-study-review-task-failed",
        step: "add",
        error: "Error: proactive store unavailable",
        context: { quiz: id },
        timestamp: expect.any(String),
      },
    ]);
    // And it stays that way: a reload reads the same attempt.
    expect(
      (await read(await as("jordan").request(`${PATH}/quizzes/${id}`))).body
        .attempt,
    ).toEqual(graded(id, false));
  });

  test("puts the review on the primary Bot's Up next when the quiz names no Bot", async () => {
    const { as, make, added, store } = setup();
    const id = await make(QUIZ_TOOL, TRIG);
    const record = await store.get("jordan", "quiz", id);
    if (!record) throw new Error("no quiz saved");
    await store.put("jordan", {
      id,
      kind: "quiz",
      botId: null,
      classId: record.classId,
      data: record.data,
    });
    expect((await post(as("jordan"), id, { answers: [0, 0, 0] })).status).toBe(
      201,
    );
    expect(added.map((input) => input.agentId)).toEqual(["primary-bot"]);
    expect(added[0]?.cards[0]?.title).toBe(
      "Review: Pythagorean identities, Quotient identities",
    );
  });

  test("turns away anything but one choice, 0 to 3, per question, and stores nothing", async () => {
    const { as, make, store, added } = setup();
    const id = await make(QUIZ_TOOL, TRIG);
    const app = as("jordan");
    for (const body of [
      "not json",
      {},
      { answers: [] },
      { answers: [1, 0] },
      { answers: [1, 0, 0, 1] },
      { answers: [1, 0, 4] },
      { answers: [1, 0, -1] },
      { answers: [1, 0, 0.5] },
      { answers: [1, 0, "2"] },
      { answers: [1, 0, null] },
      { answers: [1, 2, 0], extra: true },
    ])
      expect(await read(await post(app, id, body))).toEqual({
        status: 400,
        body: { error: "Answer every question before checking your work." },
      });
    expect(await store.list("jordan", "attempt")).toEqual([]);
    expect(added).toEqual([]);
  });
});

describe("a deck, as its card reads it", () => {
  test("comes back as it was made, and only to the person it was made for", async () => {
    const { as, make } = setup();
    const cards = Array.from({ length: 8 }, (_, index) => ({
      front: `palabra ${index + 1}`,
      back: `word ${index + 1}`,
    }));
    const id = await make(FLASHCARDS_TOOL, {
      class: "Spanish III",
      title: "La comida",
      cards,
    });
    expect(
      await read(await as("jordan").request(`${PATH}/decks/${id}`)),
    ).toEqual({
      status: 200,
      body: {
        deck: {
          id,
          title: "La comida",
          classId: "spanish5",
          className: "Spanish III",
          assignmentId: null,
          cards,
          createdAt: NOW.toISOString(),
        },
      },
    });
    expect(
      await read(await as("riley").request(`${PATH}/decks/${id}`)),
    ).toEqual({
      status: 404,
      body: { error: "Those flashcards aren't here anymore." },
    });
  });
});

describe("practice so far, as the app reads it", () => {
  test("adds up the person's attempts, for every class or one, under the names of their classes", async () => {
    const { as, make } = setup();
    const trig = await make(QUIZ_TOOL, TRIG);
    const rates = await make(QUIZ_TOOL, {
      ...TRIG,
      class: "Chemistry",
      assignment: undefined,
      title: "Reaction rates",
    });
    const app = as("jordan");
    await post(app, trig, { answers: [1, 0, 0] });
    await post(app, rates, { answers: [1, 2, 1] });

    const every = await read(await app.request(`${PATH}/progress`));
    expect(every.status).toBe(200);
    expect(every.body.progress).toMatchObject({
      classId: null,
      attempts: 2,
      answered: 6,
      correct: 4,
      note: PROGRESS_NOTE,
    });
    expect(
      (
        every.body.progress.topics as { className: string; topic: string }[]
      ).map((topic) => `${topic.className}: ${topic.topic}`),
    ).toEqual([
      "Precalculus: Quotient identities",
      "Chemistry: Pythagorean identities",
      // Both all right: the one with more questions behind it first.
      "Precalculus: Pythagorean identities",
      "Chemistry: Quotient identities",
    ]);

    const one = await read(await app.request(`${PATH}/progress?classId=chem2`));
    expect(one.body.progress).toMatchObject({
      classId: "chem2",
      attempts: 1,
      answered: 3,
      correct: 2,
      recentMisses: [
        {
          quizId: rates,
          classId: "chem2",
          topic: "Pythagorean identities",
          question: "What is 1 + tan²x?",
          at: NOW.toISOString(),
        },
      ],
    });
    // Nobody else's practice is counted.
    expect(
      (await read(await as("riley").request(`${PATH}/progress`))).body.progress,
    ).toMatchObject({ attempts: 0, topics: [], recentMisses: [] });
  });

  test("names a class it has no notices for by the name kept with its attempts", async () => {
    const store = createMemoryStudyStore({ now: () => NOW });
    const { as } = setup({ store });
    await store.put("jordan", {
      id: "quiz-old",
      kind: "quiz",
      botId: "academic-os",
      classId: "bio1",
      data: quizData({
        id: "quiz-old",
        title: "Cells",
        classId: "bio1",
        className: "Biology",
        assignmentId: null,
        questions: [
          {
            id: "q1",
            question: "What holds a cell's DNA?",
            choices: [
              "The nucleus",
              "The membrane",
              "The wall",
              "The ribosome",
            ],
            answer: 0,
            explanation: "The nucleus holds the DNA.",
            topic: "Cell parts",
          },
        ],
        createdAt: NOW.toISOString(),
      }),
    });
    const app = as("jordan");
    expect((await post(app, "quiz-old", { answers: [0] })).status).toBe(201);
    const { body } = await read(await app.request(`${PATH}/progress`));
    expect(body.progress.topics).toEqual([
      {
        classId: "bio1",
        className: "Biology",
        topic: "Cell parts",
        correct: 1,
        total: 1,
      },
    ]);
  });
});
