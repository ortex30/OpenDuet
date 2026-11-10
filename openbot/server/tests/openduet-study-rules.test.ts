import { describe, expect, test } from "bun:test";
import {
  type HelpLevel,
  QUIZ_TOOL,
  type RuleOverride,
  type RuleOverrides,
  type RulesChange,
  readTeacherRuleBlock,
  type SchoolAssignment,
  type SchoolClass,
  type SchoolSnapshot,
} from "@openbot/shared/study";
import { z } from "zod";
import {
  type RulesService,
  StudyForbiddenError,
  StudyInputError,
  type StudyKind,
  StudyNotFoundError,
  type StudyRecord,
  type StudyStore,
  type StudyTarget,
} from "../src/openduet/study/contracts";
import { guardTeacherRules } from "../src/openduet/study/guard";
import {
  createRulesService,
  normaliseName,
  resolveStudyTarget,
} from "../src/openduet/study/rules";

/**
 * The teacher's AI-help level for a class, worked out from Classroom notices and the Teacher rules
 * screen: which class a tool means, which notice decides its level, and who may loosen it.
 *
 * The snapshot is shaped like the demo student's inbox: a Hints only lab in Chemistry, a No help DBQ
 * in AP US History, a Full help quiz and a missing homework in Precalculus, a Full help test in
 * Spanish III, a Hints only essay in English 11, and a Chemistry lab already returned.
 */

const NOW = new Date("2026-11-04T15:00:00.000Z");
const NONE: RuleOverrides = { classes: {}, assignments: {} };

function work(
  fields: Pick<SchoolAssignment, "id" | "classId" | "title"> &
    Partial<SchoolAssignment>,
): SchoolAssignment {
  return {
    kind: "assignment",
    status: "open",
    due: null,
    dueDate: null,
    dueTime: null,
    points: null,
    grade: null,
    help: null,
    minutes: 30,
    link: null,
    noticeId: `notice-${fields.id}`,
    ...fields,
  };
}

const CLASSES: SchoolClass[] = [
  {
    id: "apush1",
    name: "AP US History",
    teacher: "Mr. Grant",
    period: "1",
    color: "sky",
  },
  {
    id: "chem2",
    name: "Chemistry",
    teacher: "Dr. Okoro",
    period: "2",
    color: "violet",
  },
  {
    id: "eng11",
    name: "English 11",
    teacher: "Ms. Alvarez",
    period: "3",
    color: "teal",
  },
  {
    id: "precalc4",
    name: "Precalculus",
    teacher: "Mr. Chen",
    period: "4",
    color: "amber",
  },
  {
    id: "spanish5",
    name: "Spanish III",
    teacher: "Sra. Morales",
    period: "5",
    color: "rose",
  },
];

const ASSIGNMENTS: SchoolAssignment[] = [
  work({
    id: "lab6",
    classId: "chem2",
    title: "Lab 6 report",
    due: "2026-11-06T04:59:00.000Z",
    dueDate: "2026-11-05",
    dueTime: "23:59",
    points: 40,
    help: "hints",
    minutes: 90,
    link: "https://classroom.google.com/c/chem2/a/lab6",
  }),
  work({
    id: "lab5",
    classId: "chem2",
    title: "Lab 5 report",
    status: "returned",
    due: "2026-10-29T03:59:00.000Z",
    dueDate: "2026-10-28",
    dueTime: "23:59",
    points: 40,
    grade: "34/40",
  }),
  work({
    id: "dbq3",
    classId: "apush1",
    title: "DBQ essay",
    due: "2026-11-06T13:00:00.000Z",
    dueDate: "2026-11-06",
    dueTime: "08:00",
    help: "none",
    minutes: 120,
  }),
  work({
    id: "quiz4",
    classId: "precalc4",
    title: "Unit 4 quiz",
    kind: "quiz",
    due: "2026-11-05T15:45:00.000Z",
    dueDate: "2026-11-05",
    dueTime: "10:45",
    help: "full",
    minutes: 45,
  }),
  work({
    id: "hw43",
    classId: "precalc4",
    title: "Section 4.3 homework",
    status: "missing",
    due: "2026-11-04T04:59:00.000Z",
    dueDate: "2026-11-03",
    dueTime: "23:59",
    help: "full",
    minutes: 40,
  }),
  work({
    id: "u5",
    classId: "spanish5",
    title: "Unidad 5 vocab test",
    kind: "test",
    due: "2026-11-07T17:00:00.000Z",
    dueDate: "2026-11-07",
    dueTime: "12:00",
    help: "full",
    minutes: 60,
  }),
  work({
    id: "gatsby",
    classId: "eng11",
    title: "Great Gatsby essay",
    due: "2026-11-10T04:59:00.000Z",
    dueDate: "2026-11-09",
    dueTime: "23:59",
    help: "hints",
    minutes: 180,
  }),
];

const SNAPSHOT: SchoolSnapshot = {
  syncedAt: "2026-11-04T14:55:00.000Z",
  timeZone: "America/New_York",
  classes: CLASSES,
  assignments: ASSIGNMENTS,
  couldNotRead: [],
};

const CLASS_NAMES =
  "AP US History, Chemistry, English 11, Precalculus, Spanish III";

function withClasses(classes: SchoolClass[]): SchoolSnapshot {
  return { ...SNAPSHOT, classes, assignments: [] };
}

function withWork(...extra: SchoolAssignment[]): SchoolSnapshot {
  return { ...SNAPSHOT, assignments: [...ASSIGNMENTS, ...extra] };
}

/** An override as stored; `loosens` left out reads the way an override saved before it existed does. */
function override(level: HelpLevel, loosens?: boolean): RuleOverride {
  return {
    level,
    setBy: "admin-1",
    setAt: "2026-11-01T12:00:00.000Z",
    ...(loosens === undefined ? {} : { loosens }),
  };
}

function resolve(
  className: string,
  options: {
    assignment?: string;
    overrides?: RuleOverrides;
    snapshot?: SchoolSnapshot | null;
    now?: Date;
  } = {},
): StudyTarget {
  return resolveStudyTarget(
    options.snapshot === undefined ? SNAPSHOT : options.snapshot,
    options.overrides ?? NONE,
    { className, assignment: options.assignment ?? null },
    options.now ?? NOW,
  );
}

function ok(target: StudyTarget) {
  if (!target.ok) throw new Error(`Expected a class, got: ${target.reason}`);
  return target;
}

/** The part of a target that says what the tools obey and why. */
function rule(target: StudyTarget) {
  const { classId, assignmentId, level, source, decidedBy } = ok(target);
  return { classId, assignmentId, level, source, decidedBy };
}

/** An owner-scoped store kept in memory, as the real one keeps it in Postgres. */
function memoryStore(): StudyStore & {
  records: Map<string, StudyRecord>;
  keyOf: (owner: string, kind: StudyKind, id: string) => string;
} {
  const records = new Map<string, StudyRecord>();
  const keyOf = (owner: string, kind: StudyKind, id: string) =>
    `${owner}|${kind}|${id}`;
  // Saved as JSON, as jsonb would, so nothing a caller keeps a hold of changes what is stored.
  const copy = (data: Record<string, unknown>) =>
    JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const at = new Date("2026-11-04T15:00:00.000Z");
  return {
    records,
    keyOf,
    async get(owner, kind, id) {
      return records.get(keyOf(owner, kind, id)) ?? null;
    },
    async put(owner, input) {
      const previous = records.get(keyOf(owner, input.kind, input.id));
      const record: StudyRecord = {
        id: input.id,
        ownerUserId: owner,
        botId: input.botId ?? null,
        kind: input.kind,
        classId: input.classId ?? null,
        refId: input.refId ?? null,
        status: input.status ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        data: copy(input.data),
        createdAt: previous?.createdAt ?? at,
        updatedAt: at,
      };
      records.set(keyOf(owner, input.kind, input.id), record);
      return record;
    },
    async insertOnce(owner, input) {
      const existing = records.get(keyOf(owner, input.kind, input.id));
      if (existing) return { record: existing, created: false };
      return { record: await this.put(owner, input), created: true };
    },
    async list(owner, kind) {
      return [...records.values()].filter(
        (record) => record.ownerUserId === owner && record.kind === kind,
      );
    },
    async update(owner, kind, id, change) {
      const current = records.get(keyOf(owner, kind, id));
      if (!current) throw new StudyNotFoundError();
      const next = await change(current);
      const record: StudyRecord = {
        ...current,
        ...(next.data ? { data: copy(next.data) } : {}),
        updatedAt: at,
      };
      records.set(keyOf(owner, kind, id), record);
      return record;
    },
  };
}

describe("a class name, as it is compared", () => {
  test("drops case, punctuation and accents, spells & as and, and reads roman numerals", () => {
    expect(normaliseName("  AP U.S. History & Government III! ")).toBe(
      "ap us history and government 3",
    );
    expect(normaliseName("Español IV")).toBe("espanol 4");
    expect(normaliseName("Ms. Alvarez's English-11")).toBe(
      "ms alvarezs english 11",
    );
  });
});

describe("which class a study tool means", () => {
  test("takes the name, the id, a short form, a cut-short name or words of it", () => {
    const cases: [string, string][] = [
      ["Chemistry", "chem2"],
      ["  CHEMISTRY! ", "chem2"],
      ["chem2", "chem2"],
      ["chem", "chem2"],
      ["Chemistry lab", "chem2"],
      ["AP US History", "apush1"],
      ["AP U.S. History", "apush1"],
      ["apush", "apush1"],
      ["APUSH", "apush1"],
      ["US History", "apush1"],
      ["history", "apush1"],
      ["Precalculus", "precalc4"],
      ["precalc", "precalc4"],
      ["Pre-Calculus", "precalc4"],
      ["pre-calc", "precalc4"],
      ["Spanish III", "spanish5"],
      ["Spanish 3", "spanish5"],
      ["spanish", "spanish5"],
      ["English 11", "eng11"],
      ["english11", "eng11"],
      ["e11", "eng11"],
      ["English", "eng11"],
    ];
    for (const [named, classId] of cases)
      expect({ named, classId: ok(resolve(named)).classId }).toEqual({
        named,
        classId,
      });
  });

  test("says which classes it can use when the name is none of them", () => {
    expect(resolve("Biology")).toEqual({
      ok: false,
      reason: `"Biology" isn't one of the student's classes. Use one of: ${CLASS_NAMES}.`,
    });
    // Under four letters is too short to be taken as the start of a name.
    expect(resolve("pre")).toEqual({
      ok: false,
      reason: `"pre" isn't one of the student's classes. Use one of: ${CLASS_NAMES}.`,
    });
    expect(resolve("   ")).toEqual({
      ok: false,
      reason: `Name the class this is for. Use one of: ${CLASS_NAMES}.`,
    });
  });

  test("prefers an exact name to a partial one, and asks rather than guesses between partial ones", () => {
    const snapshot = withClasses([
      { ...CLASSES[1]!, id: "chem2", name: "Chemistry" },
      { ...CLASSES[1]!, id: "apchem", name: "AP Chemistry" },
    ]);
    expect(ok(resolve("Chemistry", { snapshot })).classId).toBe("chem2");
    expect(ok(resolve("AP Chem", { snapshot })).classId).toBe("apchem");
    expect(ok(resolve("apc", { snapshot })).classId).toBe("apchem");
    expect(resolve("chem", { snapshot })).toEqual({
      ok: false,
      reason:
        '"chem" matches more than one of the student\'s classes. Use one of: AP Chemistry, Chemistry.',
    });
  });

  test("names two classes that share a name by their ids, so the model can pick one", () => {
    const snapshot = withClasses([
      { ...CLASSES[1]!, id: "chem2" },
      { ...CLASSES[1]!, id: "chemistry" },
    ]);
    expect(resolve("Chemistry", { snapshot })).toEqual({
      ok: false,
      reason:
        '"Chemistry" matches more than one of the student\'s classes. Use one of: Chemistry (chem2), Chemistry (chemistry).',
    });
    expect(ok(resolve("chem2", { snapshot })).classId).toBe("chem2");
  });

  test("reads & as and", () => {
    const snapshot = withClasses([
      { ...CLASSES[0]!, id: "health", name: "Health & Fitness" },
    ]);
    expect(ok(resolve("health and fitness", { snapshot })).classId).toBe(
      "health",
    );
  });

  test("with no classes to match, takes the class as named under the default", () => {
    const expected: StudyTarget = {
      ok: true,
      classId: "ap-us-history",
      className: "AP US History",
      teacher: null,
      assignmentId: null,
      assignmentTitle: null,
      level: "hints",
      source: "default",
      decidedBy: null,
    };
    expect(resolve(" AP US History ", { snapshot: null })).toEqual(expected);
    expect(resolve("AP US History", { snapshot: withClasses([]) })).toEqual(
      expected,
    );
    expect(resolve(" ", { snapshot: null })).toEqual({
      ok: false,
      reason: "Name the class this is for.",
    });
  });
});

describe("the level a class's notices give it", () => {
  test("is the strictest notice still to do, naming the assignment that decided it", () => {
    expect(resolve("APUSH")).toEqual({
      ok: true,
      classId: "apush1",
      className: "AP US History",
      teacher: "Mr. Grant",
      assignmentId: null,
      assignmentTitle: null,
      level: "none",
      source: "notice",
      decidedBy: "DBQ essay",
    });
    expect(rule(resolve("Chemistry"))).toEqual({
      classId: "chem2",
      assignmentId: null,
      level: "hints",
      source: "notice",
      decidedBy: "Lab 6 report",
    });
    // The missing homework is past due, so the quiz still to come decides it.
    expect(rule(resolve("Precalculus"))).toEqual({
      classId: "precalc4",
      assignmentId: null,
      level: "full",
      source: "notice",
      decidedBy: "Unit 4 quiz",
    });
    expect(rule(resolve("Spanish III"))).toEqual({
      classId: "spanish5",
      assignmentId: null,
      level: "full",
      source: "notice",
      decidedBy: "Unidad 5 vocab test",
    });
    expect(rule(resolve("English 11"))).toEqual({
      classId: "eng11",
      assignmentId: null,
      level: "hints",
      source: "notice",
      decidedBy: "Great Gatsby essay",
    });
  });

  test("falls back to Hints only once nothing with a notice is still to do", () => {
    const later = new Date("2026-12-01T12:00:00.000Z");
    for (const named of ["APUSH", "Chemistry", "Precalculus"])
      expect(rule(resolve(named, { now: later }))).toMatchObject({
        level: "hints",
        source: "default",
        decidedBy: null,
      });
  });

  test("lets the strictest notice win, the one due soonest on a tie", () => {
    const snapshot = withWork(
      work({
        id: "safety",
        classId: "chem2",
        title: "Lab safety test",
        due: "2026-11-09T17:00:00.000Z",
        help: "none",
      }),
      work({
        id: "prelab",
        classId: "chem2",
        title: "Pre-lab quiz",
        due: "2026-11-05T17:00:00.000Z",
        help: "none",
      }),
    );
    expect(rule(resolve("Chemistry", { snapshot }))).toMatchObject({
      level: "none",
      source: "notice",
      decidedBy: "Pre-lab quiz",
    });
  });

  test("comes from assignments, quizzes and tests: a material or an announcement holds only for itself", () => {
    const snapshot = withWork(
      work({
        id: "dbqdocs",
        classId: "apush1",
        title: "DBQ documents and rubric",
        kind: "material",
        help: "none",
      }),
      work({
        id: "safety",
        classId: "chem2",
        title: "Lab safety reminder",
        kind: "announcement",
        help: "none",
      }),
    );
    // While the DBQ is open, the DBQ itself pauses AP US History.
    expect(rule(resolve("APUSH", { snapshot }))).toEqual({
      classId: "apush1",
      assignmentId: null,
      level: "none",
      source: "notice",
      decidedBy: "DBQ essay",
    });
    expect(rule(resolve("Chemistry", { snapshot }))).toEqual({
      classId: "chem2",
      assignmentId: null,
      level: "hints",
      source: "notice",
      decidedBy: "Lab 6 report",
    });
    // Undated, the material would hold the class for as long as its email is read; it doesn't.
    const later = new Date("2026-11-10T12:00:00.000Z");
    expect(rule(resolve("APUSH", { snapshot, now: later }))).toEqual({
      classId: "apush1",
      assignmentId: null,
      level: "hints",
      source: "default",
      decidedBy: null,
    });
    // Named, each keeps its own No help, whatever the day.
    expect(
      rule(
        resolve("APUSH", { snapshot, assignment: "DBQ documents", now: later }),
      ),
    ).toEqual({
      classId: "apush1",
      assignmentId: "dbqdocs",
      level: "none",
      source: "notice",
      decidedBy: "DBQ documents and rubric",
    });
    expect(
      rule(resolve("Chemistry", { snapshot, assignment: "safety reminder" })),
    ).toEqual({
      classId: "chem2",
      assignmentId: "safety",
      level: "none",
      source: "notice",
      decidedBy: "Lab safety reminder",
    });
  });

  test("counts work with no due date, or one it cannot read, as still to do", () => {
    for (const due of [null, "next Tuesday"])
      expect(
        rule(
          resolve("English 11", {
            snapshot: withWork(
              work({
                id: "reading",
                classId: "eng11",
                title: "Chapter 3 reading",
                due,
                help: "none",
              }),
            ),
          }),
        ),
      ).toMatchObject({ level: "none", decidedBy: "Chapter 3 reading" });
  });
});

describe("the assignment a study tool names", () => {
  test("is found by id, by title or by words of its title, in that class only", () => {
    for (const assignment of [
      "dbq3",
      "DBQ essay",
      "dbq",
      "the DBQ essay for Mr. Grant",
    ])
      expect(rule(resolve("APUSH", { assignment }))).toEqual({
        classId: "apush1",
        assignmentId: "dbq3",
        level: "none",
        source: "notice",
        decidedBy: "DBQ essay",
      });
    // Another class's assignment is not this class's: the class's own rule holds.
    expect(rule(resolve("Chemistry", { assignment: "DBQ essay" }))).toEqual({
      classId: "chem2",
      assignmentId: null,
      level: "hints",
      source: "notice",
      decidedBy: "Lab 6 report",
    });
  });

  test("leaves the class's rule in place when nothing fits", () => {
    expect(rule(resolve("Chemistry", { assignment: "Lab 7" }))).toEqual({
      classId: "chem2",
      assignmentId: null,
      level: "hints",
      source: "notice",
      decidedBy: "Lab 6 report",
    });
  });

  test("lands on the strictest of several that fit, never a looser one", () => {
    expect(ok(resolve("Chemistry", { assignment: "report" }))).toMatchObject({
      assignmentId: "lab6",
      assignmentTitle: "Lab 6 report",
    });
  });

  test("with no level of its own, obeys its class", () => {
    expect(rule(resolve("Chemistry", { assignment: "Lab 5" }))).toEqual({
      classId: "chem2",
      assignmentId: "lab5",
      level: "hints",
      source: "notice",
      decidedBy: "Lab 6 report",
    });
  });

  test("keeps its own notice past its due date, while the class has moved on", () => {
    const later = new Date("2026-12-01T12:00:00.000Z");
    expect(rule(resolve("APUSH", { assignment: "DBQ", now: later }))).toEqual({
      classId: "apush1",
      assignmentId: "dbq3",
      level: "none",
      source: "notice",
      decidedBy: "DBQ essay",
    });
    // Missing and past due, but its own Full help still stands for it.
    expect(rule(resolve("Precalculus", { assignment: "4.3" }))).toEqual({
      classId: "precalc4",
      assignmentId: "hw43",
      level: "full",
      source: "notice",
      decidedBy: "Section 4.3 homework",
    });
  });
});

describe("overrides from the Teacher rules screen", () => {
  test("an admin loosening a class leaves an assignment whose own notice is stricter as it was", () => {
    const overrides: RuleOverrides = {
      classes: { apush1: override("full", true) },
      assignments: {},
    };
    expect(rule(resolve("APUSH", { overrides }))).toEqual({
      classId: "apush1",
      assignmentId: null,
      level: "full",
      source: "override",
      decidedBy: null,
    });
    expect(rule(resolve("APUSH", { assignment: "DBQ", overrides }))).toEqual({
      classId: "apush1",
      assignmentId: "dbq3",
      level: "none",
      source: "notice",
      decidedBy: "DBQ essay",
    });
  });

  test("loosening the assignment alone leaves the class rule its notice made", () => {
    const overrides: RuleOverrides = {
      classes: {},
      assignments: { dbq3: override("full", true) },
    };
    expect(rule(resolve("APUSH", { assignment: "DBQ", overrides }))).toEqual({
      classId: "apush1",
      assignmentId: "dbq3",
      level: "none",
      source: "notice",
      decidedBy: "DBQ essay",
    });
  });

  test("loosening both lets the assignment go", () => {
    const overrides: RuleOverrides = {
      classes: { apush1: override("full", true) },
      assignments: { dbq3: override("full", true) },
    };
    expect(rule(resolve("APUSH", { assignment: "DBQ", overrides }))).toEqual({
      classId: "apush1",
      assignmentId: "dbq3",
      level: "full",
      source: "override",
      decidedBy: "DBQ essay",
    });
  });

  test("a stricter class override holds over an assignment's looser notice", () => {
    const overrides: RuleOverrides = {
      classes: { spanish5: override("none", false) },
      assignments: {},
    };
    expect(
      rule(resolve("Spanish III", { assignment: "vocab test", overrides })),
    ).toEqual({
      classId: "spanish5",
      assignmentId: "u5",
      level: "none",
      source: "override",
      decidedBy: null,
    });
  });

  test("a tightening override is the stricter of it and the notices, so a No help posted later still wins", () => {
    const overrides: RuleOverrides = {
      classes: { spanish5: override("hints", false) },
      assignments: { gatsby: override("none", false) },
    };
    expect(rule(resolve("Spanish III", { overrides }))).toEqual({
      classId: "spanish5",
      assignmentId: null,
      level: "hints",
      source: "override",
      decidedBy: null,
    });
    const snapshot = withWork(
      work({
        id: "u6",
        classId: "spanish5",
        title: "Unidad 6 test",
        kind: "test",
        due: "2026-11-12T17:00:00.000Z",
        help: "none",
      }),
    );
    expect(rule(resolve("Spanish III", { overrides, snapshot }))).toEqual({
      classId: "spanish5",
      assignmentId: null,
      level: "none",
      source: "notice",
      decidedBy: "Unidad 6 test",
    });
    // An assignment's own tightening adds to its notice the same way.
    expect(
      rule(resolve("English 11", { assignment: "Gatsby", overrides })),
    ).toEqual({
      classId: "eng11",
      assignmentId: "gatsby",
      level: "none",
      source: "override",
      decidedBy: "Great Gatsby essay",
    });
  });

  test("a tie names the teacher's notice, and an override beats the default", () => {
    const overrides: RuleOverrides = {
      classes: {
        chem2: override("hints", false),
        apush1: override("hints", false),
      },
      assignments: { lab6: override("hints", false) },
    };
    expect(rule(resolve("Chemistry", { overrides }))).toEqual({
      classId: "chem2",
      assignmentId: null,
      level: "hints",
      source: "notice",
      decidedBy: "Lab 6 report",
    });
    expect(
      rule(resolve("Chemistry", { assignment: "Lab 6", overrides })),
    ).toMatchObject({ level: "hints", source: "notice" });
    // Once the DBQ is past, no notice says anything for the class, and the override is the rule.
    const later = new Date("2026-12-01T12:00:00.000Z");
    expect(rule(resolve("APUSH", { overrides, now: later }))).toEqual({
      classId: "apush1",
      assignmentId: null,
      level: "hints",
      source: "override",
      decidedBy: null,
    });
  });

  test("an override saved before `loosens` existed adds to the notices, as a tightening one does", () => {
    const old: RuleOverrides = {
      classes: { apush1: override("full"), spanish5: override("hints") },
      assignments: { dbq3: override("full") },
    };
    const flagged: RuleOverrides = {
      classes: {
        apush1: override("full", false),
        spanish5: override("hints", false),
      },
      assignments: { dbq3: override("full", false) },
    };
    for (const [named, assignment] of [
      ["APUSH", undefined],
      ["APUSH", "DBQ"],
      ["Spanish III", undefined],
      ["Spanish III", "vocab test"],
    ] as const)
      expect(rule(resolve(named, { assignment, overrides: old }))).toEqual(
        rule(resolve(named, { assignment, overrides: flagged })),
      );
    // So it never hides the teacher's No help, and still makes a class stricter.
    expect(rule(resolve("APUSH", { overrides: old }))).toMatchObject({
      level: "none",
      source: "notice",
      decidedBy: "DBQ essay",
    });
    expect(rule(resolve("Spanish III", { overrides: old }))).toMatchObject({
      level: "hints",
      source: "override",
    });
  });
});

describe("the rules service", () => {
  test("holds no overrides for a person who never set one", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    expect(await rules.overrides("jordan")).toEqual(NONE);
  });

  test("lets a student make a rule stricter, and records who and when", async () => {
    const store = memoryStore();
    const rules = createRulesService({ store, now: () => NOW });
    const saved = await rules.change(
      "jordan",
      { classes: { spanish5: "none" }, assignments: { lab6: "none" } },
      { canLoosen: false, snapshot: SNAPSHOT },
    );
    // Neither allows more help than the notices, so each adds to them rather than replacing them.
    const expected: RuleOverrides = {
      classes: {
        spanish5: {
          level: "none",
          setBy: "jordan",
          setAt: "2026-11-04T15:00:00.000Z",
          loosens: false,
        },
      },
      assignments: {
        lab6: {
          level: "none",
          setBy: "jordan",
          setAt: "2026-11-04T15:00:00.000Z",
          loosens: false,
        },
      },
    };
    expect(saved).toEqual(expected);
    expect(await rules.overrides("jordan")).toEqual(expected);
    expect(
      store.records.get(store.keyOf("jordan", "rules", "rules:jordan"))?.data,
    ).toEqual(expected);
    expect(
      rule(
        await rules.target("jordan", SNAPSHOT, { className: "Spanish III" }),
      ),
    ).toMatchObject({ level: "none", source: "override" });
    // The assignment is stricter now; the class's own rule is not.
    expect(
      rule(
        await rules.target("jordan", SNAPSHOT, {
          className: "Chemistry",
          assignment: "Lab 6",
        }),
      ),
    ).toEqual({
      classId: "chem2",
      assignmentId: "lab6",
      level: "none",
      source: "override",
      decidedBy: "Lab 6 report",
    });
    expect(
      rule(await rules.target("jordan", SNAPSHOT, { className: "Chemistry" })),
    ).toMatchObject({ level: "hints", source: "notice" });
  });

  test("refuses a student loosening a rule, and leaves the rules as they were", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    await rules.change(
      "jordan",
      { classes: { precalc4: "hints" } },
      { canLoosen: false, snapshot: SNAPSHOT },
    );
    const before = await rules.overrides("jordan");
    const loosening: RulesChange[] = [
      { classes: { chem2: "full" } },
      // Clearing a stricter override loosens the class too.
      { classes: { precalc4: null } },
      { assignments: { gatsby: "full" } },
      // Hidden today behind the class's own No help, and looser the day that rule lifts.
      { assignments: { dbq3: "full" } },
    ];
    for (const change of loosening) {
      const refused = await rules
        .change("jordan", change, { canLoosen: false, snapshot: SNAPSHOT })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(refused).toBeInstanceOf(StudyForbiddenError);
      expect((refused as Error).message).toBe(
        "Only a teacher or an admin can loosen a teacher's rule. You can make it stricter.",
      );
    }
    expect(await rules.overrides("jordan")).toEqual(before);
  });

  test("lets an admin loosen a class, and clear an override", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    await rules.change(
      "jordan",
      { classes: { apush1: "full", chem2: "none" } },
      { canLoosen: true, snapshot: SNAPSHOT },
    );
    // Full help is looser than the DBQ's No help, so it replaces the notices; No help only adds.
    const { classes } = await rules.overrides("jordan");
    expect([classes.apush1?.loosens, classes.chem2?.loosens]).toEqual([
      true,
      false,
    ]);
    expect(
      rule(await rules.target("jordan", SNAPSHOT, { className: "APUSH" })),
    ).toMatchObject({ level: "full", source: "override" });
    await rules.change(
      "jordan",
      { classes: { chem2: null } },
      { canLoosen: true, snapshot: SNAPSHOT },
    );
    expect(
      rule(await rules.target("jordan", SNAPSHOT, { className: "Chemistry" })),
    ).toMatchObject({ level: "hints", source: "notice" });
    expect(Object.keys((await rules.overrides("jordan")).classes)).toEqual([
      "apush1",
    ]);
  });

  test("keeps each person's rules their own", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    await rules.change(
      "alice",
      { classes: { precalc4: "none" } },
      { canLoosen: false, snapshot: SNAPSHOT },
    );
    expect(
      rule(await rules.target("alice", SNAPSHOT, { className: "Precalculus" })),
    ).toMatchObject({ level: "none" });
    expect(
      rule(await rules.target("bob", SNAPSHOT, { className: "Precalculus" })),
    ).toMatchObject({ level: "full" });
  });

  test("refuses a change it cannot check, in a sentence the person can act on", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    const attempt = (
      change: Parameters<typeof rules.change>[1],
      snapshot: SchoolSnapshot | null = SNAPSHOT,
    ) =>
      rules.change("jordan", change, { canLoosen: true, snapshot }).then(
        () => null,
        (error: unknown) => error,
      );
    const sentences: [unknown, string][] = [
      [
        await attempt({ classes: { biology: "none" } }),
        "One of those classes isn't in your list anymore. Refresh your classes and try again.",
      ],
      [
        await attempt({ assignments: { lab9: "none" } }),
        "One of those assignments isn't in your list anymore. Refresh your classes and try again.",
      ],
      [
        await attempt({ classes: { chem2: "some" as HelpLevel } }),
        "Choose Full help, Hints only or No help.",
      ],
      [
        await attempt({ classes: { chem2: "none" } }, null),
        "Refresh your classes first, then change a rule.",
      ],
    ];
    for (const [error, sentence] of sentences) {
      expect(error).toBeInstanceOf(StudyInputError);
      expect((error as Error).message).toBe(sentence);
    }
    expect(await rules.overrides("jordan")).toEqual(NONE);
  });

  test("fails closed on saved rules it cannot read", async () => {
    const store = memoryStore();
    await store.put("jordan", {
      id: "rules:jordan",
      kind: "rules",
      data: { classes: { apush1: { level: "lots" } } },
    });
    const rules = createRulesService({ store, now: () => NOW });
    await expect(
      rules.target("jordan", SNAPSHOT, { className: "Chemistry" }),
    ).rejects.toThrow("The saved teacher rules couldn't be read.");
  });

  test("builds the Teacher rules screen: classes A to Z, work by due date", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    await rules.change(
      "jordan",
      { classes: { chem2: "none" }, assignments: { lab5: "none" } },
      { canLoosen: true, snapshot: SNAPSHOT },
    );
    const view = await rules.view(
      "jordan",
      { ...SNAPSHOT, couldNotRead: ["One notice had no class in it."] },
      {
        canLoosen: false,
        couldNotRead: [
          "Gmail answered slowly, so these are from 10 minutes ago.",
          "One notice had no class in it.",
        ],
      },
    );
    expect(view.canLoosen).toBe(false);
    expect(view.syncedAt).toBe("2026-11-04T14:55:00.000Z");
    // Due times on the screen are shown in the student's own zone, from their calendar.
    expect(view.timeZone).toBe("America/New_York");
    expect(view.couldNotRead).toEqual([
      "One notice had no class in it.",
      "Gmail answered slowly, so these are from 10 minutes ago.",
    ]);
    expect(view.classes.map((rules) => rules.className)).toEqual([
      "AP US History",
      "Chemistry",
      "English 11",
      "Precalculus",
      "Spanish III",
    ]);
    expect(view.classes[1]).toEqual({
      classId: "chem2",
      className: "Chemistry",
      teacher: "Dr. Okoro",
      level: "none",
      source: "override",
      override: "none",
      assignments: [
        {
          assignmentId: "lab5",
          title: "Lab 5 report",
          kind: "assignment",
          due: "2026-10-29T03:59:00.000Z",
          status: "returned",
          notice: null,
          override: "none",
          level: "none",
          source: "override",
        },
        {
          assignmentId: "lab6",
          title: "Lab 6 report",
          kind: "assignment",
          due: "2026-11-06T04:59:00.000Z",
          status: "open",
          notice: "hints",
          override: null,
          level: "none",
          source: "override",
        },
      ],
    });
    expect(
      view.classes[3]?.assignments.map((assignment) => [
        assignment.assignmentId,
        assignment.level,
        assignment.source,
      ]),
    ).toEqual([
      ["hw43", "full", "notice"],
      ["quiz4", "full", "notice"],
    ]);
  });

  test("builds an empty screen before the classes were ever read", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    expect(
      await rules.view("jordan", null, {
        canLoosen: true,
        couldNotRead: ["Connect Gmail to read your Classroom notices."],
      }),
    ).toEqual({
      timeZone: "UTC",
      classes: [],
      canLoosen: true,
      syncedAt: null,
      couldNotRead: ["Connect Gmail to read your Classroom notices."],
    });
  });

  test("weighs a class's change against its assignments, quizzes and tests, and shows a material's own rule", async () => {
    const snapshot = withWork(
      work({
        id: "dbqdocs",
        classId: "apush1",
        title: "DBQ documents and rubric",
        kind: "material",
        help: "none",
      }),
    );
    // Past the DBQ, AP US History is at the default, so Hints only is no looser for it.
    const later = new Date("2026-11-10T12:00:00.000Z");
    const rules = createRulesService({
      store: memoryStore(),
      now: () => later,
    });
    await rules.change(
      "jordan",
      { classes: { apush1: "hints" } },
      { canLoosen: false, snapshot },
    );
    expect((await rules.overrides("jordan")).classes.apush1?.loosens).toBe(
      false,
    );
    const view = await rules.view("jordan", snapshot, { canLoosen: false });
    const apush = view.classes.find((rules) => rules.classId === "apush1");
    expect(apush).toMatchObject({
      level: "hints",
      source: "override",
      override: "hints",
    });
    expect(
      apush?.assignments.map((row) => [
        row.assignmentId,
        row.level,
        row.source,
      ]),
    ).toEqual([
      ["dbq3", "none", "notice"],
      ["dbqdocs", "none", "notice"],
    ]);
  });
});

describe("tightening and loosening as the notices move", () => {
  /** make_quiz as the guard sees it, for a person whose classes are `snapshot`. */
  function quizFor(rules: RulesService, snapshot: SchoolSnapshot) {
    const made: unknown[] = [];
    const [quiz] = guardTeacherRules(
      [
        {
          name: QUIZ_TOOL,
          ref: `openduet/${QUIZ_TOOL}`,
          description: "Makes a quiz.",
          parameters: z.object({ class: z.string() }).passthrough(),
          async execute(args) {
            made.push(args);
            return JSON.stringify({ kind: "quiz", id: "quiz-1" });
          },
        },
      ],
      {
        actorId: "jordan",
        botId: "academic-os",
        initiator: { kind: "person" },
        school: {
          current: async () => ({ snapshot, why: null }),
          stored: async () => snapshot,
        },
        rules,
        now: () => NOW,
      },
    );
    if (!quiz) throw new Error("no make_quiz");
    return { quiz, made };
  }

  /** Whatever `change` threw, or null when it did not. */
  const thrown = (pending: Promise<unknown>) =>
    pending.then(
      () => null,
      (error: unknown) => error,
    );

  const ADMIN_LOOSENED =
    "An admin loosened this rule, so only an admin can change it.";

  test("a student who makes Chemistry No help pauses its quizzes", async () => {
    const store = memoryStore();
    const rules = createRulesService({ store, now: () => NOW });
    await rules.change(
      "jordan",
      { classes: { chem2: "none" } },
      { canLoosen: false, snapshot: SNAPSHOT },
    );
    expect(
      store.records.get(store.keyOf("jordan", "rules", "rules:jordan"))?.data,
    ).toEqual({
      classes: {
        chem2: {
          level: "none",
          setBy: "jordan",
          setAt: "2026-11-04T15:00:00.000Z",
          loosens: false,
        },
      },
      assignments: {},
    });
    // Lab 6's own Hints only is under the class's No help now.
    expect(
      rule(
        await rules.target("jordan", SNAPSHOT, {
          className: "Chemistry",
          assignment: "Lab 6",
        }),
      ),
    ).toEqual({
      classId: "chem2",
      assignmentId: "lab6",
      level: "none",
      source: "override",
      decidedBy: null,
    });
    const { quiz, made } = quizFor(rules, SNAPSHOT);
    const answer = await quiz.execute({ class: "Chemistry", topic: "rates" });
    // Set on the screen, not by Dr. Okoro, so the refusal puts it in no teacher's name.
    expect(readTeacherRuleBlock(answer)).toEqual({
      classId: "chem2",
      className: "Chemistry",
      level: "none",
      source: "override",
    });
    expect(answer).toContain(
      "Chemistry is set to No help on the Teacher rules screen, so nothing was made. Tell the student in one short sentence that it was set there,",
    );
    expect(answer).not.toContain("Dr. Okoro");
    expect(answer).not.toContain("teacher's rule");
    expect(made).toEqual([]);
  });

  test("a student's Hints only gives way to a No help a teacher posts later", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    await rules.change(
      "jordan",
      { classes: { spanish5: "hints" } },
      { canLoosen: false, snapshot: SNAPSHOT },
    );
    const { quiz: before } = quizFor(rules, SNAPSHOT);
    expect(
      readTeacherRuleBlock(await before.execute({ class: "Spanish III" })),
    ).toBeNull();
    const later = withWork(
      work({
        id: "u6",
        classId: "spanish5",
        title: "Unidad 6 test",
        kind: "test",
        due: "2026-11-12T17:00:00.000Z",
        help: "none",
      }),
    );
    const { quiz, made } = quizFor(rules, later);
    expect(
      readTeacherRuleBlock(await quiz.execute({ class: "Spanish III" })),
    ).toEqual({
      classId: "spanish5",
      className: "Spanish III",
      level: "none",
      assignment: "Unidad 6 test",
      teacher: "Sra. Morales",
      source: "notice",
    });
    expect(made).toEqual([]);
    // The screen shows both: what the tools obey, and the setting still kept underneath.
    const view = await rules.view("jordan", later, { canLoosen: false });
    expect(
      view.classes.find((rules) => rules.classId === "spanish5"),
    ).toMatchObject({ level: "none", source: "notice", override: "hints" });
  });

  test("an admin who loosens AP US History while the DBQ is open frees the class, not the DBQ", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    await rules.change(
      "jordan",
      { classes: { apush1: "full" } },
      { canLoosen: true, snapshot: SNAPSHOT },
    );
    expect((await rules.overrides("jordan")).classes.apush1?.loosens).toBe(
      true,
    );
    const { quiz, made } = quizFor(rules, SNAPSHOT);
    expect(
      await quiz.execute({ class: "APUSH", topic: "Reconstruction" }),
    ).toBe(JSON.stringify({ kind: "quiz", id: "quiz-1" }));
    // Naming the DBQ itself still meets its own No help.
    expect(
      readTeacherRuleBlock(
        await quiz.execute({ class: "APUSH", assignment: "DBQ" }),
      ),
    ).toEqual({
      classId: "apush1",
      className: "AP US History",
      level: "none",
      assignment: "DBQ essay",
      teacher: "Mr. Grant",
      source: "notice",
    });
    expect(made).toEqual([{ class: "APUSH", topic: "Reconstruction" }]);
    // A loosening replaces what the notices say, so a later notice for the class doesn't undo it,
    // while one for an assignment still holds when that assignment is named.
    const later = withWork(
      work({
        id: "unit3",
        classId: "apush1",
        title: "Unit 3 test",
        kind: "test",
        due: "2026-11-13T15:00:00.000Z",
        help: "none",
      }),
    );
    expect(
      rule(await rules.target("jordan", later, { className: "APUSH" })),
    ).toMatchObject({ level: "full", source: "override" });
    expect(
      rule(
        await rules.target("jordan", later, {
          className: "APUSH",
          assignment: "Unit 3",
        }),
      ),
    ).toMatchObject({ level: "none", source: "notice" });
    // The DBQ goes only when its own override loosens it too.
    await rules.change(
      "jordan",
      { assignments: { dbq3: "full" } },
      { canLoosen: true, snapshot: SNAPSHOT },
    );
    expect((await rules.overrides("jordan")).assignments.dbq3?.loosens).toBe(
      true,
    );
    expect(
      rule(
        await rules.target("jordan", SNAPSHOT, {
          className: "APUSH",
          assignment: "DBQ",
        }),
      ),
    ).toEqual({
      classId: "apush1",
      assignmentId: "dbq3",
      level: "full",
      source: "override",
      decidedBy: "DBQ essay",
    });
  });

  test("whether an override loosens is judged when it is set, so an admin's tightening still yields to a later No help", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    // The notices give Chemistry Hints only today, so the admin's Hints only loosens nothing.
    await rules.change(
      "jordan",
      { classes: { chem2: "hints" } },
      { canLoosen: true, snapshot: SNAPSHOT },
    );
    expect((await rules.overrides("jordan")).classes.chem2?.loosens).toBe(
      false,
    );
    const later = withWork(
      work({
        id: "safety",
        classId: "chem2",
        title: "Lab safety test",
        due: "2026-11-09T17:00:00.000Z",
        help: "none",
      }),
    );
    expect(
      rule(await rules.target("jordan", later, { className: "Chemistry" })),
    ).toEqual({
      classId: "chem2",
      assignmentId: null,
      level: "none",
      source: "notice",
      decidedBy: "Lab safety test",
    });
  });

  test("a student can't clear or replace an admin's loosening, and can still make that class's work stricter", async () => {
    const rules = createRulesService({ store: memoryStore(), now: () => NOW });
    await rules.change(
      "jordan",
      { classes: { apush1: "full" } },
      { canLoosen: true, snapshot: SNAPSHOT },
    );
    const before = await rules.overrides("jordan");
    for (const change of [
      { classes: { apush1: null } },
      { classes: { apush1: "none" } },
    ] satisfies RulesChange[]) {
      const refused = await thrown(
        rules.change("jordan", change, {
          canLoosen: false,
          snapshot: SNAPSHOT,
        }),
      );
      expect(refused).toBeInstanceOf(StudyForbiddenError);
      expect((refused as Error).message).toBe(ADMIN_LOOSENED);
    }
    expect(await rules.overrides("jordan")).toEqual(before);
    // An assignment of that class is its own rule, and a student may tighten it.
    await rules.change(
      "jordan",
      { assignments: { quiz4: "none" } },
      { canLoosen: false, snapshot: SNAPSHOT },
    );
    expect(
      rule(
        await rules.target("jordan", SNAPSHOT, {
          className: "Precalculus",
          assignment: "Unit 4 quiz",
        }),
      ),
    ).toMatchObject({ level: "none", source: "override" });
    // An admin may still clear it.
    await rules.change(
      "jordan",
      { classes: { apush1: null } },
      { canLoosen: true, snapshot: SNAPSHOT },
    );
    expect((await rules.overrides("jordan")).classes).toEqual({});
  });

  test("an override stored before `loosens` existed is read as it was saved, and adds to the notices", async () => {
    const store = memoryStore();
    const old = {
      classes: {
        apush1: {
          level: "full",
          setBy: "admin-1",
          setAt: "2026-11-01T12:00:00.000Z",
        },
      },
      assignments: {
        gatsby: {
          level: "none",
          setBy: "jordan",
          setAt: "2026-11-01T12:00:00.000Z",
        },
      },
    };
    await store.put("jordan", { id: "rules:jordan", kind: "rules", data: old });
    const rules = createRulesService({ store, now: () => NOW });
    expect(await rules.overrides("jordan")).toEqual(old as RuleOverrides);
    expect(
      rule(await rules.target("jordan", SNAPSHOT, { className: "APUSH" })),
    ).toMatchObject({
      level: "none",
      source: "notice",
      decidedBy: "DBQ essay",
    });
    expect(
      rule(
        await rules.target("jordan", SNAPSHOT, {
          className: "English 11",
          assignment: "Gatsby",
        }),
      ),
    ).toMatchObject({ level: "none", source: "override" });
    // Not an admin's loosening, so a student may clear it: the class is no looser for it.
    await rules.change(
      "jordan",
      { classes: { apush1: null } },
      { canLoosen: false, snapshot: SNAPSHOT },
    );
    expect(Object.keys((await rules.overrides("jordan")).classes)).toEqual([]);
  });

  test("fails closed on a `loosens` it cannot read", async () => {
    const store = memoryStore();
    await store.put("jordan", {
      id: "rules:jordan",
      kind: "rules",
      data: {
        classes: { apush1: { ...override("full"), loosens: "yes" } },
        assignments: {},
      },
    });
    const rules = createRulesService({ store, now: () => NOW });
    await expect(
      rules.target("jordan", SNAPSHOT, { className: "APUSH" }),
    ).rejects.toThrow("The saved teacher rules couldn't be read.");
  });
});
