import { describe, expect, test } from "bun:test";
import type {
  ClassRules,
  RulesView,
  SchoolAssignment,
  SchoolSnapshot,
} from "@openbot/shared/study";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppVariables } from "../src/auth/guards";
import type {
  SchoolRead,
  SchoolService,
  StudyContext,
  StudyRouteDeps,
} from "../src/openduet/study/contracts";
import { createMemoryStudyStore } from "../src/openduet/study/memory-store";
import { mountStudyRoutes } from "../src/openduet/study/routes";
import { createRulesService } from "../src/openduet/study/rules";
import { rulesRoutes } from "../src/openduet/study/rules-routes";

/**
 * The Teacher rules screen's routes over the demo student's classes: the screen as a student and as
 * an admin sees it, a change that tightens or loosens a rule, a body that can't be a change, and a
 * read of Classroom on demand. The real rules service and the in-memory study store stand behind
 * them; only the Classroom reader is a fake, so no Gmail is read.
 */

const PATH = "/api/openduet/study";

/** Wednesday, November 4, 2026, 3:10 PM in Chicago. */
const NOW = new Date("2026-11-04T21:10:00.000Z");

const LOOSENING =
  "Only a teacher or an admin can loosen a teacher's rule. You can make it stricter.";

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

/** Jordan's classes and work, as scripts/fake-google's Classroom notices give them. */
const SNAPSHOT: SchoolSnapshot = {
  syncedAt: "2026-11-04T21:05:00.000Z",
  timeZone: "America/Chicago",
  classes: [
    {
      id: "apush1",
      name: "AP US History",
      teacher: "Mr. Grant",
      period: "1",
      color: "rose",
    },
    {
      id: "chem2",
      name: "Chemistry",
      teacher: "Dr. Okoro",
      period: "2",
      color: "teal",
    },
    {
      id: "eng11",
      name: "English 11",
      teacher: "Ms. Alvarez",
      period: "3",
      color: "violet",
    },
    {
      id: "precalc4",
      name: "Precalculus",
      teacher: "Mr. Chen",
      period: "4",
      color: "sky",
    },
    {
      id: "spanish5",
      name: "Spanish III",
      teacher: "Sra. Morales",
      period: "5",
      color: "amber",
    },
  ],
  assignments: [
    work({
      id: "precalc4-hw43",
      classId: "precalc4",
      title: "Section 4.3 homework",
      status: "missing",
      due: "2026-11-04T05:59:00.000Z",
      help: "full",
      minutes: 45,
    }),
    work({
      id: "precalc4-quiz4",
      classId: "precalc4",
      title: "Unit 4 quiz",
      kind: "quiz",
      due: "2026-11-05T16:45:00.000Z",
      help: "full",
      minutes: 60,
    }),
    work({
      id: "chem2-lab6",
      classId: "chem2",
      title: "Lab 6 report",
      due: "2026-11-06T05:59:00.000Z",
      help: "hints",
      minutes: 90,
    }),
    work({
      id: "apush1-dbq3",
      classId: "apush1",
      title: "DBQ essay",
      due: "2026-11-06T14:00:00.000Z",
      help: "none",
      minutes: 120,
    }),
    work({
      id: "spanish5-u5test",
      classId: "spanish5",
      title: "Unidad 5 test",
      kind: "test",
      due: "2026-11-07T18:20:00.000Z",
      help: "full",
    }),
    work({
      id: "eng11-gatsby",
      classId: "eng11",
      title: "Great Gatsby essay",
      due: "2026-11-11T05:59:00.000Z",
      help: "hints",
      minutes: 150,
    }),
    work({
      id: "apush1-dbqdocs",
      classId: "apush1",
      title: "DBQ documents",
      kind: "material",
      help: "none",
    }),
    work({
      id: "chem2-lab5",
      classId: "chem2",
      title: "Lab 5 report",
      status: "returned",
      due: "2026-10-29T04:59:00.000Z",
      grade: "34/40",
    }),
  ],
  couldNotRead: [],
};

/** Signs in as the given person, the way the app's guard sets the actor. */
function signedIn(
  userId: string,
  role: "user" | "admin",
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    context.set("actor", { id: userId, email: `${userId}@example.com`, role });
    await next();
  };
}

/** The Classroom reader as the routes call it, with every read it was asked for. */
function classroom(read: SchoolRead) {
  const asked: { context: StudyContext; force: boolean }[] = [];
  let answer = read;
  const service: SchoolService = {
    async current(context, options) {
      asked.push({ context, force: options?.force === true });
      return answer;
    },
    stored: async () => answer.snapshot,
  };
  return {
    service,
    asked,
    answers(next: SchoolRead) {
      answer = next;
    },
  };
}

function setup(read: SchoolRead = { snapshot: SNAPSHOT, why: null }) {
  const store = createMemoryStudyStore({ now: () => NOW });
  const rules = createRulesService({ store, now: () => NOW });
  const reader = classroom(read);
  const deps: StudyRouteDeps = {
    store,
    school: reader.service,
    rules,
    callTool: async () => {
      throw new Error("The rules routes call no tools.");
    },
    upNext: async () => [],
    primaryBot: "academic-os",
    now: () => NOW,
  };
  /** Mounted the way app.ts mounts it: under a parent app that has an error handler of its own. */
  const as = (userId: string, role: "user" | "admin" = "user") => {
    const app = new Hono();
    app.onError((_error, context) => context.json({ error: "parent" }, 500));
    app.route(
      PATH,
      mountStudyRoutes([rulesRoutes(deps)], signedIn(userId, role)),
    );
    return async (
      method: "GET" | "PUT" | "POST",
      path: string,
      body?: unknown,
    ) => {
      const response = await app.request(`${PATH}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: typeof body === "string" ? body : JSON.stringify(body),
            }),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    };
  };
  return { rules, reader, as };
}

const viewOf = (body: Record<string, unknown>) => body.rules as RulesView;

function classOf(view: RulesView, classId: string): ClassRules {
  const found = view.classes.find((rules) => rules.classId === classId);
  if (!found) throw new Error(`no ${classId}`);
  return found;
}

const JORDAN: StudyContext = {
  actorId: "jordan",
  botId: "academic-os",
  initiator: { kind: "person" },
};

describe("GET /rules", () => {
  test("shows a student the screen, read as them through the primary Bot", async () => {
    const { as, reader } = setup();
    const { status, body } = await as("jordan")("GET", "/rules");
    expect(status).toBe(200);
    const view = viewOf(body);
    expect(view.canLoosen).toBe(false);
    expect(view.syncedAt).toBe("2026-11-04T21:05:00.000Z");
    expect(view.timeZone).toBe("America/Chicago");
    expect(view.couldNotRead).toEqual([]);
    expect(view.classes.map((rules) => rules.className)).toEqual([
      "AP US History",
      "Chemistry",
      "English 11",
      "Precalculus",
      "Spanish III",
    ]);
    expect(classOf(view, "apush1")).toEqual({
      classId: "apush1",
      className: "AP US History",
      teacher: "Mr. Grant",
      level: "none",
      source: "notice",
      override: null,
      assignments: [
        {
          assignmentId: "apush1-dbq3",
          title: "DBQ essay",
          kind: "assignment",
          due: "2026-11-06T14:00:00.000Z",
          status: "open",
          notice: "none",
          override: null,
          level: "none",
          source: "notice",
        },
        {
          assignmentId: "apush1-dbqdocs",
          title: "DBQ documents",
          kind: "material",
          due: null,
          status: "open",
          notice: "none",
          override: null,
          level: "none",
          source: "notice",
        },
      ],
    });
    expect(reader.asked).toEqual([{ context: JORDAN, force: false }]);
  });

  test("tells an admin they can loosen a rule", async () => {
    const { as } = setup();
    const { status, body } = await as("ms-park", "admin")("GET", "/rules");
    expect(status).toBe(200);
    expect(viewOf(body).canLoosen).toBe(true);
  });

  test("says why Classroom couldn't be read, beside the classes it still has", async () => {
    const why =
      "Gmail needs reconnecting, so your classes couldn't be read. Reconnect Google on the Connections page.";
    const { as } = setup({ snapshot: SNAPSHOT, why });
    const view = viewOf((await as("jordan")("GET", "/rules")).body);
    expect(view.couldNotRead).toEqual([why]);
    expect(view.classes).toHaveLength(5);
  });

  test("before Classroom was ever read, shows no classes and why, and refuses a change", async () => {
    const why =
      "Gmail isn't connected, so your classes couldn't be read. Connect Google on the Connections page.";
    const { as } = setup({ snapshot: null, why });
    const jordan = as("jordan");
    expect(await jordan("GET", "/rules")).toEqual({
      status: 200,
      body: {
        rules: {
          timeZone: "UTC",
          classes: [],
          canLoosen: false,
          syncedAt: null,
          couldNotRead: [why],
        },
      },
    });
    expect(
      await jordan("PUT", "/rules", { classes: { chem2: "none" } }),
    ).toEqual({
      status: 400,
      body: { error: "Refresh your classes first, then change a rule." },
    });
  });
});

describe("PUT /rules", () => {
  test("lets a student make a class stricter, and answers the screen with it", async () => {
    const { as, rules } = setup();
    const { status, body } = await as("jordan")("PUT", "/rules", {
      classes: { chem2: "none" },
    });
    expect(status).toBe(200);
    const chemistry = classOf(viewOf(body), "chem2");
    expect(chemistry).toMatchObject({
      level: "none",
      source: "override",
      override: "none",
    });
    // Lab 6's own Hints only is under the class's No help now.
    expect(
      chemistry.assignments.map((row) => [row.assignmentId, row.level]),
    ).toEqual([
      ["chem2-lab5", "none"],
      ["chem2-lab6", "none"],
    ]);
    expect((await rules.overrides("jordan")).classes.chem2).toEqual({
      level: "none",
      setBy: "jordan",
      setAt: NOW.toISOString(),
      loosens: false,
    });
  });

  test("lets a student make an assignment stricter", async () => {
    const { as } = setup();
    const { status, body } = await as("jordan")("PUT", "/rules", {
      assignments: { "eng11-gatsby": "none" },
    });
    expect(status).toBe(200);
    const english = classOf(viewOf(body), "eng11");
    expect(english.level).toBe("hints");
    expect(english.assignments).toEqual([
      expect.objectContaining({
        assignmentId: "eng11-gatsby",
        notice: "hints",
        override: "none",
        level: "none",
        source: "override",
      }),
    ]);
  });

  test("refuses a student who loosens a rule, in a sentence, and changes nothing", async () => {
    const { as, rules } = setup();
    const jordan = as("jordan");
    for (const change of [
      { classes: { chem2: "full" } },
      { classes: { apush1: "hints" } },
      { assignments: { "eng11-gatsby": "full" } },
      { assignments: { "apush1-dbq3": "hints" } },
    ])
      expect(await jordan("PUT", "/rules", change)).toEqual({
        status: 403,
        body: { error: LOOSENING },
      });
    expect(await rules.overrides("jordan")).toEqual({
      classes: {},
      assignments: {},
    });
  });

  test("lets an admin loosen a class, which frees the class and not the DBQ", async () => {
    const { as, rules } = setup();
    const { status, body } = await as("jordan", "admin")("PUT", "/rules", {
      classes: { apush1: "full" },
    });
    expect(status).toBe(200);
    const history = classOf(viewOf(body), "apush1");
    expect(history).toMatchObject({
      level: "full",
      source: "override",
      override: "full",
    });
    expect(
      history.assignments.map((row) => [row.assignmentId, row.level]),
    ).toEqual([
      ["apush1-dbq3", "none"],
      ["apush1-dbqdocs", "none"],
    ]);
    expect((await rules.overrides("jordan")).classes.apush1?.loosens).toBe(
      true,
    );
  });

  test("refuses a student who clears an admin's loosening, with its own sentence", async () => {
    const { as } = setup();
    await as("jordan", "admin")("PUT", "/rules", {
      classes: { apush1: "full" },
    });
    expect(
      await as("jordan")("PUT", "/rules", { classes: { apush1: null } }),
    ).toEqual({
      status: 403,
      body: {
        error: "An admin loosened this rule, so only an admin can change it.",
      },
    });
  });

  test("clears an override when that loosens nothing, and refuses a student when it would", async () => {
    const { as } = setup();
    const jordan = as("jordan");
    // Hints only is what Chemistry's notices say already, so clearing it changes nothing.
    await jordan("PUT", "/rules", { classes: { chem2: "hints" } });
    const cleared = await jordan("PUT", "/rules", { classes: { chem2: null } });
    expect(cleared.status).toBe(200);
    expect(classOf(viewOf(cleared.body), "chem2")).toMatchObject({
      level: "hints",
      source: "notice",
      override: null,
    });
    // No help is stricter than the notices, so clearing it would loosen the class.
    await jordan("PUT", "/rules", { classes: { spanish5: "none" } });
    expect(
      await jordan("PUT", "/rules", { classes: { spanish5: null } }),
    ).toEqual({ status: 403, body: { error: LOOSENING } });
    const admin = await as("jordan", "admin")("PUT", "/rules", {
      classes: { spanish5: null },
    });
    expect(classOf(viewOf(admin.body), "spanish5")).toMatchObject({
      level: "full",
      source: "notice",
      override: null,
    });
  });

  test("answers a body that can't be a change with a 400 and a sentence, before reading Gmail", async () => {
    const { as, reader } = setup();
    const jordan = as("jordan");
    const CANT_READ =
      "Choose Full help, Hints only or No help for each class or assignment you change.";
    for (const body of [
      "not json",
      "null",
      [],
      { classes: "none" },
      { classes: { chem2: "lots" } },
      { classes: { chem2: 2 } },
      { classes: [] },
      { levels: { chem2: "none" } },
      { classes: { "": "none" } },
      { classes: { [`a${"b".repeat(128)}`]: "none" } },
    ])
      expect({ body, answer: await jordan("PUT", "/rules", body) }).toEqual({
        body,
        answer: { status: 400, body: { error: CANT_READ } },
      });
    const many = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`class-${index}`, "none"]),
    );
    expect(await jordan("PUT", "/rules", { assignments: many })).toEqual({
      status: 400,
      body: {
        error: "Change at most 50 classes and 50 assignments at a time.",
      },
    });
    expect(reader.asked).toEqual([]);
  });

  test("refuses an id that isn't one of the person's, \"__proto__\" included", async () => {
    const { as, rules } = setup();
    const jordan = as("jordan");
    const classes =
      "One of those classes isn't in your list anymore. Refresh your classes and try again.";
    const assignments =
      "One of those assignments isn't in your list anymore. Refresh your classes and try again.";
    expect(
      await jordan("PUT", "/rules", { classes: { biology: "none" } }),
    ).toEqual({ status: 400, body: { error: classes } });
    expect(
      await jordan("PUT", "/rules", { assignments: { "chem2-lab9": "none" } }),
    ).toEqual({ status: 400, body: { error: assignments } });
    // Sent as text, since an object literal's __proto__ sets its prototype instead of a key.
    expect(
      await jordan("PUT", "/rules", '{"classes":{"__proto__":"none"}}'),
    ).toEqual({ status: 400, body: { error: classes } });
    expect(
      await jordan("PUT", "/rules", '{"assignments":{"__proto__":null}}'),
    ).toEqual({ status: 400, body: { error: assignments } });
    expect(await rules.overrides("jordan")).toEqual({
      classes: {},
      assignments: {},
    });
  });

  test("keeps each person's rules their own", async () => {
    const { as } = setup();
    await as("alice")("PUT", "/rules", { classes: { precalc4: "none" } });
    const bob = viewOf((await as("bob")("GET", "/rules")).body);
    expect(classOf(bob, "precalc4")).toMatchObject({
      level: "full",
      override: null,
    });
  });
});

describe("the Classroom read", () => {
  test("GET /school answers the stored or fresh read, and why a fresh one failed", async () => {
    const { as, reader } = setup();
    const jordan = as("jordan");
    expect(await jordan("GET", "/school")).toEqual({
      status: 200,
      body: { school: SNAPSHOT, why: null },
    });
    const why =
      "Gmail needs reconnecting, so your classes couldn't be read. Reconnect Google on the Connections page.";
    reader.answers({ snapshot: null, why });
    expect(await jordan("GET", "/school")).toEqual({
      status: 200,
      body: { school: null, why },
    });
    expect(reader.asked).toEqual([
      { context: JORDAN, force: false },
      { context: JORDAN, force: false },
    ]);
  });

  test("POST /school/sync reads Classroom again now, and answers the screen with it", async () => {
    const { as, reader } = setup();
    const fresh: SchoolSnapshot = {
      ...SNAPSHOT,
      syncedAt: NOW.toISOString(),
      assignments: [
        ...SNAPSHOT.assignments,
        work({
          id: "spanish5-u6test",
          classId: "spanish5",
          title: "Unidad 6 test",
          kind: "test",
          due: "2026-11-13T18:20:00.000Z",
          help: "none",
        }),
      ],
      couldNotRead: [
        "1 Classroom email couldn't be read, so some assignments may be missing. It'll be read again next time.",
      ],
    };
    reader.answers({ snapshot: fresh, why: null });
    const { status, body } = await as("jordan")("POST", "/school/sync");
    expect(status).toBe(200);
    expect(body.school).toEqual(fresh);
    expect(body.why).toBeNull();
    const view = viewOf(body);
    expect(view.syncedAt).toBe(NOW.toISOString());
    expect(view.couldNotRead).toEqual(fresh.couldNotRead);
    expect(classOf(view, "spanish5")).toMatchObject({
      level: "none",
      source: "notice",
    });
    expect(reader.asked).toEqual([{ context: JORDAN, force: true }]);
  });

  test("a sync that fell back to the stored copy says why with the screen", async () => {
    const why =
      "Gmail answered in a way that couldn't be read, so your classes weren't updated. Try again in a minute.";
    const { as } = setup({ snapshot: SNAPSHOT, why });
    const { status, body } = await as("jordan")("POST", "/school/sync");
    expect(status).toBe(200);
    expect(body).toMatchObject({ school: SNAPSHOT, why });
    expect(viewOf(body).couldNotRead).toEqual([why]);
  });
});
