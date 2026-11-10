import {
  type DeckToolResult,
  type FlashcardDeck,
  PROGRESS_NOTE,
  type ProgressSummary,
  type ProgressTopic,
  type QuizAttempt,
  type QuizPublic,
  type QuizResult,
  type QuizToolResult,
} from "@openbot/shared/study";
import { z } from "zod";
import { REFUSAL_MARKER } from "../../plugins/tools";
import { closed, ENFORCED, type Limits, STATED } from "../page-content";
import { StudyInputError, type StudyRecord } from "./contracts";

/*
 * Practice quizzes and flashcards: what make_quiz and make_flashcards take, how a quiz is kept with
 * its answers and shown without them, how an attempt is graded, and what the practice adds up to.
 * Pure: the tools (quiz-tools.ts) and the routes (quiz-routes.ts) do the reading and writing.
 *
 * A quiz is graded here, never by a model, so the same answers to the same quiz always score the
 * same, and a student is never told a wrong answer was right because a model misread it.
 */

/** How many questions make_quiz is offered, and the wider range it takes, so a near miss isn't a retry. */
export const QUIZ_QUESTIONS = {
  offered: { min: 3, max: 6 },
  taken: { min: 2, max: 8 },
} as const;
/** How many cards make_flashcards is offered, and the wider range it takes. */
export const DECK_CARDS = {
  offered: { min: 8, max: 20 },
  taken: { min: 3, max: 30 },
} as const;
/** A question has exactly this many choices, drawn A to D. */
export const CHOICES = 4;

const CLASS_MAX = 100;
const ASSIGNMENT_MAX = 200;
const TITLE_MAX = 120;
const QUESTION = { min: 3, max: 400 } as const;
const CHOICE_MAX = 200;
const EXPLANATION = { min: 3, max: 500 } as const;
const TOPIC_MAX = 80;
const FRONT_MAX = 200;
const BACK_MAX = 300;

/** The most practice topics a summary lists, weakest first, and the most recent misses it names. */
export const PROGRESS_TOPICS_MAX = 12;
export const RECENT_MISSES_MAX = 8;
/** How long the missed topics in a review task's title may run, after "Review: ". */
export const REVIEW_TOPICS_MAX = 80;

/** What an attempt that is not one whole answer per question is refused with. */
export const ANSWER_EVERY_QUESTION =
  "Answer every question before checking your work.";

/* ------------------------------------------------------------------------------------------------
 * What the tools take: offered to the model with the limits stated, checked in execute with them
 * enforced (the two-schema pattern of pages.ts, built from the same calls so they cannot drift)
 * ---------------------------------------------------------------------------------------------- */

type Range = {
  offered: { min: number; max: number };
  taken: { min: number; max: number };
};

/** A trimmed string of `min` to `max` characters, or only stated as one. */
function text(limits: Limits, min: number, max: number, error: string) {
  return limits.enforce
    ? z.string({ error }).trim().min(min, { error }).max(max, { error })
    : z.string().meta({ minLength: min, maxLength: max });
}

/** A list of `item`: the offered range stated, the wider taken range enforced. */
function listOf<T extends z.ZodType>(
  limits: Limits,
  item: T,
  range: Range,
  error: string,
) {
  return limits.enforce
    ? z
        .array(item, { error })
        .min(range.taken.min, { error })
        .max(range.taken.max, { error })
    : z
        .array(item)
        .meta({ minItems: range.offered.min, maxItems: range.offered.max });
}

const NAME_THE_CLASS =
  "Name the class this is for, exactly as its Classroom notices do.";

/**
 * The class, required and never blank in both schemas. guard.ts reads the teacher's rule for the
 * class named in this argument, and lets a call that names none through to be refused here, so a
 * call without a class must never make anything.
 */
function classWith(limits: Limits) {
  const named = z.string({ error: NAME_THE_CLASS });
  return limits.enforce
    ? named
        .trim()
        .min(1, { error: NAME_THE_CLASS })
        .max(CLASS_MAX, {
          error: `Name the class in at most ${CLASS_MAX} characters.`,
        })
    : named
        .regex(/\S/, { error: NAME_THE_CLASS })
        .meta({ maxLength: CLASS_MAX });
}

/** The assignment it is for. guard.ts reads this argument too, for an assignment's own rule. */
function assignmentWith(limits: Limits) {
  return text(
    limits,
    1,
    ASSIGNMENT_MAX,
    `Name the assignment in at most ${ASSIGNMENT_MAX} characters, or leave it out.`,
  )
    .optional()
    .describe(
      "The assignment it is for, as its Classroom notice names it, when it is for one.",
    );
}

/** Choices compared as a student reads them: "Paris" and " paris" are one choice. */
function sameWords(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const FOUR_CHOICES = `Give exactly ${CHOICES} choices, each 1 to ${CHOICE_MAX} characters.`;

function choicesWith(limits: Limits) {
  if (!limits.enforce)
    return z
      .array(z.string().meta({ minLength: 1, maxLength: CHOICE_MAX }))
      .meta({ minItems: CHOICES, maxItems: CHOICES });
  return z
    .array(text(limits, 1, CHOICE_MAX, FOUR_CHOICES), { error: FOUR_CHOICES })
    .length(CHOICES, { error: FOUR_CHOICES })
    .refine(
      (choices) => new Set(choices.map(sameWords)).size === choices.length,
      { error: `Make the ${CHOICES} choices different from each other.` },
    );
}

const RIGHT_CHOICE = "Give the index of the right choice: 0, 1, 2 or 3.";

function answerWith(limits: Limits) {
  return limits.enforce
    ? z
        .number({ error: RIGHT_CHOICE })
        .int({ error: RIGHT_CHOICE })
        .min(0, { error: RIGHT_CHOICE })
        .max(CHOICES - 1, { error: RIGHT_CHOICE })
    : z
        .number()
        .int()
        .meta({ minimum: 0, maximum: CHOICES - 1 });
}

function questionWith(limits: Limits) {
  return closed(limits, {
    question: text(
      limits,
      QUESTION.min,
      QUESTION.max,
      `Write each question in ${QUESTION.min} to ${QUESTION.max} characters.`,
    ).describe("The question, as the student will read it."),
    choices: choicesWith(limits).describe(
      `${CHOICES} plausible, different choices, in the order they are shown (A to D).`,
    ),
    answer: answerWith(limits).describe(
      "The index of the right choice: 0 for the first, up to 3 for the last.",
    ),
    explanation: text(
      limits,
      EXPLANATION.min,
      EXPLANATION.max,
      `Explain each answer in one sentence of ${EXPLANATION.min} to ${EXPLANATION.max} characters.`,
    ).describe(
      "One sentence on why that choice is right, shown once the student checks their work.",
    ),
    topic: text(
      limits,
      1,
      TOPIC_MAX,
      `Name each question's topic in 1 to ${TOPIC_MAX} characters.`,
    ).describe(
      'A short topic, such as "Trig identities", so practice is counted by topic.',
    ),
  });
}

function quizInputWith(limits: Limits) {
  return closed(limits, {
    class: classWith(limits).describe(
      'The class the quiz is for, exactly as its Classroom notices name it, such as "Precalculus".',
    ),
    assignment: assignmentWith(limits),
    title: text(
      limits,
      1,
      TITLE_MAX,
      `Give the quiz a short title, at most ${TITLE_MAX} characters.`,
    ).describe('A short title naming the topic, such as "Trig identities".'),
    questions: listOf(
      limits,
      questionWith(limits),
      QUIZ_QUESTIONS,
      `Write ${QUIZ_QUESTIONS.offered.min} to ${QUIZ_QUESTIONS.offered.max} questions.`,
    ).describe(
      `${QUIZ_QUESTIONS.offered.min} to ${QUIZ_QUESTIONS.offered.max} multiple-choice questions, mixing easy and hard.`,
    ),
  });
}

/** What make_quiz takes, every limit enforced: the parser its execute runs. */
export const quizInputSchema = quizInputWith(ENFORCED);
export type QuizInput = z.infer<typeof quizInputSchema>;
/** The schema make_quiz is offered with: the shape checked by the runtime, the limits only stated. */
export const offeredQuizSchema = quizInputWith(STATED);

function cardWith(limits: Limits) {
  return closed(limits, {
    front: text(
      limits,
      1,
      FRONT_MAX,
      `Write each card's front in 1 to ${FRONT_MAX} characters.`,
    ).describe("One term, date, name or short question."),
    back: text(
      limits,
      1,
      BACK_MAX,
      `Write each card's back in 1 to ${BACK_MAX} characters.`,
    ).describe("What the front means or answers, in at most 20 words."),
  });
}

function deckInputWith(limits: Limits) {
  return closed(limits, {
    class: classWith(limits).describe(
      'The class the deck is for, exactly as its Classroom notices name it, such as "Spanish III".',
    ),
    assignment: assignmentWith(limits),
    title: text(
      limits,
      1,
      TITLE_MAX,
      `Give the deck a short title, at most ${TITLE_MAX} characters.`,
    ).describe('A short title naming the topic, such as "Unit 5 vocab".'),
    cards: listOf(
      limits,
      cardWith(limits),
      DECK_CARDS,
      `Make ${DECK_CARDS.offered.min} to ${DECK_CARDS.offered.max} cards.`,
    ).describe(
      `${DECK_CARDS.offered.min} to ${DECK_CARDS.offered.max} cards, from the basics to the hardest.`,
    ),
  });
}

/** What make_flashcards takes, every limit enforced. */
export const deckInputSchema = deckInputWith(ENFORCED);
export type DeckInput = z.infer<typeof deckInputSchema>;
export const offeredDeckSchema = deckInputWith(STATED);

function progressInputWith(limits: Limits) {
  const error = `Name the class in at most ${CLASS_MAX} characters, or leave it out for every class.`;
  return closed(limits, {
    class: (limits.enforce
      ? z.string({ error }).trim().max(CLASS_MAX, { error })
      : z.string().meta({ maxLength: CLASS_MAX })
    )
      .optional()
      .describe(
        "The class to show, exactly as its Classroom notices name it. Leave it out for every class.",
      ),
  });
}

/** What show_progress takes: an optional class. */
export const progressInputSchema = progressInputWith(ENFORCED);
export const offeredProgressSchema = progressInputWith(STATED);

/**
 * The arguments with the named optional ones dropped when null or blank: models write
 * `assignment: null` or `assignment: ""` for one they mean to leave out, and refusing it would cost
 * a retry, for make_quiz the whole quiz written again. A required one is left to be refused.
 */
export function withoutBlank(args: unknown, keys: readonly string[]): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  return Object.fromEntries(
    Object.entries(args).filter(
      ([key, value]) =>
        !(
          keys.includes(key) &&
          (value === null || (typeof value === "string" && value.trim() === ""))
        ),
    ),
  );
}

/** How many of a refusal's issues it names: enough to fix a whole quiz in one retry. */
const MOST_ISSUES = 6;

/**
 * Why a call was refused, in lines the model can act on: where, and what to do there. The retry is
 * between the model and the tool, so the student is not told about it.
 */
export function refusalFor(
  tool: string,
  what: string,
  issues: readonly z.core.$ZodIssue[],
): string {
  const lines = issues.slice(0, MOST_ISSUES).map((issue) => {
    const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    if (issue.code === "unrecognized_keys")
      return `${where}Leave out ${issue.keys.map((key) => `"${key}"`).join(", ")}; ${tool} doesn't take ${issue.keys.length === 1 ? "it" : "them"}.`;
    return `${where}${issue.message}`;
  });
  return `${REFUSAL_MARKER} ${tool} couldn't make ${what}. ${lines.join(" ")} Fix ${issues.length === 1 ? "it" : "them"} and call ${tool} again, without mentioning this to the student.`;
}

/* ------------------------------------------------------------------------------------------------
 * Quizzes: kept with their answers, shown without them
 * ---------------------------------------------------------------------------------------------- */

const storedQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  choices: z.array(z.string()).length(CHOICES),
  answer: z
    .number()
    .int()
    .min(0)
    .max(CHOICES - 1),
  explanation: z.string(),
  topic: z.string(),
});

const storedWrittenSchema = z.object({
  id: z.string(),
  kind: z.enum(["short", "free"]),
  prompt: z.string(),
  answer: z.string(),
  topic: z.string(),
  expects: z.array(z.string()),
});

const storedQuizSchema = z.object({
  title: z.string(),
  classId: z.string(),
  className: z.string(),
  assignmentId: z.string().nullable(),
  questions: z.array(storedQuestionSchema).min(1),
  createdAt: z.string(),
  /** Short-answer and free-response items kept with the quiz, never shown with their answers. */
  written: z.array(storedWrittenSchema).optional(),
});

/** A quiz as it is kept: every question with its answer and explanation. Never sent whole. */
export type StoredQuiz = z.infer<typeof storedQuizSchema> & { id: string };

/** Where a quiz or a deck belongs, as rules.ts matched the class and assignment the model named. */
export type StudyPlace = {
  classId: string;
  className: string;
  assignmentId: string | null;
};

/** A new quiz, its questions given stable ids (q1, q2, …) so an attempt's results can name them. */
export function newQuiz(
  input: QuizInput,
  place: StudyPlace,
  stamp: { id: string; at: Date },
): StoredQuiz {
  return {
    id: stamp.id,
    title: input.title,
    classId: place.classId,
    className: place.className,
    assignmentId: place.assignmentId,
    questions: input.questions.map((question, index) => ({
      id: `q${index + 1}`,
      question: question.question,
      choices: [...question.choices],
      answer: question.answer,
      explanation: question.explanation,
      topic: question.topic,
    })),
    createdAt: stamp.at.toISOString(),
  };
}

/** What a quiz record's data holds: the quiz without its id, which is the record's. */
export function quizData(quiz: StoredQuiz): Record<string, unknown> {
  const { id: _id, ...data } = quiz;
  return data;
}

/** A stored quiz read back. One that cannot be read is a fault, never a quiz with no answers. */
export function quizFromRecord(record: StudyRecord): StoredQuiz {
  const parsed = storedQuizSchema.safeParse(record.data);
  if (!parsed.success)
    throw new Error(`The quiz ${record.id} couldn't be read.`);
  return { id: record.id, ...parsed.data };
}

/** The quiz as the student sees it before answering: no answers and no explanations. */
export function publicQuiz(quiz: StoredQuiz): QuizPublic {
  return {
    id: quiz.id,
    title: quiz.title,
    classId: quiz.classId,
    className: quiz.className,
    assignmentId: quiz.assignmentId,
    questions: quiz.questions.map((question) => ({
      id: question.id,
      question: question.question,
      choices: [...question.choices],
      topic: question.topic,
    })),
    createdAt: quiz.createdAt,
  };
}

/** make_quiz's result: what the card needs to find the quiz, and nothing the model could leak. */
export function quizToolResult(quiz: StoredQuiz): QuizToolResult {
  return {
    kind: "quiz",
    id: quiz.id,
    title: quiz.title,
    className: quiz.className,
    count: quiz.questions.length,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Flashcards
 * ---------------------------------------------------------------------------------------------- */

const storedDeckSchema = z.object({
  title: z.string(),
  classId: z.string(),
  className: z.string(),
  assignmentId: z.string().nullable(),
  cards: z.array(z.object({ front: z.string(), back: z.string() })),
  createdAt: z.string(),
});

export function newDeck(
  input: DeckInput,
  place: StudyPlace,
  stamp: { id: string; at: Date },
): FlashcardDeck {
  return {
    id: stamp.id,
    title: input.title,
    classId: place.classId,
    className: place.className,
    assignmentId: place.assignmentId,
    cards: input.cards.map((card) => ({ front: card.front, back: card.back })),
    createdAt: stamp.at.toISOString(),
  };
}

export function deckData(deck: FlashcardDeck): Record<string, unknown> {
  const { id: _id, ...data } = deck;
  return data;
}

export function deckFromRecord(record: StudyRecord): FlashcardDeck {
  const parsed = storedDeckSchema.safeParse(record.data);
  if (!parsed.success)
    throw new Error(`The deck ${record.id} couldn't be read.`);
  return { id: record.id, ...parsed.data };
}

export function deckToolResult(deck: FlashcardDeck): DeckToolResult {
  return {
    kind: "deck",
    id: deck.id,
    title: deck.title,
    className: deck.className,
    count: deck.cards.length,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Grading: one attempt per quiz, its id taken from the quiz's so it is stored once
 * ---------------------------------------------------------------------------------------------- */

/** The one attempt a quiz can have. */
export function attemptIdOf(quizId: string): string {
  return `attempt:${quizId}`;
}

/**
 * The quiz graded against the student's answers, one choice (0 to 3) per question in order. The
 * same quiz, answers and stamp always give the same attempt. It starts without a review task; the
 * route adds one once the attempt is stored.
 */
export function gradeQuiz(
  quiz: StoredQuiz,
  answers: readonly number[],
  stamp: { id: string; at: Date },
): QuizAttempt {
  if (
    answers.length !== quiz.questions.length ||
    !answers.every(
      (answer) => Number.isInteger(answer) && answer >= 0 && answer < CHOICES,
    )
  )
    throw new StudyInputError(ANSWER_EVERY_QUESTION);
  const results: QuizResult[] = quiz.questions.map((question, index) => {
    const selected = answers[index] ?? -1;
    return {
      questionId: question.id,
      topic: question.topic,
      question: question.question,
      choices: [...question.choices],
      selected,
      correctIndex: question.answer,
      correct: selected === question.answer,
      explanation: question.explanation,
    };
  });
  return {
    id: stamp.id,
    quizId: quiz.id,
    classId: quiz.classId,
    results,
    correct: results.filter((result) => result.correct).length,
    total: results.length,
    at: stamp.at.toISOString(),
    reviewTaskAdded: false,
  };
}

const quizResultSchema = z.object({
  questionId: z.string(),
  topic: z.string(),
  question: z.string(),
  choices: z.array(z.string()),
  selected: z.number(),
  correctIndex: z.number(),
  correct: z.boolean(),
  explanation: z.string(),
}) satisfies z.ZodType<QuizResult>;

const quizAttemptSchema = z.object({
  id: z.string(),
  quizId: z.string(),
  classId: z.string(),
  results: z.array(quizResultSchema),
  correct: z.number(),
  total: z.number(),
  at: z.string(),
  reviewTaskAdded: z.boolean(),
}) satisfies z.ZodType<QuizAttempt>;

/** An attempt as it is kept: the attempt, and its class's name for the progress card. */
const storedAttemptSchema = quizAttemptSchema.extend({
  className: z.string().optional(),
});

export function attemptData(
  attempt: QuizAttempt,
  className: string,
): Record<string, unknown> {
  return { ...attempt, className };
}

function readAttempt(
  record: StudyRecord,
): { attempt: QuizAttempt; className: string | null } | null {
  const parsed = storedAttemptSchema.safeParse(record.data);
  if (!parsed.success) return null;
  const { className, ...attempt } = parsed.data;
  return { attempt, className: className ?? null };
}

/** A stored attempt read back, without what is kept beside it. */
export function attemptFromRecord(record: StudyRecord): QuizAttempt {
  const read = readAttempt(record);
  if (!read) throw new Error(`The attempt ${record.id} couldn't be read.`);
  return read.attempt;
}

/**
 * The attempts among stored records, and the class names kept with them. One that cannot be read is
 * left out rather than failing the rest: progress is a count of practice, not a ledger.
 */
export function practiceFrom(records: readonly StudyRecord[]): {
  attempts: QuizAttempt[];
  classNames: Map<string, string>;
} {
  const attempts: QuizAttempt[] = [];
  const classNames = new Map<string, string>();
  for (const record of records) {
    const read = readAttempt(record);
    if (!read) continue;
    attempts.push(read.attempt);
    if (read.className && !classNames.has(read.attempt.classId))
      classNames.set(read.attempt.classId, read.className);
  }
  return { attempts, classNames };
}

/** Topics in the order they were first met, each once however it was capitalised. */
function uniqueTopics(results: readonly QuizResult[]): string[] {
  const seen = new Map<string, string>();
  for (const result of results) {
    const topic = result.topic.trim();
    if (topic && !seen.has(sameWords(topic))) seen.set(sameWords(topic), topic);
  }
  return [...seen.values()];
}

/** Whole topics joined while they fit in `max`, then an ellipsis; a first topic too long alone is cut. */
function topicsWithin(topics: readonly string[], max: number): string {
  const all = topics.join(", ");
  if (all.length <= max) return all;
  let kept = "";
  for (const topic of topics) {
    const next = kept ? `${kept}, ${topic}` : topic;
    if (next.length + 1 > max) break;
    kept = next;
  }
  return kept
    ? `${kept}…`
    : `${(topics[0] ?? "").slice(0, max - 1).trimEnd()}…`;
}

/**
 * The review task a quiz with misses puts on Tasks' Up next, or null when nothing was missed. Ten
 * minutes on the missed topics, with the next step written out, so it can be started cold.
 */
export function reviewTaskFor(
  quiz: StoredQuiz,
  attempt: QuizAttempt,
): { title: string; detail: string } | null {
  const missed = attempt.results.filter((result) => !result.correct);
  if (missed.length === 0) return null;
  return {
    title: `Review: ${topicsWithin(uniqueTopics(missed), REVIEW_TOPICS_MAX)}`,
    detail: `10 minutes. You missed ${missed.length} on "${quiz.title}" in ${quiz.className}. Next: reread the explanations, then ask for 3 practice questions on it.`,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Practice so far
 * ---------------------------------------------------------------------------------------------- */

/** Newest first, ties by id, so a summary never reorders between two reads of the same attempts. */
function newestFirst(a: QuizAttempt, b: QuizAttempt): number {
  return (
    (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/** The share of a topic's questions answered right; one with none answered sorts last. */
function share(topic: ProgressTopic): number {
  return topic.total > 0 ? topic.correct / topic.total : 1;
}

/**
 * Weakest first, as the progress card orders them (weakestFirst in app/src/components/duet/study):
 * the lowest share right, then more questions behind it, then by name.
 */
function weakestFirst(a: ProgressTopic, b: ProgressTopic): number {
  return (
    share(a) - share(b) ||
    b.total - a.total ||
    a.topic.localeCompare(b.topic, "en") ||
    a.className.localeCompare(b.className, "en")
  );
}

/**
 * What the practice quizzes add up to, for one class or (null) every class: how many quizzes,
 * questions and right answers, each topic of each class counted apart and listed weakest first, and
 * the questions missed most recently. Counts only, never a percentage or a mastery score: a few
 * multiple-choice questions say what to practice next, not what somebody knows.
 *
 * `classNames` names each class id, from the student's classes and the names kept with attempts; a
 * class it has no name for is shown by its id.
 */
export function progressSummary(
  attempts: readonly QuizAttempt[],
  classNames: ReadonlyMap<string, string>,
  classId: string | null,
): ProgressSummary {
  const counted = attempts
    .filter((attempt) => classId === null || attempt.classId === classId)
    .sort(newestFirst);
  const topics = new Map<string, ProgressTopic>();
  const recentMisses: ProgressSummary["recentMisses"] = [];
  let answered = 0;
  let correct = 0;
  for (const attempt of counted) {
    const className = classNames.get(attempt.classId) ?? attempt.classId;
    for (const result of attempt.results) {
      answered++;
      if (result.correct) correct++;
      const name = result.topic.trim() || "General";
      // Newest first, so a topic keeps the way it was written most recently.
      const key = `${attempt.classId}\u0000${sameWords(name)}`;
      const topic = topics.get(key) ?? {
        classId: attempt.classId,
        className,
        topic: name,
        correct: 0,
        total: 0,
      };
      topic.total++;
      if (result.correct) topic.correct++;
      topics.set(key, topic);
      if (!result.correct && recentMisses.length < RECENT_MISSES_MAX)
        recentMisses.push({
          quizId: attempt.quizId,
          classId: attempt.classId,
          topic: name,
          question: result.question,
          at: attempt.at,
        });
    }
  }
  return {
    classId,
    attempts: counted.length,
    answered,
    correct,
    topics: [...topics.values()]
      .sort(weakestFirst)
      .slice(0, PROGRESS_TOPICS_MAX),
    recentMisses,
    note: PROGRESS_NOTE,
  };
}
