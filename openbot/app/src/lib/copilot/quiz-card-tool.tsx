import { useRenderTool } from "@copilotkit/react-core/v2";
import {
  type QuizAttempt,
  type QuizResult,
  QUIZ_TOOL,
  type QuizToolResult,
  readTeacherRuleBlock,
  type TeacherRuleBlock,
} from "@openbot/shared/study";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { useConversationSend } from "@/components/channels/conversation-send";
import { ToolLine } from "@/components/channels/tool-line";
import { BuildInProvider, useArrivedLive } from "@/components/duet/build-in";
import { DuetCard } from "@/components/duet/kit";
import { plural, QuizCard, TeacherRuleNotice } from "@/components/duet/study";
import { SmallPill } from "@/components/shell/suggestion-card";
import { readToolName } from "@/lib/plugins/tool-name";
import { asText, REFUSAL_MARKER } from "@/lib/plugins/tool-result";
import {
  quizQueryOptions,
  submitAttemptMutationOptions,
} from "@/lib/study/quizzes";
import { quizToolResultSchema, readToolResult } from "@/lib/study/schemas";
import { HeldUntilReplied } from "./page-card-tool";

/*
 * Draws the server's `make_quiz` (server/src/openduet/study/quiz-tools.ts) as a practice quiz in the
 * chat, under the Bot's line about it. The tool's result names the quiz and nothing more; the card
 * reads the quiz by its id, without its answers, runs it a question at a time, and hands the choices
 * to the server, which grades them and keeps the attempt. So a quiz opened again after a reload
 * shows how it went, and no answer ever passes through this code before the student has answered.
 *
 * Never drawn from the call's streaming arguments: those are the model's draft, answers and all.
 */

const parameters = z.object({ title: z.string().optional() });

/**
 * The teacher's rule a study tool was refused under, or null for anything else: the refusal guard.ts
 * writes, possibly JSON-encoded once or twice more on its way through the runtime. The transcript
 * keeps exactly these refusals as cards (repliesLast in chat-messages.ts) and drops the rest.
 */
export function readTeacherRule(result: unknown): TeacherRuleBlock | null {
  if (typeof result !== "string") return null;
  let text = result;
  for (let pass = 0; pass < 2; pass++) {
    const unwrapped = asText(text);
    if (unwrapped === text) break;
    text = unwrapped;
  }
  return text.trimStart().startsWith(REFUSAL_MARKER)
    ? readTeacherRuleBlock(text)
    : null;
}

/**
 * Words a card can send as the student's own message, each at most once. Null where there is no
 * conversation to send to, which hides the button, and null once the words went, so a second press
 * never asks twice. Words the conversation could not take (it is read-only, say) stay pressable.
 */
export function useSendOnce(): (words: string) => (() => void) | null {
  const conversation = useConversationSend();
  const [sent, setSent] = useState<readonly string[]>([]);
  return (words) => {
    if (!conversation || sent.includes(words)) return null;
    return () => {
      if (conversation.send(words)) setSent((before) => [...before, words]);
    };
  };
}

/** About the longest the Explain words run; past it, the later misses are only counted. */
const EXPLAIN_LIMIT = 600;
/** The most of one choice quoted in them, so a single long choice can't take all the room. */
const CHOICE_LIMIT = 100;

/** A choice's words, cut at a word near `CHOICE_LIMIT`, or its letter when the attempt lost them. */
function quotedChoice(result: QuizResult, choice: number): string {
  const text = result.choices[choice] ?? "ABCD"[choice] ?? "no answer";
  if (text.length <= CHOICE_LIMIT) return text;
  const cut = text.slice(0, CHOICE_LIMIT);
  const space = cut.lastIndexOf(" ");
  return `${(space > CHOICE_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * What "Explain what I missed" sends: which questions were missed, what was picked and what the
 * answer is. The Bot can't look this up: the quiz is graded on the server and the attempt never goes
 * into the conversation. The numbers follow the order the Bot wrote the questions in, which grading
 * keeps. Past about 600 characters the later misses are counted instead ("and 2 more"). Null when
 * nothing was missed.
 */
export function explainWords(
  title: string,
  attempt: Pick<QuizAttempt, "results">,
): string | null {
  const misses = attempt.results.flatMap((result, index) =>
    result.correct
      ? []
      : [
          `question ${index + 1} (${result.topic}; I picked "${quotedChoice(result, result.selected)}", the answer is "${quotedChoice(result, result.correctIndex)}")`,
        ],
  );
  if (misses.length === 0) return null;
  const head = `Explain what I missed on "${title}": `;
  for (let shown = misses.length; ; shown--) {
    const rest = misses.length - shown;
    const words = `${head}${listed([
      ...misses.slice(0, shown),
      ...(rest > 0 ? [`${rest} more`] : []),
    ])}.`;
    if (words.length <= EXPLAIN_LIMIT || shown === 1) return words;
  }
}

/**
 * Where a quiz or a deck sits while its record loads, or says why it didn't: the class, the title
 * and the size the tool reported, laid out as the card's own header so nothing moves when it lands.
 */
export function StudyCardPlaceholder({
  name,
  schoolClass,
  title,
  size,
  error,
  onRetry,
}: {
  /** The card's accessible name, the same as the card's own. */
  name: string;
  /** The class it is for, such as "Precalculus". */
  schoolClass: string;
  title: string;
  /** "5 questions", "12 cards". */
  size: string;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <DuetCard
      aria-busy={error ? undefined : true}
      aria-label={name}
      role="region"
    >
      <div className="px-4 pt-[18px] pb-4">
        <p className="type-sub font-medium text-duet-ink-2 [overflow-wrap:anywhere]">
          {schoolClass}
        </p>
        <p className="type-row mt-0.5 font-semibold [overflow-wrap:anywhere]">
          {title}
        </p>
        {error ? (
          <>
            <p className="type-sub mt-2 text-duet-status-problem" role="alert">
              {error}
            </p>
            <div className="mt-3 flex">
              <SmallPill onClick={onRetry}>Try again</SmallPill>
            </div>
          </>
        ) : (
          <p className="type-sub mt-1 text-duet-ink-2">{size}</p>
        )}
      </div>
    </DuetCard>
  );
}

/**
 * The quiz the tool made, read by its id and checked through the server. The read starts as soon as
 * the tool answers, while the card still waits under the Bot's words, so it is usually there when
 * the card comes in.
 */
export function QuizToolCard({ made }: { made: QuizToolResult }) {
  const queryClient = useQueryClient();
  const read = useQuery(quizQueryOptions(made.id));
  const check = useMutation(submitAttemptMutationOptions(queryClient, made.id));
  const sendOnce = useSendOnce();
  const loaded = read.data;
  const explain = loaded?.attempt
    ? explainWords(loaded.quiz.title, loaded.attempt)
    : null;
  return (
    <HeldUntilReplied title={made.title} tool={QUIZ_TOOL}>
      {loaded ? (
        <QuizCard
          attempt={loaded.attempt}
          error={check.error?.message ?? null}
          onExplain={explain ? sendOnce(explain) : null}
          onRetry={sendOnce(`Quiz me again on ${loaded.quiz.title}.`)}
          onSubmit={(answers) => check.mutate(answers)}
          quiz={loaded.quiz}
          submitting={check.isPending}
        />
      ) : (
        <StudyCardPlaceholder
          error={read.isError ? read.error.message : null}
          name={`Quiz: ${made.title}`}
          onRetry={() => void read.refetch()}
          schoolClass={made.className}
          size={plural(made.count, "question", "questions")}
          title={made.title}
        />
      )}
    </HeldUntilReplied>
  );
}

/** The tool's line while it writes the quiz, then the quiz, or the teacher's rule that paused it. */
function QuizToolView({
  result,
  running,
}: {
  result: unknown;
  running: boolean;
}) {
  const live = useArrivedLive(running);
  if (running)
    return <ToolLine label={readToolName(QUIZ_TOOL, true).label} running />;
  const rule = readTeacherRule(result);
  /*
   * Not held under the Bot's words like a card: the line holding a card's place says what the tool
   * made ("Wrote your quiz"), and here nothing was made.
   */
  if (rule)
    return (
      <BuildInProvider value={live}>
        <TeacherRuleNotice block={rule} what="Quiz" />
      </BuildInProvider>
    );
  const made = readToolResult(result, quizToolResultSchema);
  /*
   * Nothing for any other refusal, or for a result that is not a quiz. The Bot is told what to fix
   * and tries again; a line saying so would show the student the Bot's mistake, not a quiz.
   */
  if (!made) return null;
  return (
    <BuildInProvider value={live}>
      <QuizToolCard made={made} />
    </BuildInProvider>
  );
}

export function QuizCardTool() {
  useRenderTool({
    name: QUIZ_TOOL,
    parameters,
    render: ({ result, status }) => (
      <QuizToolView
        result={result}
        running={status !== "complete" && result === undefined}
      />
    ),
  });
  return null;
}
