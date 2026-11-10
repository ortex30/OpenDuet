/**
 * Fill a student's study memory with two weeks of practice, so the Learn tab, /review and
 * /my-mistakes have something to show in a demo. Development only.
 *
 *   bun --env-file=../.env scripts/seed-study-demo.ts [--email you@example.com] [--bot openduet] [--reset]
 *
 * The topics match the demo student inbox (scripts/fake-google/student-mailbox.jsonl): Precalculus
 * trig identities, Chemistry collision theory, Spanish III Unidad 5, The Great Gatsby and APUSH.
 * Each one is replayed through the same store `record_study` writes to, on the days it was
 * practiced, so its Leitner box, mastery and next review are what real practice would have left.
 * With no --email, the only person in the database is used; --reset clears their memory first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { agents, users } from "../src/db/schema/core";
import { openduetPages } from "../src/db/schema/openduet";
import { openduetStudyTopics } from "../src/db/schema/study";
import { createPageStore } from "../src/openduet/pages";
import {
  loadPrivatePack,
  privatePackDir,
  studyGuideFromPack,
  studyTopicsFromPack,
} from "../src/openduet/private-pack";
import { zonedParts } from "../src/openduet/study/time";
import {
  createStudyStore,
  type StudyEntry,
  type StudyResult,
} from "../src/openduet/study-memory";

type Practice = {
  subject: string;
  topic: string;
  /** Days ago, oldest first, and how it went that day. */
  history: [number, StudyResult, string?][];
  fixed?: boolean;
};

export const DEMO_PRACTICE: Practice[] = [
  {
    subject: "Precalculus",
    topic: "Pythagorean identities",
    history: [
      [14, "correct"],
      [12, "correct"],
      [8, "correct"],
    ],
  },
  {
    subject: "Precalculus",
    topic: "Sum and difference formulas",
    history: [
      [6, "partly"],
      [4, "correct"],
    ],
  },
  {
    subject: "Precalculus",
    topic: "Double-angle formulas",
    history: [
      [5, "missed", "Writes sin 2x as 2 sin x"],
      [2, "partly"],
    ],
  },
  {
    subject: "Precalculus",
    topic: "Verifying identities",
    history: [[1, "missed", "Works on both sides at once instead of one side"]],
  },
  {
    subject: "Chemistry",
    topic: "Collision theory",
    history: [
      [
        9,
        "missed",
        "Says the rate goes up without explaining more frequent, harder collisions",
      ],
      [3, "partly"],
    ],
  },
  {
    subject: "Chemistry",
    topic: "Reading rate graphs",
    history: [
      [7, "correct"],
      [5, "correct"],
    ],
  },
  {
    subject: "Spanish III",
    topic: "Food and cooking vocabulary",
    history: [
      [10, "partly"],
      [6, "correct"],
      [2, "correct"],
    ],
  },
  {
    subject: "Spanish III",
    topic: "Mandatos (usted commands)",
    history: [
      [4, "missed", "Uses the indicative instead of the command form"],
      [1, "missed"],
    ],
  },
  {
    subject: "English 11",
    topic: "Gatsby: the green light",
    history: [
      [13, "correct"],
      [11, "correct"],
      [7, "correct"],
    ],
  },
  {
    subject: "English 11",
    topic: "Gatsby: the valley of ashes",
    history: [[3, "partly"]],
  },
  {
    subject: "AP US History",
    topic: "Missouri Compromise",
    history: [
      [
        12,
        "missed",
        "Mixes up the Missouri Compromise and the Compromise of 1850",
      ],
      [9, "correct"],
      [5, "correct"],
    ],
    fixed: true,
  },
];

const DAY = 24 * 60 * 60 * 1000;

/** Replays every practice day, oldest first, through the store `record_study` uses. */
export async function seedStudyDemo(
  database: ReturnType<typeof createDatabase>,
  owner: string,
  botId: string,
  today = new Date(),
) {
  let clock = today;
  const store = createStudyStore(database, { now: () => clock });
  const days = [
    ...new Set(DEMO_PRACTICE.flatMap((p) => p.history.map(([day]) => day))),
  ].sort((a, b) => b - a);
  for (const day of days) {
    clock = new Date(today.getTime() - day * DAY);
    const entries: StudyEntry[] = DEMO_PRACTICE.flatMap((practice) =>
      practice.history
        .filter(([at]) => at === day)
        .map(([, result, misconception]) => ({
          subject: practice.subject,
          topic: practice.topic,
          result,
          activity: "quiz" as const,
          misconception,
          fixed: practice.fixed && result === "correct" ? true : undefined,
        })),
    );
    await store.record(owner, botId, entries);
  }
  clock = today;
  return store.overview(owner, botId);
}

if (import.meta.main) {
  const argument = (name: string) => {
    const at = process.argv.indexOf(name);
    const next = at > -1 ? process.argv[at + 1] : undefined;
    if (!next || next.startsWith("--")) return undefined;
    return next;
  };
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is not set. Run with --env-file=../.env.");
  const database = createDatabase(url, { max: 1 });
  const email = argument("--email");
  const botId = argument("--bot") ?? "openduet";
  const people = await database
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(email ? eq(users.email, email) : undefined);
  if (people.length !== 1) {
    console.error(
      email
        ? `No one signed in as ${email} yet. Open the app once, then run this again.`
        : `Found ${people.length} people. Pass --email to say whose study memory to fill.`,
    );
    process.exit(1);
  }
  const [person] = people;
  if (!person) process.exit(1);
  const [bot] = await database
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, botId));
  if (!bot) {
    console.error(
      `No Bot "${botId}". Start the app once so it loads its Bots, or pass --bot.`,
    );
    process.exit(1);
  }
  if (process.argv.includes("--reset"))
    await database
      .delete(openduetStudyTopics)
      .where(
        and(
          eq(openduetStudyTopics.ownerUserId, person.id),
          eq(openduetStudyTopics.botId, botId),
        ),
      );
  if (process.argv.includes("--pack")) {
    const named = argument("--pack");
    const dir =
      named ??
      privatePackDir({
        ACADEMIC_OS_DATA_DIR: process.env.ACADEMIC_OS_DATA_DIR,
      });
    if (!dir) {
      console.error(
        "No school pack. Unzip it so data/private/classes.json exists, or pass --pack <dir>.",
      );
      process.exit(1);
    }
    const pack = loadPrivatePack(dir);
    if (process.argv.includes("--reset"))
      await database
        .delete(openduetStudyTopics)
        .where(
          and(
            eq(openduetStudyTopics.ownerUserId, person.id),
            eq(openduetStudyTopics.botId, botId),
          ),
        );
    const store = createStudyStore(database);
    const topics = studyTopicsFromPack(pack, (file) =>
      readFileSync(join(dir, file), "utf8"),
    );
    await store.record(
      person.id,
      botId,
      topics.map((topic) => ({
        subject: topic.subject,
        topic: topic.topic,
        result: topic.result,
        activity: "quiz" as const,
        ...(topic.result === "missed"
          ? {
              misconception:
                "Still shaky. Review the notes before the next try.",
            }
          : {}),
      })),
    );
    const today = zonedParts(new Date(), pack.timeZone).date;
    const guide = studyGuideFromPack(
      pack,
      (file) => readFileSync(join(dir, file), "utf8"),
      today,
    );
    if (guide) {
      await database
        .delete(openduetPages)
        .where(
          and(
            eq(openduetPages.ownerUserId, person.id),
            eq(openduetPages.title, guide.title),
          ),
        );
      await createPageStore(database).save(person.id, botId, {
        kind: "doc",
        title: guide.title,
        summary: guide.summary,
        theme: "editorial",
        blocks: guide.blocks,
      });
      console.log(`Study guide: ${guide.title}`);
    }
    const overview = await store.overview(person.id, botId);
    console.log(
      `School pack (${pack.classes.length} current classes, ${pack.assignments.length} deadlines, ${pack.historicalExcluded} spring rows left out). Study memory: ${overview.totals.topics} topics, ${overview.totals.openMistakes} open mistakes.`,
    );
    process.exit(0);
  }
  const overview = await seedStudyDemo(database, person.id, botId);
  console.log(
    `Filled ${person.email}'s study memory: ${overview.totals.topics} topics, ${overview.totals.due} due for review, ${overview.totals.openMistakes} open mistakes. Open the Learn tab.`,
  );
  process.exit(0);
}
