import { useEffect, useRef, useState } from "react";
import { classOf, HELP_LABEL, MINUTE } from "@/lib/coach/model";
import {
  getTimer,
  logSession,
  setTimer,
  type TimerState,
  useCoachState,
  useTimer,
} from "@/lib/coach/store";
import type { Achievement } from "@/lib/coach/progress";
import { CoachButton, ClassPill, Ring } from "./kit";

/** Start a focus session on an assignment, or on nothing in particular. */
export function startFocus(
  assignmentId: string | null,
  lengthMin: number,
  now = new Date(),
) {
  setTimer({
    assignmentId,
    phase: "focus",
    lengthMin,
    startedAt: now.toISOString(),
    endsAt: new Date(now.getTime() + lengthMin * MINUTE).toISOString(),
    pausedLeftMs: null,
  });
}

export function msLeft(timer: TimerState, now: number): number {
  if (timer.pausedLeftMs !== null) return timer.pausedLeftMs;
  return Math.max(0, new Date(timer.endsAt ?? 0).getTime() - now);
}

/** Minutes of focus actually done so far in a focus phase. */
export function elapsedFocusMin(timer: TimerState, now: number): number {
  return Math.max(
    0,
    Math.round((timer.lengthMin * MINUTE - msLeft(timer, now)) / MINUTE),
  );
}

/** A soft two-note chime, where the browser allows sound. */
function chime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(
        0.2,
        ctx.currentTime + i * 0.25 + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + i * 0.25 + 0.6,
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.25);
      osc.stop(ctx.currentTime + i * 0.25 + 0.7);
    });
  } catch {
    // No sound; the screen still changes.
  }
}

/**
 * Focus mode: the whole screen given to one thing, a ring counting down, and the teacher's AI rule
 * for that assignment as a reminder. When focus ends, its minutes are logged and a break starts.
 * The timer lives in storage, so leaving the tab and coming back keeps it running.
 */
export function FocusOverlay({
  breakMin,
  onEarned,
}: {
  breakMin: number;
  onEarned: (earned: Achievement[]) => void;
}) {
  const timer = useTimer();
  const state = useCoachState();
  const [now, setNow] = useState(() => Date.now());
  const ended = useRef<string | null>(null);

  useEffect(() => {
    if (!timer) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  useEffect(() => {
    if (!timer || timer.pausedLeftMs !== null) return;
    if (msLeft(timer, now) > 0 || ended.current === timer.startedAt) return;
    ended.current = timer.startedAt;
    chime();
    if (timer.phase === "focus") {
      onEarned(
        logSession(
          timer.assignmentId,
          timer.lengthMin,
          new Date(timer.startedAt),
        ),
      );
      const start = new Date();
      setTimer({
        ...timer,
        phase: "break",
        lengthMin: breakMin,
        startedAt: start.toISOString(),
        endsAt: new Date(start.getTime() + breakMin * MINUTE).toISOString(),
      });
    } else {
      setTimer(null);
    }
  }, [timer, now, breakMin, onEarned]);

  if (!timer) return null;
  const left = msLeft(timer, now);
  const mm = Math.floor(left / MINUTE);
  const ss = Math.floor((left % MINUTE) / 1000);
  const assignment = state.assignments.find((a) => a.id === timer.assignmentId);
  const cls = assignment ? classOf(state, assignment) : null;
  const paused = timer.pausedLeftMs !== null;
  const focus = timer.phase === "focus";

  const stopFocus = () => {
    const t = getTimer();
    if (!t) return;
    if (t.phase === "focus") {
      const minutes = elapsedFocusMin(t, Date.now());
      if (minutes >= 1)
        onEarned(logSession(t.assignmentId, minutes, new Date(t.startedAt)));
    }
    setTimer(null);
  };

  return (
    <div
      aria-label={focus ? "Focus mode" : "Break"}
      aria-modal="true"
      className={
        focus
          ? "fixed inset-0 z-[60] flex flex-col items-center justify-center bg-duet-black px-6 text-duet-on-black"
          : "fixed inset-0 z-[60] flex flex-col items-center justify-center bg-duet-green-soft px-6 text-duet-ink"
      }
      role="dialog"
    >
      <p className="type-label mb-2 font-semibold uppercase tracking-widest opacity-70">
        {focus ? (paused ? "Paused" : "Focus") : "Break"}
      </p>
      {focus && assignment ? (
        <div className="mb-6 max-w-sm text-center">
          {cls ? <ClassPill color={cls.color} name={cls.name} /> : null}
          <p className="type-title mt-2 font-semibold">{assignment.title}</p>
          <p className="type-sub mt-1 opacity-70">
            AI help: {HELP_LABEL[assignment.helpLevel]}
            {assignment.helpLevel === "none" ? ". This one is all you." : ""}
          </p>
        </div>
      ) : focus ? (
        <p className="type-title mb-6 font-semibold">Free study</p>
      ) : (
        <p className="type-title mb-6 max-w-xs text-center font-semibold">
          Stand up, drink water, look at something far away.
        </p>
      )}
      <Ring
        label={`${mm} minutes ${ss} seconds left`}
        max={timer.lengthMin * MINUTE}
        size={236}
        stroke={14}
        value={timer.lengthMin * MINUTE - left}
      >
        <span className="font-semibold text-6xl tabular-nums">
          {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
        </span>
      </Ring>
      <div className="mt-8 flex gap-2">
        {focus ? (
          <CoachButton
            className="bg-white/15 text-inherit shadow-none"
            onClick={() =>
              setTimer(
                paused
                  ? {
                      ...timer,
                      pausedLeftMs: null,
                      endsAt: new Date(
                        Date.now() + (timer.pausedLeftMs ?? 0),
                      ).toISOString(),
                    }
                  : { ...timer, pausedLeftMs: left, endsAt: null },
              )
            }
          >
            {paused ? "Resume" : "Pause"}
          </CoachButton>
        ) : null}
        <CoachButton
          className={focus ? "bg-white text-duet-black shadow-none" : ""}
          onClick={stopFocus}
          primary={!focus}
        >
          {focus ? "Finish" : "Skip break"}
        </CoachButton>
      </div>
      {focus ? (
        <p className="type-caption mt-4 opacity-60">
          Finishing early still logs the minutes you did.
        </p>
      ) : null}
    </div>
  );
}

/** For the screen: whether a timer is running at all. */
export function useTimerRunning(): boolean {
  return useTimer() !== null;
}
