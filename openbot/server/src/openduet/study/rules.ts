import {
  type AssignmentKind,
  type ClassRules,
  DEFAULT_HELP_LEVEL,
  HELP_LEVELS,
  type HelpLevel,
  helpLevelRank,
  loosens,
  type RuleOverride,
  type RuleOverrides,
  type RuleSource,
  type RulesChange,
  type SchoolAssignment,
  type SchoolClass,
  type SchoolSnapshot,
} from "@openbot/shared/study";
import { z } from "zod";
import {
  type RulesService,
  StudyForbiddenError,
  StudyInputError,
  type StudyStore,
  type StudyTarget,
} from "./contracts";

/*
 * The teacher's AI-help level for a class and an assignment, worked out the same way every time from
 * the Classroom notices (school.ts) and the overrides set on the Teacher rules screen. Nothing here
 * asks a model: the level a study tool obeys is a teacher's words or an admin's choice, never a
 * guess, so the same notices and overrides always give the same answer.
 */

/** One overrides record per person, under one id, so reading the rules is one lookup. */
const recordId = (owner: string) => `rules:${owner}`;

const emptyOverrides = (): RuleOverrides => ({ classes: {}, assignments: {} });

const overrideSchema = z.object({
  level: z.enum(HELP_LEVELS),
  setBy: z.string(),
  setAt: z.string(),
  // Missing on overrides saved before it existed, which read as not loosening (see `loosening`).
  loosens: z.boolean().optional(),
});
const overridesSchema = z.object({
  classes: z.record(z.string(), overrideSchema),
  assignments: z.record(z.string(), overrideSchema),
});

/**
 * The stored overrides. Rules that cannot be read throw rather than read as none: no rules is the
 * loosest answer there is, and a teacher's No help must never fall to a record that broke.
 */
function readOverrides(data: Record<string, unknown>): RuleOverrides {
  const parsed = overridesSchema.safeParse(data);
  if (!parsed.success)
    throw new Error("The saved teacher rules couldn't be read.");
  return parsed.data;
}

/** An override by id, read as an own key only, so an id such as "constructor" is never a rule. */
function overrideOf(
  overrides: Record<string, RuleOverride>,
  id: string,
): RuleOverride | null {
  return Object.hasOwn(overrides, id) ? (overrides[id] ?? null) : null;
}

/**
 * Whether an override takes the place of what the notices say, rather than adding to it. Only one
 * that allowed more help than the notices when it was set does, and only an admin can set one. An
 * override saved before the flag existed reads as not loosening: read the other way, an old
 * stricter setting would hide a teacher's later No help, and an admin's old loosening is one tap
 * to set again.
 */
const loosening = (override: RuleOverride) => override.loosens === true;

/* ------------------------------------------------------------------------------------------------
 * Matching the class a tool named
 * ---------------------------------------------------------------------------------------------- */

/** Roman numerals the way class names use them: "Spanish III" is "Spanish 3". */
const NUMERALS: Record<string, string> = {
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
};

/**
 * A name as it is compared: lower case, "&" as "and", roman numerals as digits, and punctuation as
 * spaces, so "AP US History!" and "ap us history" are one name. Periods and apostrophes are dropped
 * rather than spaced, so the "U.S." in "AP U.S. History" stays one word, and accents are dropped, so
 * "Espanol" is "Español".
 */
export function normaliseName(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/['’.]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => NUMERALS[word] ?? word)
    .join(" ");
}

const wordsOf = (normalised: string) =>
  normalised.length > 0 ? normalised.split(" ") : [];

/** Without its spaces, so "Pre-Calculus" is "Precalculus" and "English11" is "English 11". */
const squashed = (normalised: string) => normalised.replaceAll(" ", "");

/** Whether `needle` is a run of whole words inside `haystack`, so "chem" never matches "chemistry". */
function containsWords(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++)
    if (needle.every((word, offset) => haystack[start + offset] === word))
      return true;
  return false;
}

/**
 * The short form students use: words of two letters or fewer and numbers count whole, longer words
 * give their first letter, so "AP US History" is "apush". Only for names of two words or more: one
 * word's initial is not a name anybody calls a class by.
 */
function acronymOf(words: string[]): string | null {
  if (words.length < 2) return null;
  return words
    .map((word) =>
      word.length <= 2 || /^\d+$/.test(word) ? word : word.charAt(0),
    )
    .join("");
}

/**
 * Whether the named text is how the name reads from one of its words on, cut short: "chem",
 * "precalc", "ap chem", "pre-calc". At least four letters, so "pre" or "ap" alone is not taken as
 * the start of a class.
 */
function isWordPrefix(words: string[], named: string): boolean {
  const want = squashed(named);
  if (want.length < 4) return false;
  return words.some((_, start) => words.slice(start).join("").startsWith(want));
}

/**
 * The classes the named text fits. Exact first, by name, id or short form; only when none is exact,
 * the partial fits, whole words either way or a cut-short name. So "Chemistry" is Chemistry even
 * beside AP Chemistry, and "chem" beside both is a question, not a guess.
 */
function classMatches(classes: SchoolClass[], named: string): SchoolClass[] {
  const exact = classes.filter((schoolClass) => {
    const name = normaliseName(schoolClass.name);
    return (
      squashed(name) === squashed(named) ||
      squashed(normaliseName(schoolClass.id)) === squashed(named) ||
      acronymOf(wordsOf(name)) === named
    );
  });
  if (exact.length > 0) return exact;
  const want = wordsOf(named);
  return classes.filter((schoolClass) => {
    const words = wordsOf(normaliseName(schoolClass.name));
    return (
      containsWords(words, want) ||
      containsWords(want, words) ||
      isWordPrefix(words, named)
    );
  });
}

const byName = (a: SchoolClass, b: SchoolClass) =>
  a.name.localeCompare(b.name, "en");

/** The classes as the model can name them, A to Z, with the id where two share a name. */
function classList(classes: SchoolClass[]): string {
  const counts = new Map<string, number>();
  for (const schoolClass of classes) {
    const name = normaliseName(schoolClass.name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...classes]
    .sort(byName)
    .map((schoolClass) =>
      (counts.get(normaliseName(schoolClass.name)) ?? 0) > 1
        ? `${schoolClass.name} (${schoolClass.id})`
        : schoolClass.name,
    )
    .join(", ");
}

/* ------------------------------------------------------------------------------------------------
 * Levels
 * ---------------------------------------------------------------------------------------------- */

type Decided = {
  level: HelpLevel;
  source: RuleSource;
  /** The assignment whose rule decided it, when one did. */
  decidedBy: string | null;
};

/**
 * An assignment's own level: its notice's, with its override in place of it when the override
 * loosens and on top of it otherwise, the stricter of the two; or none of its own. On a tie the
 * notice is named, since it is the rule that stands if the override goes.
 */
function ownLevel(
  assignment: SchoolAssignment,
  overrides: RuleOverrides,
): { level: HelpLevel; source: "override" | "notice" } | null {
  const notice = assignment.help;
  const override = overrideOf(overrides.assignments, assignment.id);
  if (!override) return notice ? { level: notice, source: "notice" } : null;
  if (
    notice === null ||
    loosening(override) ||
    helpLevelRank(override.level) > helpLevelRank(notice)
  )
    return { level: override.level, source: "override" };
  return { level: notice, source: "notice" };
}

/** Infinity for no due date, so undated work sorts after dated work. */
function dueTime(assignment: SchoolAssignment): number {
  if (assignment.due === null) return Number.POSITIVE_INFINITY;
  const due = Date.parse(assignment.due);
  return Number.isNaN(due) ? Number.POSITIVE_INFINITY : due;
}

/**
 * Still to do and not past due. A due date that cannot be read counts as not past: a teacher's rule
 * is never dropped over a date nobody could read.
 */
function isLive(assignment: SchoolAssignment, now: Date): boolean {
  if (assignment.status !== "open" && assignment.status !== "missing")
    return false;
  if (assignment.due === null) return true;
  const due = Date.parse(assignment.due);
  return Number.isNaN(due) || due >= now.getTime();
}

/** Soonest due first, then by title, then id, so every sort here has one answer. */
function byDueThenTitle(a: SchoolAssignment, b: SchoolAssignment): number {
  return (
    dueTime(a) - dueTime(b) ||
    a.title.localeCompare(b.title, "en") ||
    a.id.localeCompare(b.id, "en")
  );
}

/**
 * The kinds of work a class's level comes from. Materials and announcements are read, not done, and
 * one with no due date would hold its class forever, so their own level holds only for a call that
 * names them (assignmentMatch, then assignmentRule).
 */
const CLASS_RULING_KINDS: ReadonlySet<AssignmentKind> = new Set([
  "assignment",
  "quiz",
  "test",
]);

/**
 * The class's level from its notices alone: the strictest notice among its assignments, quizzes and
 * tests still to do and not past due, which names the one that decided it; otherwise the default.
 */
function noticeRule(
  snapshot: SchoolSnapshot,
  schoolClass: SchoolClass,
  now: Date,
): Decided {
  const [strictest] = snapshot.assignments
    .flatMap((assignment) =>
      assignment.classId === schoolClass.id &&
      CLASS_RULING_KINDS.has(assignment.kind) &&
      assignment.help !== null &&
      isLive(assignment, now)
        ? [{ assignment, level: assignment.help }]
        : [],
    )
    .sort(
      (a, b) =>
        helpLevelRank(b.level) - helpLevelRank(a.level) ||
        byDueThenTitle(a.assignment, b.assignment),
    );
  if (strictest)
    return {
      level: strictest.level,
      source: "notice",
      decidedBy: strictest.assignment.title,
    };
  return { level: DEFAULT_HELP_LEVEL, source: "default", decidedBy: null };
}

/**
 * The class's level: what its notices give, with its override in place of that when the override
 * loosens, and otherwise the stricter of the two. So a student who made a class Hints only still
 * gets the No help a teacher posts later. On a tie the notice is named, being the teacher's rule
 * that stands if the override goes; an override beats the default, which is nobody's rule.
 */
function classRule(
  snapshot: SchoolSnapshot,
  schoolClass: SchoolClass,
  overrides: RuleOverrides,
  now: Date,
): Decided {
  const fromNotices = noticeRule(snapshot, schoolClass, now);
  const override = overrideOf(overrides.classes, schoolClass.id);
  if (!override) return fromNotices;
  const stricter =
    helpLevelRank(override.level) - helpLevelRank(fromNotices.level);
  if (
    loosening(override) ||
    stricter > 0 ||
    (stricter === 0 && fromNotices.source === "default")
  )
    return { level: override.level, source: "override", decidedBy: null };
  return fromNotices;
}

/**
 * What the study tools obey for one assignment: the stricter of the class's level and its own. Its
 * own wins a tie, being the more particular rule. So an admin who loosens a class leaves an
 * assignment whose own notice is stricter as strict as it was: only an override on the assignment
 * itself loosens it, and never past its class's level.
 */
function assignmentRule(
  forClass: Decided,
  assignment: SchoolAssignment,
  overrides: RuleOverrides,
): Decided {
  const own = ownLevel(assignment, overrides);
  if (own && helpLevelRank(own.level) >= helpLevelRank(forClass.level))
    return {
      level: own.level,
      source: own.source,
      decidedBy: assignment.title,
    };
  return forClass;
}

/**
 * The assignment the named text fits, among the class's: by id, then by title, then by title words
 * either way. Where several fit equally, the strictest rule wins, so a vague name can never land on
 * a looser rule than another assignment it also fits. No fit is null: the class's rule still holds.
 */
function assignmentMatch(
  assignments: SchoolAssignment[],
  named: string,
  overrides: RuleOverrides,
): SchoolAssignment | null {
  const want = normaliseName(named);
  if (want.length === 0) return null;
  const words = wordsOf(want);
  const byId = assignments.filter(
    (assignment) =>
      assignment.id === named.trim() || normaliseName(assignment.id) === want,
  );
  const byTitle = assignments.filter(
    (assignment) => normaliseName(assignment.title) === want,
  );
  const byWords = assignments.filter((assignment) => {
    const title = wordsOf(normaliseName(assignment.title));
    return containsWords(title, words) || containsWords(words, title);
  });
  const fits = [byId, byTitle, byWords].find((tier) => tier.length > 0);
  if (!fits) return null;
  const rank = (assignment: SchoolAssignment) => {
    const own = ownLevel(assignment, overrides);
    return own ? helpLevelRank(own.level) : -1;
  };
  const [best] = [...fits].sort(
    (a, b) =>
      rank(b) - rank(a) ||
      Number(b.status !== "returned") - Number(a.status !== "returned") ||
      byDueThenTitle(a, b),
  );
  return best ?? null;
}

/**
 * The class (and maybe the assignment) a study tool named, with the level it must obey.
 *
 * With no snapshot, or no classes in it, there is nothing to match against: the class is taken as
 * named, under the default level, so a student with no Classroom notices yet can still study. With
 * no snapshot at all no rule could be read, so make_quiz and make_flashcards refuse before asking
 * (guard.ts, quiz-tools.ts); only show_progress comes here then, to count practice by that name.
 */
export function resolveStudyTarget(
  snapshot: SchoolSnapshot | null,
  overrides: RuleOverrides,
  named: { className: string; assignment?: string | null },
  now: Date,
): StudyTarget {
  const shown = named.className.trim();
  const wanted = normaliseName(shown);
  if (!snapshot || snapshot.classes.length === 0) {
    if (wanted.length === 0)
      return { ok: false, reason: "Name the class this is for." };
    return {
      ok: true,
      classId: wanted.replaceAll(" ", "-"),
      className: shown,
      teacher: null,
      assignmentId: null,
      assignmentTitle: null,
      level: DEFAULT_HELP_LEVEL,
      source: "default",
      decidedBy: null,
    };
  }
  const classes = snapshot.classes;
  if (wanted.length === 0)
    return {
      ok: false,
      reason: `Name the class this is for. Use one of: ${classList(classes)}.`,
    };
  const matches = classMatches(classes, wanted);
  const [schoolClass] = matches;
  if (!schoolClass)
    return {
      ok: false,
      reason: `"${shown}" isn't one of the student's classes. Use one of: ${classList(classes)}.`,
    };
  if (matches.length > 1)
    return {
      ok: false,
      reason: `"${shown}" matches more than one of the student's classes. Use one of: ${classList(matches)}.`,
    };
  const forClass = classRule(snapshot, schoolClass, overrides, now);
  const assignment = named.assignment
    ? assignmentMatch(
        snapshot.assignments.filter(
          (candidate) => candidate.classId === schoolClass.id,
        ),
        named.assignment,
        overrides,
      )
    : null;
  const decided = assignment
    ? assignmentRule(forClass, assignment, overrides)
    : forClass;
  return {
    ok: true,
    classId: schoolClass.id,
    className: schoolClass.name,
    teacher: schoolClass.teacher,
    assignmentId: assignment?.id ?? null,
    assignmentTitle: assignment?.title ?? null,
    level: decided.level,
    source: decided.source,
    decidedBy: decided.decidedBy,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The service: overrides stored per person, the Teacher rules screen, and the tools' lookup
 * ---------------------------------------------------------------------------------------------- */

const LOOSENING =
  "Only a teacher or an admin can loosen a teacher's rule. You can make it stricter.";

const ADMIN_LOOSENED =
  "An admin loosened this rule, so only an admin can change it.";

/**
 * The overrides with the change made: a level sets an override, null clears it. Each override set
 * records whether it allows more help than the notices alone give right now, which decides for
 * good whether it replaces them or adds to them (classRule, ownLevel). A class is weighed against
 * what its notices give the class; an assignment against its own notice, the level its override
 * stands in for, since its class's rule holds over it either way (assignmentRule).
 */
function changed(
  snapshot: SchoolSnapshot,
  before: RuleOverrides,
  change: RulesChange,
  stamp: { setBy: string; setAt: string },
  now: Date,
): RuleOverrides {
  const fromNotices = {
    classes: (id: string) => {
      const schoolClass = snapshot.classes.find(
        (candidate) => candidate.id === id,
      );
      return schoolClass ? noticeRule(snapshot, schoolClass, now).level : null;
    },
    assignments: (id: string) =>
      snapshot.assignments.find((candidate) => candidate.id === id)?.help ??
      null,
  };
  const apply = (kind: "classes" | "assignments") => {
    const next = new Map(Object.entries(before[kind]));
    for (const [id, level] of Object.entries(change[kind] ?? {})) {
      if (level === null) {
        next.delete(id);
        continue;
      }
      const notices = fromNotices[kind](id);
      next.set(id, {
        level,
        ...stamp,
        loosens: notices !== null && loosens(notices, level),
      });
    }
    return Object.fromEntries(next);
  };
  return { classes: apply("classes"), assignments: apply("assignments") };
}

/**
 * Throws when a student's change would set a loosening override or touch an admin's. A level that
 * allows more help than the notices give is an admin's to set. An admin's loosening stands until an
 * admin changes it: not replaced, and not cleared either, which could loosen as easily as tighten
 * once the notices it replaced have moved on.
 */
function assertNoLooseningOverride(
  before: RuleOverrides,
  after: RuleOverrides,
  change: RulesChange,
) {
  for (const kind of ["classes", "assignments"] as const)
    for (const id of Object.keys(change[kind] ?? {})) {
      const current = overrideOf(before[kind], id);
      if (current && loosening(current))
        throw new StudyForbiddenError(ADMIN_LOOSENED);
      const set = overrideOf(after[kind], id);
      if (set && loosening(set)) throw new StudyForbiddenError(LOOSENING);
    }
}

/**
 * Throws unless every class and assignment the change names is at least as strict after it as
 * before. An assignment is judged by its own level as well as what the tools obey for it: a looser
 * override hidden today behind a stricter class rule would loosen it the day that rule lifts.
 */
function assertNoLooser(
  snapshot: SchoolSnapshot,
  before: RuleOverrides,
  after: RuleOverrides,
  change: RulesChange,
  now: Date,
) {
  for (const id of Object.keys(change.classes ?? {})) {
    const schoolClass = snapshot.classes.find(
      (candidate) => candidate.id === id,
    );
    if (
      schoolClass &&
      loosens(
        classRule(snapshot, schoolClass, before, now).level,
        classRule(snapshot, schoolClass, after, now).level,
      )
    )
      throw new StudyForbiddenError(LOOSENING);
  }
  for (const id of Object.keys(change.assignments ?? {})) {
    const assignment = snapshot.assignments.find(
      (candidate) => candidate.id === id,
    );
    if (!assignment) continue;
    // No level of its own is the loosest an assignment's own rule can be.
    const own = (overrides: RuleOverrides) =>
      ownLevel(assignment, overrides)?.level ?? "full";
    if (loosens(own(before), own(after)))
      throw new StudyForbiddenError(LOOSENING);
    const schoolClass = snapshot.classes.find(
      (candidate) => candidate.id === assignment.classId,
    );
    const obeyed = (overrides: RuleOverrides) =>
      schoolClass
        ? assignmentRule(
            classRule(snapshot, schoolClass, overrides, now),
            assignment,
            overrides,
          ).level
        : own(overrides);
    if (loosens(obeyed(before), obeyed(after)))
      throw new StudyForbiddenError(LOOSENING);
  }
}

/** Every id the change names is one of the person's, and every level is one a teacher uses. */
function assertKnown(snapshot: SchoolSnapshot, change: RulesChange) {
  const classes = Object.entries(change.classes ?? {});
  const assignments = Object.entries(change.assignments ?? {});
  for (const [id] of classes)
    if (!snapshot.classes.some((schoolClass) => schoolClass.id === id))
      throw new StudyInputError(
        "One of those classes isn't in your list anymore. Refresh your classes and try again.",
      );
  for (const [id] of assignments)
    if (!snapshot.assignments.some((assignment) => assignment.id === id))
      throw new StudyInputError(
        "One of those assignments isn't in your list anymore. Refresh your classes and try again.",
      );
  for (const [, level] of [...classes, ...assignments])
    if (level !== null && !HELP_LEVELS.includes(level))
      throw new StudyInputError("Choose Full help, Hints only or No help.");
}

function classRulesOf(
  snapshot: SchoolSnapshot,
  schoolClass: SchoolClass,
  overrides: RuleOverrides,
  now: Date,
): ClassRules {
  const forClass = classRule(snapshot, schoolClass, overrides, now);
  return {
    classId: schoolClass.id,
    className: schoolClass.name,
    teacher: schoolClass.teacher,
    level: forClass.level,
    source: forClass.source,
    override: overrideOf(overrides.classes, schoolClass.id)?.level ?? null,
    assignments: snapshot.assignments
      .filter((assignment) => assignment.classId === schoolClass.id)
      .sort(byDueThenTitle)
      .map((assignment) => {
        const obeyed = assignmentRule(forClass, assignment, overrides);
        return {
          assignmentId: assignment.id,
          title: assignment.title,
          kind: assignment.kind,
          due: assignment.due,
          status: assignment.status,
          notice: assignment.help,
          override:
            overrideOf(overrides.assignments, assignment.id)?.level ?? null,
          level: obeyed.level,
          source: obeyed.source,
        };
      }),
  };
}

export function createRulesService(deps: {
  store: StudyStore;
  now?: () => Date;
}): RulesService {
  const clock = deps.now ?? (() => new Date());
  const overrides = async (owner: string): Promise<RuleOverrides> => {
    const record = await deps.store.get(owner, "rules", recordId(owner));
    return record ? readOverrides(record.data) : emptyOverrides();
  };
  return {
    overrides,
    async change(owner, change, options) {
      const { snapshot } = options;
      if (!snapshot)
        throw new StudyInputError(
          "Refresh your classes first, then change a rule.",
        );
      assertKnown(snapshot, change);
      const now = options.now ?? clock();
      const id = recordId(owner);
      await deps.store.insertOnce(owner, {
        id,
        kind: "rules",
        data: emptyOverrides(),
      });
      // Checked under the record's lock, against the rules as they are now, not as a tab last saw them.
      const saved = await deps.store.update(owner, "rules", id, (current) => {
        const before = readOverrides(current.data);
        const after = changed(
          snapshot,
          before,
          change,
          { setBy: owner, setAt: now.toISOString() },
          now,
        );
        if (!options.canLoosen) {
          assertNoLooseningOverride(before, after, change);
          assertNoLooser(snapshot, before, after, change, now);
        }
        return { data: after };
      });
      return readOverrides(saved.data);
    },
    async view(owner, snapshot, options) {
      const couldNotRead = [
        ...new Set([
          ...(snapshot?.couldNotRead ?? []),
          ...(options.couldNotRead ?? []),
        ]),
      ];
      if (!snapshot)
        return {
          timeZone: "UTC",
          classes: [],
          canLoosen: options.canLoosen,
          syncedAt: null,
          couldNotRead,
        };
      const saved = await overrides(owner);
      const now = options.now ?? clock();
      return {
        timeZone: snapshot.timeZone,
        classes: [...snapshot.classes]
          .sort(byName)
          .map((schoolClass) =>
            classRulesOf(snapshot, schoolClass, saved, now),
          ),
        canLoosen: options.canLoosen,
        syncedAt: snapshot.syncedAt,
        couldNotRead,
      };
    },
    async target(owner, snapshot, named, now) {
      return resolveStudyTarget(
        snapshot,
        await overrides(owner),
        named,
        now ?? clock(),
      );
    },
  };
}
