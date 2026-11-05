import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { DuetIcon } from "@/components/duet/icons";
import { ScreenScroll } from "@/components/shell/screen";
import { primaryBot } from "@/lib/agents/primary-bot";
import { agentListQueryOptions } from "@/lib/agents/queries";
import {
  type Assignment,
  type CoachState,
  classOf,
  formatDue,
  formatMinutes,
  HELP_LABEL,
  remainingMin,
} from "@/lib/coach/model";
import { catchUpInstruction } from "@/lib/coach/plan";
import { type Achievement, pacing, todaysCheckIn } from "@/lib/coach/progress";
import { syncAchievements, useCoachState } from "@/lib/coach/store";
import { FocusOverlay } from "./focus-timer";
import { HandOffSheet } from "./hand-off";
import { CoachButton } from "./kit";
import { SetupSheet, WeeklyReportSheet } from "./sheets";
import { CatchUpCard, CheckInCard, DoNextCard, TodayHero } from "./today";
import {
  AchievementsCard,
  AssignmentsCard,
  Celebration,
  WorkloadRadar,
} from "./week";

/** The time, ticking every half minute so due times and the bedtime nudge stay current. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * What the coach is handed for one assignment: the work, the time left and the teacher's rule, so
 * the Bot helps the way the teacher allows and no further.
 */
export function assignmentInstruction(
  state: CoachState,
  a: Assignment,
  now: Date,
): string {
  const c = classOf(state, a);
  const what =
    a.helpLevel === "none"
      ? "The teacher set this to No help, so do not help with the work itself. Only help me plan my time for it: a schedule of sessions before it's due, as a page."
      : a.helpLevel === "hints"
        ? "The teacher set this to Hints only: coach me with guiding questions and one hint at a time, and never write any part I will turn in. Start by asking where I'm stuck."
        : "The teacher allows Full help: teach me, quiz me and give feedback, but don't hand me finished work to submit. Start with a quick check of what I already know.";
  return [
    `Help me with ${c.name}${c.teacher ? ` (${c.teacher})` : ""}: ${a.title}.`,
    `It's due ${formatDue(a.dueAt, now)} (${new Date(a.dueAt).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}), worth ${a.points} points, and I have about ${formatMinutes(remainingMin(a))} of work left.`,
    `AI help: ${HELP_LABEL[a.helpLevel]}. ${what}`,
    a.source ? `Classroom link: ${a.source}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

type HandOff = { title: string; instruction: string };

/**
 * The Coach tab: the student's planning home. From the top: today's goal and streak, the daily
 * check-in, the one thing to do next, catch-up mode when something is late, the week's load,
 * every assignment, the badges, and the weekly report. Focus mode covers the screen while it runs.
 */
export function CoachScreen() {
  const state = useCoachState();
  const now = useNow();
  const navigate = useNavigate();
  const agents = useQuery(agentListQueryOptions());
  const bot = primaryBot(agents.data);
  const [handOff, setHandOff] = useState<HandOff | null>(null);
  const [report, setReport] = useState(false);
  const [setup, setSetup] = useState(false);
  const [earned, setEarned] = useState<Achievement[]>([]);
  const pace = pacing(state, todaysCheckIn(state, now));
  const onEarned = useCallback((list: Achievement[]) => {
    if (list.length) setEarned(list);
  }, []);

  useEffect(() => syncAchievements(), []);

  useEffect(() => {
    if (!earned.length) return;
    const id = window.setTimeout(() => setEarned([]), 5000);
    return () => window.clearTimeout(id);
  }, [earned]);

  return (
    <ScreenScroll>
      <header className="mb-3 flex items-end justify-between gap-2 px-1">
        <div>
          <h1 className="type-display font-semibold text-duet-ink">Coach</h1>
          <p className="type-sub mt-0.5 text-duet-ink-2">
            {now.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
            {state.demo ? " · demo week" : ""}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            aria-label="Weekly report"
            className="grid size-11 place-items-center rounded-full bg-duet-card text-duet-ink shadow-duet-card hover:bg-duet-tile"
            onClick={() => setReport(true)}
            type="button"
          >
            <DuetIcon name="dashboard" size={20} />
          </button>
          <button
            aria-label="Coach settings"
            className="grid size-11 place-items-center rounded-full bg-duet-card text-duet-ink shadow-duet-card hover:bg-duet-tile"
            onClick={() => setSetup(true)}
            type="button"
          >
            <DuetIcon name="settings" size={20} />
          </button>
        </div>
      </header>

      {!state.profile.setupDone ? (
        <div className="mb-3 flex items-center gap-3 rounded-[24px] bg-[image:var(--duet-face-gradient)] px-4 py-3 text-white">
          <span aria-hidden className="text-2xl">
            👋
          </span>
          <p className="type-sub min-w-0 flex-1 font-medium">
            Demo week. Add your classes to make it yours.
          </p>
          <CoachButton
            className="bg-duet-on-accent text-duet-accent shadow-none"
            onClick={() => setSetup(true)}
          >
            Set up
          </CoachButton>
        </div>
      ) : null}

      <TodayHero now={now} pace={pace} state={state} />
      <CheckInCard now={now} onEarned={onEarned} pace={pace} state={state} />
      <DoNextCard
        now={now}
        onHandOff={(r) =>
          setHandOff({
            title: r.assignment.title,
            instruction: assignmentInstruction(state, r.assignment, now),
          })
        }
        pace={pace}
        state={state}
      />
      <CatchUpCard
        now={now}
        onPlan={() =>
          setHandOff({
            title: "Catch-up plan",
            instruction: catchUpInstruction(state, now),
          })
        }
        state={state}
      />
      <WorkloadRadar now={now} state={state} />
      <AssignmentsCard now={now} onEarned={onEarned} state={state} />
      <AchievementsCard state={state} />

      {handOff && bot ? (
        <HandOffSheet
          bot={bot}
          instruction={handOff.instruction}
          onClose={() => setHandOff(null)}
          onStarted={(task) => {
            setHandOff(null);
            void navigate({
              to: "/tasks/$taskId",
              params: { taskId: task.id },
            });
          }}
          title={handOff.title}
        />
      ) : null}
      {report ? (
        <WeeklyReportSheet
          now={now}
          onClose={() => setReport(false)}
          state={state}
        />
      ) : null}
      {setup ? (
        <SetupSheet onClose={() => setSetup(false)} state={state} />
      ) : null}
      <FocusOverlay breakMin={pace.breakMin} onEarned={onEarned} />
      <Celebration achievements={earned} onDone={() => setEarned([])} />
    </ScreenScroll>
  );
}
