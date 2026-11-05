import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import type { Message } from "@ag-ui/core";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  type QuizAttempt,
  type QuizPublic,
  type QuizToolResult,
  type TeacherRuleBlock,
  teacherRuleText,
} from "@openbot/shared/study";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComposerDraft } from "@/components/channels/composer/draft";
import { ConversationView } from "@/components/channels/conversation-view";
import {
  explainWords,
  QuizCardTool,
  QuizToolCard,
  readTeacherRule,
} from "@/lib/copilot/quiz-card-tool";
import { settleReactWork } from "./settle-react-work";

/**
 * The quiz as a student meets it in Chat: drawn by the real renderer in the real transcript, read
 * from the server by the id the tool returned, checked through the server, and the next step sent
 * as the student's own words.
 */

type Seen = { method: string; url: string; body: unknown };
/** Every request the card made to /api/openduet/study, in order. */
const seen: Seen[] = [];
/** How the study routes answer, set by each test. */
let respond: (request: Seen) => Response | Promise<Response> = () =>
  Response.json({ error: "Not found" }, { status: 404 });

const originalFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      // The composer asks the deployment about itself; nothing here depends on the answer.
      if (!url.startsWith("/api/openduet/study/"))
        return Response.json({ error: "Not found" }, { status: 404 });
      const request = {
        method: init?.method ?? "GET",
        url,
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      };
      seen.push(request);
      return respond(request);
    },
    { preconnect: originalFetch.preconnect },
  );
});
afterEach(() => {
  cleanup();
  seen.length = 0;
  respond = () => Response.json({ error: "Not found" }, { status: 404 });
});
afterAll(async () => {
  await settleReactWork();
  globalThis.fetch = originalFetch;
  GlobalRegistrator.unregister();
});

const QUIZ: QuizPublic = {
  id: "quiz-1",
  title: "Trig identities",
  classId: "precalc4",
  className: "Precalculus",
  assignmentId: "precalc4-quiz4",
  questions: [
    {
      id: "q1",
      question: "What is sin²x + cos²x?",
      choices: ["0", "1", "tan x", "2"],
      topic: "Pythagorean identities",
    },
    {
      id: "q2",
      question: "Which one equals tan x?",
      choices: ["cos x / sin x", "1 / cos x", "sin x / cos x", "sin x · cos x"],
      topic: "Quotient identities",
    },
    {
      id: "q3",
      question: "What is 1 + tan²x?",
      choices: ["sec²x", "csc²x", "cot²x", "1"],
      topic: "Pythagorean identities",
    },
  ],
  createdAt: "2026-11-04T15:00:00.000Z",
};

const ATTEMPT: QuizAttempt = {
  id: "attempt:quiz-1",
  quizId: "quiz-1",
  classId: "precalc4",
  results: QUIZ.questions.map((question, index) => {
    const correctIndex = [1, 2, 0][index] ?? 0;
    const selected = [1, 0, 0][index] ?? 0;
    return {
      questionId: question.id,
      topic: question.topic,
      question: question.question,
      choices: question.choices,
      selected,
      correctIndex,
      correct: selected === correctIndex,
      explanation: `Explanation ${index + 1}.`,
    };
  }),
  correct: 2,
  total: 3,
  at: "2026-11-04T15:05:00.000Z",
  reviewTaskAdded: true,
};

const MADE: QuizToolResult = {
  kind: "quiz",
  id: "quiz-1",
  title: "Trig identities",
  className: "Precalculus",
  count: 3,
};

const QUIZ_PATH = "/api/openduet/study/quizzes/quiz-1";

/** What "Explain what I missed" sends for ATTEMPT: the one question missed, by its number. */
const EXPLAIN =
  'Explain what I missed on "Trig identities": question 2 (Quotient identities; I picked "cos x / sin x", the answer is "sin x / cos x").';

/** The study routes for this quiz: GET answers `read()`, POST answers `check(body)`. */
function serving(routes: {
  read?: () => Response | Promise<Response>;
  check?: (body: unknown) => Response | Promise<Response>;
}) {
  respond = (request) => {
    if (request.method === "GET" && request.url === QUIZ_PATH && routes.read)
      return routes.read();
    if (
      request.method === "POST" &&
      request.url === `${QUIZ_PATH}/attempts` &&
      routes.check
    )
      return routes.check(request.body);
    return Response.json({ error: "Not found" }, { status: 404 });
  };
}

/**
 * The student asks, the Bot calls make_quiz and then says its line. The call's arguments are the
 * model's draft, answer key and all: the card must never draw from them.
 */
function asked(result?: string): Message[] {
  return [
    { id: "u1", role: "user", content: "Quiz me on trig identities." },
    {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: {
            name: "make_quiz",
            arguments: JSON.stringify({
              class: "Precalculus",
              title: "Trig identities",
              questions: [
                {
                  question: "A draft question from the model",
                  choices: ["draft A", "draft B", "draft C", "draft D"],
                  answer: 1,
                  explanation: "The draft explanation.",
                  topic: "Draft topic",
                },
              ],
            }),
          },
        },
      ],
    },
    ...(result === undefined
      ? []
      : [
          {
            id: "t1",
            role: "tool" as const,
            toolCallId: "call-1",
            content: result,
          },
          {
            id: "a2",
            role: "assistant" as const,
            content: "Here's a 3-question quiz on trig identities.",
          },
        ]),
  ];
}

function Chat({
  messages,
  sent = [],
  busy = false,
  disabled = false,
  queries,
}: {
  messages: Message[];
  sent?: ComposerDraft[];
  busy?: boolean;
  disabled?: boolean;
  queries: QueryClient;
}) {
  return (
    <QueryClientProvider client={queries}>
      <CopilotKitProvider>
        <QuizCardTool />
        <ConversationView
          busy={busy}
          disabled={disabled}
          messages={messages}
          onSubmit={(draft) => {
            sent.push(draft);
          }}
        />
      </CopilotKitProvider>
    </QueryClientProvider>
  );
}

const fresh = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const RULE: TeacherRuleBlock = {
  classId: "apush1",
  className: "AP US History",
  level: "none",
  assignment: "DBQ essay: Causes of the Civil War",
  teacher: "Mr. Grant",
  source: "notice",
};
/** The refusal guard.ts writes when a teacher's No help pauses the quiz. */
const PAUSED = `Refused. ${teacherRuleText(
  RULE,
  'Mr. Grant set AP US History to No help while "DBQ essay: Causes of the Civil War" is open, so nothing was made.',
)}`;

describe("reading the tool's result", () => {
  test("finds the teacher's rule in a refusal, encoded or not, and nothing in anything else", () => {
    expect(readTeacherRule(PAUSED)).toEqual(RULE);
    expect(readTeacherRule(JSON.stringify(PAUSED))).toEqual(RULE);
    expect(readTeacherRule(JSON.stringify(JSON.stringify(PAUSED)))).toEqual(
      RULE,
    );
    expect(
      readTeacherRule(
        "Refused. \"Biology\" isn't one of the student's classes. Use one of: Chemistry.",
      ),
    ).toBeNull();
    expect(readTeacherRule(JSON.stringify(MADE))).toBeNull();
    // The marker only counts in a refusal.
    expect(readTeacherRule(PAUSED.replace("Refused. ", ""))).toBeNull();
    expect(readTeacherRule(undefined)).toBeNull();
  });
});

describe("the words Explain what I missed sends", () => {
  /** A result for question `number`, missed with choice B when `missed`, else answered right. */
  const result = (
    number: number,
    missed: boolean,
    choices = ["first", "second", "third", "fourth"],
  ): QuizAttempt["results"][number] => ({
    questionId: `q${number}`,
    topic: `Topic ${number}`,
    question: `Question ${number}?`,
    choices,
    selected: missed ? 1 : 0,
    correctIndex: 0,
    correct: !missed,
    explanation: "Because.",
  });

  test("name each question missed by its number, with its topic, what was picked and the answer", () => {
    expect(
      explainWords("Unit 4", {
        results: [
          result(1, true),
          result(2, false),
          result(3, true),
          result(4, true),
        ],
      }),
    ).toBe(
      'Explain what I missed on "Unit 4": question 1 (Topic 1; I picked "second", the answer is "first"), question 3 (Topic 3; I picked "second", the answer is "first") and question 4 (Topic 4; I picked "second", the answer is "first").',
    );
    expect(explainWords("Trig identities", ATTEMPT)).toBe(EXPLAIN);
  });

  test("are none when nothing was missed", () => {
    expect(
      explainWords("Unit 4", { results: [result(1, false), result(2, false)] }),
    ).toBeNull();
  });

  test("stay under about 600 characters, counting the misses that don't fit", () => {
    const long = Array.from({ length: 4 }, (_, index) =>
      `A long choice for this question, number ${index + 1}, written out in full`.padEnd(
        90,
        ".",
      ),
    );
    const words =
      explainWords("Every identity", {
        results: Array.from({ length: 8 }, (_, index) =>
          result(index + 1, true, long),
        ),
      }) ?? "";
    expect(words.length).toBeLessThanOrEqual(600);
    expect(words).toStartWith(
      'Explain what I missed on "Every identity": question 1 (Topic 1;',
    );
    const shown = words.match(/question \d+ \(/g)?.length ?? 0;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(8);
    expect(words).toEndWith(` and ${8 - shown} more.`);
    // The ones kept are the first ones, in order.
    expect([...(words.match(/question \d+/g) ?? [])]).toEqual(
      Array.from({ length: shown }, (_, index) => `question ${index + 1}`),
    );
  });

  test("cut a choice too long to quote whole, so even one miss stays short", () => {
    const essay = `${"The causes reach back decades ".repeat(7)}and more.`;
    const words =
      explainWords("Civil War", {
        results: [result(1, true, [essay, essay, "no", "maybe"])],
      }) ?? "";
    expect(words.length).toBeLessThanOrEqual(600);
    expect(words).toContain('I picked "The causes reach back decades');
    expect(words).toContain('…", the answer is "The causes');
    expect(words).not.toContain("and more.");
  });
});

describe("the quiz card", () => {
  test("while the tool runs, a line says so, and nothing is drawn from the model's draft", async () => {
    const queries = fresh();
    const view = render(<Chat busy messages={asked()} queries={queries} />);
    expect(await view.findByText("Writing your quiz")).toBeTruthy();
    expect(view.queryByText(/draft/i)).toBeNull();
    expect(seen).toEqual([]);
  });

  test("a refused call draws nothing, and asks the server for nothing", async () => {
    for (const result of [
      "Refused. make_quiz couldn't make this quiz. questions: Write 3 to 6 questions. Fix it and call make_quiz again, without mentioning this to the student.",
      JSON.stringify({ kind: "deck", id: "deck-1" }),
    ]) {
      const view = render(<Chat messages={asked(result)} queries={fresh()} />);
      await view.findByText(/Here's a 3-question quiz/);
      expect(view.queryByRole("region", { name: /Quiz/ })).toBeNull();
      expect(view.queryByText(/draft/i)).toBeNull();
      cleanup();
    }
    expect(seen).toEqual([]);
  });

  test("a teacher's No help draws the notice in the quiz's place, however the result arrived", async () => {
    for (const result of [PAUSED, JSON.stringify(PAUSED)]) {
      const view = render(<Chat messages={asked(result)} queries={fresh()} />);
      const notice = await view.findByRole("region", { name: "Quiz paused" });
      expect(within(notice).getByText("No help")).toBeTruthy();
      expect(within(notice).getByText("Set by Mr. Grant")).toBeTruthy();
      expect(
        within(notice).getByText(
          "AI quizzes and flashcards are paused for AP US History while “DBQ essay: Causes of the Civil War” is open. Planning still works.",
        ),
      ).toBeTruthy();
      cleanup();
    }
    // Even while the Bot is still writing: no line claims a quiz was written.
    const view = render(
      <Chat busy messages={asked(PAUSED)} queries={fresh()} />,
    );
    expect(
      await view.findByRole("region", { name: "Quiz paused" }),
    ).toBeTruthy();
    expect(view.queryByText("Wrote your quiz")).toBeNull();
    expect(seen).toEqual([]);
  });

  test("holds its place while it loads, then runs the quiz and hands the choices to the server", async () => {
    const reading = Promise.withResolvers<Response>();
    serving({
      read: () => reading.promise,
      check: () => Response.json({ attempt: ATTEMPT }, { status: 201 }),
    });
    const view = render(
      <Chat messages={asked(JSON.stringify(MADE))} queries={fresh()} />,
    );
    const placeholder = await view.findByRole("region", {
      name: "Quiz: Trig identities",
    });
    expect(placeholder.getAttribute("aria-busy")).toBe("true");
    expect(within(placeholder).getByText("Precalculus")).toBeTruthy();
    expect(within(placeholder).getByText("3 questions")).toBeTruthy();

    await act(async () =>
      reading.resolve(Response.json({ quiz: QUIZ, attempt: null })),
    );
    expect(await view.findByText("Question 1 of 3")).toBeTruthy();
    const line = view.getByText(/Here's a 3-question quiz/);
    const card = view.getByRole("region", { name: "Quiz: Trig identities" });
    // Under the Bot's line about it.
    expect(
      line.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(view.queryByText(/draft/i)).toBeNull();

    fireEvent.click(view.getByRole("radio", { name: "1" }));
    fireEvent.click(view.getByRole("button", { name: "Next" }));
    fireEvent.click(view.getByRole("radio", { name: "cos x / sin x" }));
    fireEvent.click(view.getByRole("button", { name: "Next" }));
    fireEvent.click(view.getByRole("radio", { name: "sec²x" }));
    fireEvent.click(view.getByRole("button", { name: "Check my work" }));

    expect(await view.findByText("2 out of 3 correct")).toBeTruthy();
    expect(seen).toEqual([
      { method: "GET", url: QUIZ_PATH, body: null },
      {
        method: "POST",
        url: `${QUIZ_PATH}/attempts`,
        body: { answers: [1, 0, 0] },
      },
    ]);
    expect(
      view.getByText("A 10-minute review task was added to Tasks."),
    ).toBeTruthy();
    expect(view.getByText("Explanation 2.")).toBeTruthy();
    expect(view.getByText("You chose: cos x / sin x")).toBeTruthy();
    expect(view.getByText("Answer: sin x / cos x")).toBeTruthy();
  });

  test("says when checking failed, and checks again only when pressed again", async () => {
    let checks = 0;
    serving({
      read: () =>
        Response.json({
          quiz: { ...QUIZ, questions: QUIZ.questions.slice(0, 1) },
          attempt: null,
        }),
      check: () => {
        checks++;
        return checks === 1
          ? Response.json(
              { error: "Couldn't reach your study data. Try again." },
              { status: 503 },
            )
          : Response.json(
              {
                attempt: {
                  ...ATTEMPT,
                  results: ATTEMPT.results.slice(0, 1),
                  correct: 1,
                  total: 1,
                  reviewTaskAdded: false,
                },
              },
              { status: 201 },
            );
      },
    });
    const view = render(
      <Chat messages={asked(JSON.stringify(MADE))} queries={fresh()} />,
    );
    fireEvent.click(await view.findByRole("radio", { name: "1" }));
    fireEvent.click(view.getByRole("button", { name: "Check my work" }));
    expect((await view.findByRole("alert")).textContent).toBe(
      "Couldn't reach your study data. Try again.",
    );
    expect(checks).toBe(1);
    fireEvent.click(view.getByRole("button", { name: "Check my work" }));
    expect(await view.findByText("1 out of 1 correct")).toBeTruthy();
    expect(checks).toBe(2);
    expect(view.queryByRole("alert")).toBeNull();
  });

  test("a quiz already checked opens on how it went, and its next steps go as the student's words, once each", async () => {
    serving({ read: () => Response.json({ quiz: QUIZ, attempt: ATTEMPT }) });
    const sent: ComposerDraft[] = [];
    const view = render(
      <Chat
        messages={asked(JSON.stringify(MADE))}
        queries={fresh()}
        sent={sent}
      />,
    );
    expect(await view.findByText("2 out of 3 correct")).toBeTruthy();
    expect(view.queryByText("Question 1 of 3")).toBeNull();

    fireEvent.click(
      view.getByRole("button", { name: "Explain what I missed" }),
    );
    await waitFor(() =>
      expect(sent.map((draft) => draft.text)).toEqual([EXPLAIN]),
    );
    // Sent, so it can't be sent twice.
    expect(
      view.queryByRole("button", { name: "Explain what I missed" }),
    ).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Quiz me again" }));
    await waitFor(() =>
      expect(sent.map((draft) => draft.text)).toEqual([
        EXPLAIN,
        "Quiz me again on Trig identities.",
      ]),
    );
    expect(view.queryByRole("button", { name: "Quiz me again" })).toBeNull();
    expect(seen.map((request) => request.method)).toEqual(["GET"]);
  });

  test("words a conversation can't take stay pressable", async () => {
    serving({ read: () => Response.json({ quiz: QUIZ, attempt: ATTEMPT }) });
    const sent: ComposerDraft[] = [];
    const view = render(
      <Chat
        disabled
        messages={asked(JSON.stringify(MADE))}
        queries={fresh()}
        sent={sent}
      />,
    );
    fireEvent.click(
      await view.findByRole("button", { name: "Explain what I missed" }),
    );
    expect(sent).toEqual([]);
    expect(
      view.getByRole("button", { name: "Explain what I missed" }),
    ).toBeTruthy();
  });

  test("a quiz that can't be read says so, and Try again reads it again", async () => {
    let reads = 0;
    serving({
      read: () => {
        reads++;
        return reads === 1
          ? Response.json(
              { error: "That quiz isn't here anymore." },
              { status: 404 },
            )
          : Response.json({ quiz: QUIZ, attempt: null });
      },
    });
    const view = render(
      <Chat
        messages={asked(JSON.stringify(JSON.stringify(MADE)))}
        queries={fresh()}
      />,
    );
    const alert = await view.findByRole("alert");
    expect(alert.textContent).toBe("That quiz isn't here anymore.");
    const card = view.getByRole("region", { name: "Quiz: Trig identities" });
    expect(card.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(await view.findByText("Question 1 of 3")).toBeTruthy();
    expect(reads).toBe(2);
  });

  test("while the Bot is still writing, the card waits under a finished line, already reading the quiz", async () => {
    serving({ read: () => Response.json({ quiz: QUIZ, attempt: null }) });
    const queries = fresh();
    const messages = asked(JSON.stringify(MADE));
    const view = render(<Chat busy messages={messages} queries={queries} />);
    await view.findByText(/Here's a 3-question quiz/);
    await waitFor(() => expect(seen).toHaveLength(1));
    const held = view.container.querySelector("[data-card-held]");
    expect(held?.textContent).toContain("Wrote your quiz");
    expect(held?.textContent).toContain("Trig identities");
    expect(view.queryByText("Question 1 of 3")).toBeNull();

    await act(async () =>
      view.rerender(<Chat messages={messages} queries={queries} />),
    );
    expect(await view.findByText("Question 1 of 3")).toBeTruthy();
    expect(view.container.querySelector("[data-card-held]")).toBeNull();
    // It was read once, while it waited.
    expect(seen).toHaveLength(1);
  });

  test("outside a conversation there is nowhere to send, so it offers nothing to send", async () => {
    serving({ read: () => Response.json({ quiz: QUIZ, attempt: ATTEMPT }) });
    const view = render(
      <QueryClientProvider client={fresh()}>
        <QuizToolCard made={MADE} />
      </QueryClientProvider>,
    );
    expect(await view.findByText("2 out of 3 correct")).toBeTruthy();
    expect(
      view.queryByRole("button", { name: "Explain what I missed" }),
    ).toBeNull();
    expect(view.queryByRole("button", { name: "Quiz me again" })).toBeNull();
  });
});
