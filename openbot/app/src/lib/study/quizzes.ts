import type {
  FlashcardDeck,
  ProgressSummary,
  QuizAttempt,
  QuizPublic,
} from "@openbot/shared/study";
import {
  mutationOptions,
  type QueryClient,
  queryOptions,
} from "@tanstack/react-query";
import { z } from "zod";
import { client } from "@/lib/client";
import { proactiveKeys } from "@/lib/proactive";
import { studyKeys } from "./keys";
import {
  flashcardDeckSchema,
  progressSummarySchema,
  quizAttemptSchema,
  quizPublicSchema,
} from "./schemas";

/*
 * The quiz and flashcard cards' reads and their one write: a quiz with its attempt, the attempt the
 * server grades, a deck, and practice so far (server/src/openduet/study/quiz-routes.ts). The cards
 * re-read the record by the id the tool returned, so what they show survives a reload and matches
 * every other screen.
 */

/** A quiz without its answers, and the attempt once it was checked: what a quiz card draws. */
export type QuizWithAttempt = { quiz: QuizPublic; attempt: QuizAttempt | null };

export const quizWithAttemptSchema = z.object({
  quiz: quizPublicSchema,
  attempt: quizAttemptSchema.nullable(),
}) satisfies z.ZodType<QuizWithAttempt>;

/** Every practice summary, whichever class it covers: what a graded quiz changes. */
const everyProgress = [...studyKeys.all, "progress"] as const;

/**
 * The payload, checked. A body of the wrong shape is a failed read, said in a sentence the person can
 * act on, rather than a list of zod issues on the screen.
 */
function checked<T>(schema: z.ZodType<T>, value: unknown, failure: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(failure);
  return parsed.data;
}

const quizPath = (id: string) =>
  `/api/openduet/study/quizzes/${encodeURIComponent(id)}`;

/** GET /api/openduet/study/quizzes/:id, which answers { quiz, attempt }. */
export function quizQueryOptions(id: string) {
  return queryOptions({
    queryKey: studyKeys.quiz(id),
    queryFn: async ({ signal }): Promise<QuizWithAttempt> => {
      // Two keys in one envelope, so the response is read whole rather than unwrapped by the client.
      const response = await client(quizPath(id), {
        fallback: "Couldn't open this quiz.",
        signal,
      });
      return checked(
        quizWithAttemptSchema,
        await response.json().catch(() => null),
        "Couldn't read this quiz. Reload the page to try again.",
      );
    },
    /*
     * A quiz only changes when it is checked, and checking it writes the attempt into this query
     * itself. A minute keeps a long thread from re-reading every quiz card it scrolls past.
     */
    staleTime: 60_000,
  });
}

/**
 * POST /api/openduet/study/quizzes/:id/attempts with one choice per question, graded on the server.
 * The attempt it answers goes straight into the quiz's query, so the card turns to the results, and
 * every practice summary is read again.
 */
export function submitAttemptMutationOptions(
  queryClient: QueryClient,
  id: string,
) {
  return mutationOptions({
    // One check at a time for a quiz. A second waits for the first, and the server answers it with
    // the same attempt rather than grading again.
    scope: { id: `quiz:${id}` },
    // A check that failed is pressed again by the person, never replayed behind their back.
    retry: false,
    mutationFn: async (answers: number[]): Promise<QuizAttempt> =>
      checked(
        quizAttemptSchema,
        await client<unknown>(`${quizPath(id)}/attempts`, "attempt", {
          method: "POST",
          body: { answers },
          fallback: "Couldn't check your work. Try again.",
        }),
        "Couldn't read how it went. Reload the page to see your results.",
      ),
    onSuccess: async (attempt) => {
      // A read that started while grading must not put the unanswered quiz back over the results.
      await queryClient.cancelQueries({
        queryKey: studyKeys.quiz(id),
        exact: true,
      });
      queryClient.setQueryData<QuizWithAttempt>(
        studyKeys.quiz(id),
        (current) => (current ? { ...current, attempt } : current),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: everyProgress }),
        // A miss put a review on Tasks' Up next: show it there now, not at the next poll.
        ...(attempt.reviewTaskAdded
          ? [
              queryClient.invalidateQueries({
                queryKey: proactiveKeys.suggestions,
              }),
            ]
          : []),
      ]);
    },
  });
}

/** GET /api/openduet/study/decks/:id, which answers { deck }. */
export function deckQueryOptions(id: string) {
  return queryOptions({
    queryKey: studyKeys.deck(id),
    queryFn: async ({ signal }): Promise<FlashcardDeck> =>
      checked(
        flashcardDeckSchema,
        await client<unknown>(
          `/api/openduet/study/decks/${encodeURIComponent(id)}`,
          "deck",
          { fallback: "Couldn't open these flashcards.", signal },
        ),
        "Couldn't read these flashcards. Reload the page to try again.",
      ),
    // A deck never changes once it is made.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** GET /api/openduet/study/progress, for one class or (null) every class, which answers { progress }. */
export function progressQueryOptions(classId: string | null) {
  return queryOptions({
    queryKey: studyKeys.progress(classId),
    queryFn: async ({ signal }): Promise<ProgressSummary> =>
      checked(
        progressSummarySchema,
        await client<unknown>(
          `/api/openduet/study/progress${classId ? `?${new URLSearchParams({ classId })}` : ""}`,
          "progress",
          { fallback: "Couldn't load your practice.", signal },
        ),
        "Couldn't read your practice. Reload the page to try again.",
      ),
  });
}
