import type { QuizAttempt } from "@openbot/shared/study";
import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables } from "../../auth/guards";
import {
  type StudyRouteDeps,
  StudyInputError,
  StudyNotFoundError,
} from "./contracts";
import {
  ANSWER_EVERY_QUESTION,
  attemptData,
  attemptFromRecord,
  attemptIdOf,
  CHOICES,
  deckFromRecord,
  gradeQuiz,
  practiceFrom,
  progressSummary,
  publicQuiz,
  QUIZ_QUESTIONS,
  quizFromRecord,
  reviewTaskFor,
  type StoredQuiz,
} from "./quizzes";

/*
 * The quiz card's side of /api/openduet/study: a quiz without its answers, an attempt graded here,
 * a deck, and practice so far. Every read and write is the signed-in person's, and somebody else's
 * quiz is answered exactly as no quiz is.
 *
 * Mounted by routes.ts, which signs the person in, limits the body and maps the Study* errors to
 * answers, so this adds none of the three: an onError here would answer before that mapping does.
 * Each path starts with its own word (quizzes, decks, progress) so no other study router's path is
 * caught by one of these.
 */

/** The longest an id in a path is read as; anything longer is no record of theirs. */
const ID_MAX = 200;

/** One choice (0 to 3) per question, as the card sends them; the count is checked when graded. */
const answersSchema = z
  .object({
    answers: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(CHOICES - 1),
      )
      .min(1)
      .max(QUIZ_QUESTIONS.taken.max),
  })
  .strict();

export function quizRoutes(deps: StudyRouteDeps) {
  const now = () => deps.now?.() ?? new Date();

  /** The person's quiz, with the Bot that made it, or StudyNotFoundError. */
  async function ownQuiz(
    owner: string,
    id: string,
  ): Promise<{ quiz: StoredQuiz; botId: string | null }> {
    const record =
      id.length <= ID_MAX ? await deps.store.get(owner, "quiz", id) : null;
    if (!record) throw new StudyNotFoundError("That quiz isn't here anymore.");
    return { quiz: quizFromRecord(record), botId: record.botId };
  }

  /**
   * A missed topic puts one ten-minute review on Tasks' Up next, for the Bot that made the quiz, and
   * the attempt says so. Grading never waits on it: a review that can't be added is logged, and the
   * attempt stands without it.
   */
  async function withReviewTask(
    owner: string,
    quiz: StoredQuiz,
    botId: string | null,
    attempt: QuizAttempt,
  ): Promise<QuizAttempt> {
    const task = reviewTaskFor(quiz, attempt);
    if (!task) return attempt;
    const failed = (step: string, error: unknown) => {
      console.error(
        JSON.stringify({
          type: "openduet-study-review-task-failed",
          step,
          error: String(error),
          context: { quiz: quiz.id },
          timestamp: new Date().toISOString(),
        }),
      );
      return attempt;
    };
    try {
      await deps.upNext({
        ownerUserId: owner,
        agentId: botId ?? deps.primaryBot,
        cards: [{ ...task, sourceApp: null, sourceLink: null }],
      });
    } catch (error) {
      return failed("add", error);
    }
    const marked: QuizAttempt = { ...attempt, reviewTaskAdded: true };
    try {
      await deps.store.update(owner, "attempt", attempt.id, () => ({
        data: attemptData(marked, quiz.className),
      }));
    } catch (error) {
      // The card is on Up next, but the attempt says what is stored, so a reload says the same.
      return failed("mark", error);
    }
    return marked;
  }

  return new Hono<{ Variables: AppVariables }>()
    .get("/quizzes/:id", async (context) => {
      const owner = context.var.actor.id;
      const { quiz } = await ownQuiz(owner, context.req.param("id"));
      const stored = await deps.store.get(
        owner,
        "attempt",
        attemptIdOf(quiz.id),
      );
      return context.json({
        quiz: publicQuiz(quiz),
        attempt: stored ? attemptFromRecord(stored) : null,
      });
    })
    .post("/quizzes/:id/attempts", async (context) => {
      const body = answersSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!body.success) throw new StudyInputError(ANSWER_EVERY_QUESTION);
      const owner = context.var.actor.id;
      const { quiz, botId } = await ownQuiz(owner, context.req.param("id"));
      const id = attemptIdOf(quiz.id);
      // A quiz has one attempt. Asked again, it is answered as it was first graded, never again.
      const existing = await deps.store.get(owner, "attempt", id);
      if (existing)
        return context.json({ attempt: attemptFromRecord(existing) }, 200);
      const graded = gradeQuiz(quiz, body.data.answers, { id, at: now() });
      const { record, created } = await deps.store.insertOnce(owner, {
        id,
        kind: "attempt",
        botId,
        classId: quiz.classId,
        refId: quiz.id,
        data: attemptData(graded, quiz.className),
      });
      // Two checks at once: the one stored first stands, and only it adds a review.
      if (!created)
        return context.json({ attempt: attemptFromRecord(record) }, 200);
      return context.json(
        { attempt: await withReviewTask(owner, quiz, botId, graded) },
        201,
      );
    })
    .get("/decks/:id", async (context) => {
      const id = context.req.param("id");
      const record =
        id.length <= ID_MAX
          ? await deps.store.get(context.var.actor.id, "deck", id)
          : null;
      if (!record)
        throw new StudyNotFoundError("Those flashcards aren't here anymore.");
      return context.json({ deck: deckFromRecord(record) });
    })
    .get("/progress", async (context) => {
      const owner = context.var.actor.id;
      const classId = context.req.query("classId")?.trim() || null;
      if (classId && classId.length > ID_MAX)
        throw new StudyInputError("Pick one of your classes.");
      const { attempts, classNames } = practiceFrom(
        await deps.store.list(owner, "attempt", {
          limit: 500,
          ...(classId ? { classId } : {}),
        }),
      );
      // The stored classes, for their names only: no Gmail read for a count of practice.
      const snapshot = await deps.school.stored(owner).catch(() => null);
      for (const schoolClass of snapshot?.classes ?? [])
        classNames.set(schoolClass.id, schoolClass.name);
      return context.json({
        progress: progressSummary(attempts, classNames, classId),
      });
    });
}
