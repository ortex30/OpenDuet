import {
  type Assignment,
  type CoachState,
  addDays,
  classOf,
  DAY,
  formatDue,
  formatMinutes,
  HELP_LABEL,
  HOUR,
  isOverdue,
  remainingMin,
  startOfDay,
} from "./model";

/* ---------------------------------------------------------------- Do next ---------------------- */

export type Ranked = {
  assignment: Assignment;
  score: number;
  /** Short reasons, most important first, such as "Due tomorrow" and "1h 25m left". */
  reasons: string[];
};

/**
 * How much an open assignment needs the student now, 0 and up. It weighs how much of the time left
 * the remaining work would fill (at the student's daily capacity), how close the deadline is, and
 * what it is worth. Late work that still earns credit ranks high: it is the cheapest points left.
 * Late work that earns nothing ranks last; it is listed for the record.
 */
export function priorityScore(
  a: Assignment,
  now: Date,
  capacityMin: number,
): number {
  if (a.status === "done") return -1;
  const left = remainingMin(a);
  const hoursLeft = (new Date(a.dueAt).getTime() - now.getTime()) / HOUR;
  if (hoursLeft < 0) {
    if (a.lateCredit === null) return 1;
    const recoverable = a.points * a.lateCredit;
    return 70 + Math.min(40, recoverable / Math.max(0.25, left / 60));
  }
  const availableMin = Math.max(15, (hoursLeft / 24) * capacityMin);
  const pressure = Math.min(1.5, left / availableMin);
  const soon = hoursLeft < 24 ? 30 : hoursLeft < 48 ? 15 : 0;
  return pressure * 60 + soon + Math.min(15, a.points / 8);
}

export function reasonsFor(a: Assignment, now: Date): string[] {
  const reasons: string[] = [];
  const left = remainingMin(a);
  if (isOverdue(a, now)) {
    reasons.push(
      a.lateCredit === null
        ? "Late, no credit left"
        : `Late, still worth ${Math.round(a.lateCredit * 100)}%`,
    );
  } else {
    reasons.push(`Due ${formatDue(a.dueAt, now)}`);
  }
  if (left > 0) reasons.push(`about ${formatMinutes(left)} left`);
  reasons.push(`${a.points} pts`);
  if (a.helpLevel === "none") reasons.push(`${HELP_LABEL.none}: on your own`);
  return reasons;
}

/** Every open assignment, the one that needs the student most first. */
export function rankAssignments(state: CoachState, now: Date): Ranked[] {
  return state.assignments
    .filter((a) => a.status !== "done")
    .map((assignment) => ({
      assignment,
      score: priorityScore(assignment, now, state.profile.dailyCapacityMin),
      reasons: reasonsFor(assignment, now),
    }))
    .sort((x, y) => y.score - x.score);
}

/** One sentence on why the top pick is the top pick. */
export function whyFirst(state: CoachState, top: Ranked, now: Date): string {
  const a = top.assignment;
  const name = classOf(state, a).name;
  if (isOverdue(a, now) && a.lateCredit !== null)
    return `${name} is late but still worth ${Math.round(a.lateCredit * 100)}% credit, and it's quick points.`;
  const left = remainingMin(a);
  const due = formatDue(a.dueAt, now);
  return `${name} is due ${due} and has about ${formatMinutes(left)} of work left.`;
}

/* ---------------------------------------------------------------- Workload radar --------------- */

export type DayLoad = {
  date: Date;
  /** Minutes planned that day when every open assignment is spread evenly up to its due day. */
  spreadMin: number;
  /** Minutes that day if everything is left to the night before it is due. */
  crammedMin: number;
  /** Assignments due that day. */
  due: Assignment[];
  over: boolean;
};

/** The last day work can happen on: the day before if it is due before noon, otherwise the day. */
function lastWorkDay(a: Assignment, today: Date): Date {
  const due = new Date(a.dueAt);
  const day = startOfDay(due);
  const last = due.getHours() < 12 ? addDays(day, -1) : day;
  return last.getTime() < today.getTime() ? today : last;
}

/**
 * The next seven days of work. Two answers per day: the even spread (each open assignment's
 * remaining work divided across the days from today to its last work day), and the cram (all of it
 * on that last day). A day is over when even the spread is more than the student's daily capacity.
 */
export function workload(state: CoachState, now: Date): DayLoad[] {
  const today = startOfDay(now);
  const days: DayLoad[] = Array.from({ length: 7 }, (_, i) => ({
    date: addDays(today, i),
    spreadMin: 0,
    crammedMin: 0,
    due: [],
    over: false,
  }));
  const index = (d: Date) =>
    Math.round((startOfDay(d).getTime() - today.getTime()) / DAY);
  for (const a of state.assignments) {
    if (a.status === "done") continue;
    const dueIndex = index(new Date(a.dueAt));
    if (dueIndex >= 0 && dueIndex < 7) days[dueIndex]?.due.push(a);
    const left = remainingMin(a);
    if (!left) continue;
    const last = Math.min(6, index(lastWorkDay(a, today)));
    const lastDay = days[last];
    if (lastDay) lastDay.crammedMin += left;
    const share = left / (last + 1);
    for (let i = 0; i <= last; i++) {
      const day = days[i];
      if (day) day.spreadMin += share;
    }
  }
  for (const day of days)
    day.over = day.spreadMin > state.profile.dailyCapacityMin;
  return days;
}

/** The radar's one line of advice, or null when the week is calm. */
export function workloadAdvice(
  state: CoachState,
  days: DayLoad[],
): string | null {
  const cap = state.profile.dailyCapacityMin;
  const over = days.find((d) => d.over);
  const dayName = (d: Date) => {
    const i = days.findIndex((x) => x.date.getTime() === d.getTime());
    if (i === 0) return "Today";
    if (i === 1) return "Tomorrow";
    return d.toLocaleDateString("en-US", { weekday: "long" });
  };
  if (over)
    return `${dayName(over.date)} has ${formatMinutes(over.spreadMin)} of work even spread out, more than your ${formatMinutes(cap)}. Do the top pick first, and ask the coach to help plan the rest.`;
  const crunch = days.find((d) => d.crammedMin > cap * 1.5);
  if (crunch) {
    const biggest = [...state.assignments]
      .filter((a) => a.status !== "done" && remainingMin(a) > 0)
      .sort((x, y) => remainingMin(y) - remainingMin(x))[0];
    return `Leaving it all to the last night puts ${formatMinutes(crunch.crammedMin)} on ${dayName(crunch.date)}. A little ${biggest ? `on ${biggest.title.split(":")[0]} ` : ""}each day keeps it under ${formatMinutes(cap)}.`;
  }
  return null;
}

/* ---------------------------------------------------------------- Catch-up --------------------- */

export type CatchUpItem = {
  assignment: Assignment;
  /** Points still on the table if it is done now. */
  recoverable: number;
  /** Recoverable points per hour of remaining work. */
  perHour: number;
};

export type CatchUpPlan = {
  /** Late work worth doing, best value first. */
  doNow: CatchUpItem[];
  /** Late work that earns nothing now: ask about it, don't spend tonight on it. */
  askAbout: Assignment[];
  /** Points that can still be won back in total. */
  totalRecoverable: number;
};

/** Everything that is late, sorted by how many points an hour of work wins back. */
export function catchUpPlan(state: CoachState, now: Date): CatchUpPlan {
  const late = state.assignments.filter((a) => isOverdue(a, now));
  const doNow = late
    .filter((a) => a.lateCredit !== null)
    .map((assignment) => {
      const recoverable = assignment.points * (assignment.lateCredit ?? 0);
      const hours = Math.max(0.25, remainingMin(assignment) / 60);
      return { assignment, recoverable, perHour: recoverable / hours };
    })
    .sort((x, y) => y.perHour - x.perHour);
  return {
    doNow,
    askAbout: late.filter((a) => a.lateCredit === null),
    totalRecoverable: doNow.reduce((sum, item) => sum + item.recoverable, 0),
  };
}

/**
 * What the coach is handed to help catch up: the late work and the week ahead, with each teacher's
 * AI rule, so it can plan without breaking one. It drafts, and the app asks before anything is sent.
 */
export function catchUpInstruction(state: CoachState, now: Date): string {
  const plan = catchUpPlan(state, now);
  const line = (a: Assignment) => {
    const c = classOf(state, a);
    return `- ${c.name} (${c.teacher}): ${a.title}, due ${formatDue(a.dueAt, now)}, ${a.points} pts, about ${formatMinutes(remainingMin(a))} left, AI help: ${HELP_LABEL[a.helpLevel]}${a.lateCredit !== null ? `, late credit ${Math.round(a.lateCredit * 100)}%` : ", no late credit"}.`;
  };
  const upcoming = rankAssignments(state, now)
    .filter((r) => !isOverdue(r.assignment, now))
    .slice(0, 5)
    .map((r) => line(r.assignment));
  return [
    "I'm behind and want to catch up. Make me a catch-up plan as a page: the order to do things tonight and this week, how long each takes, and where it fits around what's due.",
    "Follow each teacher's AI help rule exactly; for No help work, only help me plan my time.",
    plan.askAbout.length
      ? "For late work that no longer earns credit, draft a short, polite email to the teacher asking whether I can still turn it in, and don't send it until I approve."
      : "",
    "Late work:",
    ...[...plan.doNow.map((i) => i.assignment), ...plan.askAbout].map(line),
    "Coming up:",
    ...upcoming,
  ]
    .filter(Boolean)
    .join("\n");
}
