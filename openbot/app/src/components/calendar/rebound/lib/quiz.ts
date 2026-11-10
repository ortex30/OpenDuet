// The deep personality quiz: question bank + profile derivation.
// Owned by the QUIZ agent. Contract (frozen): QUIZ_QUESTIONS shape and
// deriveProfile(answers) -> Profile.

import { formatTime, minToTime, timeToMin } from "./helpers";
import type { Profile, QuizAnswers, TimeWindow } from "./types";

export interface QuizOption {
  id: string;
  label: string;
  description?: string;
}

export type QuizSection = "energy" | "rhythm" | "plans";

export interface QuizQuestionDef {
  id: string;
  section: QuizSection;
  prompt: string;
  /** Plain-English reason for asking, shown under the prompt. */
  affects: string;
  options: QuizOption[];
}

// Thirteen direct planning controls in three short sections. The old bank
// combined unrelated choices in a few places; each question below now asks for
// one decision that directly changes the deterministic planner or recovery
// guidance.
export const QUIZ_QUESTIONS: QuizQuestionDef[] = [
  {
    id: "energy",
    section: "energy",
    prompt: "When do you usually focus best on difficult work?",
    affects: "Difficult work will be scheduled during the time you choose.",
    options: [
      { id: "morning", label: "Early morning" },
      { id: "afternoon", label: "Late morning or afternoon" },
      { id: "evening", label: "Evening" },
      { id: "varies", label: "It changes from day to day" },
    ],
  },
  {
    id: "wake",
    section: "energy",
    prompt: "What’s the earliest Rebound should schedule study time?",
    affects: "This becomes your earliest possible study time.",
    options: [
      { id: "w630", label: "6:30 AM" },
      { id: "w730", label: "7:30 AM" },
      { id: "w900", label: "9:00 AM" },
      { id: "w1030", label: "10:30 AM or later" },
    ],
  },
  {
    id: "sleep",
    section: "energy",
    prompt: "What time should study be finished for the night?",
    affects: "This becomes the hard stop for your plan.",
    options: [
      { id: "s2200", label: "By 10:00 PM" },
      { id: "s2300", label: "By 11:00 PM" },
      { id: "s2345", label: "By 11:45 PM" },
    ],
  },
  {
    id: "afterschool",
    section: "energy",
    prompt: "How much downtime do you need after class or work?",
    affects: "Rebound protects this reset before study can begin.",
    options: [
      { id: "yes", label: "None — I can start right away" },
      { id: "d30", label: "About 30 minutes" },
      { id: "decompress", label: "About an hour" },
      { id: "no", label: "90 minutes or more" },
    ],
  },
  {
    id: "rhythm",
    section: "rhythm",
    prompt: "Which study rhythm feels sustainable?",
    affects:
      "This sets both the length of study blocks and the breaks between them.",
    options: [
      { id: "r25", label: "25 minutes on, 5 off" },
      { id: "r45", label: "45 minutes on, 10 off" },
      { id: "r60", label: "60 minutes on, 10 off" },
      { id: "r80", label: "80 minutes on, 15 off" },
    ],
  },
  {
    id: "cap",
    section: "rhythm",
    prompt: "How much study time is realistic on a normal weekday?",
    affects: "This sets the maximum study time for a normal weekday.",
    options: [
      { id: "c60", label: "About 1 hour" },
      { id: "c120", label: "About 2 hours" },
      { id: "c180", label: "About 3 hours" },
      { id: "c240", label: "About 4 hours" },
    ],
  },
  {
    id: "weekend",
    section: "rhythm",
    prompt: "How much schoolwork is okay on weekends?",
    affects: "This controls how much work can land on Saturday and Sunday.",
    options: [
      { id: "protect", label: "Keep them mostly free" },
      { id: "light", label: "A lighter study day is fine" },
      { id: "full", label: "Treat them like regular study days" },
    ],
  },
  {
    id: "hardfirst",
    section: "rhythm",
    prompt: "When you sit down to study, what do you prefer to start with?",
    affects: "This decides which task Rebound puts first.",
    options: [
      { id: "hard", label: "The hardest task" },
      { id: "warmup", label: "An easier task to warm up" },
    ],
  },
  {
    id: "variety",
    section: "rhythm",
    prompt:
      "During one study day, do you prefer to stay with one subject or switch?",
    affects: "This controls how often your plan changes subjects.",
    options: [
      { id: "batch", label: "Stay with one subject" },
      { id: "mix", label: "Switch between subjects" },
    ],
  },
  {
    id: "procrastination",
    section: "plans",
    prompt:
      "For something due in 10 days, how do you usually spread out the work?",
    affects:
      "This controls how early larger tasks begin and how the work ramps up.",
    options: [
      { id: "early", label: "A little at a time from the start" },
      { id: "spurts", label: "A small start, then a bigger push near the end" },
      { id: "late", label: "Mostly in the last few days" },
    ],
  },
  {
    id: "buffer",
    section: "plans",
    prompt: "For a Friday deadline, when do you want the work ready?",
    affects: "This sets the cushion Rebound aims for before due dates.",
    options: [
      { id: "b0", label: "Friday" },
      { id: "b1", label: "Thursday" },
      { id: "b2", label: "Wednesday" },
    ],
  },
  {
    id: "reboundwhen",
    section: "plans",
    prompt:
      "If you don’t get to a planned task, when should Rebound try to reschedule it?",
    affects:
      "For example, if you miss a 45-minute chemistry task, Rebound tries this option first. Classes and work stay fixed.",
    options: [
      { id: "sameday", label: "Later that day" },
      { id: "nextday", label: "About the same time tomorrow" },
      { id: "nextevening", label: "Tomorrow evening" },
      { id: "auto", label: "The first open time that fits" },
    ],
  },
  {
    id: "derailer",
    section: "plans",
    prompt: "What most often disrupts your study plan?",
    affects: "This helps tailor recovery guidance after missed work.",
    options: [
      { id: "changes", label: "My week changes without warning" },
      { id: "energy", label: "I run out of energy" },
      {
        id: "overwhelm",
        label: "I fall behind and don’t know where to restart",
      },
      { id: "estimates", label: "Tasks take longer than I expected" },
    ],
  },
];

// ---------------------------------------------------------------------------
// deriveProfile — total function. Mapping table (questionId · optionId → value;
// the starred option is the default used when an answer is missing):
//
//   energy           morning→early · afternoon*→balanced · evening→late · varies→balanced
//   wake             w630→06:30 · w730*→07:30 · w900→09:00 · w1030→10:30
//   sleep            s2200→22:00 · s2300*→23:00 · s2345→23:45
//   afterschool      yes*→0m · d30→30m · decompress→60m · no→90m
//   rhythm           r25→25/5/4 · r45*→45/10/3 · r60→60/10/3 · r80→80/15/2
//   cap              c60→60 · c120→120 · c180*→180 · c240→240
//   weekend          protect→protect · light*→light · full→full
//   flow             deep-batch→hard/batch · deep-mix*→hard/mix ·
//                    warm-batch→warm/batch · warm-mix→warm/mix
//   procrastination  early*→steady/starter · spurts|late→ramp/deadline
//   buffer           b0→0 · b1*→1 · b2→2
//   reboundwhen      sameday→same-day-later · nextday→next-day · nextevening→next-evening · auto*→auto
//
// Legacy focus/breaks/pacing/hardfirst/variety/latenight answers remain readable
// so profiles saved before this shorter survey keep their original behavior.
//
// peakWindows (1–2 windows, all clamped to [wake, sleep], ≥45 min each):
//   base by chronotype:  early → [wake, wake+4h capped at 12:00]
//                        balanced → [13:00, 17:00]
//                          (balanced + afterschool "no" → late morning [max(wake, 09:30), 12:30]
//                           instead, since they need a long post-class reset)
//                        late → [19:00, min(22:00, sleep)]
//   afterschool refiner: "yes" adds [15:00, 18:00] (early/late types; merges into
//                        balanced's base) · "d30" adds [15:30, 18:00] ·
//                        "decompress" adds [16:00, 18:30] · "no" adds nothing
//   legacy latenight:    "sharp" adds [20:00, min(sleep, 23:30)] · "bad" clips
//                        every window to end ≤ 21:30
//   overlapping windows merge; if more than 2 remain, the 2 longest are kept.
// ---------------------------------------------------------------------------

function clampWindow(
  w: TimeWindow,
  wakeMin: number,
  sleepMin: number,
): TimeWindow | null {
  const s = Math.max(timeToMin(w.start), wakeMin);
  const e = Math.min(timeToMin(w.end), sleepMin);
  if (e - s < 45) return null;
  return { start: minToTime(s), end: minToTime(e) };
}

function mergeWindows(ws: TimeWindow[]): TimeWindow[] {
  const sorted = [...ws].sort(
    (a, b) => timeToMin(a.start) - timeToMin(b.start),
  );
  const out: TimeWindow[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && timeToMin(w.start) <= timeToMin(last.end)) {
      if (timeToMin(w.end) > timeToMin(last.end)) last.end = w.end;
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

/** Map quiz answers to concrete scheduling parameters. Total function:
 *  returns a sensible default profile for missing answers. */
export function deriveProfile(answers: QuizAnswers): Profile {
  const ans = (id: string, fallback: string): string => answers[id] ?? fallback;

  const energy = ans("energy", "afternoon");
  const chronotype: Profile["chronotype"] =
    energy === "morning" ? "early" : energy === "evening" ? "late" : "balanced";

  const wakeMap: Record<string, string> = {
    w630: "06:30",
    w730: "07:30",
    w900: "09:00",
    w1030: "10:30",
  };
  const wake = wakeMap[ans("wake", "w730")] ?? "07:30";

  const sleepMap: Record<string, string> = {
    s2200: "22:00",
    s2300: "23:00",
    s2345: "23:45",
  };
  const sleep = sleepMap[ans("sleep", "s2300")] ?? "23:00";

  const rhythmMap: Record<
    string,
    { focusSpanMin: number; breakMin: number; longBreakEvery: number }
  > = {
    r25: { focusSpanMin: 25, breakMin: 5, longBreakEvery: 4 },
    r45: { focusSpanMin: 45, breakMin: 10, longBreakEvery: 3 },
    r60: { focusSpanMin: 60, breakMin: 10, longBreakEvery: 3 },
    r80: { focusSpanMin: 80, breakMin: 15, longBreakEvery: 2 },
  };
  const rhythm = answers.rhythm ? rhythmMap[answers.rhythm] : undefined;
  const focusMap: Record<string, number> = {
    f25: 25,
    f45: 45,
    f60: 60,
    f80: 80,
  };
  const focusSpanMin =
    rhythm?.focusSpanMin ?? focusMap[ans("focus", "f45")] ?? 45;

  const breakMap: Record<string, { breakMin: number; longBreakEvery: number }> =
    {
      quick: { breakMin: 5, longBreakEvery: 4 },
      standard: { breakMin: 10, longBreakEvery: 3 },
      real: { breakMin: 15, longBreakEvery: 3 },
      stretch: { breakMin: 5, longBreakEvery: 2 },
    };
  const breakRhythm = rhythm ??
    breakMap[ans("breaks", "standard")] ?? {
      breakMin: 10,
      longBreakEvery: 3,
    };

  const capMap: Record<string, number> = {
    c60: 60,
    c120: 120,
    c180: 180,
    c240: 240,
    c300: 300,
  };
  const dailyCapMin = capMap[ans("cap", "c180")] ?? 180;

  const weekendAns = ans("weekend", "light");
  const weekendPolicy: Profile["weekendPolicy"] =
    weekendAns === "protect"
      ? "protect"
      : weekendAns === "full"
        ? "full"
        : "light";

  const procrastinationAnswer = answers.procrastination;
  const procrastination =
    procrastinationAnswer === "spurts" || procrastinationAnswer === "late"
      ? procrastinationAnswer
      : "early";
  const legacyPacing =
    answers.pacing === "steady" ||
    answers.pacing === "ramp" ||
    answers.pacing === "cram"
      ? answers.pacing
      : undefined;
  const pacing: Profile["pacing"] = legacyPacing
    ? legacyPacing === "steady"
      ? "steady"
      : "ramp"
    : procrastination === "early"
      ? "steady"
      : "ramp";

  const flowAnswer = answers.flow;
  const flow =
    flowAnswer === "deep-batch" ||
    flowAnswer === "deep-mix" ||
    flowAnswer === "warm-batch" ||
    flowAnswer === "warm-mix"
      ? flowAnswer
      : undefined;
  const hardFirst = flow
    ? flow.startsWith("deep-")
    : answers.hardfirst !== "warmup";
  const variety: Profile["variety"] = flow
    ? flow.endsWith("-mix")
      ? "mix"
      : "batch"
    : answers.variety === "batch" || answers.variety === "mostly"
      ? "batch"
      : "mix";

  const bufferMap: Record<string, number> = { b0: 0, b1: 1, b2: 2 };
  const bufferDays = bufferMap[ans("buffer", "b1")] ?? 1;

  const procrastinationStyle: Profile["procrastinationStyle"] =
    procrastination === "early" ? "starter" : "deadline";

  const reboundWhenMap: Record<string, Profile["reboundWhen"]> = {
    sameday: "same-day-later",
    nextday: "next-day",
    nextevening: "next-evening",
    auto: "auto",
  };
  const reboundWhen = reboundWhenMap[ans("reboundwhen", "auto")] ?? "auto";

  // --- peak windows ---
  const afterschool = ans("afterschool", "yes");
  const postCommitmentBufferMin =
    afterschool === "d30"
      ? 30
      : afterschool === "decompress"
        ? 60
        : afterschool === "no"
          ? 90
          : 0;
  const latenight = ans("latenight", "ok");
  const wakeMin = timeToMin(wake);
  const sleepMin = timeToMin(sleep);

  const raw: TimeWindow[] = [];
  if (chronotype === "early") {
    raw.push({
      start: wake,
      end: minToTime(Math.min(wakeMin + 240, timeToMin("12:00"))),
    });
  } else if (chronotype === "late") {
    raw.push({
      start: "19:00",
      end: minToTime(Math.min(timeToMin("22:00"), sleepMin)),
    });
  } else if (afterschool === "no") {
    // Balanced type whose afternoons are a write-off: peak is late morning.
    raw.push({
      start: minToTime(Math.max(wakeMin, timeToMin("09:30"))),
      end: "12:30",
    });
  } else {
    raw.push({ start: "13:00", end: "17:00" });
  }

  if (afterschool === "yes" && chronotype !== "balanced")
    raw.push({ start: "15:00", end: "18:00" });
  if (afterschool === "d30") raw.push({ start: "15:30", end: "18:00" });
  if (afterschool === "decompress") raw.push({ start: "16:00", end: "18:30" });
  if (latenight === "sharp") {
    raw.push({
      start: "20:00",
      end: minToTime(Math.min(sleepMin, timeToMin("23:30"))),
    });
  }

  let windows = mergeWindows(
    raw
      .map((w) => clampWindow(w, wakeMin, sleepMin))
      .filter((w): w is TimeWindow => w !== null),
  );
  if (latenight === "bad") {
    windows = windows
      .map((w) => ({
        start: w.start,
        end: minToTime(Math.min(timeToMin(w.end), timeToMin("21:30"))),
      }))
      .filter((w) => timeToMin(w.end) - timeToMin(w.start) >= 45);
  }
  if (windows.length > 2) {
    windows = [...windows]
      .sort(
        (a, b) =>
          timeToMin(b.end) -
          timeToMin(b.start) -
          (timeToMin(a.end) - timeToMin(a.start)),
      )
      .slice(0, 2)
      .sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
  }
  if (windows.length === 0) {
    // Defensive: guarantee at least one usable window inside the day bounds.
    windows = [
      clampWindow({ start: "13:00", end: "17:00" }, wakeMin, sleepMin) ?? {
        start: wake,
        end: sleep,
      },
    ];
  }

  return {
    chronotype,
    peakWindows: windows,
    postCommitmentBufferMin,
    wake,
    sleep,
    focusSpanMin,
    breakMin: breakRhythm.breakMin,
    longBreakEvery: breakRhythm.longBreakEvery,
    dailyCapMin,
    weekendPolicy,
    pacing,
    hardFirst,
    variety,
    bufferDays,
    procrastinationStyle,
    reboundWhen,
  };
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

/** Human-readable profile breakdown rows for the results screen and
 *  Settings. One row per Profile aspect, in plain English. */
export function profileBreakdown(
  profile: Profile,
): { label: string; value: string; effect: string }[] {
  const windowsText = profile.peakWindows
    .map((w) => `${formatTime(w.start)}–${formatTime(w.end)}`)
    .join(" and ");
  const chronoWord =
    profile.chronotype === "early"
      ? "Morning"
      : profile.chronotype === "late"
        ? "Evening"
        : "Midday";

  const capHours =
    profile.dailyCapMin % 60 === 0
      ? `${profile.dailyCapMin / 60} ${profile.dailyCapMin === 60 ? "hour" : "hours"}`
      : `${Math.floor(profile.dailyCapMin / 60)}h ${profile.dailyCapMin % 60}m`;

  return [
    {
      label: "Peak focus",
      value: `${chronoWord} — ${windowsText}`,
      effect: "Your hardest work is placed into these windows first.",
    },
    {
      label: "After class or work",
      value:
        (profile.postCommitmentBufferMin ?? 0) > 0
          ? `${profile.postCommitmentBufferMin} min protected`
          : "Ready right away",
      effect:
        (profile.postCommitmentBufferMin ?? 0) > 0
          ? "Normal work stays out of that reset window; a hard deadline can use it only as a last resort."
          : "Rebound can use an open slot as soon as class or work ends.",
    },
    {
      label: "Earliest start",
      value: formatTime(profile.wake),
      effect: "Nothing is ever scheduled before this.",
    },
    {
      label: "Latest end",
      value: formatTime(profile.sleep),
      effect: "Nothing is ever scheduled after this — sleep stays protected.",
    },
    {
      label: "Focus block",
      value: `${profile.focusSpanMin} minutes`,
      effect: "Every work session is one block of this length.",
    },
    {
      label: "Break rhythm",
      value: `${profile.breakMin}-minute breaks`,
      effect: `At least ${profile.breakMin} minutes between blocks; every ${ordinal(profile.longBreakEvery)} block earns a ${profile.breakMin * 2}-minute break.`,
    },
    {
      label: "Weekday ceiling",
      value: `${capHours} per day`,
      effect: "Normal weekdays stay under this amount of scheduled work.",
    },
    {
      label: "Weekends",
      value:
        profile.weekendPolicy === "protect"
          ? "Protected"
          : profile.weekendPolicy === "light"
            ? "Light"
            : "Full",
      effect:
        profile.weekendPolicy === "protect"
          ? "Weekends stay near-empty — used only when the week genuinely can't fit the work, at a quarter of your weekday cap."
          : profile.weekendPolicy === "light"
            ? "Weekends carry up to 60% of your weekday ceiling."
            : "Weekends are planned at full weekday capacity.",
    },
    {
      label: "Exam pacing",
      value: profile.pacing === "steady" ? "Steady" : "Ramp",
      effect:
        profile.pacing === "steady"
          ? "Exam prep spreads evenly across every week until the test."
          : "Exam prep builds week over week — the final week carries about twice the first.",
    },
    {
      label: "First move",
      value: profile.hardFirst ? "Hardest first" : "Warm-up first",
      effect: profile.hardFirst
        ? "The most urgent, heaviest work claims your peak windows."
        : "Peak windows still hold real work, but the hardest task isn't forced in first.",
    },
    {
      label: "Subject variety",
      value:
        profile.variety === "batch" ? "One subject per day" : "Mix subjects",
      effect:
        profile.variety === "batch"
          ? "A day is filled by one course before the next one starts."
          : "Courses rotate within a day so no subject goes stale.",
    },
    {
      label: "Deadline buffer",
      value:
        profile.bufferDays === 0
          ? "None"
          : `${profile.bufferDays} day${profile.bufferDays === 1 ? "" : "s"}`,
      effect:
        profile.bufferDays === 0
          ? "Work is planned right up to the due date."
          : `Tasks are planned to finish ${profile.bufferDays} day${profile.bufferDays === 1 ? "" : "s"} before they're due.`,
    },
    {
      label: "Start style",
      value:
        profile.procrastinationStyle === "starter"
          ? "Early starter"
          : "Deadline-driven",
      effect:
        profile.procrastinationStyle === "starter"
          ? "Task work is front-loaded into your earliest free time."
          : "Most task work sits in the final stretch before a due date — with at least one early session always locked in.",
    },
    {
      label: "Missed work",
      value:
        profile.reboundWhen === "same-day-later"
          ? "Later the same day"
          : profile.reboundWhen === "next-day"
            ? "Tomorrow, similar time"
            : profile.reboundWhen === "next-evening"
              ? "Tomorrow evening"
              : "Next suitable opening",
      effect:
        profile.reboundWhen === "same-day-later"
          ? "A missed block looks for another open slot today first."
          : profile.reboundWhen === "next-day"
            ? "A missed block looks near its original time tomorrow first."
            : profile.reboundWhen === "next-evening"
              ? "A missed block looks for an evening slot tomorrow first."
              : "The next suitable opening is used, prioritizing your focus windows.",
    },
  ];
}

// ---------------------------------------------------------------------------
// "Other" answers — every quiz question also accepts a free-text answer,
// stored in QuizAnswers as `other:<text>`. deriveProfile is a total function,
// so an `other:` value uses a safe default until the text is reviewed. The
// text is also preserved as a learned note and routed through intake's profile
// extraction so a clear preference can become a real planner rule.
// ---------------------------------------------------------------------------

export const OTHER_PREFIX = "other:";

/** Free-text answers in question order, with their prompts for AI context. */
export function otherAnswers(
  answers: QuizAnswers,
): { questionId: string; prompt: string; text: string }[] {
  const out: { questionId: string; prompt: string; text: string }[] = [];
  for (const q of QUIZ_QUESTIONS) {
    const a = answers[q.id];
    if (!a?.startsWith(OTHER_PREFIX)) continue;
    const text = a.slice(OTHER_PREFIX.length).trim().slice(0, 500);
    if (text) out.push({ questionId: q.id, prompt: q.prompt, text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Schedule-seeding questions — asked alongside the quiz so a student's real
// week exists before the results screen. Answers are stored as plain text
// (chips prefill the box); onboarding routes the combined text through the
// same parse pipeline as intake, so classes/shifts/practice become real
// commitments and courses instead of dying with a skipped intake step.
// ---------------------------------------------------------------------------

export interface ScheduleQuestionDef {
  id: string;
  prompt: string;
  /** What answering does, shown under the prompt. */
  affects: string;
  placeholder: string;
  /** Tappable examples that prefill the text box for quick editing. */
  suggestions: string[];
}

export const SCHEDULE_QUESTIONS: ScheduleQuestionDef[] = [
  {
    id: "sched-classes",
    prompt: "When are you usually in class or at school?",
    affects: "These times are kept clear so study can fit around them.",
    placeholder: "Add different days or times",
    suggestions: [
      "School weekdays, 8 AM–3 PM",
      "Classes Mon/Wed/Fri mornings",
      "Classes Tue/Thu afternoons",
      "My schedule changes each week",
    ],
  },
  {
    id: "sched-commitments",
    prompt: "When are you regularly busy with work, practice, or clubs?",
    affects: "Regular commitments become protected busy time.",
    placeholder: "Add different days or times",
    suggestions: [
      "Work Tue/Thu, 4–8 PM",
      "Practice weekdays, 5–7 PM",
      "Club meeting Wednesdays, 6–7 PM",
      "Nothing regular right now",
    ],
  },
];

/** Suggestion chips that describe an absence, not schedule items — they must
 *  never reach the parse pipeline as text to extract. */
const NON_ITEMS = new Set([
  "My schedule changes each week",
  "Nothing regular right now",
]);

/** Combined free text from the schedule questions, ready for the intake parse
 *  pipeline; empty when the student skipped them or only picked a non-item. */
export function scheduleSeedText(answers: QuizAnswers): string {
  const parts: string[] = [];
  for (const q of SCHEDULE_QUESTIONS) {
    const a = answers[q.id]?.trim();
    if (!a || NON_ITEMS.has(a)) continue;
    parts.push(a);
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Quiz → first learned notes. The product's promise is that Rebound learns
// the student, and the quiz is the first thing it learns from. Only
// distinctive answers and free text seed notes, capped at 3 so Settings shows
// a short, useful list on day one — not a restatement of the whole profile.
// ---------------------------------------------------------------------------

const SEED_NOTES: { id: string; option: string; note: string }[] = [
  {
    id: "derailer",
    option: "changes",
    note: "Unexpected schedule changes are the main reason a study plan falls apart.",
  },
  {
    id: "derailer",
    option: "energy",
    note: "Running out of energy is the main reason a study plan falls apart.",
  },
  {
    id: "derailer",
    option: "overwhelm",
    note: "When the plan slips, not knowing where to restart is the main blocker.",
  },
  {
    id: "derailer",
    option: "estimates",
    note: "Tasks taking longer than expected is the main reason a study plan falls apart.",
  },
  {
    id: "latenight",
    option: "bad",
    note: "Late-night output drops sharply — keep hard work out of the last hours before bed.",
  },
  {
    id: "afterschool",
    option: "no",
    note: "Needs at least 90 minutes to reset after classes or work before studying.",
  },
  {
    id: "afterschool",
    option: "decompress",
    note: "Needs about an hour to decompress after classes before real work starts.",
  },
  {
    id: "afterschool",
    option: "d30",
    note: "Needs about 30 minutes to reset after classes or work before studying.",
  },
  {
    id: "latenight",
    option: "sharp",
    note: "Produces some of their best work late at night.",
  },
  {
    id: "procrastination",
    option: "late",
    note: "Most work happens near the deadline — early sessions need reinforcing.",
  },
  {
    id: "weekend",
    option: "protect",
    note: "Weekends are protected — schedule work there only when the week can't hold it.",
  },
  {
    id: "cap",
    option: "c60",
    note: "Weekday study capacity is about 1 hour — keep the plan deliberately light.",
  },
  {
    id: "cap",
    option: "c120",
    note: "Typical weekday capacity is about 2 hours — avoid over-scheduling.",
  },
  {
    id: "pacing",
    option: "cram",
    note: "Use a deadline ramp for exam preparation.",
  },
  {
    id: "breaks",
    option: "stretch",
    note: "Prefers long focus periods with occasional longer breaks.",
  },
];

/** 0–3 learned-note texts seeded from distinctive quiz answers, in priority
 *  order. Free text is preserved even when profile extraction is offline. */
export function deriveSeedLearnings(answers: QuizAnswers): string[] {
  const out = otherAnswers(answers)
    .slice(0, 3)
    .map(({ prompt, text }) => `“${prompt}” — ${text}`.slice(0, 240));
  for (const s of SEED_NOTES) {
    if (out.length === 3) break;
    if (answers[s.id] === s.option) out.push(s.note);
  }
  if (
    out.length < 3 &&
    answers["sched-classes"] === "My schedule changes each week"
  ) {
    out.push("Class schedule varies week to week — expect frequent replans.");
  }
  return out;
}
