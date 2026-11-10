import { describe, expect, test } from "bun:test";
import {
  type Assignment,
  addDays,
  type CoachState,
  formatDue,
  formatMinutes,
  localDate,
  remainingMin,
} from "@/lib/coach/model";
import {
  catchUpInstruction,
  catchUpPlan,
  rankAssignments,
  workload,
  workloadAdvice,
} from "@/lib/coach/plan";
import {
  ACHIEVEMENTS,
  bedtimeNudge,
  bestStreak,
  minutesToBedtime,
  newlyEarned,
  pacing,
  reportText,
  streak,
  weeklyReport,
} from "@/lib/coach/progress";
import {
  blankState,
  demoState,
  privatePackState,
  withAccountName,
  withSampleColors,
} from "@/lib/coach/seed";

/** A Thursday afternoon, local time. */
const NOW = new Date(2026, 10, 5, 16, 0, 0);

function at(days: number, hour: number, minute = 0): string {
  const d = addDays(NOW, days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function assignment(over: Partial<Assignment>): Assignment {
  return {
    id: over.id ?? "a",
    classId: "c",
    title: over.title ?? "Thing",
    dueAt: at(3, 23, 59),
    points: 20,
    estimateMin: 60,
    spentMin: 0,
    helpLevel: "full",
    status: "todo",
    doneAt: null,
    lateCredit: null,
    source: null,
    ...over,
  };
}

function withAssignments(list: Assignment[]): CoachState {
  return {
    ...blankState("Sam"),
    classes: [{ id: "c", name: "Bio", teacher: "Ms. Lee", color: "green" }],
    assignments: list,
  };
}

describe("formatting", () => {
  test("minutes read like a person says them", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(95)).toBe("1h 35m");
  });

  test("due dates are relative to today", () => {
    expect(formatDue(at(0, 23), NOW)).toBe("today");
    expect(formatDue(at(1, 9), NOW)).toBe("tomorrow");
    expect(formatDue(at(-1, 9), NOW)).toBe("yesterday");
    expect(formatDue(at(-3, 9), NOW)).toBe("3 days ago");
    expect(formatDue(at(3, 9), NOW)).toBe("Sun");
  });

  test("remaining work never goes below zero, and done work has none", () => {
    expect(remainingMin(assignment({ estimateMin: 30, spentMin: 50 }))).toBe(0);
    expect(remainingMin(assignment({ status: "done" }))).toBe(0);
    expect(remainingMin(assignment({ estimateMin: 90, spentMin: 30 }))).toBe(
      60,
    );
  });
});

describe("do next", () => {
  test("a big job due tomorrow beats a small one due next week", () => {
    const state = withAssignments([
      assignment({ id: "later", dueAt: at(6, 23), estimateMin: 30 }),
      assignment({ id: "soon", dueAt: at(1, 23), estimateMin: 120 }),
    ]);
    expect(rankAssignments(state, NOW).map((r) => r.assignment.id)).toEqual([
      "soon",
      "later",
    ]);
  });

  test("late work that still earns credit ranks above calm work, late work worth nothing ranks last", () => {
    const state = withAssignments([
      assignment({ id: "calm", dueAt: at(5, 23), estimateMin: 45 }),
      assignment({
        id: "late-credit",
        dueAt: at(-1, 23),
        lateCredit: 0.7,
        estimateMin: 30,
      }),
      assignment({ id: "late-zero", dueAt: at(-2, 23), lateCredit: null }),
    ]);
    const order = rankAssignments(state, NOW).map((r) => r.assignment.id);
    expect(order[0]).toBe("late-credit");
    expect(order.at(-1)).toBe("late-zero");
  });

  test("done work is not ranked, and reasons say why", () => {
    const state = withAssignments([
      assignment({ id: "done", status: "done", doneAt: at(-1, 9) }),
      assignment({
        id: "open",
        dueAt: at(1, 23),
        helpLevel: "none",
        points: 9,
      }),
    ]);
    const ranked = rankAssignments(state, NOW);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.reasons).toEqual([
      "Due tomorrow",
      "about 1h left",
      "9 pts",
      "No help: on your own",
    ]);
  });

  test("in the demo week the chem lab or the precalc quiz comes first, not the essay due in six days", () => {
    const top = rankAssignments(demoState(NOW), NOW)[0]?.assignment.id;
    expect(["chem-lab6", "precalc-quiz4", "precalc-hw43"]).toContain(top);
  });
});

describe("workload radar", () => {
  test("spreads remaining work evenly up to the last work day, and crams it there", () => {
    const state = withAssignments([
      assignment({ dueAt: at(3, 23), estimateMin: 120 }),
    ]);
    const days = workload(state, NOW);
    expect(days).toHaveLength(7);
    expect(days.slice(0, 4).map((d) => d.spreadMin)).toEqual([30, 30, 30, 30]);
    expect(days[3]?.crammedMin).toBe(120);
    expect(days[3]?.due).toHaveLength(1);
    expect(days.some((d) => d.over)).toBe(false);
  });

  test("work due before noon has to be done the day before", () => {
    const state = withAssignments([
      assignment({ dueAt: at(2, 8), estimateMin: 60 }),
    ]);
    const days = workload(state, NOW);
    expect(days[1]?.crammedMin).toBe(60);
    expect(days[2]?.spreadMin).toBe(0);
  });

  test("late work lands on today", () => {
    const state = withAssignments([
      assignment({ dueAt: at(-1, 23), estimateMin: 40 }),
    ]);
    expect(workload(state, NOW)[0]?.spreadMin).toBe(40);
  });

  test("flags a day that is over capacity even when spread out, and says so", () => {
    const state = withAssignments([
      assignment({ id: "x", dueAt: at(0, 23), estimateMin: 200 }),
    ]);
    const days = workload(state, NOW);
    expect(days[0]?.over).toBe(true);
    expect(workloadAdvice(state, days)).toContain("more than your 2h");
  });

  test("warns about cramming when the night before would be heavy", () => {
    const state = withAssignments([
      assignment({
        id: "big",
        title: "Essay: Gatsby",
        dueAt: at(5, 23),
        estimateMin: 240,
      }),
    ]);
    const advice = workloadAdvice(state, workload(state, NOW));
    expect(advice).toContain("Leaving it all to the last night");
    expect(advice).toContain("Essay");
  });

  test("a calm week gets no advice", () => {
    const state = withAssignments([assignment({ estimateMin: 30 })]);
    expect(workloadAdvice(state, workload(state, NOW))).toBeNull();
  });
});

describe("catch-up mode", () => {
  test("sorts late work by points won back per hour and totals what is recoverable", () => {
    const state = withAssignments([
      assignment({
        id: "slow",
        dueAt: at(-1, 23),
        points: 40,
        lateCredit: 0.5,
        estimateMin: 120,
      }),
      assignment({
        id: "quick",
        dueAt: at(-1, 23),
        points: 20,
        lateCredit: 0.7,
        estimateMin: 30,
      }),
      assignment({ id: "gone", dueAt: at(-2, 23), lateCredit: null }),
      assignment({ id: "not-late", dueAt: at(2, 23) }),
    ]);
    const plan = catchUpPlan(state, NOW);
    expect(plan.doNow.map((i) => i.assignment.id)).toEqual(["quick", "slow"]);
    expect(plan.askAbout.map((a) => a.id)).toEqual(["gone"]);
    expect(plan.totalRecoverable).toBe(34);
  });

  test("the coach's instruction carries each teacher's AI rule and asks before sending", () => {
    const state = withAssignments([
      assignment({
        id: "gone",
        title: "Lab 4",
        dueAt: at(-2, 23),
        lateCredit: null,
        helpLevel: "none",
      }),
      assignment({
        id: "next",
        title: "Worksheet",
        dueAt: at(1, 23),
        helpLevel: "hints",
      }),
    ]);
    const text = catchUpInstruction(state, NOW);
    expect(text).toContain("Bio (Ms. Lee): Lab 4");
    expect(text).toContain("AI help: No help");
    expect(text).toContain("AI help: Hints only");
    expect(text).toContain("don't send it until I approve");
  });
});

describe("streaks", () => {
  const session = (daysAgo: number, minutes: number) => ({
    id: `s${daysAgo}-${minutes}`,
    assignmentId: null,
    startedAt: at(-daysAgo, 19),
    minutes,
  });

  test("counts days in a row and keeps yesterday's streak alive today", () => {
    const state = {
      ...blankState("Sam"),
      sessions: [session(1, 30), session(2, 20), session(3, 25)],
    };
    expect(streak(state, NOW)).toEqual({ days: 3, todayDone: false });
    const today = { ...state, sessions: [...state.sessions, session(0, 15)] };
    expect(streak(today, NOW)).toEqual({ days: 4, todayDone: true });
  });

  test("a gap ends the streak, and a 10-minute day does not count", () => {
    const state = {
      ...blankState("Sam"),
      sessions: [session(1, 30), session(2, 10), session(3, 25)],
    };
    expect(streak(state, NOW).days).toBe(1);
    expect(bestStreak(state)).toBe(1);
  });

  test("finishing an assignment counts as a study day", () => {
    const state = withAssignments([
      assignment({ status: "done", doneAt: at(-1, 20) }),
    ]);
    expect(streak(state, NOW).days).toBe(1);
  });
});

describe("wellbeing", () => {
  const base = blankState("Sam");
  const check = (mood: number, energy: number, sleepHours: number) => ({
    date: localDate(NOW),
    mood,
    energy,
    sleepHours,
  });

  test("no check-in keeps the usual 25 and 5", () => {
    expect(pacing(base, undefined)).toMatchObject({
      focusMin: 25,
      breakMin: 5,
      goalMin: 60,
    });
  });

  test("tired or short on sleep means shorter sessions and a smaller goal", () => {
    expect(pacing(base, check(3, 2, 7))).toMatchObject({
      focusMin: 20,
      goalMin: 45,
    });
    expect(pacing(base, check(4, 4, 5))).toMatchObject({
      focusMin: 20,
      goalMin: 45,
    });
  });

  test("low mood halves the goal and points to support", () => {
    expect(pacing(base, check(1, 4, 8))).toMatchObject({
      focusMin: 15,
      goalMin: 30,
      support: true,
    });
  });

  test("a great day gets long sessions", () => {
    expect(pacing(base, check(5, 5, 8))).toMatchObject({
      focusMin: 45,
      breakMin: 10,
    });
  });

  test("bedtime nudges before and after, and leaves the afternoon alone", () => {
    const evening = new Date(2026, 10, 5, 22, 0);
    const late = new Date(2026, 10, 5, 23, 15);
    const pastMidnight = new Date(2026, 10, 6, 1, 0);
    expect(minutesToBedtime("22:30", evening)).toBe(30);
    expect(bedtimeNudge(base, evening)?.tone).toBe("soon");
    expect(bedtimeNudge(base, late)?.tone).toBe("past");
    expect(minutesToBedtime("22:30", pastMidnight)).toBe(-150);
    expect(bedtimeNudge(base, pastMidnight)?.tone).toBe("past");
    expect(bedtimeNudge(base, NOW)).toBeNull();
  });
});

describe("achievements", () => {
  test("the demo week has earned a few already, and none twice", () => {
    const state = demoState(NOW);
    const earned = newlyEarned(state, NOW).map((a) => a.id);
    expect(earned).toEqual(
      expect.arrayContaining([
        "first-focus",
        "streak-3",
        "deep-work",
        "early-bird",
      ]),
    );
    const unlocked = Object.fromEntries(
      earned.map((id) => [id, NOW.toISOString()]),
    );
    expect(newlyEarned({ ...state, unlocked }, NOW)).toEqual([]);
  });

  test("comeback is earned by turning in late work", () => {
    const comeback = ACHIEVEMENTS.find((a) => a.id === "comeback");
    const late = withAssignments([
      assignment({ dueAt: at(-2, 23), status: "done", doneAt: at(-1, 10) }),
    ]);
    expect(comeback?.earned(late, NOW)).toBe(true);
  });
});

describe("weekly report", () => {
  test("adds up the week by day and class, and keeps wellbeing out unless asked", () => {
    const state = demoState(NOW);
    const report = weeklyReport(state, NOW);
    expect(report.daily).toHaveLength(7);
    expect(report.totalMin).toBe(50 + 60 + 15 + 25 + 35);
    expect(report.byClass[0]?.name).toBe("Chemistry");
    expect(report.completed.map((a) => a.id)).toEqual(["chem-lab5"]);
    expect(report.onTime).toBe(1);
    const text = reportText(state, report, false);
    expect(text).toContain("Jordan's week");
    expect(text).toContain("Focused study: 3h 5m");
    expect(text).not.toContain("sleep");
    expect(reportText(state, report, true)).toContain("average sleep 6.5h");
  });
});

describe("the student's name", () => {
  test("the sample week greets the account by its first word, and stays Jordan with no name", () => {
    const sample = demoState(NOW);
    expect(withAccountName(sample, "Viren Shah").profile.name).toBe("Viren");
    expect(withAccountName(sample, "  Ava  ").profile.name).toBe("Ava");
    expect(withAccountName(sample, undefined)).toBe(sample);
    expect(withAccountName(sample, null).profile.name).toBe("Jordan");
    expect(withAccountName(sample, " ").profile.name).toBe("Jordan");
    // An address is not a name to greet.
    expect(withAccountName(sample, "dev@openbot.local").profile.name).toBe(
      "Jordan",
    );
  });

  test("a week the student set up, or started empty, keeps the name they gave", () => {
    const setUp = demoState(NOW);
    setUp.profile = { ...setUp.profile, name: "Ava", setupDone: true };
    expect(withAccountName(setUp, "Viren Shah")).toBe(setUp);
    const fresh = blankState("Sam");
    expect(withAccountName(fresh, "Viren Shah")).toBe(fresh);
  });

  test("a school pack uses the name it was given, and not an email", () => {
    const state = privatePackState({
      available: true,
      school: "St. Andrew's",
      timeZone: "America/Chicago",
      historicalExcluded: 0,
      studentName: "Viren Harding",
      classes: [
        {
          id: "apush",
          name: "AP United States History",
          teacher: "Ms. Peña",
          help: "hints",
        },
      ],
      assignments: [],
    });
    expect(state.profile.name).toBe("Viren");
    expect(withAccountName(state, "dev@openbot.local").profile.name).toBe(
      "Viren",
    );
  });
});

describe("the sample week's colours", () => {
  test("a sample week saved before the calendar's colours takes them, and keeps any other class's", () => {
    const fresh = demoState(NOW);
    expect(withSampleColors(fresh)).toBe(fresh);
    // As a browser saved it before, with a class that is no sample's (and names no colour).
    const before = ["red", "green", "violet", "blue", "amber"] as const;
    const saved = {
      ...fresh,
      classes: [
        ...fresh.classes.map((c, i) => ({ ...c, color: before[i] ?? c.color })),
        {
          id: "toString",
          name: "Robotics",
          teacher: "",
          color: "accent" as const,
        },
      ],
    };
    expect(withSampleColors(saved).classes.map((c) => [c.id, c.color])).toEqual(
      [
        ["apush", "blue"],
        ["chem", "violet"],
        ["english", "green"],
        ["precalc", "amber"],
        ["spanish", "red"],
        ["toString", "accent"],
      ],
    );
  });

  test("a week the student set up, or started empty, keeps its colours", () => {
    const setUp = demoState(NOW);
    setUp.profile = { ...setUp.profile, setupDone: true };
    setUp.classes = setUp.classes.map((c) => ({ ...c, color: "accent" }));
    expect(withSampleColors(setUp)).toBe(setUp);
    const empty = blankState("Sam");
    expect(withSampleColors(empty)).toBe(empty);
  });
});
