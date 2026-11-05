import { useSyncExternalStore } from "react";
import { newId } from "@/lib/new-id";
import type { Assignment, CheckIn, CoachState, Profile } from "./model";
import { localDate } from "./model";
import { newlyEarned } from "./progress";
import { blankState, demoState } from "./seed";

/*
 * The Coach tab's state, kept in this browser's localStorage under one key. One store for the tab,
 * read with useSyncExternalStore so every card redraws together after a change. Storage can be
 * missing or full; the tab then still works for the visit and starts over next time.
 */

export const COACH_STORAGE_KEY = "academic-os.coach.v1";
export const TIMER_STORAGE_KEY = "academic-os.coach.timer.v1";

type Listener = () => void;
const listeners = new Set<Listener>();
let cached: CoachState | null = null;

function read(): CoachState {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(COACH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CoachState;
      if (parsed?.version === 1) {
        cached = parsed;
        return parsed;
      }
    }
  } catch {
    // Unreadable or unavailable: start from the demo week.
  }
  cached = demoState(new Date());
  return cached;
}

function write(next: CoachState): void {
  cached = next;
  try {
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Kept in memory for this visit.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCoachState(): CoachState {
  return read();
}

/** For tests: forget what was read so the next read goes back to storage. */
export function resetCoachCache(): void {
  cached = null;
  timerCached = undefined;
}

export function useCoachState(): CoachState {
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Apply a change, then stamp any achievement it earned. Returns the achievements newly earned, so
 * the screen can celebrate them.
 */
export function updateCoach(
  change: (state: CoachState) => CoachState,
  now = new Date(),
) {
  const changed = change(read());
  const earned = newlyEarned(changed, now);
  if (!earned.length) {
    write(changed);
    return [];
  }
  const unlocked = { ...changed.unlocked };
  for (const a of earned) unlocked[a.id] = now.toISOString();
  write({ ...changed, unlocked });
  return earned;
}

/* ---------------------------------------------------------------- Actions ---------------------- */

export function logSession(
  assignmentId: string | null,
  minutes: number,
  startedAt: Date,
  now = new Date(),
) {
  return updateCoach(
    (s) => ({
      ...s,
      sessions: [
        ...s.sessions,
        {
          id: newId(),
          assignmentId,
          startedAt: startedAt.toISOString(),
          minutes,
        },
      ],
      assignments: s.assignments.map((a) =>
        a.id === assignmentId
          ? {
              ...a,
              spentMin: a.spentMin + minutes,
              status: a.status === "todo" ? "doing" : a.status,
            }
          : a,
      ),
    }),
    now,
  );
}

export function setDone(id: string, done: boolean, now = new Date()) {
  return updateCoach(
    (s) => ({
      ...s,
      assignments: s.assignments.map((a) =>
        a.id === id
          ? {
              ...a,
              status: done ? "done" : a.spentMin > 0 ? "doing" : "todo",
              doneAt: done ? now.toISOString() : null,
            }
          : a,
      ),
    }),
    now,
  );
}

export function saveAssignment(
  input: Omit<Assignment, "id" | "spentMin" | "status" | "doneAt"> & {
    id?: string;
  },
  now = new Date(),
) {
  return updateCoach((s) => {
    const existing = input.id
      ? s.assignments.find((a) => a.id === input.id)
      : undefined;
    if (existing)
      return {
        ...s,
        assignments: s.assignments.map((a) =>
          a.id === existing.id ? { ...a, ...input, id: a.id } : a,
        ),
      };
    const created: Assignment = {
      ...input,
      id: newId(),
      spentMin: 0,
      status: "todo",
      doneAt: null,
    };
    return { ...s, assignments: [...s.assignments, created] };
  }, now);
}

export function removeAssignment(id: string) {
  return updateCoach((s) => ({
    ...s,
    assignments: s.assignments.filter((a) => a.id !== id),
  }));
}

export function saveCheckIn(checkIn: Omit<CheckIn, "date">, now = new Date()) {
  const date = localDate(now);
  return updateCoach(
    (s) => ({
      ...s,
      checkIns: [
        ...s.checkIns.filter((c) => c.date !== date),
        { ...checkIn, date },
      ],
    }),
    now,
  );
}

export function saveProfile(
  profile: Partial<Profile>,
  classes?: CoachState["classes"],
) {
  return updateCoach((s) => ({
    ...s,
    profile: { ...s.profile, ...profile },
    classes: classes ?? s.classes,
  }));
}

export function restartWithDemo(now = new Date()) {
  write(demoState(now));
}

export function startFresh(name: string) {
  write(blankState(name));
}

/* ---------------------------------------------------------------- Focus timer ------------------ */

export type TimerState = {
  assignmentId: string | null;
  phase: "focus" | "break";
  lengthMin: number;
  /** When the running phase began, ISO. */
  startedAt: string;
  /** When the running phase ends, ISO. Null while paused. */
  endsAt: string | null;
  /** Milliseconds left, kept while paused. */
  pausedLeftMs: number | null;
};

const timerListeners = new Set<Listener>();
let timerCached: TimerState | null | undefined;

function readTimer(): TimerState | null {
  if (timerCached !== undefined) return timerCached;
  try {
    const raw = window.localStorage.getItem(TIMER_STORAGE_KEY);
    timerCached = raw ? (JSON.parse(raw) as TimerState) : null;
  } catch {
    timerCached = null;
  }
  return timerCached;
}

export function setTimer(next: TimerState | null): void {
  timerCached = next;
  try {
    if (next)
      window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(TIMER_STORAGE_KEY);
  } catch {
    // In memory only.
  }
  for (const listener of timerListeners) listener();
}

export function useTimer(): TimerState | null {
  return useSyncExternalStore(
    (l) => {
      timerListeners.add(l);
      return () => timerListeners.delete(l);
    },
    readTimer,
    readTimer,
  );
}

export function getTimer(): TimerState | null {
  return readTimer();
}
