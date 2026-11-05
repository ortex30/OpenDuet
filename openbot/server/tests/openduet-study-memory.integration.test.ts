import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { PERSON_INITIATOR } from "../src/audit";
import type { AuthenticatedActor } from "../src/auth/guards";
import { createDatabase } from "../src/db/client";
import { agents, users } from "../src/db/schema/core";
import { openduetStudyTopics } from "../src/db/schema/study";
import {
  createStudyRoutes,
  createStudyStore,
  RECORD_STUDY_TOOL,
  STUDY_MEMORY_TOOL,
  type StudyOverview,
  studyTools,
} from "../src/openduet/study-memory";
import { createOpenDuetTools } from "../src/openduet/wiring";
import { TEST_POOL, testDatabaseUrl } from "./support/database";

const database = createDatabase(testDatabaseUrl(), TEST_POOL);
const prefix = `study-${randomUUID()}`;
const owner = `${prefix}-owner`;
const other = `${prefix}-other`;
const bot = `${prefix}-bot`;

let clock = new Date("2026-11-05T21:00:00Z");
const days = (count: number) => {
  clock = new Date(clock.getTime() + count * 24 * 60 * 60 * 1000);
};
const store = createStudyStore(database, { now: () => clock });
const initiator = PERSON_INITIATOR;
const tools = studyTools({ actorId: owner, botId: bot, initiator, store });
const tool = (name: string) => {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};
const call = async (name: string, args: unknown) =>
  JSON.parse(String(await tool(name).execute(args as never)));

const routes = createStudyRoutes(store, async (context, next) => {
  context.set("actor", {
    id: context.req.header("x-person") ?? owner,
  } as AuthenticatedActor);
  await next();
});
const as = (person: string, path: string, init: RequestInit = {}) =>
  routes.request(path, {
    ...init,
    headers: { "x-person": person, ...(init.headers ?? {}) },
  });

beforeAll(async () => {
  await database.insert(users).values([
    { id: owner, email: `${owner}@example.test` },
    { id: other, email: `${other}@example.test` },
  ]);
  await database.insert(agents).values({
    id: bot,
    name: "Academic OS",
    type: "built_in",
    configuration: {},
  });
});
afterAll(async () => {
  await database
    .delete(openduetStudyTopics)
    .where(inArray(openduetStudyTopics.ownerUserId, [owner, other]));
  await database.delete(agents).where(eq(agents.id, bot));
  await database.delete(users).where(inArray(users.id, [owner, other]));
});

test("every Bot holds record_study and study_memory", () => {
  const all = createOpenDuetTools({
    database,
    callTool: async () => {
      throw new Error("unused");
    },
    complete: async () => {
      throw new Error("unused");
    },
    model: "test",
    directChannel: async () => ({ id: "c", threadId: "t" }),
  })(owner, bot, initiator);
  const names = all.map((candidate) => candidate.name);
  expect(names).toContain(RECORD_STUDY_TOOL);
  expect(names).toContain(STUDY_MEMORY_TOOL);
});

test("an empty memory says so and offers a quiz", async () => {
  const empty = await call(STUDY_MEMORY_TOOL, { view: "due" });
  expect(empty.topics).toEqual([]);
  expect(empty.note).toContain("empty");
});

test("record_study refuses bad input without saving", async () => {
  const refusal = String(
    await tool(RECORD_STUDY_TOOL).execute({
      entries: [{ subject: "Physics", topic: "Forces", result: "great" }],
    } as never),
  );
  expect(refusal.startsWith("Refused.")).toBe(true);
  expect(await store.list(owner)).toEqual([]);
});

test("a quiz's results land in study memory with a Leitner schedule", async () => {
  const saved = await call(RECORD_STUDY_TOOL, {
    entries: [
      {
        subject: "Physics",
        topic: "Newton's second law",
        result: "correct",
        activity: "quiz",
      },
      {
        subject: "Physics",
        topic: "Free fall",
        result: "missed",
        activity: "quiz",
        misconception: "Thinks heavier objects fall faster",
      },
      { subject: "Latin", topic: "Ablative case", result: "partly" },
    ],
  });
  expect(
    saved.recorded.map(
      (t: {
        topic: string;
        box: number;
        change: string;
        nextReview: string;
      }) => [t.topic, t.box, t.change, t.nextReview],
    ),
  ).toEqual([
    ["Newton's second law", 2, "new", "2026-11-07"],
    ["Free fall", 1, "new", "2026-11-06"],
    ["Ablative case", 1, "new", "2026-11-06"],
  ]);
  expect(saved.note).toContain("Don't list");
});

test("the same topic with other spacing and case is one topic, and moves up and down", async () => {
  days(2);
  const up = await call(RECORD_STUDY_TOOL, {
    entries: [
      { subject: "physics", topic: "newton's  second law", result: "correct" },
    ],
  });
  expect(up.recorded[0]).toMatchObject({
    topic: "Newton's second law",
    subject: "Physics",
    box: 3,
    change: "up",
  });
  const down = await call(RECORD_STUDY_TOOL, {
    entries: [
      { subject: "Physics", topic: "Newton's second law", result: "missed" },
    ],
  });
  expect(down.recorded[0]).toMatchObject({ box: 1, change: "down" });
  const rows = await store.list(owner);
  expect(
    rows.filter((row) => row.topic === "Newton's second law"),
  ).toHaveLength(1);
  expect(rows.find((row) => row.topic === "Newton's second law")).toMatchObject(
    {
      correctCount: 2,
      missedCount: 1,
    },
  );
});

test("study_memory reads what is due, the weakest and open mistakes", async () => {
  days(1);
  const due = await call(STUDY_MEMORY_TOOL, { view: "due" });
  expect(due.dueCount).toBe(3);
  expect(due.due.map((t: { topic: string }) => t.topic).sort()).toEqual([
    "Ablative case",
    "Free fall",
    "Newton's second law",
  ]);
  const mistakes = await call(STUDY_MEMORY_TOOL, { view: "mistakes" });
  expect(mistakes.mistakes).toMatchObject([
    {
      subject: "Physics",
      topic: "Free fall",
      note: "Thinks heavier objects fall faster",
    },
  ]);
  // Physics (13) is weaker than Latin (20), so it comes first.
  const overview = await call(STUDY_MEMORY_TOOL, { view: "overview" });
  expect(overview.subjects.map((s: { subject: string }) => s.subject)).toEqual([
    "Physics",
    "Latin",
  ]);
  const latin = await call(STUDY_MEMORY_TOOL, {
    view: "subject",
    subject: "latin",
  });
  expect(latin.topics.map((t: { topic: string }) => t.topic)).toEqual([
    "Ablative case",
  ]);
  const needsSubject = String(
    await tool(STUDY_MEMORY_TOOL).execute({ view: "subject" } as never),
  );
  expect(needsSubject.startsWith("Refused.")).toBe(true);
});

test("getting it right with fixed: true closes the mistake", async () => {
  await call(RECORD_STUDY_TOOL, {
    entries: [
      {
        subject: "Physics",
        topic: "Free fall",
        result: "correct",
        fixed: true,
      },
    ],
  });
  const mistakes = await call(STUDY_MEMORY_TOOL, { view: "mistakes" });
  expect(mistakes.mistakes).toEqual([]);
  const freeFall = (await store.list(owner)).find(
    (t) => t.topic === "Free fall",
  );
  expect(freeFall?.fixedMistakes).toBe(1);
});

test("the Learn tab's route returns only the person's own overview", async () => {
  const mine = (await (await as(owner, "/")).json()) as {
    overview: StudyOverview;
  };
  expect(mine.overview.totals.topics).toBe(3);
  const theirs = (await (await as(other, "/")).json()) as {
    overview: StudyOverview;
  };
  expect(theirs.overview.totals.topics).toBe(0);
});

test("the Learn tab can mark mistakes fixed and forget a topic, only its owner's", async () => {
  await call(RECORD_STUDY_TOOL, {
    entries: [
      {
        subject: "Latin",
        topic: "Ablative case",
        result: "missed",
        misconception: "Uses ablative for the indirect object",
      },
    ],
  });
  const latin = (await store.list(owner)).find(
    (t) => t.topic === "Ablative case",
  );
  if (!latin) throw new Error("missing");
  expect(latin.openMistakes).toHaveLength(1);

  expect(
    (await as(other, `/topics/${latin.id}/fixed`, { method: "POST" })).status,
  ).toBe(404);
  const fixed = await as(owner, `/topics/${latin.id}/fixed`, {
    method: "POST",
  });
  expect(fixed.status).toBe(200);
  expect(
    ((await fixed.json()) as { topic: { openMistakes: string[] } }).topic
      .openMistakes,
  ).toEqual([]);

  expect(
    (await as(other, `/topics/${latin.id}`, { method: "DELETE" })).status,
  ).toBe(404);
  expect(
    (await as(owner, `/topics/${latin.id}`, { method: "DELETE" })).status,
  ).toBe(204);
  expect((await store.list(owner)).map((t) => t.topic)).not.toContain(
    "Ablative case",
  );
});

test("the demo seed replays two weeks of practice into a believable memory", async () => {
  const { seedStudyDemo } = await import("../scripts/seed-study-demo");
  const overview = await seedStudyDemo(
    database,
    other,
    bot,
    new Date("2026-11-05T13:00:00Z"),
  );
  expect(overview.totals.topics).toBe(11);
  expect(overview.subjects.map((subject) => subject.subject).sort()).toEqual([
    "AP US History",
    "Chemistry",
    "English 11",
    "Precalculus",
    "Spanish III",
  ]);
  // Some topics are strong, some due today, and the open mistakes are the unfixed ones.
  expect(overview.totals.strong).toBeGreaterThan(0);
  expect(overview.totals.due).toBeGreaterThan(0);
  expect(overview.mistakes.map((mistake) => mistake.topic).sort()).toEqual([
    "Collision theory",
    "Double-angle formulas",
    "Mandatos (usted commands)",
    "Verifying identities",
  ]);
  const compromise = overview.topics.find(
    (topic) => topic.topic === "Missouri Compromise",
  );
  expect(compromise?.fixedMistakes).toBe(1);
  expect(compromise?.level).toBe("getting-there");
  const identities = overview.topics.find(
    (topic) => topic.topic === "Pythagorean identities",
  );
  // Box 4 after three right answers, and practiced 8 days ago, so it is back for review today.
  expect(identities).toMatchObject({ box: 4, level: "strong", due: true });
});
