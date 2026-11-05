import {
  type Assignment,
  type CoachState,
  addDays,
  type FocusSession,
  localDate,
  startOfDay,
} from "./model";

/** A local time on a day some days from `now`. */
function at(now: Date, days: number, hour: number, minute = 0): string {
  const d = startOfDay(addDays(now, days));
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/**
 * The demo student's week, Jordan Rivera at Lakeview High: the same classes, assignments, due dates
 * and teacher AI rules as the demo school inbox (scripts/fake-google/student-mailbox.jsonl), placed
 * around `now` so it always reads as this week. A few past focus sessions and check-ins give the
 * streak, the badges and the weekly report something to show on the first open.
 */
export function demoState(now: Date): CoachState {
  const assignments: Assignment[] = [
    {
      id: "chem-lab6",
      classId: "chem",
      title: "Lab 6 report: Reaction Rates",
      dueAt: at(now, 1, 23, 59),
      points: 40,
      estimateMin: 120,
      spentMin: 35,
      helpLevel: "hints",
      status: "doing",
      doneAt: null,
      lateCredit: 0.5,
      source: "https://classroom.google.com/c/chem2/a/lab6",
    },
    {
      id: "precalc-quiz4",
      classId: "precalc",
      title: "Study for Unit 4 quiz: trig identities",
      dueAt: at(now, 1, 10, 45),
      points: 50,
      estimateMin: 60,
      spentMin: 0,
      helpLevel: "full",
      status: "todo",
      doneAt: null,
      lateCredit: null,
      source: "https://classroom.google.com/c/precalc4/p/quiz4",
    },
    {
      id: "precalc-hw43",
      classId: "precalc",
      title: "Section 4.3 problems 1-25 odd",
      dueAt: at(now, -1, 23, 59),
      points: 20,
      estimateMin: 45,
      spentMin: 0,
      helpLevel: "full",
      status: "todo",
      doneAt: null,
      lateCredit: 0.7,
      source: "https://classroom.google.com/c/precalc4/a/hw43",
    },
    {
      id: "apush-dbq",
      classId: "apush",
      title: "DBQ essay: Causes of the Civil War",
      dueAt: at(now, 2, 8, 0),
      points: 9,
      estimateMin: 150,
      spentMin: 0,
      helpLevel: "none",
      status: "todo",
      doneAt: null,
      lateCredit: null,
      source: "https://classroom.google.com/c/apush1/a/dbq3",
    },
    {
      id: "spanish-u5",
      classId: "spanish",
      title: "Vocab test: Unidad 5 (60 words + mandatos)",
      dueAt: at(now, 3, 12, 20),
      points: 60,
      estimateMin: 90,
      spentMin: 15,
      helpLevel: "full",
      status: "todo",
      doneAt: null,
      lateCredit: null,
      source: "https://classroom.google.com/c/spanish5/p/u5",
    },
    {
      id: "eng-gatsby",
      classId: "english",
      title: "Gatsby analytical essay (1,000 words)",
      dueAt: at(now, 6, 9, 50),
      points: 100,
      estimateMin: 240,
      spentMin: 0,
      helpLevel: "hints",
      status: "todo",
      doneAt: null,
      lateCredit: 0.8,
      source: "https://classroom.google.com/c/eng11/a/gatsby",
    },
    {
      id: "chem-lab5",
      classId: "chem",
      title: "Lab 5 report",
      dueAt: at(now, -3, 23, 59),
      points: 40,
      estimateMin: 110,
      spentMin: 110,
      helpLevel: "hints",
      status: "done",
      doneAt: at(now, -4, 20, 30),
      lateCredit: 0.5,
      source: "https://classroom.google.com/c/chem2/a/lab5",
    },
  ];
  const past: [number, string | null, number, number][] = [
    // [days ago, assignment, hour, minutes]
    [5, "chem-lab5", 19, 50],
    [4, "chem-lab5", 19, 60],
    [3, "spanish-u5", 20, 15],
    [2, null, 18, 25],
    [1, "chem-lab6", 19, 35],
  ];
  const sessions: FocusSession[] = past.map(([ago, id, hour, minutes], i) => ({
    id: `seed-${i}`,
    assignmentId: id,
    startedAt: at(now, -ago, hour),
    minutes,
  }));
  return {
    version: 1,
    demo: true,
    profile: {
      name: "Jordan",
      dailyGoalMin: 60,
      bedtime: "22:30",
      dailyCapacityMin: 120,
      setupDone: false,
    },
    classes: [
      {
        id: "apush",
        name: "AP US History",
        teacher: "Mr. Grant",
        color: "red",
      },
      { id: "chem", name: "Chemistry", teacher: "Dr. Okoro", color: "green" },
      {
        id: "english",
        name: "English 11",
        teacher: "Ms. Alvarez",
        color: "violet",
      },
      {
        id: "precalc",
        name: "Precalculus",
        teacher: "Mr. Chen",
        color: "blue",
      },
      {
        id: "spanish",
        name: "Spanish III",
        teacher: "Sra. Morales",
        color: "amber",
      },
    ],
    assignments,
    sessions,
    checkIns: [
      { date: localDate(addDays(now, -2)), mood: 4, energy: 3, sleepHours: 7 },
      { date: localDate(addDays(now, -1)), mood: 3, energy: 2, sleepHours: 6 },
    ],
    unlocked: {},
  };
}

/** An empty week for a student who starts from scratch instead of the demo. */
export function blankState(name: string): CoachState {
  return {
    version: 1,
    demo: false,
    profile: {
      name,
      dailyGoalMin: 60,
      bedtime: "22:30",
      dailyCapacityMin: 120,
      setupDone: true,
    },
    classes: [],
    assignments: [],
    sessions: [],
    checkIns: [],
    unlocked: {},
  };
}
