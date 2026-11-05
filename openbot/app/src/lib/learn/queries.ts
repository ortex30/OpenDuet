import {
  mutationOptions,
  type QueryClient,
  queryOptions,
} from "@tanstack/react-query";
import { z } from "zod";
import { client } from "@/lib/client";

/*
 * The student's study memory, as the Learn tab reads it: every topic practiced, how well it is
 * known, what is due for spaced review and the mistakes still open. Written by the server's
 * `record_study` tool after any quiz, review or tutoring (server/src/openduet/study-memory.ts).
 */

const level = z.enum(["new", "shaky", "getting-there", "strong"]);
export type MasteryLevel = z.infer<typeof level>;

const topic = z.object({
  id: z.string(),
  subject: z.string(),
  topic: z.string(),
  box: z.number(),
  mastery: z.number(),
  level,
  correctCount: z.number(),
  partlyCount: z.number(),
  missedCount: z.number(),
  lastResult: z.enum(["correct", "partly", "missed"]),
  lastActivity: z.string().nullable(),
  openMistakes: z.array(z.string()),
  fixedMistakes: z.number(),
  due: z.boolean(),
  dueAt: z.string(),
  lastPracticedAt: z.string(),
});
export type StudyTopic = z.infer<typeof topic>;

const overview = z.object({
  totals: z.object({
    topics: z.number(),
    due: z.number(),
    strong: z.number(),
    openMistakes: z.number(),
    practicedThisWeek: z.number(),
  }),
  subjects: z.array(
    z.object({
      subject: z.string(),
      mastery: z.number(),
      topics: z.number(),
      due: z.number(),
      openMistakes: z.number(),
    }),
  ),
  due: z.array(topic),
  weakest: z.array(topic),
  mistakes: z.array(
    z.object({
      topicId: z.string(),
      subject: z.string(),
      topic: z.string(),
      note: z.string(),
    }),
  ),
  topics: z.array(topic),
});
export type StudyOverview = z.infer<typeof overview>;

export const studyKeys = { all: ["openduet", "study"] as const };

export const studyOverviewQueryOptions = () =>
  queryOptions({
    queryKey: studyKeys.all,
    queryFn: async () =>
      overview.parse(
        await client<unknown>("/api/openduet/study", "overview", {
          fallback: "Couldn't load your study memory. Try again.",
        }),
      ),
  });

/** "Got it": the topic's open mistakes are marked fixed. */
export const fixMistakesMutationOptions = (queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (topicId: string) =>
      client<unknown>(
        `/api/openduet/study/topics/${encodeURIComponent(topicId)}/fixed`,
        "topic",
        { method: "POST", fallback: "Couldn't mark that fixed. Try again." },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studyKeys.all }),
  });

/** Forget a topic, such as one recorded under the wrong class. */
export const forgetTopicMutationOptions = (queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (topicId: string) =>
      client(`/api/openduet/study/topics/${encodeURIComponent(topicId)}`, {
        method: "DELETE",
        fallback: "Couldn't forget that topic. Try again.",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: studyKeys.all }),
  });

export const LEVEL_WORDS: Record<MasteryLevel, string> = {
  new: "New",
  shaky: "Shaky",
  "getting-there": "Getting there",
  strong: "Strong",
};

/**
 * What each session button asks the Bot for: the learning skills in skills.yaml, by their titles.
 * The first line becomes the task's title (server/src/openduet/task-store.ts, `titleFrom`).
 */
export const STUDY_ASKS = {
  review:
    "Review what's due.\nRun my spaced review on the topics my study memory says are due today, one question at a time.",
  mistakes:
    "Fix my mistakes.\nGo over the open misunderstandings in my study memory, one at a time, until they're fixed.",
  start:
    "Quiz me on my nearest test.\nOne question at a time, and save how I did to my study memory.",
  subject: (subject: string) =>
    `Practice ${subject}.\nQuiz me one question at a time on my weakest ${subject} topics from my study memory.`,
} as const;
