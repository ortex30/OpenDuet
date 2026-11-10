import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agents, users } from "./core";
import { jsonb } from "./json";

/** One thing the student got wrong and why, kept until a later practice shows it fixed. */
export type StudyMisconception = {
  note: string;
  at: string;
  fixedAt?: string;
};

/**
 * Academic OS's study memory: one row per topic a student has practiced, per Bot.
 *
 * Written by the `record_study` tool after any quiz, flashcard round, tutoring step or teach-back
 * (openduet/study-memory.ts), and read by `study_memory`, the Learn tab and the review skill. The
 * schedule is a Leitner box: a right answer moves the topic up a box and further out, a miss puts it
 * back in box 1 for tomorrow. `subject_key` and `topic_key` are the lowercased, trimmed names, so
 * "Physics" and "physics " are one class.
 */
export const openduetStudyTopics = pgTable(
  "openduet_study_topics",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    subjectKey: text("subject_key").notNull(),
    topic: text("topic").notNull(),
    topicKey: text("topic_key").notNull(),
    box: integer("box").notNull().default(1),
    correctCount: integer("correct_count").notNull().default(0),
    partlyCount: integer("partly_count").notNull().default(0),
    missedCount: integer("missed_count").notNull().default(0),
    lastResult: text("last_result").notNull(),
    lastActivity: text("last_activity"),
    misconceptions: jsonb("misconceptions")
      .$type<{ items: StudyMisconception[] }>()
      .notNull()
      .default({ items: [] }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    lastPracticedAt: timestamp("last_practiced_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("openduet_study_topics_owner_topic_idx").on(
      table.ownerUserId,
      table.botId,
      table.subjectKey,
      table.topicKey,
    ),
    index("openduet_study_topics_owner_due_idx").on(
      table.ownerUserId,
      table.dueAt,
    ),
    check("openduet_study_topics_box_check", sql`${table.box} BETWEEN 1 AND 5`),
    check(
      "openduet_study_topics_result_check",
      sql`${table.lastResult} IN ('correct', 'partly', 'missed')`,
    ),
  ],
);
