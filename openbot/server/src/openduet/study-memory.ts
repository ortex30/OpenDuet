import { randomUUID } from "node:crypto";
import type { GrantedTool } from "@openbot/toolkit/granted-tool";
import { and, asc, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AuditInitiator } from "../audit";
import type { AppVariables } from "../auth/guards";
import type { Database } from "../db/client";
import {
  openduetStudyTopics,
  type StudyMisconception,
} from "../db/schema/study";

/*
 * Study memory: what the student has practiced, how it went, and when each topic should come back.
 *
 * Academic OS's learning loop is know the work, practice it, learn from the results and adjust. The
 * skills already quiz, tutor and explain, but every conversation forgot how it went. This keeps one
 * row per class and topic, moved through five Leitner boxes: a right answer sends the topic up a box
 * and further out, a partly right one keeps it where it is, and a miss puts it back in box 1 for
 * tomorrow. Mistakes are kept with the topic as a short note until a later practice shows them fixed.
 *
 * Two tools, held by every Bot like the brief and pages (openduet/wiring.ts): `record_study` after
 * any practice, and `study_memory` to read it back for the review and mistakes skills. The Learn tab
 * reads the same store through `/api/openduet/study`. Nothing leaves the deployment and the student
 * owns every row, so neither tool meets the approval gate. A background research run is not offered
 * them, because `restrictToolsForRun` keeps that run to the catalogue's reads.
 */

export const RECORD_STUDY_TOOL = "record_study";
export const STUDY_MEMORY_TOOL = "study_memory";

export const STUDY_RESULTS = ["correct", "partly", "missed"] as const;
export type StudyResult = (typeof STUDY_RESULTS)[number];

export const STUDY_ACTIVITIES = [
  "quiz",
  "flashcards",
  "tutor",
  "teach-back",
  "check-work",
  "review",
  "reading",
  "writing",
  "other",
] as const;

export const MIN_BOX = 1;
export const MAX_BOX = 5;
/** Days until a topic in each box comes back: box 1 tomorrow, box 5 in about two weeks. */
export const BOX_INTERVAL_DAYS: Record<number, number> = {
  1: 1,
  2: 2,
  3: 4,
  4: 8,
  5: 16,
};
/**
 * Taken off every interval, so a topic practiced at 9 PM is due the next morning rather than at 9 PM
 * the next day. The server does not know the student's time zone; half a day covers it.
 */
const DUE_SLACK_HOURS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Open mistakes kept per topic; past this the oldest goes, since the newest says the most. */
export const MAX_OPEN_MISCONCEPTIONS = 5;
export const MAX_ENTRIES_PER_CALL = 20;

/** Where a result moves a topic: up a box when right, the same when partly, back to box 1 when missed. */
export function nextBox(box: number, result: StudyResult): number {
  const current = Math.min(MAX_BOX, Math.max(MIN_BOX, Math.round(box)));
  if (result === "correct") return Math.min(MAX_BOX, current + 1);
  if (result === "missed") return MIN_BOX;
  return current;
}

/** When a topic in `box` comes back, counted from `now`. */
export function dueAfter(now: Date, box: number): Date {
  const days = BOX_INTERVAL_DAYS[box] ?? 1;
  return new Date(
    now.getTime() + days * DAY_MS - DUE_SLACK_HOURS * 60 * 60 * 1000,
  );
}

/**
 * How well a topic is known, 0 to 100: mostly how far up the boxes it has climbed, which takes
 * repeated right answers spread over days, and partly its overall accuracy.
 */
export function masteryOf(input: {
  box: number;
  correctCount: number;
  partlyCount: number;
  missedCount: number;
}): number {
  const total = input.correctCount + input.partlyCount + input.missedCount;
  if (total === 0) return 0;
  const climb = (Math.min(MAX_BOX, Math.max(MIN_BOX, input.box)) - 1) / 4;
  const accuracy = (input.correctCount + 0.5 * input.partlyCount) / total;
  return Math.round(100 * (0.6 * climb + 0.4 * accuracy));
}

export type MasteryLevel = "new" | "shaky" | "getting-there" | "strong";
export function levelOf(mastery: number, attempts: number): MasteryLevel {
  if (attempts === 0) return "new";
  if (mastery < 40) return "shaky";
  if (mastery < 75) return "getting-there";
  return "strong";
}

/** "Physics " and "physics" are one class. */
export const keyOf = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

export type StudyTopic = {
  id: string;
  subject: string;
  topic: string;
  box: number;
  mastery: number;
  level: MasteryLevel;
  correctCount: number;
  partlyCount: number;
  missedCount: number;
  lastResult: StudyResult;
  lastActivity: string | null;
  openMistakes: string[];
  fixedMistakes: number;
  due: boolean;
  dueAt: string;
  lastPracticedAt: string;
};

export type StudySubject = {
  subject: string;
  mastery: number;
  topics: number;
  due: number;
  openMistakes: number;
};

export type StudyOverview = {
  totals: {
    topics: number;
    due: number;
    strong: number;
    openMistakes: number;
    practicedThisWeek: number;
  };
  subjects: StudySubject[];
  due: StudyTopic[];
  weakest: StudyTopic[];
  mistakes: { topicId: string; subject: string; topic: string; note: string }[];
  topics: StudyTopic[];
};

export type StudyEntry = {
  subject: string;
  topic: string;
  result: StudyResult;
  activity?: (typeof STUDY_ACTIVITIES)[number] | undefined;
  misconception?: string | undefined;
  fixed?: boolean | undefined;
};

export type RecordedTopic = {
  subject: string;
  topic: string;
  result: StudyResult;
  box: number;
  mastery: number;
  change: "up" | "same" | "down" | "new";
  nextReview: string;
};

export class StudyTopicNotFoundError extends Error {
  constructor() {
    super("That topic isn't in your study memory.");
    this.name = "StudyTopicNotFoundError";
  }
}

type Row = typeof openduetStudyTopics.$inferSelect;

function topicOf(row: Row, now: Date): StudyTopic {
  const items = row.misconceptions?.items ?? [];
  const attempts = row.correctCount + row.partlyCount + row.missedCount;
  const mastery = masteryOf(row);
  return {
    id: row.id,
    subject: row.subject,
    topic: row.topic,
    box: row.box,
    mastery,
    level: levelOf(mastery, attempts),
    correctCount: row.correctCount,
    partlyCount: row.partlyCount,
    missedCount: row.missedCount,
    lastResult: row.lastResult as StudyResult,
    lastActivity: row.lastActivity,
    openMistakes: items
      .filter((item) => !item.fixedAt)
      .map((item) => item.note),
    fixedMistakes: items.filter((item) => item.fixedAt).length,
    due: row.dueAt.getTime() <= now.getTime(),
    dueAt: row.dueAt.toISOString(),
    lastPracticedAt: row.lastPracticedAt.toISOString(),
  };
}

/** Most overdue first, then the least known. */
function byDue(a: StudyTopic, b: StudyTopic) {
  return a.dueAt.localeCompare(b.dueAt) || a.mastery - b.mastery;
}

/** The student's own topics, grouped and ranked the way the Learn tab and the skills read them. */
export function overviewOf(topics: StudyTopic[], now: Date): StudyOverview {
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const bySubject = new Map<string, StudyTopic[]>();
  for (const topic of topics) {
    const key = keyOf(topic.subject);
    bySubject.set(key, [...(bySubject.get(key) ?? []), topic]);
  }
  const subjects: StudySubject[] = [...bySubject.values()]
    .map((group) => ({
      subject: group[0]?.subject ?? "",
      mastery: Math.round(
        group.reduce((sum, topic) => sum + topic.mastery, 0) / group.length,
      ),
      topics: group.length,
      due: group.filter((topic) => topic.due).length,
      openMistakes: group.reduce(
        (sum, topic) => sum + topic.openMistakes.length,
        0,
      ),
    }))
    .sort(
      (a, b) => a.mastery - b.mastery || a.subject.localeCompare(b.subject),
    );
  const due = topics.filter((topic) => topic.due).sort(byDue);
  const weakest = [...topics]
    .sort((a, b) => a.mastery - b.mastery || byDue(a, b))
    .slice(0, 5);
  const mistakes = topics
    .flatMap((topic) =>
      topic.openMistakes.map((note) => ({
        topicId: topic.id,
        subject: topic.subject,
        topic: topic.topic,
        note,
      })),
    )
    .slice(0, 20);
  return {
    totals: {
      topics: topics.length,
      due: due.length,
      strong: topics.filter((topic) => topic.level === "strong").length,
      openMistakes: topics.reduce(
        (sum, topic) => sum + topic.openMistakes.length,
        0,
      ),
      practicedThisWeek: topics.filter(
        (topic) => new Date(topic.lastPracticedAt).getTime() >= weekAgo,
      ).length,
    },
    subjects,
    due,
    weakest,
    mistakes,
    topics: [...topics].sort(
      (a, b) =>
        a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic),
    ),
  };
}

/** What one practice result does to a topic's mistakes: add the new note, close the old ones. */
export function nextMisconceptions(
  items: StudyMisconception[],
  entry: Pick<StudyEntry, "misconception" | "fixed" | "result">,
  now: Date,
): StudyMisconception[] {
  const at = now.toISOString();
  let next = items.map((item) =>
    entry.fixed && !item.fixedAt ? { ...item, fixedAt: at } : item,
  );
  const note = entry.misconception?.trim();
  if (
    note &&
    !next.some((item) => !item.fixedAt && keyOf(item.note) === keyOf(note))
  )
    next = [...next, { note, at }];
  const open = next.filter((item) => !item.fixedAt);
  if (open.length > MAX_OPEN_MISCONCEPTIONS) {
    const drop = new Set(open.slice(0, open.length - MAX_OPEN_MISCONCEPTIONS));
    next = next.filter((item) => !drop.has(item));
  }
  // Fixed ones are kept only as a count's worth of history.
  const fixed = next.filter((item) => item.fixedAt).slice(-10);
  return [...fixed, ...next.filter((item) => !item.fixedAt)];
}

export type StudyStore = ReturnType<typeof createStudyStore>;

/** Every read and write is the owner's: another student's topic is the same as no topic. */
export function createStudyStore(
  database: Database,
  options: { now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date());
  const list = async (owner: string, botId?: string): Promise<StudyTopic[]> => {
    const at = now();
    const rows = await database
      .select()
      .from(openduetStudyTopics)
      .where(
        botId
          ? and(
              eq(openduetStudyTopics.ownerUserId, owner),
              eq(openduetStudyTopics.botId, botId),
            )
          : eq(openduetStudyTopics.ownerUserId, owner),
      )
      .orderBy(asc(openduetStudyTopics.dueAt));
    return rows.map((row) => topicOf(row, at));
  };
  return {
    /** Saves each result, making the topic the first time it is practiced. */
    async record(
      owner: string,
      botId: string,
      entries: StudyEntry[],
    ): Promise<RecordedTopic[]> {
      const at = now();
      const recorded: RecordedTopic[] = [];
      for (const entry of entries) {
        const subject = entry.subject.trim().replace(/\s+/g, " ");
        const topic = entry.topic.trim().replace(/\s+/g, " ");
        const where = and(
          eq(openduetStudyTopics.ownerUserId, owner),
          eq(openduetStudyTopics.botId, botId),
          eq(openduetStudyTopics.subjectKey, keyOf(subject)),
          eq(openduetStudyTopics.topicKey, keyOf(topic)),
        );
        const result = await database.transaction(async (transaction) => {
          const [existing] = await transaction
            .select()
            .from(openduetStudyTopics)
            .where(where)
            .for("update");
          const before = existing?.box ?? MIN_BOX;
          const box = existing
            ? nextBox(before, entry.result)
            : startBox(entry.result);
          const counts = {
            correctCount:
              (existing?.correctCount ?? 0) +
              (entry.result === "correct" ? 1 : 0),
            partlyCount:
              (existing?.partlyCount ?? 0) +
              (entry.result === "partly" ? 1 : 0),
            missedCount:
              (existing?.missedCount ?? 0) +
              (entry.result === "missed" ? 1 : 0),
          };
          const misconceptions = {
            items: nextMisconceptions(
              existing?.misconceptions?.items ?? [],
              entry,
              at,
            ),
          };
          const fields = {
            box,
            ...counts,
            lastResult: entry.result,
            lastActivity: entry.activity ?? existing?.lastActivity ?? null,
            misconceptions,
            dueAt: dueAfter(at, box),
            lastPracticedAt: at,
          };
          if (existing) {
            await transaction
              .update(openduetStudyTopics)
              .set(fields)
              .where(eq(openduetStudyTopics.id, existing.id));
          } else {
            await transaction.insert(openduetStudyTopics).values({
              id: randomUUID(),
              ownerUserId: owner,
              botId,
              subject,
              subjectKey: keyOf(subject),
              topic,
              topicKey: keyOf(topic),
              createdAt: at,
              ...fields,
            });
          }
          return {
            subject: existing?.subject ?? subject,
            topic: existing?.topic ?? topic,
            result: entry.result,
            box,
            mastery: masteryOf({ box, ...counts }),
            change: !existing
              ? ("new" as const)
              : box > before
                ? ("up" as const)
                : box < before
                  ? ("down" as const)
                  : ("same" as const),
            nextReview: fields.dueAt.toISOString(),
          };
        });
        recorded.push(result);
      }
      return recorded;
    },

    /** The owner's topics, for one Bot or all of them. */
    list,

    async overview(owner: string, botId?: string): Promise<StudyOverview> {
      return overviewOf(await list(owner, botId), now());
    },

    /** Marks a topic's open mistakes fixed, from the Learn tab. */
    async resolveMistakes(owner: string, id: string): Promise<StudyTopic> {
      const at = now();
      const [row] = await database
        .select()
        .from(openduetStudyTopics)
        .where(
          and(
            eq(openduetStudyTopics.ownerUserId, owner),
            eq(openduetStudyTopics.id, id),
          ),
        );
      if (!row) throw new StudyTopicNotFoundError();
      const items = nextMisconceptions(
        row.misconceptions?.items ?? [],
        { fixed: true, result: "correct" },
        at,
      );
      const [updated] = await database
        .update(openduetStudyTopics)
        .set({ misconceptions: { items } })
        .where(eq(openduetStudyTopics.id, id))
        .returning();
      if (!updated) throw new StudyTopicNotFoundError();
      return topicOf(updated, at);
    },

    /** Forgets a topic, from the Learn tab. */
    async remove(owner: string, id: string): Promise<void> {
      const deleted = await database
        .delete(openduetStudyTopics)
        .where(
          and(
            eq(openduetStudyTopics.ownerUserId, owner),
            eq(openduetStudyTopics.id, id),
          ),
        )
        .returning({ id: openduetStudyTopics.id });
      if (deleted.length === 0) throw new StudyTopicNotFoundError();
    },
  };
}

/** A first try: right starts in box 2, so it comes back in two days rather than tomorrow. */
function startBox(result: StudyResult) {
  return result === "correct" ? 2 : MIN_BOX;
}

const entrySchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .describe(
        "The class, as the student names it: 'Physics', 'English 10', 'Latin'.",
      ),
    topic: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe(
        "One specific topic or skill, short and reusable so later practice lands on the same one: 'Newton's second law', 'Ablative case', 'Thesis statements'. Not a whole unit, not a single question.",
      ),
    result: z
      .enum(STUDY_RESULTS)
      .describe(
        "How it went: correct (got it without help), partly (needed a hint or got part of it) or missed.",
      ),
    activity: z
      .enum(STUDY_ACTIVITIES)
      .optional()
      .describe("What kind of practice it was."),
    misconception: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .optional()
      .describe(
        "When they got it wrong, the specific misunderstanding in one short sentence, e.g. 'Thinks heavier objects fall faster'. Leave out when right.",
      ),
    fixed: z
      .boolean()
      .optional()
      .describe(
        "True when this practice showed an earlier mistake on this topic is now fixed.",
      ),
  })
  .strict();

const recordParameters = z
  .object({
    entries: z
      .array(entrySchema)
      .min(1)
      .max(MAX_ENTRIES_PER_CALL)
      .describe(
        `One to ${MAX_ENTRIES_PER_CALL} results, one per topic practiced.`,
      ),
  })
  .strict();

const STUDY_VIEWS = [
  "overview",
  "due",
  "weakest",
  "mistakes",
  "subject",
] as const;
const readParameters = z
  .object({
    view: z
      .enum(STUDY_VIEWS)
      .describe(
        "overview: every class with its mastery; due: topics due for review now, most overdue first; weakest: the least known topics; mistakes: open misunderstandings; subject: every topic in one class.",
      ),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe("Only this class. Needed for the subject view."),
  })
  .strict();

/** What the model reads for one topic: no ids or timestamps it would repeat to the student. */
function briefTopic(topic: StudyTopic) {
  return {
    subject: topic.subject,
    topic: topic.topic,
    mastery: topic.mastery,
    level: topic.level,
    record: `${topic.correctCount} right, ${topic.partlyCount} partly, ${topic.missedCount} missed`,
    due: topic.due,
    nextReview: topic.dueAt.slice(0, 10),
    ...(topic.openMistakes.length > 0
      ? { openMistakes: topic.openMistakes }
      : {}),
  };
}

/** Held by every Bot, like pages. Reads and writes only the student's own study memory. */
export function studyTools(options: {
  actorId: string;
  botId: string;
  initiator: AuditInitiator;
  store: StudyStore;
}): GrantedTool[] {
  return [
    {
      name: RECORD_STUDY_TOOL,
      ref: `openduet/${RECORD_STUDY_TOOL}`,
      description: [
        "Save how the student did on each topic they just practiced to their study memory, which schedules spaced review and fills their learn screen.",
        "Call it once at the end of any quiz, flashcard round, review, tutoring problem, teach-back or work check, with one entry per topic: right, partly or missed, and the misunderstanding when they got it wrong.",
        "Use short, reusable topic names so later practice lands on the same topic.",
        "It saves silently: do not announce or list what was saved.",
      ].join(" "),
      parameters: recordParameters,
      initiator: options.initiator,
      async execute(args) {
        const parsed = recordParameters.safeParse(args ?? {});
        if (!parsed.success)
          return `Refused. ${RECORD_STUDY_TOOL} takes 1 to ${MAX_ENTRIES_PER_CALL} entries, each with a subject (at most 60 characters), a topic (at most 100) and a result of correct, partly or missed. ${parsed.error.issues[0]?.message ?? ""}`.trim();
        const recorded = await options.store.record(
          options.actorId,
          options.botId,
          parsed.data.entries,
        );
        return JSON.stringify({
          recorded: recorded.map((topic) => ({
            ...topic,
            nextReview: topic.nextReview.slice(0, 10),
          })),
          note: "Saved to their study memory and learn screen. Don't list what was saved. At most, mention in a few words the one topic that moved most, such as a topic that just reached strong or one that will come back tomorrow.",
        });
      },
    },
    {
      name: STUDY_MEMORY_TOOL,
      ref: `openduet/${STUDY_MEMORY_TOOL}`,
      description: [
        "Read the student's study memory: how well they know each topic they have practiced, which topics are due for spaced review, and their open mistakes.",
        "Use it before a review session, to pick what to practice, to target their mistakes, or when they ask what they are weak at.",
      ].join(" "),
      parameters: readParameters,
      initiator: options.initiator,
      async execute(args) {
        const parsed = readParameters.safeParse(args ?? {});
        if (!parsed.success)
          return `Refused. ${STUDY_MEMORY_TOOL} takes a view of ${STUDY_VIEWS.join(", ")}, and a subject for the subject view.`;
        const { view, subject } = parsed.data;
        if (view === "subject" && !subject)
          return `Refused. The subject view needs a subject.`;
        const all = await options.store.list(options.actorId, options.botId);
        const topics = subject
          ? all.filter((topic) => keyOf(topic.subject) === keyOf(subject))
          : all;
        if (topics.length === 0)
          return JSON.stringify({
            topics: [],
            note: subject
              ? `Nothing recorded for ${subject} yet. Say so in a few words and offer a quick quiz to start.`
              : "Their study memory is empty: nothing has been practiced yet. Say so in a few words and offer a quick quiz on their nearest test to start it.",
          });
        const overview = overviewOf(topics, new Date());
        if (view === "overview")
          return JSON.stringify({
            totals: overview.totals,
            subjects: overview.subjects,
            note: "Mastery is 0 to 100. The learn screen shows the full map; give the short answer here.",
          });
        if (view === "due")
          return JSON.stringify({
            due: overview.due.slice(0, 12).map(briefTopic),
            dueCount: overview.due.length,
            note:
              overview.due.length === 0
                ? "Nothing is due for review. Say so and suggest the weakest topic instead."
                : "Most overdue first.",
          });
        if (view === "weakest")
          return JSON.stringify({ weakest: overview.weakest.map(briefTopic) });
        if (view === "mistakes")
          return JSON.stringify({
            mistakes: overview.mistakes,
            note:
              overview.mistakes.length === 0
                ? "No open mistakes. Say so in a few words."
                : "Each is an open misunderstanding from earlier practice. Mark one fixed with record_study (fixed: true) once they get it right.",
          });
        return JSON.stringify({ topics: overview.topics.map(briefTopic) });
      },
    },
  ];
}

/** `/api/openduet/study`: the student's own study memory, as the Learn tab reads it. */
export function createStudyRoutes(
  store: StudyStore,
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>,
) {
  const routes = new Hono<{ Variables: AppVariables }>();
  routes.use("*", requireUser);
  routes.onError((error, context) => {
    if (error instanceof StudyTopicNotFoundError)
      return context.json({ error: error.message }, 404);
    console.error(
      JSON.stringify({
        type: "openduet-study-route-error",
        error: error.name,
        context: { route: context.req.path },
        timestamp: new Date().toISOString(),
      }),
    );
    return context.json(
      { error: "Couldn't load your study memory. Try again." },
      503,
    );
  });
  routes.get("/", async (context) =>
    context.json({ overview: await store.overview(context.var.actor.id) }),
  );
  routes.post("/topics/:id/fixed", async (context) =>
    context.json({
      topic: await store.resolveMistakes(
        context.var.actor.id,
        context.req.param("id"),
      ),
    }),
  );
  routes.delete("/topics/:id", async (context) => {
    await store.remove(context.var.actor.id, context.req.param("id"));
    return context.body(null, 204);
  });
  return routes;
}
