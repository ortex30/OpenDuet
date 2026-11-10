/*
 * The Coach tab's data: the student's classes, assignments, focus sessions and check-ins.
 *
 * It lives in this browser (see store.ts), seeded on first open with the demo student's real week
 * (seed.ts), so the tab works before any school account is connected. Everything in this folder
 * other than store.ts is pure: it takes the state and a `now`, which keeps it simple to test.
 */

export type HelpLevel = "full" | "hints" | "none";

export const HELP_LABEL: Record<HelpLevel, string> = {
  full: "Full help",
  hints: "Hints only",
  none: "No help",
};

/** A colour name the tab knows how to draw, one per class. */
export type ClassColor =
  | "violet"
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "accent";

export const CLASS_COLORS: ClassColor[] = [
  "violet",
  "blue",
  "green",
  "amber",
  "red",
  "accent",
];

export type CoachClass = {
  id: string;
  name: string;
  teacher: string;
  color: ClassColor;
};

export type AssignmentStatus = "todo" | "doing" | "done";

export type Assignment = {
  id: string;
  classId: string;
  title: string;
  /** ISO time it is due. */
  dueAt: string;
  points: number;
  /** The student's own estimate of the whole job, in minutes. */
  estimateMin: number;
  /** Minutes of focus already logged against it. */
  spentMin: number;
  helpLevel: HelpLevel;
  status: AssignmentStatus;
  doneAt: string | null;
  /** Share of credit still available once it is late, 0 to 1. Null: late work is not accepted. */
  lateCredit: number | null;
  /** Where it came from, such as a Classroom link. */
  source: string | null;
};

export type FocusSession = {
  id: string;
  assignmentId: string | null;
  startedAt: string;
  minutes: number;
};

export type CheckIn = {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** 1 (rough) to 5 (great). */
  mood: number;
  /** 1 (drained) to 5 (charged). */
  energy: number;
  sleepHours: number;
};

export type Profile = {
  name: string;
  /** Minutes of focus a day that counts as a goal met. */
  dailyGoalMin: number;
  /** HH:MM, local. */
  bedtime: string;
  /** Minutes the student can study on a school day, for spotting crunch days. */
  dailyCapacityMin: number;
  setupDone: boolean;
};

export type CoachState = {
  version: 1;
  /** True while the state is the seeded demo week. */
  demo: boolean;
  /**
   * "sample" is the generic week. "private" is a school pack loaded from this
   * machine. Missing means sample, including weeks saved before the field existed.
   */
  source?: "sample" | "private";
  profile: Profile;
  classes: CoachClass[];
  assignments: Assignment[];
  sessions: FocusSession[];
  checkIns: CheckIn[];
  /** Achievement id to the ISO time it was first earned. */
  unlocked: Record<string, string>;
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** The local calendar date of a time, YYYY-MM-DD. */
export function localDate(time: Date | string | number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Midnight at the start of a time's local day. */
export function startOfDay(time: Date | number): Date {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The same local date moved by whole days. */
export function addDays(time: Date | number, days: number): Date {
  const d = new Date(time);
  d.setDate(d.getDate() + days);
  return d;
}

/** Minutes of work still left on an assignment, never below zero. */
export function remainingMin(a: Assignment): number {
  if (a.status === "done") return 0;
  return Math.max(0, a.estimateMin - a.spentMin);
}

export function isOverdue(a: Assignment, now: Date): boolean {
  return a.status !== "done" && new Date(a.dueAt).getTime() < now.getTime();
}

export function classOf(state: CoachState, a: Assignment): CoachClass {
  return (
    state.classes.find((c) => c.id === a.classId) ?? {
      id: a.classId,
      name: "Other",
      teacher: "",
      color: "accent",
    }
  );
}

/** "45 min", "1h", "1h 30m". */
export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** "today", "tomorrow", "Fri", "yesterday", "3 days ago", relative to now's local day. */
export function formatDue(dueAt: string, now: Date): string {
  const days = Math.round(
    (startOfDay(new Date(dueAt)).getTime() - startOfDay(now).getTime()) / DAY,
  );
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${-days} days ago`;
  if (days < 7)
    return new Date(dueAt).toLocaleDateString("en-US", { weekday: "short" });
  return new Date(dueAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
