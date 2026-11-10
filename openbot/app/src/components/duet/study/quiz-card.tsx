import type {
  QuizAttempt,
  QuizPublic,
  QuizResult,
} from "@openbot/shared/study";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { SmallPill } from "@/components/shell/suggestion-card";
import { cn } from "@/lib/utils";
import { BuildIn } from "../build-in";
import { DuetIcon } from "../icons";
import { DuetCard, Rule } from "../kit";
import { PageText } from "../page-text";

const LETTERS = ["A", "B", "C", "D"] as const;
/* Each answer has its own colour: a soft tint at rest, the full colour once chosen. */
const POP = [
  {
    soft: "bg-duet-pop-a-soft",
    ink: "text-duet-pop-a",
    full: "bg-duet-pop-a",
    ring: "var(--duet-pop-a)",
  },
  {
    soft: "bg-duet-pop-b-soft",
    ink: "text-duet-pop-b",
    full: "bg-duet-pop-b",
    ring: "var(--duet-pop-b)",
  },
  {
    soft: "bg-duet-pop-c-soft",
    ink: "text-duet-pop-c",
    full: "bg-duet-pop-c",
    ring: "var(--duet-pop-c)",
  },
  {
    soft: "bg-duet-pop-d-soft",
    ink: "text-duet-pop-d",
    full: "bg-duet-pop-d",
    ring: "var(--duet-pop-d)",
  },
] as const;

/**
 * A practice quiz in the chat, a question at a time, then how it went.
 *
 * The card never sees an answer key: a question arrives as its text, four choices and a topic, and
 * "Check my work" hands the choices to `onSubmit`, which grades on the server. What comes back, the
 * attempt, carries the right answers and the explanations, and once it is here the card shows that
 * instead of the questions. A quiz has one attempt, so a card read back from history with its
 * attempt opens on the results.
 *
 * Props only, like the brief's card: the tool renderer reads the quiz and its attempt and does the
 * grading, and `onExplain` / `onRetry` are null wherever the conversation cannot take a message.
 */
export function QuizCard({
  quiz,
  attempt,
  onSubmit,
  submitting,
  error,
  onExplain = null,
  onRetry = null,
}: {
  quiz: QuizPublic;
  attempt: QuizAttempt | null;
  onSubmit: (answers: number[]) => void;
  /** True while the answers are being graded. */
  submitting: boolean;
  error: string | null;
  onExplain?: (() => void) | null;
  onRetry?: (() => void) | null;
}) {
  // Results take focus only when they replace the questions here, never when read back from history.
  const [checked, setChecked] = useState(false);
  return (
    <BuildIn order={0}>
      <DuetCard aria-label={`Quiz: ${quiz.title}`} role="region">
        <BuildIn className="px-4 pt-[18px]" order={0}>
          <span className="type-caption inline-flex h-6 items-center rounded-full bg-duet-accent-soft px-2.5 font-semibold text-duet-accent [overflow-wrap:anywhere]">
            {quiz.className}
          </span>
          <p className="type-row mt-2 font-semibold [overflow-wrap:anywhere]">
            {quiz.title}
          </p>
        </BuildIn>
        {attempt ? (
          <QuizResults
            attempt={attempt}
            error={error}
            focusOnArrival={checked}
            onExplain={onExplain}
            onRetry={onRetry}
          />
        ) : (
          <QuizQuestions
            error={error}
            // Each quiz starts from its first question with nothing chosen.
            key={quiz.id}
            onSubmit={(answers) => {
              setChecked(true);
              onSubmit(answers);
            }}
            quiz={quiz}
            submitting={submitting}
          />
        )}
      </DuetCard>
    </BuildIn>
  );
}

function QuizQuestions({
  quiz,
  submitting,
  error,
  onSubmit,
}: {
  quiz: QuizPublic;
  submitting: boolean;
  error: string | null;
  onSubmit: (answers: number[]) => void;
}) {
  const questions = quiz.questions;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() =>
    questions.map(() => null),
  );
  const name = useId();
  const group = useRef<HTMLFieldSetElement>(null);
  const moved = useRef(false);
  /*
   * Back and Next put focus on the new question's choices, the chosen one if there is one. Left on
   * the button, a screen reader would say nothing about the question that just replaced the last.
   */
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const radios = Array.from(
      group.current?.querySelectorAll<HTMLInputElement>(
        `input[name="${name}-${index}"]`,
      ) ?? [],
    );
    (radios.find((radio) => radio.checked) ?? radios[0])?.focus();
  }, [index, name]);

  const question = questions[index];
  if (!question)
    return (
      <p className="type-sub px-4 pt-2 pb-4 text-duet-ink-2">
        This quiz has no questions.
      </p>
    );
  const last = index === questions.length - 1;
  const chosen = answers[index] ?? null;
  const complete = answers.filter(
    (answer): answer is number => answer !== null,
  );
  const answeredAll = complete.length === questions.length;
  const go = (step: number) => {
    moved.current = true;
    setIndex((current) =>
      Math.min(questions.length - 1, Math.max(0, current + step)),
    );
  };
  const choose = (choice: number) =>
    setAnswers((current) =>
      current.map((answer, at) => (at === index ? choice : answer)),
    );
  return (
    <>
      <BuildIn className="px-4 pt-4" order={1}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="type-caption shrink-0 font-medium text-duet-ink-2 tabular-nums">
            {`${index + 1} / ${questions.length}`}
          </p>
          <p className="type-caption min-w-0 truncate text-duet-ink-2">
            {question.topic}
          </p>
        </div>
        {/*
         * The count above says the same in words, so the bar is only for the eye. It slides in from
         * the left rather than stretching, so its rounded end keeps its shape.
         */}
        <div
          aria-hidden
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-duet-tile"
        >
          <div
            className="h-full rounded-full bg-[image:var(--duet-face-gradient)] transition-transform duration-[var(--duet-dur-swap)] motion-reduce:transition-none"
            data-quiz-progress={(index + 1) / questions.length}
            style={{
              transform: `translateX(${((index + 1) / questions.length - 1) * 100}%)`,
            }}
          />
        </div>
        {/* A native radio group: arrow keys move the choice, and the question is its name. */}
        <fieldset className="mt-4 min-w-0" ref={group}>
          <legend className="type-body [overflow-wrap:anywhere]">
            <PageText text={question.question} />
          </legend>
          <div className="mt-3 flex flex-col gap-2">
            {question.choices.map((choice, choiceIndex) => {
              const on = chosen === choiceIndex;
              const pop = POP[choiceIndex % POP.length] ?? POP[0];
              return (
                <label
                  className={cn(
                    "flex min-h-[52px] cursor-pointer items-start gap-3 rounded-[16px] px-3 py-3 transition-[background-color,box-shadow,transform] has-[:disabled]:cursor-default has-[:disabled]:opacity-60 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-duet-accent/40 active:scale-[0.99]",
                    pop.soft,
                    on
                      ? "shadow-[inset_0_0_0_2px_var(--pop)]"
                      : "hover:brightness-[0.97]",
                  )}
                  style={{ "--pop": pop.ring } as CSSProperties}
                  // Choices never reorder within a question, so their place is who they are.
                  // biome-ignore lint/suspicious/noArrayIndexKey: the index is the answer itself.
                  key={choiceIndex}
                >
                  <input
                    checked={on}
                    className="sr-only"
                    disabled={submitting}
                    name={`${name}-${index}`}
                    onChange={() => choose(choiceIndex)}
                    type="radio"
                    value={choiceIndex}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "type-caption mt-0.5 grid size-7 shrink-0 place-items-center rounded-full font-bold transition-colors",
                      on
                        ? cn(pop.full, "text-white")
                        : cn("bg-duet-card", pop.ink),
                    )}
                  >
                    {LETTERS[choiceIndex] ?? ""}
                  </span>
                  <span className="type-body min-w-0 flex-1 leading-relaxed [overflow-wrap:anywhere]">
                    <PageText text={choice} />
                  </span>
                  {on ? (
                    <DuetIcon
                      className={cn("mt-1 shrink-0", pop.ink)}
                      name="check"
                      size={18}
                      stroke={2.4}
                    />
                  ) : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      </BuildIn>
      {error ? (
        <p className="type-sub px-4 pt-3 text-duet-status-problem" role="alert">
          {error}
        </p>
      ) : null}
      <BuildIn className="flex gap-2 px-4 pt-4 pb-4" order={2}>
        <SmallPill disabled={index === 0 || submitting} onClick={() => go(-1)}>
          Back
        </SmallPill>
        {last ? (
          <SmallPill
            disabled={!answeredAll || submitting}
            onClick={() => {
              if (answeredAll) onSubmit(complete);
            }}
            primary
          >
            {submitting ? "Checking…" : "Check"}
          </SmallPill>
        ) : (
          <SmallPill disabled={chosen === null} onClick={() => go(1)} primary>
            Next
          </SmallPill>
        )}
      </BuildIn>
    </>
  );
}

function QuizResults({
  attempt,
  error,
  focusOnArrival,
  onExplain,
  onRetry,
}: {
  attempt: QuizAttempt;
  error: string | null;
  focusOnArrival: boolean;
  onExplain: (() => void) | null;
  onRetry: (() => void) | null;
}) {
  const score = useRef<HTMLParagraphElement>(null);
  // The questions and their buttons are gone, so focus would fall to the page: the score takes it.
  useEffect(() => {
    if (focusOnArrival) score.current?.focus();
  }, [focusOnArrival]);
  const missed = attempt.results.some((result) => !result.correct);
  const perfect = attempt.total > 0 && attempt.correct === attempt.total;
  const explain = missed ? onExplain : null;
  return (
    <>
      <BuildIn className="px-4 pt-4" order={1}>
        <p
          className="type-display font-bold tabular-nums outline-none bg-[image:var(--duet-face-gradient)] bg-clip-text text-transparent w-fit"
          ref={score}
          tabIndex={-1}
        >
          <span aria-hidden>{`${attempt.correct} / ${attempt.total}`}</span>
          <span className="sr-only">{`${attempt.correct} out of ${attempt.total} correct`}</span>
        </p>
        <p className="type-sub mt-0.5 text-duet-ink-2">
          {perfect
            ? "Perfect score."
            : `${attempt.total - attempt.correct} to look at.`}
        </p>
      </BuildIn>
      <BuildIn order={2}>
        <ol aria-label="Your answers" className="mt-3">
          {attempt.results.map((result, index) => (
            <li key={result.questionId}>
              {index > 0 ? <Rule /> : null}
              <ResultRow number={index + 1} result={result} />
            </li>
          ))}
        </ol>
      </BuildIn>
      <BuildIn className="px-4 pt-1 pb-4" order={3}>
        {attempt.reviewTaskAdded ? (
          <p className="type-sub flex items-center gap-2 text-duet-ink-2">
            <DuetIcon className="shrink-0" name="tasks" size={16} />
            <span>Review task added.</span>
          </p>
        ) : null}
        {error ? (
          <p className="type-sub mt-2 text-duet-status-problem" role="alert">
            {error}
          </p>
        ) : null}
        {onRetry || explain ? (
          // One above the other, the next step first: side by side on a phone, "Explain what I
          // missed" broke onto two lines inside half a card.
          <div className="mt-3 flex flex-col gap-2">
            {explain ? (
              <SmallPill onClick={explain} primary>
                Explain
              </SmallPill>
            ) : null}
            {onRetry ? (
              <SmallPill onClick={onRetry} primary={!explain}>
                Try again
              </SmallPill>
            ) : null}
          </div>
        ) : null}
      </BuildIn>
    </>
  );
}

/** A choice's words, or its letter when the attempt lost them. */
function choiceText(result: QuizResult, choice: number): string {
  return result.choices[choice] ?? LETTERS[choice] ?? "No answer";
}

function ResultRow({ number, result }: { number: number; result: QuizResult }) {
  return (
    <div
      className="px-4 py-3"
      data-result={result.correct ? "correct" : "missed"}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="type-caption min-w-0 truncate font-medium text-duet-ink-2">
          {`${number}. ${result.topic}`}
        </p>
        <span
          className={cn(
            "type-caption inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 font-medium",
            result.correct
              ? "bg-duet-status-done-soft text-duet-status-done"
              : "bg-duet-status-problem-soft text-duet-status-problem",
          )}
        >
          <DuetIcon
            name={result.correct ? "check" : "x"}
            size={13}
            stroke={2.6}
          />
          {result.correct ? "Correct" : "Missed"}
        </span>
      </div>
      <p className="type-body mt-1 font-medium [overflow-wrap:anywhere]">
        {result.question}
      </p>
      {result.correct ? null : (
        <p className="type-sub mt-1 text-duet-ink-2 [overflow-wrap:anywhere]">
          {`You said ${choiceText(result, result.selected)}`}
        </p>
      )}
      <p
        className={cn(
          "type-sub text-duet-ink [overflow-wrap:anywhere]",
          result.correct ? "mt-1" : "mt-0.5",
        )}
      >
        <span className="font-semibold text-duet-status-done">
          {choiceText(result, result.correctIndex)}
        </span>
      </p>
      {result.explanation ? (
        <p className="type-sub mt-1 text-duet-ink-2 [overflow-wrap:anywhere]">
          {result.explanation}
        </p>
      ) : null}
    </div>
  );
}
