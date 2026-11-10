import type { ProgressSummary, ProgressTopic } from "@openbot/shared/study";
import { cn } from "@/lib/utils";
import { type ReactNode, useState } from "react";
import { BuildIn } from "../build-in";
import { DuetCard, Rule, SectionLabel } from "../kit";

/** The share of a topic's questions answered right; a topic with none answered sorts last. */
function share(topic: ProgressTopic): number {
  return topic.total > 0 ? topic.correct / topic.total : 1;
}

/**
 * Topics with the lowest share right first, since those are what to practice. A tie goes to the
 * topic with more questions behind it, then to the name, so the order never shuffles between reads.
 */
export function weakestFirst(
  topics: readonly ProgressTopic[],
): ProgressTopic[] {
  return [...topics].sort(
    (a, b) =>
      share(a) - share(b) ||
      b.total - a.total ||
      a.topic.localeCompare(b.topic) ||
      a.className.localeCompare(b.className),
  );
}

/**
 * What the student's practice quizzes add up to: how many quizzes, questions and right answers,
 * each topic weakest first, and the questions missed most recently.
 *
 * Counts, not a grade. There is no percentage and no "mastery": a few multiple-choice questions
 * say what to practice next, not what somebody knows, and the note under every card says so.
 */
export function ProgressCard({ summary }: { summary: ProgressSummary }) {
  const classNames = new Map(
    summary.topics.map((topic) => [topic.classId, topic.className]),
  );
  const everyClass = summary.classId === null;
  const scope = everyClass
    ? "All classes"
    : (classNames.get(summary.classId ?? "") ?? null);
  const empty = summary.attempts === 0;
  const topics = weakestFirst(summary.topics);
  return (
    <BuildIn order={0}>
      <DuetCard aria-label="Practice progress" role="region">
        <BuildIn className="px-4 pt-[18px]" order={0}>
          {scope ? (
            <p className="type-sub font-medium text-duet-ink-2 [overflow-wrap:anywhere]">
              {scope}
            </p>
          ) : null}
          <p className="type-row mt-0.5 font-semibold">How you're doing</p>
          {empty ? (
            <p className="type-sub mt-1 text-duet-ink-2">
              No practice quizzes yet. Ask for a quiz, and how you did shows up
              here.
            </p>
          ) : null}
        </BuildIn>
        {empty ? null : (
          <>
            <BuildIn className="px-4 pt-3" order={1}>
              <dl className="grid grid-cols-3 gap-2">
                <Stat
                  label={summary.attempts === 1 ? "Quiz" : "Quizzes"}
                  value={summary.attempts}
                />
                <Stat
                  label={summary.answered === 1 ? "Question" : "Questions"}
                  value={summary.answered}
                />
                <Stat label="Correct" value={summary.correct} />
              </dl>
            </BuildIn>
            {topics.length > 0 ? (
              <BuildIn order={2}>
                <section className="mt-4">
                  <SectionLabel>Work on these</SectionLabel>
                  <Folded
                    items={topics}
                    keyOf={(topic) => `${topic.classId}:${topic.topic}`}
                    label="Topics"
                    render={(topic) => (
                      <TopicRow showClass={everyClass} topic={topic} />
                    )}
                  />
                </section>
              </BuildIn>
            ) : null}
            {summary.recentMisses.length > 0 ? (
              <BuildIn order={3}>
                <section className="mt-4">
                  <SectionLabel>Recent misses</SectionLabel>
                  <Folded
                    items={summary.recentMisses}
                    keyOf={(miss) => `${miss.quizId}:${miss.question}`}
                    label="Missed lately"
                    render={(miss) => (
                      <div className="px-4 py-2.5">
                        <p className="type-sub font-medium [overflow-wrap:anywhere]">
                          {miss.question}
                        </p>
                        <p className="type-caption mt-0.5 text-duet-ink-2 [overflow-wrap:anywhere]">
                          {everyClass && classNames.get(miss.classId)
                            ? `${miss.topic} · ${classNames.get(miss.classId)}`
                            : miss.topic}
                        </p>
                      </div>
                    )}
                  />
                </section>
              </BuildIn>
            ) : null}
          </>
        )}
        <BuildIn className="px-4 pt-3 pb-4" order={4}>
          <p className="type-caption text-duet-ink-2">{summary.note}</p>
        </BuildIn>
      </DuetCard>
    </BuildIn>
  );
}

const STAT_TONE: Record<string, string> = {
  Quiz: "bg-duet-pop-a-soft text-duet-pop-a",
  Quizzes: "bg-duet-pop-a-soft text-duet-pop-a",
  Question: "bg-duet-pop-c-soft text-duet-pop-c",
  Questions: "bg-duet-pop-c-soft text-duet-pop-c",
  Correct: "bg-duet-pop-b-soft text-duet-pop-b",
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    // The term comes first for a screen reader ("Quizzes, 3"); the number reads first by eye.
    <div className={cn("flex min-w-0 flex-col-reverse rounded-[14px] px-3 py-2.5", STAT_TONE[label] ?? "bg-duet-tile")}>
      <dt className="type-caption truncate opacity-80">{label}</dt>
      <dd className="type-display font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function TopicRow({
  topic,
  showClass,
}: {
  topic: ProgressTopic;
  showClass: boolean;
}) {
  const filled = Math.round(Math.min(1, Math.max(0, share(topic))) * 100);
  return (
    <div className="px-4 py-2.5" data-topic={topic.topic}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-body min-w-0 font-medium [overflow-wrap:anywhere]">
          {topic.topic}
        </p>
        <p className="type-sub shrink-0 font-medium text-duet-ink-2 tabular-nums">
          <span aria-hidden>{`${topic.correct} / ${topic.total}`}</span>
          <span className="sr-only">{`${topic.correct} of ${topic.total} correct`}</span>
        </p>
      </div>
      {showClass ? (
        <p className="type-caption text-duet-ink-2 [overflow-wrap:anywhere]">
          {topic.className}
        </p>
      ) : null}
      {/* The count beside the name says the same in words, so the bar is only for the eye. */}
      <div
        aria-hidden
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-duet-tile"
      >
        <div
          className="h-full rounded-full bg-duet-ink-2"
          style={{ width: `${topic.total > 0 ? filled : 0}%` }}
        />
      </div>
    </div>
  );
}

/** How many rows a list shows before "Show N more", as the brief's sections do (SECTION_ROWS). */
const SHOWN = 5;

/** A list that folds after a few rows. One row over is shown whole, since "Show 1 more" saves nothing. */
function Folded<T>({
  items,
  label,
  keyOf,
  render,
}: {
  items: readonly T[];
  label: string;
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const folded = !open && items.length > SHOWN + 1;
  const shown = folded ? items.slice(0, SHOWN) : items;
  const hidden = items.length - shown.length;
  return (
    <>
      <ul className="mt-1">
        {shown.map((item, index) => (
          <li key={keyOf(item)}>
            {index > 0 ? <Rule /> : null}
            {render(item)}
          </li>
        ))}
      </ul>
      {folded ? (
        <div className="px-4 pt-0.5">
          <button
            aria-label={`Show ${hidden} more in ${label}`}
            className="type-sub -mx-2 inline-flex h-11 items-center gap-1 rounded-full px-2 font-medium text-duet-accent transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 active:opacity-60"
            onClick={() => setOpen(true)}
            type="button"
          >
            {`Show ${hidden} more`}
          </button>
        </div>
      ) : null}
    </>
  );
}
