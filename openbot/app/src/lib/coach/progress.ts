import {
  type Assignment,
  type CheckIn,
  type CoachState,
  addDays,
  classOf,
  DAY,
  formatMinutes,
  isOverdue,
  localDate,
  MINUTE,
  startOfDay,
} from "./model";

/* ---------------------------------------------------------------- Minutes and streak ----------- */

/** Focus minutes per local date. */
export function minutesByDay(state: CoachState): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const s of state.sessions) {
    const key = localDate(s.startedAt);
    byDay.set(key, (byDay.get(key) ?? 0) + s.minutes);
  }
  return byDay;
}

export function minutesOn(state: CoachState, day: Date): number {
  return minutesByDay(state).get(localDate(day)) ?? 0;
}

/** A day counts toward the streak with 15 minutes of focus or one assignment finished. */
export const STREAK_MIN = 15;

function activeDays(state: CoachState): Set<string> {
  const days = new Set<string>();
  for (const [day, min] of minutesByDay(state))
    if (min >= STREAK_MIN) days.add(day);
  for (const a of state.assignments)
    if (a.doneAt) days.add(localDate(a.doneAt));
  return days;
}

/**
 * Days in a row with study. Today still counts as open: a streak that ran through yesterday stays
 * alive until today ends, so the number does not drop to zero every morning.
 */
export function streak(
  state: CoachState,
  now: Date,
): { days: number; todayDone: boolean } {
  const active = activeDays(state);
  const todayDone = active.has(localDate(now));
  let day = todayDone ? startOfDay(now) : addDays(startOfDay(now), -1);
  let days = 0;
  while (active.has(localDate(day))) {
    days++;
    day = addDays(day, -1);
  }
  return { days, todayDone };
}

/** The best streak ever, for the badges. */
export function bestStreak(state: CoachState): number {
  const sorted = [...activeDays(state)].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    const expected = previous
      ? localDate(addDays(new Date(`${previous}T12:00:00`), 1))
      : null;
    run = expected === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

/** How many days the daily goal was met. */
export function goalDays(state: CoachState): number {
  let count = 0;
  for (const min of minutesByDay(state).values())
    if (min >= state.profile.dailyGoalMin) count++;
  return count;
}

/* ---------------------------------------------------------------- Wellbeing -------------------- */

export type Pacing = {
  focusMin: number;
  breakMin: number;
  /** Today's goal after the check-in, in minutes. */
  goalMin: number;
  message: string;
  /** Low mood: show where support is, gently. */
  support: boolean;
};

export function todaysCheckIn(
  state: CoachState,
  now: Date,
): CheckIn | undefined {
  return state.checkIns.find((c) => c.date === localDate(now));
}

/**
 * How hard to push today, from the morning check-in. Tired or short on sleep means shorter sessions
 * and a smaller goal; a good day keeps the usual rhythm. Low mood is never pushed harder.
 */
export function pacing(
  state: CoachState,
  checkIn: CheckIn | undefined,
): Pacing {
  const goal = state.profile.dailyGoalMin;
  if (!checkIn)
    return {
      focusMin: 25,
      breakMin: 5,
      goalMin: goal,
      message: "",
      support: false,
    };
  const tired = checkIn.energy <= 2 || checkIn.sleepHours < 6;
  const low = checkIn.mood <= 2;
  if (low)
    return {
      focusMin: 15,
      breakMin: 5,
      goalMin: Math.round((goal * 0.5) / 5) * 5,
      message:
        "Rough days happen. Let's keep it small today: one short session on the thing that matters most, then rest.",
      support: true,
    };
  if (tired)
    return {
      focusMin: 20,
      breakMin: 5,
      goalMin: Math.round((goal * 0.75) / 5) * 5,
      message:
        "Running low, so shorter sessions today. Easy wins first, hard thinking after a break.",
      support: false,
    };
  if (checkIn.energy >= 4 && checkIn.mood >= 4)
    return {
      focusMin: 45,
      breakMin: 10,
      goalMin: goal,
      message:
        "You're charged up. Good day to take on the hardest thing on your list.",
      support: false,
    };
  return {
    focusMin: 25,
    breakMin: 5,
    goalMin: goal,
    message: "Steady day. Classic 25 and 5 sessions.",
    support: false,
  };
}

/** Minutes until bedtime, negative once it has passed (until 4 AM, when the night is over). */
export function minutesToBedtime(bedtime: string, now: Date): number {
  const [h = 22, m = 30] = bedtime.split(":").map(Number);
  const bed = new Date(now);
  bed.setHours(h, m, 0, 0);
  if (now.getHours() < 4) bed.setDate(bed.getDate() - 1);
  return Math.round((bed.getTime() - now.getTime()) / MINUTE);
}

export type BedtimeNudge = { tone: "soon" | "past"; text: string } | null;

export function bedtimeNudge(state: CoachState, now: Date): BedtimeNudge {
  const left = minutesToBedtime(state.profile.bedtime, now);
  if (left < 0 && left > -6 * 60)
    return {
      tone: "past",
      text: "It's past your bedtime. Sleep does more for tomorrow's quiz than another hour tonight. Your spot is saved.",
    };
  if (left >= 0 && left <= 45)
    return {
      tone: "soon",
      text: `Bedtime in ${formatMinutes(left)}. Wrap up what you're on and pick tomorrow's first step.`,
    };
  return null;
}

/* ---------------------------------------------------------------- Achievements ----------------- */

export type Achievement = {
  id: string;
  title: string;
  description: string;
  emoji: string;
  earned: (state: CoachState, now: Date) => boolean;
};

const finishedEarly = (a: Assignment) =>
  a.doneAt !== null &&
  new Date(a.dueAt).getTime() - new Date(a.doneAt).getTime() >= DAY;

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-focus",
    title: "First focus",
    description: "Finish a focus session.",
    emoji: "🎯",
    earned: (s) => s.sessions.length > 0,
  },
  {
    id: "streak-3",
    title: "On a roll",
    description: "Study three days in a row.",
    emoji: "🔥",
    earned: (s) => bestStreak(s) >= 3,
  },
  {
    id: "streak-7",
    title: "Full week",
    description: "Study seven days in a row.",
    emoji: "🏆",
    earned: (s) => bestStreak(s) >= 7,
  },
  {
    id: "deep-work",
    title: "Deep work",
    description: "One session of 45 minutes or more.",
    emoji: "🧠",
    earned: (s) => s.sessions.some((x) => x.minutes >= 45),
  },
  {
    id: "early-bird",
    title: "Early bird",
    description: "Finish an assignment a day or more before it's due.",
    emoji: "🌅",
    earned: (s) => s.assignments.some(finishedEarly),
  },
  {
    id: "comeback",
    title: "Comeback",
    description: "Turn in something that was late.",
    emoji: "💪",
    earned: (s) =>
      s.assignments.some(
        (a) =>
          a.doneAt !== null &&
          new Date(a.doneAt).getTime() > new Date(a.dueAt).getTime(),
      ),
  },
  {
    id: "goal-3",
    title: "Goal getter",
    description: "Hit your daily goal on three days.",
    emoji: "⭐",
    earned: (s) => goalDays(s) >= 3,
  },
  {
    id: "check-in-3",
    title: "Self-aware",
    description: "Do three daily check-ins.",
    emoji: "🌱",
    earned: (s) => s.checkIns.length >= 3,
  },
  {
    id: "clean-slate",
    title: "Clean slate",
    description: "Nothing late on your list.",
    emoji: "✨",
    earned: (s, now) =>
      s.assignments.length > 0 &&
      s.assignments.some((a) => a.status === "done") &&
      !s.assignments.some((a) => isOverdue(a, now)),
  },
  {
    id: "ten-hours",
    title: "Ten hours",
    description: "Log ten hours of focus.",
    emoji: "⏱️",
    earned: (s) => s.sessions.reduce((sum, x) => sum + x.minutes, 0) >= 600,
  },
];

/** Achievements earned now that were not unlocked before, in list order. */
export function newlyEarned(state: CoachState, now: Date): Achievement[] {
  return ACHIEVEMENTS.filter(
    (a) => !state.unlocked[a.id] && a.earned(state, now),
  );
}

/* ---------------------------------------------------------------- Weekly report ---------------- */

export type WeeklyReport = {
  from: Date;
  to: Date;
  totalMin: number;
  /** Minutes per day for the last seven days, oldest first. */
  daily: { date: Date; minutes: number }[];
  byClass: { name: string; color: string; minutes: number }[];
  completed: Assignment[];
  onTime: number;
  late: Assignment[];
  streakDays: number;
  avgMood: number | null;
  avgSleep: number | null;
};

export function weeklyReport(state: CoachState, now: Date): WeeklyReport {
  const to = startOfDay(now);
  const from = addDays(to, -6);
  const inWeek = (iso: string) => {
    const t = startOfDay(new Date(iso)).getTime();
    return t >= from.getTime() && t <= to.getTime();
  };
  const byDay = minutesByDay(state);
  const daily = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    return { date, minutes: byDay.get(localDate(date)) ?? 0 };
  });
  const perClass = new Map<
    string,
    { name: string; color: string; minutes: number }
  >();
  for (const s of state.sessions) {
    if (!inWeek(s.startedAt)) continue;
    const a = state.assignments.find((x) => x.id === s.assignmentId);
    const c = a
      ? classOf(state, a)
      : { id: "general", name: "General study", color: "general" };
    const row = perClass.get(c.id) ?? {
      name: c.name,
      color: c.color,
      minutes: 0,
    };
    row.minutes += s.minutes;
    perClass.set(c.id, row);
  }
  const completed = state.assignments.filter(
    (a) => a.doneAt && inWeek(a.doneAt),
  );
  const onTime = completed.filter(
    (a) => new Date(a.doneAt ?? 0).getTime() <= new Date(a.dueAt).getTime(),
  ).length;
  const checks = state.checkIns.filter((c) => inWeek(`${c.date}T12:00:00`));
  const avg = (xs: number[]) =>
    xs.length
      ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
      : null;
  return {
    from,
    to,
    totalMin: daily.reduce((sum, d) => sum + d.minutes, 0),
    daily,
    byClass: [...perClass.values()].sort((a, b) => b.minutes - a.minutes),
    completed,
    onTime,
    late: state.assignments.filter((a) => isOverdue(a, now)),
    streakDays: streak(state, now).days,
    avgMood: avg(checks.map((c) => c.mood)),
    avgSleep: avg(checks.map((c) => c.sleepHours)),
  };
}

/**
 * The report as plain text, for a parent, an advisor or a teacher. Mood and sleep stay out unless
 * the student chooses to include them: they are the student's to share.
 */
export function reportText(
  state: CoachState,
  report: WeeklyReport,
  includeWellbeing: boolean,
): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const lines = [
    `${state.profile.name}'s week, ${fmt(report.from)} to ${fmt(report.to)} (from Academic OS)`,
    "",
    `Focused study: ${formatMinutes(report.totalMin)}, with a ${report.streakDays}-day streak.`,
    report.byClass.length
      ? `By class: ${report.byClass.map((c) => `${c.name} ${formatMinutes(c.minutes)}`).join(", ")}.`
      : "",
    `Finished: ${report.completed.length} assignment${report.completed.length === 1 ? "" : "s"}, ${report.onTime} on time.`,
    report.late.length
      ? `Catching up on: ${report.late.map((a) => a.title).join("; ")}.`
      : "Nothing late.",
    includeWellbeing && report.avgSleep !== null
      ? `Check-ins: average sleep ${report.avgSleep}h, mood ${report.avgMood}/5.`
      : "",
  ];
  return lines.filter((l, i) => l !== "" || i === 1).join("\n");
}
