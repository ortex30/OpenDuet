import { readConnectPrompt } from "@openbot/shared/connect-prompt";
import {
  CLASS_COLORS,
  HELP_LEVELS,
  type SchoolSnapshot,
} from "@openbot/shared/study";
import { z } from "zod";
import { CALENDAR_LIST, type CallTool, GMAIL_SEARCH } from "../brief";
import type {
  SchoolRead,
  SchoolService,
  StudyContext,
  StudyStore,
} from "./contracts";
import {
  buildSnapshot,
  carriedNotices,
  isClassroomSender,
  NOTICE_TYPES,
  type ParsedNotice,
  parseClassroomNotice,
} from "./notices";
import { isTimeZone, zonedInstant } from "./time";

/*
 * The student's classes and assignments, read from the Classroom notices in their Gmail and kept as
 * one record (kind "school", id "school:<owner>"), so the study tools and screens read it without a
 * round of Gmail calls each time.
 *
 * Read through the plugin store as the student and under the Bot's grants, exactly as the morning
 * brief reads Gmail and Calendar, so a sync can only see what this Bot was given and this student
 * connected. What could not be read is said in a sentence they can act on, never smoothed over. A
 * read, stored or still running, answers only the Bot that made it: another Bot may not have been
 * given what this one was, so it reads for itself.
 *
 * A sync only ever adds to what the student's teachers said. A message that was read once keeps its
 * notice (a sent email does not change), so a later sync that fails to read it does not lose the
 * teacher's "No help" with it. A notice whose email the search no longer lists (deleted, older than
 * thirty days, or pushed out by newer mail) stands while its work does (carriedNotices). And a sync
 * that reads nothing at all, or finds no Classroom email where classes were read before, leaves the
 * stored copy standing.
 */

export const GMAIL_READ = "google-workspace/gmail_read_message";

/** Every Classroom notice from the last thirty days. */
export const CLASSROOM_QUERY = "from:classroom.google.com newer_than:30d";

/** The most gmail_search_messages returns in one answer. */
const SEARCH_PAGE = 50;

/** How many notices a sync reads, newest first. Each one is a Gmail request. */
export const NOTICES_READ = 40;

/** Reads at once: enough to be quick, few enough to stay well inside Gmail's per-user rate. */
const READ_CONCURRENCY = 4;

/** The most notices a sync keeps from emails the search no longer lists. */
const CARRIED_MAX = 100;

/** Said when the search lists no Classroom email at all, though classes were read before. */
const NONE_FOUND =
  "Gmail found no Classroom emails this time, so your classes weren't updated.";

const DEFAULT_MAX_AGE_MS = 10 * 60_000;

/** Changed whenever the parser reads a notice differently, so notices kept by an older one are read again. */
const PARSER_VERSION = 1;

export const schoolRecordId = (owner: string) => `school:${owner}`;

const KINDS = [
  "assignment",
  "quiz",
  "test",
  "announcement",
  "material",
] as const;
const STATUSES = ["open", "missing", "returned"] as const;

const snapshotSchema = z.object({
  syncedAt: z.string(),
  timeZone: z.string(),
  classes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      teacher: z.string().nullable(),
      period: z.string().nullable(),
      color: z.enum(CLASS_COLORS),
    }),
  ),
  assignments: z.array(
    z.object({
      id: z.string(),
      classId: z.string(),
      title: z.string(),
      kind: z.enum(KINDS),
      status: z.enum(STATUSES),
      due: z.string().nullable(),
      dueDate: z.string().nullable(),
      dueTime: z.string().nullable(),
      points: z.number().nullable(),
      grade: z.string().nullable(),
      help: z.enum(HELP_LEVELS).nullable(),
      minutes: z.number(),
      link: z.string().nullable(),
      noticeId: z.string(),
    }),
  ),
  couldNotRead: z.array(z.string()),
});

const noticeSchema = z.object({
  noticeId: z.string(),
  receivedAt: z.string(),
  type: z.enum(NOTICE_TYPES),
  className: z.string(),
  teacher: z.string().nullable(),
  period: z.string().nullable(),
  courseId: z.string().nullable(),
  classId: z.string(),
  itemId: z.string().nullable(),
  title: z.string().nullable(),
  assignmentId: z.string().nullable(),
  kind: z.enum(KINDS),
  status: z.enum(STATUSES),
  due: z.string().nullable(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  points: z.number().nullable(),
  grade: z.string().nullable(),
  help: z.enum(HELP_LEVELS).nullable(),
  statedMinutes: z.number().nullable(),
  minutes: z.number(),
  link: z.string().nullable(),
  text: z.string(),
});

const storedSchema = z.object({
  parser: z.number(),
  snapshot: snapshotSchema,
  /** Each message a sync read, by Gmail id: its notice, or null for mail that is not one. */
  notices: z.record(z.string(), z.unknown()),
});

/** gmail_search_messages' answer: only the parts a sync reads. */
const searchSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string(),
        from: z.string().default(""),
        subject: z.string().default(""),
        date: z.string().default(""),
      }),
    )
    .default([]),
  resultSizeEstimate: z.number().nullable().optional(),
});

/** gmail_read_message's answer: only the parts a notice is read from. */
const readSchema = z.object({
  id: z.string(),
  from: z.string().default(""),
  subject: z.string().default(""),
  date: z.string().default(""),
  body: z.string().default(""),
});

/** calendar_list_events' answer when no timeMax is given: it names the calendar's zone. */
const zoneSchema = z.object({
  timeZone: z.string().optional(),
  note: z.string().optional(),
});

type Stored = {
  /** The Bot whose sync made it, whose grants it was read under. */
  botId: string | null;
  parser: number;
  snapshot: SchoolSnapshot;
  notices: Map<string, ParsedNotice | null>;
};

/** A notice read in another time zone, its due time read in this one, as reading it again would. */
function inZone(notice: ParsedNotice, timeZone: string): ParsedNotice {
  if (!notice.dueDate || !notice.dueTime) return notice;
  try {
    const due = zonedInstant(notice.dueDate, notice.dueTime, timeZone);
    return { ...notice, due: due.toISOString() };
  } catch {
    return notice;
  }
}

type Answer = { ok: true; text: string } | { ok: false; text: string };

function parsed<T>(schema: z.ZodType<T>, text: string): T | null {
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** What went wrong, in the plugin store's or Google's own words, short enough to show. */
function reasonOf(text: string): string {
  const bare = text.replace(/^Refused\.\s*/, "");
  const words = (readConnectPrompt(bare)?.message ?? bare)
    .replace(/\s+/g, " ")
    .trim();
  return words.length > 300 ? `${words.slice(0, 299)}…` : words;
}

/**
 * The sentence for a source that could not be read: what was lost, what that means, and what the
 * student can do about it. A refusal that carries a Connect card names its reason; a Bot without
 * the tool is an admin's to fix; anything else is said in Google's or the plugin store's words.
 */
function unreadable(
  product: "Gmail" | "Google Calendar",
  text: string,
  lost: { what: string; meaning?: string },
): string {
  const meaning = lost.meaning ? ` ${lost.meaning}` : "";
  const prompt = readConnectPrompt(text.replace(/^Refused\.\s*/, ""));
  if (prompt?.reason === "reconnect")
    return `${product} needs reconnecting, so ${lost.what} couldn't be read.${meaning} Reconnect Google on the Connections page.`;
  if (prompt?.reason === "shared")
    return `The shared Google account isn't connected, so ${lost.what} couldn't be read.${meaning} An admin has to connect it.`;
  if (prompt)
    return `${product} isn't connected, so ${lost.what} couldn't be read.${meaning} Connect Google on the Connections page.`;
  if (/has not been given the tool/i.test(text))
    return `This Bot hasn't been given ${product}, so ${lost.what} couldn't be read.${meaning} Ask an admin to give it ${product}.`;
  const reason = reasonOf(text);
  const what = lost.what.charAt(0).toUpperCase() + lost.what.slice(1);
  return `${what} couldn't be read from ${product}.${meaning}${reason ? ` ${reason}` : ""}`;
}

/** Up to `limit` of these at once, in order. */
async function inParallel<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let index = next++; index < items.length; index = next++)
        results[index] = await work(items[index] as T);
    }),
  );
  return results;
}

export function createSchoolService(deps: {
  store: StudyStore;
  callTool: CallTool;
  now?: () => Date;
}): SchoolService {
  const now = deps.now ?? (() => new Date());
  /**
   * The sync running for each person and Bot, which a second caller from the same Bot waits on
   * rather than starting another.
   */
  const running = new Map<string, Promise<SchoolRead>>();

  async function load(owner: string): Promise<Stored | null> {
    const record = await deps.store.get(owner, "school", schoolRecordId(owner));
    if (!record) return null;
    const found = storedSchema.safeParse(record.data);
    if (!found.success) return null;
    const notices = new Map<string, ParsedNotice | null>();
    for (const [id, value] of Object.entries(found.data.notices)) {
      if (value === null) notices.set(id, null);
      else {
        // A kept notice that no longer reads is dropped, and that message is read again.
        const notice = noticeSchema.safeParse(value);
        if (notice.success) notices.set(id, notice.data);
      }
    }
    return {
      botId: record.botId,
      parser: found.data.parser,
      snapshot: found.data.snapshot,
      notices,
    };
  }

  function fresh(snapshot: SchoolSnapshot, maxAgeMs: number): boolean {
    const age = now().getTime() - Date.parse(snapshot.syncedAt);
    // A copy stamped well in the future came from a clock that was wrong; it is not trusted as new.
    return Number.isFinite(age) && age >= -60_000 && age < maxAgeMs;
  }

  async function sync(
    context: StudyContext,
    previous: Stored | null,
  ): Promise<SchoolRead> {
    const owner = context.actorId;
    const startedAt = now();
    const call = async (
      ref: string,
      args: Record<string, unknown>,
    ): Promise<Answer> => {
      try {
        const result = await deps.callTool({
          ref,
          args,
          botId: context.botId,
          actorId: context.actorId,
          initiator: context.initiator,
        });
        return result.isError
          ? { ok: false, text: result.text }
          : { ok: true, text: result.text };
      } catch (error) {
        // The plugin store refuses by throwing: not connected, not granted, a policy.
        return {
          ok: false,
          text: error instanceof Error ? error.message : String(error),
        };
      }
    };
    const fallback = (why: string): SchoolRead => ({
      snapshot: previous?.snapshot ?? null,
      why,
    });
    const couldNotRead: string[] = [];

    // The student's time zone, which their calendar names when asked for the rest of today. Due
    // times are read in it, so without it they are read in the last zone known, or in UTC.
    const known =
      previous && isTimeZone(previous.snapshot.timeZone)
        ? previous.snapshot.timeZone
        : null;
    let timeZone = known ?? "UTC";
    const calendar = await call(CALENDAR_LIST, {});
    const zone = calendar.ok ? parsed(zoneSchema, calendar.text) : null;
    const meaning = known
      ? `Due times use your last known time zone, ${known}.`
      : "Due times are shown in UTC.";
    if (zone?.timeZone && !zone.note && isTimeZone(zone.timeZone))
      timeZone = zone.timeZone;
    else if (!calendar.ok)
      couldNotRead.push(
        unreadable("Google Calendar", calendar.text, {
          what: "your time zone",
          meaning,
        }),
      );
    else
      couldNotRead.push(
        `Google Calendar didn't say which time zone you're in. ${meaning}`,
      );

    const search = await call(GMAIL_SEARCH, {
      query: CLASSROOM_QUERY,
      maxResults: SEARCH_PAGE,
    });
    if (!search.ok)
      return fallback(
        unreadable("Gmail", search.text, { what: "your classes" }),
      );
    const found = parsed(searchSchema, search.text);
    if (!found)
      return fallback(
        "Gmail answered in a way that couldn't be read, so your classes weren't updated. Try again in a minute.",
      );
    const classroom = found.messages.filter((message) =>
      isClassroomSender(message.from),
    );
    // No Classroom email at all where classes were read before is a read that went wrong, or a
    // mailbox emptied, not a student whose classes all ended: the stored copy stands, and says so.
    if (
      classroom.length === 0 &&
      previous &&
      previous.snapshot.classes.length > 0
    )
      return {
        snapshot: {
          ...previous.snapshot,
          couldNotRead: [
            ...new Set([...previous.snapshot.couldNotRead, NONE_FOUND]),
          ],
        },
        why: NONE_FOUND,
      };
    const listed = classroom.slice(0, NOTICES_READ);

    // A message read before is not read again: a sent email does not change. Notices kept by
    // another parser, or read in another time zone, are read afresh, and so is one listed with a
    // date other than the one it was read with, which only a mailbox made up again can do.
    const kept =
      previous?.parser === PARSER_VERSION &&
      previous.snapshot.timeZone === timeZone
        ? previous.notices
        : new Map<string, ParsedNotice | null>();
    const redated = (message: { id: string; date: string }) => {
      const listedAt = Date.parse(message.date);
      const readAt = Date.parse(kept.get(message.id)?.receivedAt ?? "");
      return (
        Number.isFinite(listedAt) &&
        Number.isFinite(readAt) &&
        listedAt !== readAt
      );
    };
    const failures: string[] = [];
    const read = await inParallel(
      listed.filter((message) => !kept.has(message.id) || redated(message)),
      READ_CONCURRENCY,
      async (listedMessage) => {
        const answer = await call(GMAIL_READ, { id: listedMessage.id });
        const message = answer.ok ? parsed(readSchema, answer.text) : null;
        if (!message) {
          failures.push(answer.ok ? "" : answer.text);
          return null;
        }
        return {
          id: listedMessage.id,
          notice: parseClassroomNotice(
            {
              id: listedMessage.id,
              from: message.from || listedMessage.from,
              subject: message.subject || listedMessage.subject,
              date: message.date || listedMessage.date,
              body: message.body,
            },
            { timeZone },
          ),
        };
      },
    );

    const notices = new Map<string, ParsedNotice | null>();
    for (const message of listed)
      if (kept.has(message.id))
        notices.set(message.id, kept.get(message.id) ?? null);
    for (const entry of read) if (entry) notices.set(entry.id, entry.notice);

    // Nothing could be read at all, which is not the same as having no classes: keep what is stored.
    if (listed.length > 0 && notices.size === 0)
      return fallback(
        unreadable("Gmail", failures.find(Boolean) ?? "", {
          what: "your Classroom emails",
          meaning: "Your classes weren't updated.",
        }),
      );

    // A notice whose email is no longer listed stands while its work does, with its due time read in
    // this time zone, as reading it again would.
    const listedIds = new Set(listed.map((message) => message.id));
    const moved = previous !== null && previous.snapshot.timeZone !== timeZone;
    const unlisted = [...(previous?.notices ?? [])].flatMap(([id, notice]) =>
      notice && !listedIds.has(id)
        ? [moved ? inZone(notice, timeZone) : notice]
        : [],
    );
    for (const notice of carriedNotices(
      [...notices.values()].filter(
        (notice): notice is ParsedNotice => notice !== null,
      ),
      unlisted,
      { at: startedAt, limit: CARRIED_MAX },
    ))
      notices.set(notice.noticeId, notice);
    if (failures.length > 0)
      couldNotRead.push(
        `${failures.length} Classroom email${failures.length === 1 ? "" : "s"} couldn't be read, so some assignments may be missing. ${failures.length === 1 ? "It" : "They"}'ll be read again next time.`,
      );
    // Gmail's estimate of the matches is only an estimate, so it counts only when the page was full.
    if (
      classroom.length > NOTICES_READ ||
      (found.messages.length >= SEARCH_PAGE &&
        (found.resultSizeEstimate ?? 0) > found.messages.length)
    )
      couldNotRead.push(
        `Only your ${NOTICES_READ} newest Classroom emails from the last 30 days were read. Older ones weren't checked.`,
      );

    const snapshot = buildSnapshot(
      [...notices.values()].filter(
        (notice): notice is ParsedNotice => notice !== null,
      ),
      { timeZone, syncedAt: startedAt.toISOString(), couldNotRead },
    );
    try {
      await deps.store.put(owner, {
        id: schoolRecordId(owner),
        kind: "school",
        botId: context.botId,
        data: {
          parser: PARSER_VERSION,
          snapshot,
          notices: Object.fromEntries(notices),
        },
      });
    } catch (error) {
      // The student still gets what was read; the next request reads it again.
      console.error(
        JSON.stringify({
          type: "openduet-school-save-error",
          error: error instanceof Error ? error.name : "unknown",
          timestamp: new Date().toISOString(),
        }),
      );
    }
    return { snapshot, why: null };
  }

  return {
    async current(context, options = {}) {
      const owner = context.actorId;
      const key = JSON.stringify([owner, context.botId]);
      const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
      // A sync already under way is as fresh as a forced one would be.
      const inFlight = running.get(key);
      if (inFlight && options.force) return inFlight;
      // A fresh copy is answered at once, without waiting on anybody's sync. Only this Bot's own
      // copy is one: what another Bot read, it may not have been given, so it is never reused,
      // fresh or as a fallback, and nothing it read is kept or carried for this one.
      const record = await load(owner);
      const stored = record?.botId === context.botId ? record : null;
      if (!options.force && stored && fresh(stored.snapshot, maxAgeMs))
        return { snapshot: stored.snapshot, why: null };
      // One under way, or started while the stored copy was being read, is shared, never doubled.
      const started = running.get(key);
      if (started) return started;
      const syncing = sync(context, stored).finally(() => {
        running.delete(key);
      });
      running.set(key, syncing);
      return syncing;
    },

    async stored(owner) {
      return (await load(owner))?.snapshot ?? null;
    },
  };
}
