import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { DuetIcon } from "@/components/duet/icons";
import { DuetCard, SectionLabel } from "@/components/duet/kit";
import { ScreenScroll, ScreenTitle } from "@/components/shell/screen";
import { SmallPill } from "@/components/shell/suggestion-card";
import { primaryBot } from "@/lib/agents/primary-bot";
import { agentListQueryOptions } from "@/lib/agents/queries";
import {
  fixMistakesMutationOptions,
  forgetTopicMutationOptions,
  LEVEL_WORDS,
  type MasteryLevel,
  STUDY_ASKS,
  type StudyOverview,
  type StudyTopic,
  studyOverviewQueryOptions,
} from "@/lib/learn/queries";
import { startTaskMutationOptions } from "@/lib/tasks/mutations";
import { cn } from "@/lib/utils";
import { queryClient } from "@/query-client";

/*
 * The Learn tab: what the student knows, from their study memory. Every quiz, review, tutoring
 * problem and teach-back saves how each topic went (server/src/openduet/study-memory.ts), and this
 * draws it: mastery per class, the topics due for spaced review today, and the mistakes still open.
 * Each session button starts a task with the matching learning skill, so the review happens in a
 * conversation of its own and its results come straight back here.
 */

const LEVEL_TONE: Record<MasteryLevel, string> = {
  new: "bg-duet-tile text-duet-ink-2",
  shaky: "bg-duet-red-soft text-duet-red",
  "getting-there": "bg-duet-amber-soft text-duet-amber",
  strong: "bg-duet-green-soft text-duet-green",
};

const BAR_TONE = (mastery: number) =>
  mastery >= 75
    ? "bg-duet-green"
    : mastery >= 40
      ? "bg-duet-amber"
      : "bg-duet-red";

export function LearnScreen() {
  const agents = useQuery(agentListQueryOptions());
  const bot = primaryBot(agents.data);
  const study = useQuery(studyOverviewQueryOptions());
  const navigate = useNavigate();
  const start = useMutation(startTaskMutationOptions(queryClient));
  const begin = (instruction: string) => {
    if (!bot || start.isPending) return;
    start.mutate(
      { botId: bot.id, instruction },
      {
        onSuccess: (task) =>
          navigate({ to: "/tasks/$taskId", params: { taskId: task.id } }),
      },
    );
  };
  return (
    <ScreenScroll>
      <ScreenTitle title="Learn">
        What you know, and what to review today.
      </ScreenTitle>
      {start.error ? (
        <p className="type-sub mb-3 px-1 text-duet-red" role="alert">
          {start.error.message}
        </p>
      ) : null}
      {study.isPending ? null : study.error ? (
        <p className="type-sub px-1 text-duet-red" role="alert">
          {study.error.message}
        </p>
      ) : study.data.totals.topics === 0 ? (
        <EmptyLearn
          busy={start.isPending}
          canStart={Boolean(bot)}
          onStart={() => begin(STUDY_ASKS.start)}
        />
      ) : (
        <LearnBody
          busy={start.isPending}
          canStart={Boolean(bot)}
          onBegin={begin}
          overview={study.data}
        />
      )}
    </ScreenScroll>
  );
}

function EmptyLearn({
  busy,
  canStart,
  onStart,
}: {
  busy: boolean;
  canStart: boolean;
  onStart: () => void;
}) {
  return (
    <DuetCard className="px-5 py-6 text-center" data-learn-empty="">
      <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-duet-accent-soft text-duet-accent">
        <DuetIcon name="bulb" size={24} />
      </div>
      <p className="type-row font-semibold">Nothing practiced yet</p>
      <p className="type-sub mx-auto mt-1 max-w-[280px] text-duet-ink-2">
        Take a quick quiz and every topic you practice shows up here, with
        reviews spaced so it sticks.
      </p>
      <div className="mx-auto mt-4 flex max-w-[220px]">
        <SmallPill disabled={busy || !canStart} onClick={onStart} primary>
          Start with a quiz
        </SmallPill>
      </div>
    </DuetCard>
  );
}

function LearnBody({
  overview,
  busy,
  canStart,
  onBegin,
}: {
  overview: StudyOverview;
  busy: boolean;
  canStart: boolean;
  onBegin: (instruction: string) => void;
}) {
  const { totals } = overview;
  return (
    <div className="flex flex-col gap-5">
      <DuetCard className="px-4 py-4" data-learn-today="">
        <div className="grid grid-cols-4 gap-2 text-center">
          <Metric label="Topics" value={totals.topics} />
          <Metric label="Due today" tone="accent" value={totals.due} />
          <Metric label="Strong" tone="green" value={totals.strong} />
          <Metric label="Mistakes" tone="red" value={totals.openMistakes} />
        </div>
        <div className="mt-4 flex gap-2">
          {totals.due > 0 ? (
            <SmallPill
              disabled={busy || !canStart}
              onClick={() => onBegin(STUDY_ASKS.review)}
              primary
            >
              Review {totals.due} {totals.due === 1 ? "topic" : "topics"}
            </SmallPill>
          ) : (
            <p className="type-sub flex min-h-11 flex-1 items-center justify-center text-duet-green">
              <DuetIcon className="mr-1" name="checkCircle" size={16} />
              All caught up on reviews
            </p>
          )}
          {totals.openMistakes > 0 ? (
            <SmallPill
              disabled={busy || !canStart}
              onClick={() => onBegin(STUDY_ASKS.mistakes)}
            >
              Fix mistakes
            </SmallPill>
          ) : null}
        </div>
      </DuetCard>

      <section aria-labelledby="learn-classes" className="flex flex-col gap-2">
        <div id="learn-classes">
          <SectionLabel>Mastery by class</SectionLabel>
        </div>
        {overview.subjects.map((subject) => (
          <SubjectCard
            busy={busy || !canStart}
            key={subject.subject}
            onReview={() => onBegin(STUDY_ASKS.subject(subject.subject))}
            subject={subject}
            topics={overview.topics.filter(
              (topic) =>
                topic.subject.toLowerCase() === subject.subject.toLowerCase(),
            )}
          />
        ))}
      </section>

      {overview.due.length > 0 ? (
        <section aria-labelledby="learn-due" className="flex flex-col gap-2">
          <div id="learn-due">
            <SectionLabel>Due for review</SectionLabel>
          </div>
          <DuetCard className="divide-y divide-duet-hair-2">
            {overview.due.slice(0, 8).map((topic) => (
              <div className="px-4 py-3" key={topic.id}>
                <div className="flex items-start justify-between gap-2">
                  <p className="type-body font-medium [overflow-wrap:anywhere]">
                    {topic.topic}
                  </p>
                  <LevelPill level={topic.level} />
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <BoxDots box={topic.box} />
                  <p className="type-label min-w-0 text-duet-ink-2">
                    {topic.subject} · last time {RESULT_WORDS[topic.lastResult]}
                  </p>
                </div>
              </div>
            ))}
          </DuetCard>
        </section>
      ) : null}

      {overview.mistakes.length > 0 ? (
        <MistakeList mistakes={overview.mistakes} />
      ) : null}
    </div>
  );
}

const RESULT_WORDS = {
  correct: "right",
  partly: "partly right",
  missed: "missed",
} as const;

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "accent" | "green" | "red";
}) {
  return (
    <div>
      <p
        className={cn(
          "type-display font-semibold tabular-nums",
          tone === "accent" && value > 0 && "text-duet-accent",
          tone === "green" && value > 0 && "text-duet-green",
          tone === "red" && value > 0 && "text-duet-red",
        )}
      >
        {value}
      </p>
      <p className="type-label text-duet-ink-2">{label}</p>
    </div>
  );
}

function SubjectCard({
  subject,
  topics,
  busy,
  onReview,
}: {
  subject: StudyOverview["subjects"][number];
  topics: StudyTopic[];
  busy: boolean;
  onReview: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = `learn-subject-${subject.subject.replace(/\W+/g, "-")}`;
  return (
    <DuetCard data-learn-subject={subject.subject}>
      <button
        aria-controls={panel}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-violet/40"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="type-row font-semibold [overflow-wrap:anywhere]">
              {subject.subject}
            </p>
            <p className="type-sub shrink-0 font-semibold tabular-nums">
              {subject.mastery}%
            </p>
          </div>
          <MasteryBar mastery={subject.mastery} />
          <p className="type-label mt-1.5 text-duet-ink-2">
            {subject.topics} {subject.topics === 1 ? "topic" : "topics"}
            {subject.due > 0 ? ` · ${subject.due} due` : ""}
            {subject.openMistakes > 0
              ? ` · ${subject.openMistakes} ${subject.openMistakes === 1 ? "mistake" : "mistakes"}`
              : ""}
          </p>
        </div>
        <DuetIcon
          className={cn(
            "shrink-0 text-duet-ink-3 transition-transform",
            open && "rotate-90",
          )}
          name="chevronRight"
          size={18}
        />
      </button>
      {open ? (
        <div className="border-duet-hair-2 border-t px-4 pt-1 pb-3" id={panel}>
          <ul className="divide-y divide-duet-hair-2">
            {[...topics]
              .sort((a, b) => a.mastery - b.mastery)
              .map((topic) => (
                <TopicRow key={topic.id} topic={topic} />
              ))}
          </ul>
          <div className="mt-2 flex">
            <SmallPill disabled={busy} onClick={onReview}>
              Practice {subject.subject}
            </SmallPill>
          </div>
        </div>
      ) : null}
    </DuetCard>
  );
}

function TopicRow({ topic }: { topic: StudyTopic }) {
  const forget = useMutation(forgetTopicMutationOptions(queryClient));
  return (
    <li className="flex items-center gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="type-body [overflow-wrap:anywhere]">{topic.topic}</p>
          <LevelPill level={topic.level} />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <BoxDots box={topic.box} />
          <p className="type-label min-w-0 text-duet-ink-2">
            {record(topic)} · {nextReview(topic)}
          </p>
        </div>
      </div>
      <button
        aria-label={`Forget ${topic.topic}`}
        className="grid size-9 shrink-0 place-items-center rounded-full text-duet-ink-3 hover:bg-duet-tile hover:text-duet-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-violet/40 disabled:opacity-50"
        disabled={forget.isPending}
        onClick={() => forget.mutate(topic.id)}
        type="button"
      >
        <DuetIcon name="trash" size={16} />
      </button>
    </li>
  );
}

/** "2 right, 1 missed": only the counts that are not zero. */
function record(topic: StudyTopic): string {
  return (
    [
      topic.correctCount ? `${topic.correctCount} right` : "",
      topic.partlyCount ? `${topic.partlyCount} partly` : "",
      topic.missedCount ? `${topic.missedCount} missed` : "",
    ]
      .filter(Boolean)
      .join(", ") || "not tried"
  );
}

function MistakeList({ mistakes }: { mistakes: StudyOverview["mistakes"] }) {
  const fix = useMutation(fixMistakesMutationOptions(queryClient));
  return (
    <section aria-labelledby="learn-mistakes" className="flex flex-col gap-2">
      <div id="learn-mistakes">
        <SectionLabel>Mistakes to fix</SectionLabel>
      </div>
      <DuetCard className="divide-y divide-duet-hair-2">
        {mistakes.map((mistake) => (
          <div
            className="flex items-start gap-3 px-4 py-3"
            data-learn-mistake=""
            key={`${mistake.topicId}-${mistake.note}`}
          >
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-duet-red-soft text-duet-red">
              <DuetIcon name="alert" size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="type-body [overflow-wrap:anywhere]">
                {mistake.note}
              </p>
              <p className="type-label text-duet-ink-2">
                {mistake.subject} · {mistake.topic}
              </p>
            </div>
            <button
              className="type-label min-h-9 shrink-0 rounded-full px-3 font-semibold text-duet-ink shadow-[inset_0_0_0_1px_var(--duet-hair)] hover:bg-duet-tile focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-violet/40 disabled:opacity-50"
              disabled={fix.isPending}
              onClick={() => fix.mutate(mistake.topicId)}
              type="button"
            >
              Got it
            </button>
          </div>
        ))}
      </DuetCard>
      {fix.error ? (
        <p className="type-sub px-1 text-duet-red" role="alert">
          {fix.error.message}
        </p>
      ) : null}
    </section>
  );
}

function MasteryBar({ mastery }: { mastery: number }) {
  return (
    <div
      aria-label={`${mastery}% mastered`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={mastery}
      className="mt-1.5 h-2 overflow-hidden rounded-full bg-duet-tile"
      role="progressbar"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          BAR_TONE(mastery),
        )}
        style={{ width: `${Math.max(3, mastery)}%` }}
      />
    </div>
  );
}

/** The topic's Leitner box as five dots: how many reviews in a row it has climbed. */
function BoxDots({ box }: { box: number }) {
  return (
    <span
      aria-label={`Box ${box} of 5`}
      className="flex shrink-0 gap-[3px]"
      role="img"
    >
      {[1, 2, 3, 4, 5].map((dot) => (
        <span
          className={cn(
            "size-[6px] rounded-full",
            dot <= box ? "bg-duet-accent" : "bg-duet-hair",
          )}
          key={dot}
        />
      ))}
    </span>
  );
}

function LevelPill({ level }: { level: MasteryLevel }) {
  return (
    <span
      className={cn(
        "type-label shrink-0 rounded-full px-2 py-0.5 font-semibold",
        LEVEL_TONE[level],
      )}
    >
      {LEVEL_WORDS[level]}
    </span>
  );
}

function nextReview(topic: StudyTopic): string {
  if (topic.due) return "due now";
  const days = Math.max(
    1,
    Math.round((new Date(topic.dueAt).getTime() - Date.now()) / 86_400_000),
  );
  return days === 1 ? "back tomorrow" : `back in ${days} days`;
}
