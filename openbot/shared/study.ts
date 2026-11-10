/**
 * Academic OS's study features, declared once and read from both sides: the names of the study
 * tools, the shapes their results and the /api/openduet/study routes carry, and the teacher-rule
 * refusal the server writes and the app draws.
 *
 * Plain TypeScript only (no zod), like the rest of shared/. The server validates with its own zod
 * schemas and the app parses route payloads with its own, both against these types.
 */

/** Tools a Bot calls. The app registers a card renderer for each, under the same bare name. */
export const QUIZ_TOOL = "make_quiz";
export const FLASHCARDS_TOOL = "make_flashcards";
export const PROGRESS_TOOL = "show_progress";
export const PLAN_TOOL = "propose_study_plan";

/** The tools a teacher's "No help" pauses for that class. Planning and progress are never paused. */
export const RULED_STUDY_TOOLS = [QUIZ_TOOL, FLASHCARDS_TOOL] as const;

/* ------------------------------------------------------------------------------------------------
 * Teacher AI-help levels
 * ---------------------------------------------------------------------------------------------- */

/** How much AI help a teacher allows, from most to least. */
export const HELP_LEVELS = ["full", "hints", "none"] as const;
export type HelpLevel = (typeof HELP_LEVELS)[number];

/** The words a Classroom notice and the app use for each level. */
export const HELP_LEVEL_LABEL: Record<HelpLevel, string> = {
  full: "Full help",
  hints: "Hints only",
  none: "No help",
};

/** A class with no notice that says otherwise is treated as Hints only, as the Bot's prompt says. */
export const DEFAULT_HELP_LEVEL: HelpLevel = "hints";

/** 0 for full, 1 for hints, 2 for none: a higher rank is stricter. */
export function helpLevelRank(level: HelpLevel): number {
  return HELP_LEVELS.indexOf(level);
}

/** The stricter of two levels. */
export function stricterLevel(a: HelpLevel, b: HelpLevel): HelpLevel {
  return helpLevelRank(a) >= helpLevelRank(b) ? a : b;
}

/** True when `next` allows more help than `current`, which only an administrator may do. */
export function loosens(current: HelpLevel, next: HelpLevel): boolean {
  return helpLevelRank(next) < helpLevelRank(current);
}

/**
 * Reads a level from a notice line such as "AI help: Hints only." Deterministic on purpose: a level
 * is the teacher's words, never something a model decided. Returns null when the text names none.
 */
export function parseHelpLevel(text: string): HelpLevel | null {
  const words = text.toLowerCase().replace(/[^a-z ]/g, " ");
  if (/\bno (ai )?help\b/.test(words)) return "none";
  if (/\bhints? only\b/.test(words) || /\bonly hints?\b/.test(words))
    return "hints";
  if (/\bfull (ai )?help\b/.test(words)) return "full";
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * School data, parsed from the student's Google Classroom notices
 * ---------------------------------------------------------------------------------------------- */

/** Colours the calendar knows, so each class keeps one colour everywhere. */
export const CLASS_COLORS = [
  "sky",
  "violet",
  "teal",
  "amber",
  "rose",
  "lime",
  "orange",
  "slate",
] as const;
export type ClassColor = (typeof CLASS_COLORS)[number];

export type SchoolClass = {
  /** Stable id: the Classroom course id from the notice's link, or a slug of the class name. */
  id: string;
  /** As the notice names it, such as "AP US History". */
  name: string;
  teacher: string | null;
  period: string | null;
  color: ClassColor;
};

export type AssignmentKind =
  | "assignment"
  | "quiz"
  | "test"
  | "announcement"
  | "material";

/** open: still to do. missing: past due and not turned in. returned: graded and handed back. */
export type AssignmentStatus = "open" | "missing" | "returned";

export type SchoolAssignment = {
  /** Stable id: the Classroom course-work id from the notice's link, or a slug of class and title. */
  id: string;
  classId: string;
  title: string;
  kind: AssignmentKind;
  status: AssignmentStatus;
  /** When it is due, as an ISO 8601 instant, or null when the notice gave no due date. */
  due: string | null;
  /** The due date as the student's own calendar day, "YYYY-MM-DD", or null. */
  dueDate: string | null;
  /** The due time on that day, "HH:mm" in the student's time zone, or null for none. */
  dueTime: string | null;
  points: number | null;
  /** A returned grade as the notice wrote it, such as "34/40". */
  grade: string | null;
  /** The teacher's level from the notice's "AI help:" line, or null when it had none. */
  help: HelpLevel | null;
  /** Estimated minutes of work, from the notice when it says, otherwise a default for its kind. */
  minutes: number;
  /** The Classroom link, when the notice had one. */
  link: string | null;
  /** The Gmail message it was read from, newest notice wins. */
  noticeId: string;
};

export type SchoolSnapshot = {
  /** When the notices were last read, ISO 8601. */
  syncedAt: string;
  /** The student's IANA time zone, from their calendar, or "UTC" when it could not be read. */
  timeZone: string;
  classes: SchoolClass[];
  assignments: SchoolAssignment[];
  /** Sources that could not be read and why, in words the student can act on. */
  couldNotRead: string[];
};

/* ------------------------------------------------------------------------------------------------
 * Teacher rules: the notice's level, and the overrides set on the Teacher rules screen
 * ---------------------------------------------------------------------------------------------- */

export type RuleOverride = {
  level: HelpLevel;
  /** The id of the person who set it. */
  setBy: string;
  setAt: string;
  /**
   * True when, at the time it was set, the override allowed more help than the teacher's notices did:
   * only an administrator can set one, and it replaces the level the notices give. Otherwise it only
   * tightens, so it combines with the notices as the stricter of the two, and a stricter notice that
   * arrives later still wins.
   */
  loosens?: boolean;
};

export type RuleOverrides = {
  classes: Record<string, RuleOverride>;
  assignments: Record<string, RuleOverride>;
};

/** What decided a level: an override on the Teacher rules screen, a Classroom notice, or the default. */
export type RuleSource = "override" | "notice" | "default";

/** One class's rules as the Teacher rules screen shows them. */
export type ClassRules = {
  classId: string;
  className: string;
  teacher: string | null;
  /** The level the study tools obey for the class as a whole. */
  level: HelpLevel;
  source: RuleSource;
  override: HelpLevel | null;
  assignments: {
    assignmentId: string;
    title: string;
    /** What the item is. Only assignments, quizzes and tests decide the class's level. */
    kind?: AssignmentKind;
    due: string | null;
    status: AssignmentStatus;
    /** The notice's own level. */
    notice: HelpLevel | null;
    override: HelpLevel | null;
    /** What the study tools obey for this assignment. */
    level: HelpLevel;
    source: RuleSource;
  }[];
};

export type RulesView = {
  /** The student's IANA time zone, from their calendar, for showing due dates and times. */
  timeZone: string;
  classes: ClassRules[];
  /** False for a student: they may make a rule stricter, never looser. */
  canLoosen: boolean;
  /** When the Classroom notices behind the view were read, or null if never. */
  syncedAt: string | null;
  couldNotRead: string[];
};

/** The body of PUT /api/openduet/study/rules: a level to set, or null to clear an override. */
export type RulesChange = {
  classes?: Record<string, HelpLevel | null>;
  assignments?: Record<string, HelpLevel | null>;
};

/* ------------------------------------------------------------------------------------------------
 * The teacher-rule refusal: written by the server, drawn by the app
 * ---------------------------------------------------------------------------------------------- */

/** Marks a refusal that a teacher's rule caused, so the card can say so to the student. */
export const TEACHER_RULE_MARKER = "[teacher-rule]";

export type TeacherRuleBlock = {
  classId: string;
  className: string;
  level: HelpLevel;
  /** The assignment whose rule paused the tool, when one did. */
  assignment?: string;
  teacher?: string;
  source: RuleSource;
};

/**
 * The text after "Refused. ": the marker, the facts as JSON for the card, then the sentence the model
 * reads. The server prefixes "Refused. " itself.
 */
export function teacherRuleText(
  block: TeacherRuleBlock,
  sentence: string,
): string {
  return `${TEACHER_RULE_MARKER}${JSON.stringify(block)} ${sentence}`;
}

/**
 * Reads the facts back out of a tool result. Accepts the whole result, with or without the
 * "Refused." prefix. Returns null for anything that is not a teacher-rule refusal.
 */
export function readTeacherRuleBlock(
  text: string | null | undefined,
): TeacherRuleBlock | null {
  if (!text) return null;
  const at = text.indexOf(TEACHER_RULE_MARKER);
  if (at < 0) return null;
  const rest = text.slice(at + TEACHER_RULE_MARKER.length);
  if (!rest.startsWith("{")) return null;
  let depth = 0;
  let inString = false;
  for (let index = 0; index < rest.length; index++) {
    const char = rest[index];
    if (inString) {
      if (char === "\\") index++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        try {
          const value = JSON.parse(rest.slice(0, index + 1)) as unknown;
          if (!value || typeof value !== "object") return null;
          const block = value as Partial<TeacherRuleBlock>;
          if (
            typeof block.classId !== "string" ||
            typeof block.className !== "string" ||
            !HELP_LEVELS.includes(block.level as HelpLevel)
          )
            return null;
          return {
            classId: block.classId,
            className: block.className,
            level: block.level as HelpLevel,
            ...(typeof block.assignment === "string"
              ? { assignment: block.assignment }
              : {}),
            ...(typeof block.teacher === "string"
              ? { teacher: block.teacher }
              : {}),
            source:
              block.source === "override" || block.source === "notice"
                ? block.source
                : "default",
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Quizzes, flashcards and progress
 * ---------------------------------------------------------------------------------------------- */

/** A question as the student sees it before answering: no answer, no explanation. */
export type QuizQuestionPublic = {
  id: string;
  question: string;
  /** Exactly four choices, A to D. */
  choices: string[];
  topic: string;
};

export type QuizPublic = {
  id: string;
  title: string;
  classId: string;
  className: string;
  assignmentId: string | null;
  questions: QuizQuestionPublic[];
  createdAt: string;
};

export type QuizResult = {
  questionId: string;
  topic: string;
  question: string;
  choices: string[];
  /** 0 to 3. */
  selected: number;
  correctIndex: number;
  correct: boolean;
  explanation: string;
};

export type QuizAttempt = {
  id: string;
  quizId: string;
  classId: string;
  results: QuizResult[];
  correct: number;
  total: number;
  at: string;
  /** True when a missed topic put a review task on the Tasks tab. */
  reviewTaskAdded: boolean;
};

export type Flashcard = { front: string; back: string };

export type FlashcardDeck = {
  id: string;
  title: string;
  classId: string;
  className: string;
  assignmentId: string | null;
  cards: Flashcard[];
  createdAt: string;
};

export type ProgressTopic = {
  classId: string;
  className: string;
  topic: string;
  correct: number;
  total: number;
};

export type ProgressSummary = {
  /** The class it covers, or null for every class. */
  classId: string | null;
  attempts: number;
  answered: number;
  correct: number;
  topics: ProgressTopic[];
  /** The latest missed questions, newest first, at most eight. */
  recentMisses: {
    quizId: string;
    classId: string;
    topic: string;
    question: string;
    at: string;
  }[];
  /** Always shown: this counts practice, it does not measure mastery. */
  note: string;
};

export const PROGRESS_NOTE =
  "Based on your completed practice quizzes only. Not a grade or a mastery score.";

/* ------------------------------------------------------------------------------------------------
 * Study plans and the calendar
 * ---------------------------------------------------------------------------------------------- */

export type StudyBlock = {
  id: string;
  /** The assignment it works on, or null for general study. */
  assignmentId: string | null;
  classId: string | null;
  title: string;
  /** The student's own day, "YYYY-MM-DD". */
  date: string;
  /** "HH:mm" in the student's time zone. */
  start: string;
  end: string;
  /** True when the block falls after the assignment's deadline (catch-up work). */
  late?: boolean;
};

export type PlanStatus = "proposed" | "applied" | "discarded";

export type StudyPlan = {
  id: string;
  status: PlanStatus;
  /** Why the plan looks the way it does, in the Bot's words. */
  reason: string;
  timeZone: string;
  startDate: string;
  days: number;
  blocks: StudyBlock[];
  /** Work that did not fit, with the minutes still needed. */
  remaining: {
    assignmentId: string;
    title: string;
    minutes: number;
    due: string | null;
  }[];
  warnings: string[];
  totalMinutes: number;
  createdAt: string;
  appliedAt: string | null;
  /**
   * True when Apply would be refused because the plan is out of date. Computed when the plan is read.
   */
  stale: boolean;
  /**
   * Why it is out of date: "changed" when another plan was applied after this one was made,
   * "started" when one of its sessions has already begun. Null when it is not stale.
   */
  staleReason: PlanStaleReason | null;
};

export type PlanStaleReason = "changed" | "started";

/** A timed event from the student's calendar, clipped to one local day. */
export type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  /** "HH:mm" in the student's time zone. */
  start: string;
  /** "HH:mm", later than start; "24:00" for an event clipped at midnight (its rest is on the next day). */
  end: string;
  location?: string;
  /** The class it belongs to, when its title names one of the student's classes. */
  classId?: string;
};

export type CalendarAllDay = { id: string; title: string; date: string };

export type CalendarDeadline = {
  assignmentId: string;
  classId: string;
  title: string;
  date: string;
  time: string | null;
  kind: AssignmentKind;
  /**
   * The level the study tools obey for this assignment, overrides and the class rule applied (the
   * same as the Teacher rules screen shows), or null when nothing is known.
   */
  help: HelpLevel | null;
};

/** GET /api/openduet/study/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD answers { calendar: CalendarView }. */
export type CalendarView = {
  timeZone: string;
  /** The student's today, "YYYY-MM-DD", and the minute of their day now (0 to 1439). */
  today: string;
  nowMinute: number;
  /** The range asked for, inclusive. */
  from: string;
  to: string;
  classes: SchoolClass[];
  events: CalendarEvent[];
  allDay: CalendarAllDay[];
  /** Applied study blocks in the range. */
  blocks: StudyBlock[];
  deadlines: CalendarDeadline[];
  couldNotRead: string[];
};

/* ------------------------------------------------------------------------------------------------
 * What each tool returns: small, because the result is replayed to the model on every later turn.
 * The cards read the full record from /api/openduet/study by id.
 * ---------------------------------------------------------------------------------------------- */

export type QuizToolResult = {
  kind: "quiz";
  id: string;
  title: string;
  className: string;
  count: number;
};

export type DeckToolResult = {
  kind: "deck";
  id: string;
  title: string;
  className: string;
  count: number;
};

export type ProgressToolResult = {
  kind: "progress";
  summary: ProgressSummary;
};

export type PlanToolResult = {
  kind: "plan";
  id: string;
  blocks: number;
  totalMinutes: number;
  remainingMinutes: number;
  warnings: string[];
};
