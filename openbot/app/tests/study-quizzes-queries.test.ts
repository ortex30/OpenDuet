import { afterEach, describe, expect, test } from "bun:test";
import type {
  FlashcardDeck,
  ProgressSummary,
  QuizAttempt,
  QuizPublic,
} from "@openbot/shared/study";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { proactiveKeys } from "@/lib/proactive";
import { studyKeys } from "@/lib/study/keys";
import {
  deckQueryOptions,
  progressQueryOptions,
  type QuizWithAttempt,
  quizQueryOptions,
  submitAttemptMutationOptions,
} from "@/lib/study/quizzes";

/**
 * The quiz and flashcard cards' reads and their one write: each asks the route its shared type
 * names, turns a body of the wrong shape into a sentence, and a checked quiz lands in the quiz's
 * own query while every practice summary is read again.
 */

const originalFetch = globalThis.fetch;
const clients: QueryClient[] = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const client of clients.splice(0)) client.clear();
});

type Asked = {
  url: string;
  method: string;
  body: unknown;
  credentials: string;
};

/** Answers every request with `status` and `body`, keeping what was asked. */
function answering(status: number, body: unknown): Asked[] {
  const asked: Asked[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        credentials: String(init?.credentials),
      });
      return Response.json(body, { status });
    },
    { preconnect: originalFetch.preconnect },
  );
  return asked;
}

function fresh() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return client;
}

const quiz: QuizPublic = {
  id: "quiz/1",
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
  ],
  createdAt: "2026-11-04T15:00:00.000Z",
};

const attempt: QuizAttempt = {
  id: "attempt:quiz/1",
  quizId: "quiz/1",
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
      explanation: "It's the Pythagorean identity.",
    },
    {
      questionId: "q2",
      topic: "Quotient identities",
      question: "Which one equals tan x?",
      choices: ["cos x / sin x", "1 / cos x", "sin x / cos x", "sin x · cos x"],
      selected: 0,
      correctIndex: 2,
      correct: false,
      explanation: "Tangent is sine over cosine.",
    },
  ],
  correct: 1,
  total: 2,
  at: "2026-11-04T15:05:00.000Z",
  reviewTaskAdded: true,
};

const deck: FlashcardDeck = {
  id: "deck-1",
  title: "La comida",
  classId: "spanish5",
  className: "Spanish III",
  assignmentId: null,
  cards: [
    { front: "la manzana", back: "the apple" },
    { front: "el pescado", back: "the fish" },
    { front: "la cena", back: "dinner" },
  ],
  createdAt: "2026-11-04T15:00:00.000Z",
};

const progress: ProgressSummary = {
  classId: "chem2",
  attempts: 1,
  answered: 3,
  correct: 2,
  topics: [
    {
      classId: "chem2",
      className: "Chemistry",
      topic: "Rate laws",
      correct: 2,
      total: 3,
    },
  ],
  recentMisses: [],
  note: "Based on your completed practice quizzes only. Not a grade or a mastery score.",
};

describe("quizQueryOptions", () => {
  test("asks for the quiz by its id, encoded, under the quiz's key, and reads { quiz, attempt }", async () => {
    const asked = answering(200, { quiz, attempt: null });
    const options = quizQueryOptions("quiz/1");
    // Spread, because the key is typed with the data it holds and the expectation is a bare key.
    expect([...options.queryKey]).toEqual([...studyKeys.quiz("quiz/1")]);
    expect(await fresh().fetchQuery(options)).toEqual({ quiz, attempt: null });
    expect(asked).toEqual([
      {
        url: "/api/openduet/study/quizzes/quiz%2F1",
        method: "GET",
        body: null,
        credentials: "include",
      },
    ]);
    answering(200, { quiz, attempt });
    expect(await fresh().fetchQuery(quizQueryOptions("quiz/1"))).toEqual({
      quiz,
      attempt,
    });
  });

  test("a quiz of the wrong shape is a failed read, in words, and the server's own reason comes through", async () => {
    answering(200, { quiz: { ...quiz, questions: "none" }, attempt: null });
    await expect(
      fresh().fetchQuery(quizQueryOptions("quiz/1")),
    ).rejects.toThrow("Couldn't read this quiz. Reload the page to try again.");
    answering(200, { quiz });
    await expect(
      fresh().fetchQuery(quizQueryOptions("quiz/1")),
    ).rejects.toThrow("Couldn't read this quiz. Reload the page to try again.");
    answering(404, { error: "That quiz isn't here anymore." });
    await expect(fresh().fetchQuery(quizQueryOptions("gone"))).rejects.toThrow(
      "That quiz isn't here anymore.",
    );
    answering(503, "not json");
    await expect(
      fresh().fetchQuery(quizQueryOptions("quiz/1")),
    ).rejects.toThrow("Couldn't open this quiz.");
  });
});

describe("submitAttemptMutationOptions", () => {
  test("posts one choice per question, one check at a time, and never retries on its own", async () => {
    const queryClient = fresh();
    const asked = answering(201, { attempt });
    const options = submitAttemptMutationOptions(queryClient, "quiz/1");
    expect(options.scope).toEqual({ id: "quiz:quiz/1" });
    expect(options.retry).toBe(false);
    expect(
      await new MutationObserver(queryClient, options).mutate([1, 0]),
    ).toEqual(attempt);
    expect(asked).toEqual([
      {
        url: "/api/openduet/study/quizzes/quiz%2F1/attempts",
        method: "POST",
        body: { answers: [1, 0] },
        credentials: "include",
      },
    ]);
  });

  test("puts the attempt in the quiz's query, and has every practice summary and Up next read again", async () => {
    const queryClient = fresh();
    queryClient.setQueryData<QuizWithAttempt>(studyKeys.quiz("quiz/1"), {
      quiz,
      attempt: null,
    });
    queryClient.setQueryData(studyKeys.progress(null), progress);
    queryClient.setQueryData(studyKeys.progress("chem2"), progress);
    queryClient.setQueryData(proactiveKeys.suggestions, []);
    queryClient.setQueryData(studyKeys.deck("deck-1"), deck);
    answering(201, { attempt });

    await new MutationObserver(
      queryClient,
      submitAttemptMutationOptions(queryClient, "quiz/1"),
    ).mutate([1, 0]);

    const cached: QuizWithAttempt | undefined = queryClient.getQueryData(
      studyKeys.quiz("quiz/1"),
    );
    expect(cached).toEqual({ quiz, attempt });
    const invalid = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated;
    expect(invalid(studyKeys.progress(null))).toBe(true);
    expect(invalid(studyKeys.progress("chem2"))).toBe(true);
    expect(invalid(proactiveKeys.suggestions)).toBe(true);
    // The quiz itself is answered, not re-read; nothing else in study is touched.
    expect(invalid(studyKeys.quiz("quiz/1"))).toBe(false);
    expect(invalid(studyKeys.deck("deck-1"))).toBe(false);
  });

  test("leaves Up next alone when nothing was missed", async () => {
    const queryClient = fresh();
    queryClient.setQueryData(proactiveKeys.suggestions, []);
    answering(201, { attempt: { ...attempt, reviewTaskAdded: false } });
    await new MutationObserver(
      queryClient,
      submitAttemptMutationOptions(queryClient, "quiz/1"),
    ).mutate([1, 2]);
    expect(
      queryClient.getQueryState(proactiveKeys.suggestions)?.isInvalidated,
    ).toBe(false);
  });

  test("says the server's reason when it turns the answers away, and a body of the wrong shape in words", async () => {
    answering(400, {
      error: "Answer every question before checking your work.",
    });
    const queryClient = fresh();
    await expect(
      new MutationObserver(
        queryClient,
        submitAttemptMutationOptions(queryClient, "quiz/1"),
      ).mutate([1]),
    ).rejects.toThrow("Answer every question before checking your work.");
    answering(201, { attempt: { ...attempt, results: "none" } });
    await expect(
      new MutationObserver(
        queryClient,
        submitAttemptMutationOptions(queryClient, "quiz/1"),
      ).mutate([1, 0]),
    ).rejects.toThrow(
      "Couldn't read how it went. Reload the page to see your results.",
    );
  });
});

describe("deckQueryOptions and progressQueryOptions", () => {
  test("ask for the deck by its id, under the deck's key, and unwrap { deck }", async () => {
    const asked = answering(200, { deck });
    const options = deckQueryOptions("deck-1");
    expect([...options.queryKey]).toEqual([...studyKeys.deck("deck-1")]);
    expect(await fresh().fetchQuery(options)).toEqual(deck);
    expect(asked.map((request) => request.url)).toEqual([
      "/api/openduet/study/decks/deck-1",
    ]);
    answering(200, { deck: { ...deck, cards: [{ front: "x" }] } });
    await expect(
      fresh().fetchQuery(deckQueryOptions("deck-1")),
    ).rejects.toThrow(
      "Couldn't read these flashcards. Reload the page to try again.",
    );
  });

  test("ask for every class's practice, or one class's, under its own key", async () => {
    const asked = answering(200, { progress });
    const every = progressQueryOptions(null);
    expect([...every.queryKey]).toEqual([...studyKeys.progress(null)]);
    expect(await fresh().fetchQuery(every)).toEqual(progress);
    const one = progressQueryOptions("chem 2");
    expect([...one.queryKey]).toEqual([...studyKeys.progress("chem 2")]);
    expect(await fresh().fetchQuery(one)).toEqual(progress);
    expect(asked.map((request) => request.url)).toEqual([
      "/api/openduet/study/progress",
      "/api/openduet/study/progress?classId=chem+2",
    ]);
  });
});
