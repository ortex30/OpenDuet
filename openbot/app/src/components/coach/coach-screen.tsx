import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { DuetIcon } from "@/components/duet/icons";
import { ScreenScroll } from "@/components/shell/screen";
import { primaryBot } from "@/lib/agents/primary-bot";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { currentUserQueryOptions } from "@/lib/auth/queries";
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
import {
  type PrivateDemoPayload,
  privatePackState,
  withAccountName,
  withSampleColors,
} from "@/lib/coach/seed";
import {
  adoptPrivatePack,
  getCoachState,
  isUntouchedSample,
  syncAchievements,
  updateCoach,
  useCoachState,
} from "@/lib/coach/store";
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
  const accountName = useQuery(currentUserQueryOptions()).data?.name;
  const [handOff, setHandOff] = useState<HandOff | null>(null);
  const [report, setReport] = useState(false);
  const [setup, setSetup] = useState(false);
  const [earned, setEarned] = useState<Achievement[]>([]);
  const pace = pacing(state, todaysCheckIn(state, now));
  const onEarned = useCallback((list: Achievement[]) => {
    if (list.length) setEarned(list);
  }, []);

  useEffect(() => syncAchievements(), []);

  // Once per tab, and only while Today's plan is still the generic sample week.
  // The flag is set after the read finishes. Setting it first lets React's
  // strict-mode remount cancel the only request.
  useEffect(() => {
    const key = "academic-os.pack-checked";
    if (window.sessionStorage.getItem(key) === "1") return;
    if (!isUntouchedSample(getCoachState())) {
      window.sessionStorage.setItem(key, "1");
      return;
    }
    let cancel = false;
    void fetch("/api/openduet/study/private-demo")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { available?: boolean };
      })
      .then((body) => {
        if (cancel || !body || body.available !== true) return;
        adoptPrivatePack(privatePackState(body as PrivateDemoPayload));
      })
      .catch(() => {
        // No pack, or the server is not up yet. The sample week stays.
      })
      .finally(() => {
        if (!cancel) window.sessionStorage.setItem(key, "1");
      });
    return () => {
      cancel = true;
    };
  }, []);

  // Until the student sets it up as their own, the sample week greets whoever is signed in, not
  // Jordan, and one this browser saved before its classes took the calendar's colours takes them.
  useEffect(() => {
    const sample = (s: CoachState) =>
      withSampleColors(withAccountName(s, accountName));
    if (sample(state) !== state) updateCoach(sample);
  }, [state, accountName]);

  useEffect(() => {
    if (!earned.length) return;
    const id = window.setTimeout(() => setEarned([]), 5000);
    return () => window.clearTimeout(id);
  }, [earned]);

  return (
    <ScreenScroll>
      {/* The bar over the screen names it; the heading stays for screen readers. */}
      <header className="mb-3 flex items-center justify-between gap-2 px-1">
        <div>
          <h1 className="sr-only">Coach</h1>
          <p className="type-sub text-duet-ink-2">
            {now.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
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
        <div className="mb-3 flex items-center gap-3 rounded-[20px] bg-duet-card px-4 py-3 shadow-duet-card">
          <p className="type-sub min-w-0 flex-1 text-duet-ink-2">
            {state.source === "private"
              ? "These classes are from your school pack. Older spring work is left out."
              : "This is a sample week. Add your classes to make it yours."}
          </p>
          <CoachButton onClick={() => setSetup(true)}>Set up</CoachButton>
        </div>
      ) : null}

      <TonightPlan />
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

/** One evening from the school pack. Hidden until asked, so the sample week stays quiet. */
function TonightPlan() {
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mb-3 rounded-[20px] bg-duet-card px-4 py-3 shadow-duet-card">
      <div className="flex items-center justify-between gap-2">
        <p className="type-sub font-semibold">Tonight</p>
        <button
          className="type-caption min-h-11 rounded-full bg-duet-ink px-4 font-semibold text-duet-surface disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void fetch("/api/openduet/study/workshop/tonight", {
              method: "POST",
              credentials: "include",
            })
              .then(async (response) => {
                const body = (await response.json()) as {
                  error?: string;
                  plan?: {
                    blocks?: { title: string; start: string; end: string }[];
                    warnings?: string[];
                  };
                };
                if (!response.ok) throw new Error(body.error || "No plan yet.");
                const blocks = body.plan?.blocks ?? [];
                const warnings = body.plan?.warnings ?? [];
                setLines(
                  blocks.length
                    ? [
                        ...blocks.map(
                          (block) =>
                            `${block.start}–${block.end} ${block.title}`,
                        ),
                        ...warnings.filter((warning) => warning.trim()),
                      ]
                    : ["Nothing due in the next few days."],
                );
              })
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error ? reason.message : "Try again.",
                ),
              )
              .finally(() => setBusy(false));
          }}
          type="button"
        >
          {busy ? "Planning…" : "What should I do tonight?"}
        </button>
      </div>
      {error ? (
        <p className="type-sub mt-2 text-duet-red" role="alert">
          {error}
        </p>
      ) : null}
      {lines.length > 0 ? (
        <ul className="type-sub mt-2 list-disc pl-4 text-duet-ink">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
