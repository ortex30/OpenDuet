import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { connectAppRefusal } from "@openbot/shared/connect-prompt";
import type { SchoolSnapshot } from "@openbot/shared/study";
import {
  type FakeGoogle,
  startFakeGoogle,
} from "../../scripts/fake-google/server";
import {
  CALENDAR_LIST,
  type CallTool,
  GMAIL_SEARCH,
} from "../src/openduet/brief";
import type { StudyContext, StudyStore } from "../src/openduet/study/contracts";
import { createMemoryStudyStore } from "../src/openduet/study/memory-store";
import {
  CLASSROOM_QUERY,
  createSchoolService,
  GMAIL_READ,
  schoolRecordId,
} from "../src/openduet/study/school";
import { addDays, zonedParts } from "../src/openduet/study/time";
import { callTool as googleWorkspace } from "../src/plugins/google-workspace-rest";
import { PluginRefusedError } from "../src/plugins/plugin-store/model";

/*
 * The school service: the student's classes read from their Classroom notices through the plugin
 * store, kept, and read again only when the kept copy is old. First against a stand-in for the
 * plugin store that answers in the Gmail and Calendar adapter's own shapes, then against the real
 * adapter and the fake Google's demo student, which is what the demo runs on.
 */

const CONTEXT: StudyContext = {
  actorId: "jordan",
  botId: "academic-os",
  initiator: { kind: "person" },
};

/** The same student's other Bot, which may or may not have been given Gmail. */
const OTHER_BOT: StudyContext = { ...CONTEXT, botId: "homework-helper" };

const OKORO = '"Dr. Okoro (Google Classroom)" <no-reply@classroom.google.com>';
const CHEN = '"Mr. Chen (Google Classroom)" <no-reply@classroom.google.com>';
const GRANT = '"Mr. Grant (Google Classroom)" <no-reply@classroom.google.com>';
const ALVAREZ =
  '"Ms. Alvarez (Google Classroom)" <no-reply@classroom.google.com>';

type Mail = {
  id: string;
  from: string;
  subject: string;
  date: string;
  body: string;
};

const LAB6: Mail = {
  id: "18f0a1b2c3d4e5f6",
  from: OKORO,
  subject: 'New assignment: "Lab 6 report: Reaction Rates"',
  date: "2026-11-02T21:10:00.000Z",
  body: [
    "Chemistry · Period 2 · Dr. Okoro",
    "New assignment",
    "Lab 6 report: Reaction Rates",
    "Due: Thu, Nov 5, 2026, 11:59 PM",
    "Points: 40",
    "Estimated time: 90 min",
    "AI help: Hints only",
    "",
    "Include a data table and a conclusion.",
    "",
    "Open: https://classroom.google.com/c/chem2/a/lab6",
  ].join("\n"),
};

const QUIZ: Mail = {
  id: "18f0a1b2c3d4e5f7",
  from: CHEN,
  subject: 'New quiz: "Unit 4 quiz: Trig identities"',
  date: "2026-11-03T19:30:00.000Z",
  body: [
    "Precalculus · Period 4 · Mr. Chen",
    "New quiz",
    "Unit 4 quiz: Trig identities",
    "Due: Thu, Nov 5, 2026, 10:45 AM",
    "AI help: No help",
    "",
    "Open: https://classroom.google.com/c/precalc4/a/quiz4",
  ].join("\n"),
};

const COACH: Mail = {
  id: "18f0a1b2c3d4e5f8",
  from: "Coach Daniels <tdaniels@lakeviewhs.org>",
  subject: "Practice moved to Field B",
  date: "2026-11-04T15:10:00.000Z",
  body: "Team, practice today is on Field B.",
};

/** The connector's refusal when this person has not connected Google, as the plugin store throws it. */
const notConnected = () =>
  new PluginRefusedError(
    connectAppRefusal({
      serverId: "google-workspace",
      title: "Gmail and Google Calendar",
      message:
        "You have not connected your Gmail and Google Calendar account. Connect it and ask again.",
    }),
    null,
  );

const UNAUTHORIZED =
  "Gmail refused this request (401): Request had invalid authentication credentials. Google did not accept this person's access. Reconnecting Gmail and Google Calendar on the Connections page usually fixes it.";

type Failure = Error | string;

/**
 * A stand-in for the plugin store's callTool over the Gmail and Calendar adapter: it answers each
 * tool in the adapter's JSON shapes, throws what the store throws, and counts what was asked.
 */
function fakeGoogle(initial: { mail?: Mail[]; timeZone?: string } = {}) {
  const state = {
    mail: [...(initial.mail ?? [LAB6, QUIZ, COACH])],
    timeZone: initial.timeZone ?? "America/Chicago",
    zoneNote: null as string | null,
    fail: new Map<string, Failure>(),
    /** Ids whose read fails, the rest succeeding. */
    unreadable: new Set<string>(),
    /** What the search says it matched, when a test wants Gmail's estimate to be wrong. */
    estimate: null as number | null,
    /** Every call waits for this, when a test wants a sync held open. */
    hold: null as Promise<void> | null,
    /** Bots the plugin store refuses every tool, as it refuses one never given Gmail. */
    ungranted: new Set<string>(),
    calls: [] as {
      ref: string;
      args: Record<string, unknown>;
      botId: string;
    }[],
  };
  const answer = (value: unknown) => ({
    text: JSON.stringify(value),
    isError: false,
  });
  const callTool: CallTool = async (input) => {
    state.calls.push({ ref: input.ref, args: input.args, botId: input.botId });
    if (state.hold) await state.hold;
    expect(input).toMatchObject({
      actorId: CONTEXT.actorId,
      initiator: CONTEXT.initiator,
    });
    if (state.ungranted.has(input.botId))
      throw new PluginRefusedError(
        `This Bot has not been given the tool ${input.ref}.`,
        null,
      );
    const failure = state.fail.get(input.ref);
    if (failure instanceof Error) throw failure;
    if (typeof failure === "string") return { text: failure, isError: true };
    if (input.ref === CALENDAR_LIST)
      return answer({
        timeZone: state.timeZone,
        ...(state.zoneNote ? { note: state.zoneNote } : {}),
        events: [],
      });
    if (input.ref === GMAIL_SEARCH) {
      const newest = [...state.mail].sort((a, b) =>
        b.date.localeCompare(a.date),
      );
      const page = newest.slice(0, Number(input.args.maxResults ?? 25));
      return answer({
        messages: page.map((mail) => ({
          id: mail.id,
          threadId: mail.id,
          from: mail.from,
          to: ["jordan.rivera@students.lakeviewhs.org"],
          cc: [],
          subject: mail.subject,
          date: mail.date,
          snippet: mail.body.slice(0, 140),
          labels: ["INBOX"],
          headers: {},
        })),
        resultSizeEstimate: state.estimate ?? state.mail.length,
      });
    }
    if (input.ref === GMAIL_READ) {
      const mail = state.mail.find(
        (candidate) => candidate.id === input.args.id,
      );
      if (!mail || state.unreadable.has(mail.id))
        return {
          text: "Gmail refused this request (404): Requested entity was not found. No message with that id is in this mailbox.",
          isError: true,
        };
      return answer({
        id: mail.id,
        threadId: mail.id,
        from: mail.from,
        to: ["jordan.rivera@students.lakeviewhs.org"],
        cc: [],
        subject: mail.subject,
        date: mail.date,
        labels: ["INBOX"],
        headers: {},
        messageId: `<${mail.id}@mail.gmail.com>`,
        body: mail.body,
      });
    }
    throw new Error(`unexpected tool ${input.ref}`);
  };
  const count = (ref: string) =>
    state.calls.filter((call) => call.ref === ref).length;
  return { state, callTool, count };
}

function fixture(options: Parameters<typeof fakeGoogle>[0] = {}) {
  let now = new Date("2026-11-04T15:00:00.000Z");
  const clock = {
    now: () => now,
    advance(minutes: number) {
      now = new Date(now.getTime() + minutes * 60_000);
    },
  };
  const store = createMemoryStudyStore({ now: clock.now });
  const google = fakeGoogle(options);
  const school = createSchoolService({
    store,
    callTool: google.callTool,
    now: clock.now,
  });
  return { store, google, school, clock };
}

describe("the school service", () => {
  test("reads the student's classes from their Classroom notices and keeps them", async () => {
    const { school, google, store } = fixture();
    const read = await school.current(CONTEXT);

    expect(read.why).toBeNull();
    expect(read.snapshot).toEqual({
      syncedAt: "2026-11-04T15:00:00.000Z",
      timeZone: "America/Chicago",
      classes: [
        {
          id: "chem2",
          name: "Chemistry",
          teacher: "Dr. Okoro",
          period: "Period 2",
          color: "sky",
        },
        {
          id: "precalc4",
          name: "Precalculus",
          teacher: "Mr. Chen",
          period: "Period 4",
          color: "violet",
        },
      ],
      assignments: [
        {
          id: "precalc4-quiz4",
          classId: "precalc4",
          title: "Unit 4 quiz: Trig identities",
          kind: "quiz",
          status: "open",
          due: "2026-11-05T16:45:00.000Z",
          dueDate: "2026-11-05",
          dueTime: "10:45",
          points: null,
          grade: null,
          help: "none",
          minutes: 60,
          link: "https://classroom.google.com/c/precalc4/a/quiz4",
          noticeId: QUIZ.id,
        },
        {
          id: "chem2-lab6",
          classId: "chem2",
          title: "Lab 6 report: Reaction Rates",
          kind: "assignment",
          status: "open",
          due: "2026-11-06T05:59:00.000Z",
          dueDate: "2026-11-05",
          dueTime: "23:59",
          points: 40,
          grade: null,
          help: "hints",
          minutes: 90,
          link: "https://classroom.google.com/c/chem2/a/lab6",
          noticeId: LAB6.id,
        },
      ],
      couldNotRead: [],
    } satisfies SchoolSnapshot);

    // The search asks for every Classroom notice of the last thirty days, a full page of them, and
    // only Classroom's own mail is read in full: the coach's message never is.
    expect(google.state.calls.map((call) => call.ref)).toEqual([
      CALENDAR_LIST,
      GMAIL_SEARCH,
      GMAIL_READ,
      GMAIL_READ,
    ]);
    // Each one as this Bot, under its grants.
    expect(
      google.state.calls.every((call) => call.botId === CONTEXT.botId),
    ).toBe(true);
    expect(google.state.calls[1]?.args).toEqual({
      query: CLASSROOM_QUERY,
      maxResults: 50,
    });
    expect(
      google.state.calls
        .filter((call) => call.ref === GMAIL_READ)
        .map((call) => call.args.id)
        .sort(),
    ).toEqual([LAB6.id, QUIZ.id].sort());

    expect(await school.stored(CONTEXT.actorId)).toEqual(read.snapshot);
    expect(
      await store.get(CONTEXT.actorId, "school", schoolRecordId("jordan")),
    ).toMatchObject({
      id: "school:jordan",
      kind: "school",
      botId: CONTEXT.botId,
    });
  });

  test("answers from the kept copy while it is fresh, without asking Gmail", async () => {
    const { school, google, clock } = fixture();
    const first = await school.current(CONTEXT);
    const calls = google.state.calls.length;
    clock.advance(9);
    expect(await school.current(CONTEXT)).toEqual(first);
    expect(google.state.calls).toHaveLength(calls);
    expect(await school.stored("somebody-else")).toBeNull();
  });

  test("reads again when the copy is older than maxAgeMs, or when forced", async () => {
    const { school, google, clock } = fixture();
    await school.current(CONTEXT);
    clock.advance(11);
    const again = await school.current(CONTEXT);
    expect(google.count(GMAIL_SEARCH)).toBe(2);
    expect(again.snapshot?.syncedAt).toBe("2026-11-04T15:11:00.000Z");

    clock.advance(1);
    await school.current(CONTEXT, { force: true });
    expect(google.count(GMAIL_SEARCH)).toBe(3);
    await school.current(CONTEXT, { maxAgeMs: 0 });
    expect(google.count(GMAIL_SEARCH)).toBe(4);
  });

  test("reads only the notices it has not read before", async () => {
    const { school, google } = fixture();
    await school.current(CONTEXT);
    expect(google.count(GMAIL_READ)).toBe(2);
    google.state.mail.push({
      ...LAB6,
      id: "18f0a1b2c3d4e5f9",
      subject: 'Due tomorrow: "Lab 6 report: Reaction Rates"',
      date: "2026-11-04T13:05:00.000Z",
      body: LAB6.body
        .replace("New assignment", "Due soon")
        .replace("AI help: Hints only", "AI help: No help"),
    });
    const read = await school.current(CONTEXT, { force: true });
    expect(google.count(GMAIL_READ)).toBe(3);
    // The newer notice's rule wins.
    expect(
      read.snapshot?.assignments.find((entry) => entry.id === "chem2-lab6"),
    ).toMatchObject({ help: "none", noticeId: "18f0a1b2c3d4e5f9" });
  });

  test("reads a kept notice again when its email is listed with another date", async () => {
    const { school, google } = fixture();
    await school.current(CONTEXT);
    expect(google.count(GMAIL_READ)).toBe(2);
    // The same id, a day later, saying something else: what only a mailbox made up again can do.
    google.state.mail = google.state.mail.map((mail) =>
      mail.id === LAB6.id
        ? {
            ...LAB6,
            date: "2026-11-03T21:10:00.000Z",
            body: LAB6.body.replace("Thu, Nov 5", "Fri, Nov 6"),
          }
        : mail,
    );
    const read = await school.current(CONTEXT, { force: true });
    expect(google.count(GMAIL_READ)).toBe(3);
    expect(
      read.snapshot?.assignments.find((entry) => entry.id === "chem2-lab6"),
    ).toMatchObject({ dueDate: "2026-11-06", noticeId: LAB6.id });
    // Listed with the date it was read with, it is kept and not read again.
    await school.current(CONTEXT, { force: true });
    expect(google.count(GMAIL_READ)).toBe(3);
  });

  test("a teacher's rule stays when its email is deleted, until its work is done", async () => {
    const { school, google, clock, store } = fixture();
    await school.current(CONTEXT);
    // The quiz's notice, the one that says No help, is deleted.
    google.state.mail = google.state.mail.filter((mail) => mail.id !== QUIZ.id);
    const kept = await school.current(CONTEXT, { force: true });
    expect(kept.why).toBeNull();
    expect(kept.snapshot?.classes.map((entry) => entry.id)).toEqual([
      "chem2",
      "precalc4",
    ]);
    expect(
      kept.snapshot?.assignments.find((entry) => entry.id === "precalc4-quiz4"),
    ).toMatchObject({ help: "none", noticeId: QUIZ.id });
    // Nothing was read again, and the notice is kept for the sync after this one.
    expect(google.count(GMAIL_READ)).toBe(2);
    const record = await store.get(
      "jordan",
      "school",
      schoolRecordId("jordan"),
    );
    expect(Object.keys(record?.data.notices ?? {})).toContain(QUIZ.id);

    // More than two days after the quiz, its work is done, and the rule goes with it.
    clock.advance(3 * 24 * 60 + 2 * 60);
    const later = await school.current(CONTEXT, { force: true });
    expect(later.snapshot?.classes.map((entry) => entry.id)).toEqual(["chem2"]);
    expect(
      later.snapshot?.assignments.map((entry) => [entry.id, entry.status]),
    ).toEqual([["chem2-lab6", "missing"]]);
  });

  test("a teacher's rule stays when 41 newer notices push its email out of the search, a reminder without the rule among them", async () => {
    const DBQ: Mail = {
      id: "18f0a1b2c3d4e700",
      from: GRANT,
      subject: 'New assignment: "DBQ essay: Causes of the Civil War"',
      date: "2026-11-02T12:40:00.000Z",
      body: [
        "AP US History · Period 1 · Mr. Grant",
        "New assignment",
        "DBQ essay: Causes of the Civil War",
        "Due: Fri, Nov 6, 2026, 8:00 AM",
        "AI help: No help",
        "",
        "Open: https://classroom.google.com/c/apush1/a/dbq3",
      ].join("\n"),
    };
    const { school, google } = fixture({ mail: [DBQ] });
    expect((await school.current(CONTEXT)).snapshot?.assignments).toEqual([
      expect.objectContaining({ id: "apush1-dbq3", help: "none" }),
    ]);

    for (let index = 0; index < 40; index++)
      google.state.mail.push({
        id: `18f0a1b2c3d4${String(800 + index).padStart(4, "0")}`,
        from: ALVAREZ,
        subject: `New announcement: Reading ${index}`,
        date: new Date(
          Date.parse("2026-11-03T12:00:00.000Z") + index * 60_000,
        ).toISOString(),
        body: [
          "English 11 · Period 3 · Ms. Alvarez",
          "Announcement",
          "",
          `Read chapter ${index}.`,
          "",
          `Open: https://classroom.google.com/c/eng11/p/r${index}`,
        ].join("\n"),
      });
    // Classroom's reminder, the newest of all, repeats the due date but not the rule.
    google.state.mail.push({
      ...DBQ,
      id: "18f0a1b2c3d4e7ff",
      subject: 'Reminder: "DBQ essay: Causes of the Civil War"',
      date: "2026-11-04T12:00:00.000Z",
      body: DBQ.body
        .replace("New assignment", "Due soon")
        .replace("\nAI help: No help", ""),
    });

    const read = await school.current(CONTEXT, { force: true });
    expect(read.why).toBeNull();
    expect(
      read.snapshot?.assignments.find((entry) => entry.id === "apush1-dbq3"),
    ).toMatchObject({ help: "none", noticeId: "18f0a1b2c3d4e7ff" });
    expect(read.snapshot?.classes.map((entry) => entry.id)).toEqual([
      "apush1",
      "eng11",
    ]);
    expect(read.snapshot?.couldNotRead).toEqual([
      "Only your 40 newest Classroom emails from the last 30 days were read. Older ones weren't checked.",
    ]);
    // The DBQ's own email was read once, by the first sync, and not listed since.
    expect(
      google.state.calls.filter(
        (call) => call.ref === GMAIL_READ && call.args.id === DBQ.id,
      ),
    ).toHaveLength(1);
  });

  test("a search that finds no Classroom email keeps the classes read before, and says so", async () => {
    const { school, google } = fixture();
    const first = await school.current(CONTEXT);
    if (!first.snapshot) throw new Error("no snapshot");
    google.state.mail = [COACH];
    const sentence =
      "Gmail found no Classroom emails this time, so your classes weren't updated.";
    expect(await school.current(CONTEXT, { force: true })).toEqual({
      snapshot: { ...first.snapshot, couldNotRead: [sentence] },
      why: sentence,
    });
    // Nothing was stored over the copy kept, so the teachers' rules still stand.
    expect(await school.stored(CONTEXT.actorId)).toEqual(first.snapshot);

    // A student whose mailbox never held a Classroom email simply has no classes yet.
    const empty = fixture({ mail: [COACH] });
    const none = await empty.school.current(CONTEXT);
    expect(none.why).toBeNull();
    expect(none.snapshot?.classes).toEqual([]);
  });

  test("a notice whose email is gone has its due time read in the student's new time zone", async () => {
    const { school, google } = fixture();
    await school.current(CONTEXT);
    google.state.mail = google.state.mail.filter((mail) => mail.id !== QUIZ.id);
    google.state.timeZone = "America/New_York";
    const read = await school.current(CONTEXT, { force: true });
    expect(read.snapshot?.timeZone).toBe("America/New_York");
    // 10:45 in New York, an hour before 10:45 in Chicago.
    expect(
      read.snapshot?.assignments.find((entry) => entry.id === "precalc4-quiz4"),
    ).toMatchObject({
      help: "none",
      due: "2026-11-05T15:45:00.000Z",
      dueDate: "2026-11-05",
      dueTime: "10:45",
    });
  });

  test("reads every notice again when the student's time zone changes", async () => {
    const { school, google } = fixture();
    await school.current(CONTEXT);
    google.state.timeZone = "America/New_York";
    const read = await school.current(CONTEXT, { force: true });
    expect(google.count(GMAIL_READ)).toBe(4);
    expect(read.snapshot?.timeZone).toBe("America/New_York");
    // 11:59 PM in New York is an hour earlier than in Chicago.
    expect(
      read.snapshot?.assignments.find((entry) => entry.id === "chem2-lab6")
        ?.due,
    ).toBe("2026-11-06T04:59:00.000Z");
  });

  test("callers at the same moment share one sync", async () => {
    const { school, google } = fixture();
    const reads = await Promise.all([
      school.current(CONTEXT),
      school.current(CONTEXT),
      school.current(CONTEXT, { force: true }),
    ]);
    expect(google.count(GMAIL_SEARCH)).toBe(1);
    expect(reads[1]).toEqual(reads[0]);
    expect(reads[2]).toEqual(reads[0]);
    // Once it is done, a forced read starts a new one.
    await school.current(CONTEXT, { force: true });
    expect(google.count(GMAIL_SEARCH)).toBe(2);
  });

  test("a fresh copy is answered at once, even while a forced sync is under way", async () => {
    const { school, google } = fixture();
    const first = await school.current(CONTEXT);
    let release: () => void = () => {};
    google.state.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked = google.state.calls.length;
    const forced = school.current(CONTEXT, { force: true });
    // Under way once its first call has reached Google.
    while (google.state.calls.length === asked)
      await new Promise((resolve) => setTimeout(resolve, 1));
    // A second forced read joins the one under way; an ordinary one does not wait for it.
    const joined = school.current(CONTEXT, { force: true });
    expect(await school.current(CONTEXT)).toEqual(first);
    release();
    google.state.hold = null;
    expect(await joined).toEqual(await forced);
    expect(google.count(GMAIL_SEARCH)).toBe(2);
  });

  test("a Bot never given Gmail never gets the classes another Bot read, fresh or as a fallback", async () => {
    const { school, google, clock } = fixture();
    const own = await school.current(CONTEXT);
    google.state.ungranted.add(OTHER_BOT.botId);
    const refused = {
      snapshot: null,
      why: "This Bot hasn't been given Gmail, so your classes couldn't be read. Gmail needs to be turned on for this coach.",
    };
    // While the first Bot's copy is fresh, and once a failed read would fall back to it.
    expect(await school.current(OTHER_BOT)).toEqual(refused);
    clock.advance(15);
    expect(await school.current(OTHER_BOT)).toEqual(refused);
    expect(await school.current(OTHER_BOT, { force: true })).toEqual(refused);
    // The first Bot's own copy is untouched, and still its answer.
    expect(await school.stored(CONTEXT.actorId)).toEqual(own.snapshot);
    const again = await school.current(CONTEXT);
    expect(again.why).toBeNull();
    expect(again.snapshot?.classes).toHaveLength(2);
  });

  test("a Bot's read never waits on, or answers with, another Bot's read under way", async () => {
    const { school, google, clock } = fixture();
    await school.current(CONTEXT);
    clock.advance(15);
    google.state.ungranted.add(OTHER_BOT.botId);
    let release: () => void = () => {};
    google.state.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked = google.state.calls.length;
    const other = school.current(OTHER_BOT);
    while (google.state.calls.length === asked)
      await new Promise((resolve) => setTimeout(resolve, 1));
    // The copy is old, so this Bot reads again: for itself, not by joining the other's read.
    const own = school.current(CONTEXT);
    release();
    google.state.hold = null;
    expect((await own).why).toBeNull();
    expect((await own).snapshot?.classes).toHaveLength(2);
    expect((await other).snapshot).toBeNull();
    expect(
      google.state.calls
        .filter((call) => call.ref === GMAIL_SEARCH)
        .map((call) => call.botId)
        .sort(),
    ).toEqual([CONTEXT.botId, CONTEXT.botId, OTHER_BOT.botId]);
  });

  test("a second Bot given Gmail reads every notice for itself", async () => {
    const { school, google } = fixture();
    await school.current(CONTEXT);
    const other = await school.current(OTHER_BOT);
    expect(other.why).toBeNull();
    expect(other.snapshot?.classes).toHaveLength(2);
    // Nothing the first Bot read was handed over: the second read both notices itself.
    expect(
      google.state.calls.filter(
        (call) => call.ref === GMAIL_READ && call.botId === OTHER_BOT.botId,
      ),
    ).toHaveLength(2);
  });

  test("says Gmail isn't connected, and with nothing kept has no snapshot", async () => {
    const { school, google, store } = fixture();
    google.state.fail.set(CALENDAR_LIST, notConnected());
    google.state.fail.set(GMAIL_SEARCH, notConnected());
    expect(await school.current(CONTEXT)).toEqual({
      snapshot: null,
      why: "Gmail isn't connected, so your classes couldn't be read. Connect Google on the Connections page.",
    });
    expect(await store.get("jordan", "school", "school:jordan")).toBeNull();
  });

  test("a failed read falls back to the kept copy and says why", async () => {
    const { school, google, clock } = fixture();
    const first = await school.current(CONTEXT);
    clock.advance(15);
    google.state.fail.set(GMAIL_SEARCH, UNAUTHORIZED);
    const read = await school.current(CONTEXT);
    expect(read.snapshot).toEqual(first.snapshot);
    expect(read.why).toBe(
      `Your classes couldn't be read from Gmail. ${UNAUTHORIZED}`,
    );
  });

  test("names a reconnect, a shared account and a Bot without the tool in words to act on", async () => {
    const reasons: [Failure, string][] = [
      [
        new PluginRefusedError(
          connectAppRefusal({
            serverId: "google-workspace",
            title: "Gmail and Google Calendar",
            message:
              "Your Gmail and Google Calendar account needs reconnecting.",
            reason: "reconnect",
          }),
          null,
        ),
        "Gmail needs reconnecting, so your classes couldn't be read. Reconnect Google on the Connections page.",
      ],
      [
        new PluginRefusedError(
          connectAppRefusal({
            serverId: "google-workspace",
            title: "Gmail and Google Calendar",
            message: "Nobody has connected the team's account.",
            reason: "shared",
          }),
          null,
        ),
        "The shared Google account isn't connected, so your classes couldn't be read. An admin has to connect it.",
      ],
      [
        new PluginRefusedError(
          "This Bot has not been given the tool google-workspace/gmail_search_messages.",
          null,
        ),
        "This Bot hasn't been given Gmail, so your classes couldn't be read. Gmail needs to be turned on for this coach.",
      ],
    ];
    for (const [failure, sentence] of reasons) {
      const { school, google } = fixture();
      google.state.fail.set(GMAIL_SEARCH, failure);
      expect((await school.current(CONTEXT)).why).toBe(sentence);
    }
  });

  test("without the calendar's time zone, due times are read in UTC or the last zone known, and it says so", async () => {
    const { school, google, clock } = fixture();
    google.state.fail.set(CALENDAR_LIST, notConnected());
    const utc = await school.current(CONTEXT);
    expect(utc.why).toBeNull();
    expect(utc.snapshot?.timeZone).toBe("UTC");
    expect(utc.snapshot?.couldNotRead).toEqual([
      "Google Calendar isn't connected, so your time zone couldn't be read. Due times are shown in UTC. Connect Google on the Connections page.",
    ]);
    expect(
      utc.snapshot?.assignments.find((entry) => entry.id === "chem2-lab6")?.due,
    ).toBe("2026-11-05T23:59:00.000Z");

    // Once a zone was known, it is the one used while the calendar cannot be read.
    google.state.fail.delete(CALENDAR_LIST);
    await school.current(CONTEXT, { force: true });
    clock.advance(1);
    google.state.timeZone = "UTC";
    google.state.zoneNote =
      "Your calendar's time zone could not be read, so today was taken to end at midnight UTC.";
    const kept = await school.current(CONTEXT, { force: true });
    expect(kept.snapshot?.timeZone).toBe("America/Chicago");
    expect(kept.snapshot?.couldNotRead).toEqual([
      "Google Calendar didn't say which time zone you're in. Due times use your last known time zone, America/Chicago.",
    ]);
  });

  test("an email that can't be read is said and read again next time, and what was read is kept", async () => {
    const { school, google } = fixture();
    await school.current(CONTEXT);
    const fresh: Mail = {
      id: "18f0a1b2c3d4e600",
      from: CHEN,
      subject: 'Missing: "Section 4.3 homework"',
      date: "2026-11-04T12:05:00.000Z",
      body: [
        "Precalculus · Period 4 · Mr. Chen",
        "Missing",
        "Section 4.3 homework",
        "Due: Tue, Nov 3, 2026, 11:59 PM",
        "",
        "Open: https://classroom.google.com/c/precalc4/a/hw43",
      ].join("\n"),
    };
    google.state.mail.push(fresh);
    google.state.unreadable.add(fresh.id);
    const partial = await school.current(CONTEXT, { force: true });
    expect(partial.why).toBeNull();
    expect(partial.snapshot?.couldNotRead).toEqual([
      "1 Classroom email couldn't be read, so some assignments may be missing. It'll be read again next time.",
    ]);
    // The teacher's rule read before is still there; only the new email is missing.
    expect(
      partial.snapshot?.assignments.map((entry) => [entry.id, entry.help]),
    ).toEqual([
      ["precalc4-quiz4", "none"],
      ["chem2-lab6", "hints"],
    ]);

    google.state.unreadable.clear();
    const whole = await school.current(CONTEXT, { force: true });
    expect(whole.snapshot?.couldNotRead).toEqual([]);
    expect(whole.snapshot?.assignments.map((entry) => entry.id)).toContain(
      "precalc4-hw43",
    );
  });

  test("when no Classroom email can be read at all, nothing is replaced", async () => {
    const { school, google } = fixture();
    google.state.fail.set(
      GMAIL_READ,
      new PluginRefusedError(
        "This Bot has not been given the tool google-workspace/gmail_read_message.",
        null,
      ),
    );
    expect(await school.current(CONTEXT)).toEqual({
      snapshot: null,
      why: "This Bot hasn't been given Gmail, so your Classroom emails couldn't be read. Your classes weren't updated. Gmail needs to be turned on for this coach.",
    });
  });

  test("reads at most the 40 newest notices, and says so", async () => {
    const many: Mail[] = Array.from({ length: 45 }, (_, index) => ({
      ...LAB6,
      id: `18f0a1b2c3d4${String(index).padStart(4, "0")}`,
      date: new Date(Date.parse(LAB6.date) + index * 60_000).toISOString(),
      body: LAB6.body.replace("Lab 6", `Lab ${index}`),
    }));
    const { school, google } = fixture({ mail: [...many, COACH] });
    const read = await school.current(CONTEXT);
    expect(google.count(GMAIL_READ)).toBe(40);
    expect(read.snapshot?.couldNotRead).toEqual([
      "Only your 40 newest Classroom emails from the last 30 days were read. Older ones weren't checked.",
    ]);
  });

  test("Gmail's estimate of the matches says nothing unless the page was full", async () => {
    const { school, google } = fixture();
    // Gmail's estimate is often far off; with three messages listed, three is all there were.
    google.state.estimate = 201;
    const read = await school.current(CONTEXT);
    expect(read.snapshot?.couldNotRead).toEqual([]);
    expect(read.snapshot?.assignments).toHaveLength(2);
  });

  test("a kept copy that no longer reads is no copy, and is read afresh", async () => {
    const { school, google, store } = fixture();
    await store.put("jordan", {
      id: "school:jordan",
      kind: "school",
      data: { snapshot: { classes: "not a list" } },
    });
    expect(await school.stored("jordan")).toBeNull();
    const read = await school.current(CONTEXT);
    expect(google.count(GMAIL_SEARCH)).toBe(1);
    expect(read.snapshot?.classes).toHaveLength(2);
  });

  test("a copy that cannot be saved is still the answer", async () => {
    const google = fakeGoogle();
    const memory = createMemoryStudyStore();
    const failing: StudyStore = {
      ...memory,
      put: async () => {
        throw new Error("the database is down");
      },
    };
    const school = createSchoolService({
      store: failing,
      callTool: google.callTool,
      now: () => new Date("2026-11-04T15:00:00.000Z"),
    });
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const read = await school.current(CONTEXT);
      expect(read.why).toBeNull();
      expect(read.snapshot?.classes).toHaveLength(2);
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
  });
});

/*
 * The real thing: the fake Google's demo student, read through the real Gmail and Calendar adapter
 * over a socket, exactly as a deployment pointed at the fake reads it.
 */
describe("the demo student, through the real adapter", () => {
  const NOW = Date.parse("2026-11-04T15:00:00.000Z");
  let fake: FakeGoogle;
  let connection: { url: string; token: string };

  async function signIn(base: string): Promise<string> {
    const redirect = "http://127.0.0.1:3001/api/plugins/oauth/callback";
    const consent = await fetch(
      `${base}/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent(redirect)}`,
      { redirect: "manual" },
    );
    const code =
      new URL(consent.headers.get("location") ?? "").searchParams.get("code") ??
      "";
    const tokens = await fetch(`${base}/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: "test-client",
        redirect_uri: redirect,
      }),
    });
    return ((await tokens.json()) as { access_token: string }).access_token;
  }

  const through =
    (target: { url: string; token: string }): CallTool =>
    async (input) => {
      const result = await googleWorkspace(
        target,
        input.ref.split("/")[1] ?? "",
        input.args,
      );
      return { text: result.text, isError: result.isError };
    };

  beforeAll(async () => {
    fake = startFakeGoogle({ persona: "student", now: () => NOW });
    connection = { url: fake.url, token: await signIn(fake.url) };
  });

  afterAll(async () => {
    await fake.stop();
  });

  test("every Classroom notice in the student's mailbox parses", async () => {
    const mailbox = readFileSync(
      new URL(
        "../../scripts/fake-google/student-mailbox.jsonl",
        import.meta.url,
      ),
      "utf8",
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { from: string });
    const notices = mailbox.filter((seed) =>
      seed.from.endsWith("<no-reply@classroom.google.com>"),
    );
    expect(notices.length).toBe(12);

    const store = createMemoryStudyStore({ now: () => new Date(NOW) });
    const school = createSchoolService({
      store,
      callTool: through(connection),
      now: () => new Date(NOW),
    });
    const read = await school.current(CONTEXT);
    expect(read.why).toBeNull();
    expect(read.snapshot?.couldNotRead).toEqual([]);

    const record = await store.get("jordan", "school", "school:jordan");
    const kept = Object.values(
      (record?.data.notices ?? {}) as Record<string, unknown>,
    );
    // Every notice the mailbox holds was read and parsed: none came back as "not a notice".
    expect(kept).toHaveLength(notices.length);
    expect(kept.every((notice) => notice !== null)).toBe(true);
  });

  test("builds the demo's classes and assignments, due this week wherever today is", async () => {
    const school = createSchoolService({
      store: createMemoryStudyStore({ now: () => new Date(NOW) }),
      callTool: through(connection),
      now: () => new Date(NOW),
    });
    const { snapshot } = await school.current(CONTEXT);
    if (!snapshot) throw new Error("no snapshot");
    const today = zonedParts(new Date(NOW), "America/Chicago").date;
    expect(snapshot.timeZone).toBe("America/Chicago");
    expect(
      snapshot.classes.map((entry) => [
        entry.id,
        entry.name,
        entry.teacher,
        entry.period,
        entry.color,
      ]),
    ).toEqual([
      ["apush1", "AP US History", "Mr. Grant", "Period 1", "sky"],
      ["chem2", "Chemistry", "Dr. Okoro", "Period 2", "violet"],
      ["eng11", "English 11", "Ms. Alvarez", "Period 3", "teal"],
      ["precalc4", "Precalculus", "Mr. Chen", "Period 4", "amber"],
      ["spanish5", "Spanish III", "Sra. Morales", "Period 5", "rose"],
    ]);
    expect(
      snapshot.assignments.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        status: entry.status,
        due: entry.dueDate && `${entry.dueDate} ${entry.dueTime}`,
        help: entry.help,
        minutes: entry.minutes,
        grade: entry.grade,
      })),
    ).toEqual([
      {
        id: "precalc4-hw43",
        kind: "assignment",
        status: "missing",
        due: `${addDays(today, -1)} 23:59`,
        help: "full",
        minutes: 45,
        grade: null,
      },
      {
        id: "precalc4-quiz4",
        kind: "quiz",
        status: "open",
        due: `${addDays(today, 1)} 10:45`,
        help: "full",
        minutes: 60,
        grade: null,
      },
      {
        id: "chem2-lab6",
        kind: "assignment",
        status: "open",
        due: `${addDays(today, 1)} 23:59`,
        help: "hints",
        minutes: 90,
        grade: null,
      },
      {
        id: "apush1-dbq3",
        kind: "assignment",
        status: "open",
        due: `${addDays(today, 2)} 08:00`,
        help: "none",
        minutes: 120,
        grade: null,
      },
      {
        // Three days from Wednesday is a Saturday, so the test is on Monday, in class.
        id: "spanish5-u5test",
        kind: "test",
        status: "open",
        due: `${addDays(today, 5)} 12:20`,
        help: "full",
        minutes: 60,
        grade: null,
      },
      {
        id: "eng11-gatsby",
        kind: "assignment",
        status: "open",
        due: `${addDays(today, 6)} 23:59`,
        help: "hints",
        minutes: 150,
        grade: null,
      },
      {
        id: "apush1-dbqdocs",
        kind: "material",
        status: "open",
        due: null,
        help: "none",
        minutes: 0,
        grade: null,
      },
      {
        id: "chem2-lab5",
        kind: "assignment",
        status: "returned",
        due: null,
        help: null,
        minutes: 90,
        grade: "34/40",
      },
    ]);
    for (const entry of snapshot.assignments)
      expect(entry.noticeId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("a sync, then the fake started again on a later day, gives the later day's due dates", async () => {
    // Rehearsed on a Tuesday and the copy kept, as Postgres keeps it; then a new fake on Thursday.
    let clock = Date.parse("2026-11-03T15:00:00.000Z");
    let target = { url: "", token: "" };
    let reads = 0;
    const school = createSchoolService({
      store: createMemoryStudyStore({ now: () => new Date(clock) }),
      callTool: async (input) => {
        if (input.ref === GMAIL_READ) reads++;
        return through(target)(input);
      },
      now: () => new Date(clock),
    });
    const dueDates = (snapshot: SchoolSnapshot | null) =>
      Object.fromEntries(
        (snapshot?.assignments ?? []).flatMap((entry) =>
          entry.dueDate
            ? [[entry.id, `${entry.dueDate} ${entry.dueTime}`]]
            : [],
        ),
      );

    let rehearsed: SchoolSnapshot | null = null;
    const tuesday = startFakeGoogle({ persona: "student", now: () => clock });
    try {
      target = { url: tuesday.url, token: await signIn(tuesday.url) };
      rehearsed = (await school.current(CONTEXT)).snapshot;
    } finally {
      await tuesday.stop();
    }
    expect(dueDates(rehearsed)).toEqual({
      "precalc4-hw43": "2026-11-02 23:59",
      "precalc4-quiz4": "2026-11-04 10:45",
      "chem2-lab6": "2026-11-04 23:59",
      "apush1-dbq3": "2026-11-05 08:00",
      "spanish5-u5test": "2026-11-06 12:20",
      "eng11-gatsby": "2026-11-09 23:59",
    });
    expect(reads).toBe(12);

    clock = Date.parse("2026-11-05T15:00:00.000Z");
    const thursday = startFakeGoogle({ persona: "student", now: () => clock });
    try {
      target = { url: thursday.url, token: await signIn(thursday.url) };
      const read = await school.current(CONTEXT, { force: true });
      expect(read.why).toBeNull();
      expect(dueDates(read.snapshot)).toEqual({
        "precalc4-hw43": "2026-11-04 23:59",
        "precalc4-quiz4": "2026-11-06 10:45",
        "chem2-lab6": "2026-11-06 23:59",
        // Two and three days from Thursday are the weekend, so both are on Monday.
        "apush1-dbq3": "2026-11-09 08:00",
        "spanish5-u5test": "2026-11-09 12:20",
        "eng11-gatsby": "2026-11-11 23:59",
      });
      // Thursday's mail is other messages, and every one was read.
      const before = new Map(
        rehearsed?.assignments.map((entry) => [entry.id, entry.noticeId]),
      );
      for (const entry of read.snapshot?.assignments ?? [])
        expect(entry.noticeId).not.toBe(before.get(entry.id) ?? "");
      expect(reads).toBe(24);

      // Reset later the same day, the ids stay but every date moved, so each is read again.
      clock += 30 * 60_000;
      thursday.reset();
      const reset = await school.current(CONTEXT, { force: true });
      expect(reset.why).toBeNull();
      expect(dueDates(reset.snapshot)).toEqual(dueDates(read.snapshot));
      expect(reads).toBe(36);
    } finally {
      await thursday.stop();
    }
  });

  test("the student's calendar is a school week, served across days by timeMin and timeMax", async () => {
    const today = zonedParts(new Date(NOW), "America/Chicago").date;
    const answer = await googleWorkspace(connection, "calendar_list_events", {
      timeMin: new Date(NOW - 2 * 86_400_000).toISOString(),
      timeMax: new Date(NOW + 2 * 86_400_000).toISOString(),
      maxResults: 50,
    });
    expect(answer.isError).toBe(false);
    const events = (
      JSON.parse(answer.text) as {
        events: {
          id: string;
          summary: string;
          start: string;
          status: string;
        }[];
      }
    ).events;
    const on = (date: string) =>
      events.filter((event) => event.start.startsWith(date));
    // Yesterday, today and tomorrow are school days (2026-11-04 is a Wednesday).
    for (const date of [addDays(today, -1), today, addDays(today, 1)])
      expect(on(date).map((event) => event.summary)).toEqual(
        expect.arrayContaining([
          "AP US History (Mr. Grant)",
          "Chemistry (Dr. Okoro)",
          "English 11 (Ms. Alvarez)",
          "Precalculus (Mr. Chen)",
          "Spanish III (Sra. Morales)",
          "Soccer practice",
        ]),
      );
    expect(
      on(today).find((event) => event.summary === "Debate club prep"),
    ).toMatchObject({
      start: `${today}T19:30:00-06:00`,
      status: "tentative",
    });
    expect(on(today).map((event) => event.summary)).toContain(
      "Chem lab help session",
    );
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    // Before the window, nothing: the day before yesterday is out of it.
    expect(on(addDays(today, -3))).toEqual([]);
  });

  test("a school week across the clocks going back keeps every class at its own local time", async () => {
    // Saturday 31 October 2026, 10:00 CDT: classes still today, none on Sunday, CST from Monday.
    const saturday = Date.parse("2026-10-31T15:00:00.000Z");
    const weekend = startFakeGoogle({
      persona: "student",
      now: () => saturday,
    });
    try {
      const target = { url: weekend.url, token: await signIn(weekend.url) };
      const answer = await googleWorkspace(target, "calendar_list_events", {
        timeMin: "2026-10-30T05:00:00.000Z",
        timeMax: "2026-11-03T06:00:00.000Z",
        maxResults: 50,
      });
      const events = (
        JSON.parse(answer.text) as {
          events: { summary: string; start: string }[];
        }
      ).events;
      const history = events
        .filter((event) => event.summary === "AP US History (Mr. Grant)")
        .map((event) => event.start);
      expect(history).toEqual([
        "2026-10-30T08:00:00-05:00",
        "2026-10-31T08:00:00-05:00",
        "2026-11-02T08:00:00-06:00",
      ]);
      expect(
        events
          .filter((event) => event.summary === "Soccer practice")
          .map((event) => event.start),
      ).toEqual(["2026-11-02T15:30:00-06:00"]);
      expect(
        events.find((event) => event.summary === "Dentist appointment")?.start,
      ).toBe("2026-11-02T16:15:00-06:00");

      // The mailbox's due dates are written against that Saturday, on school days: the lab is due
      // tomorrow, which is a Sunday, so it is due on Monday instead.
      const school = createSchoolService({
        store: createMemoryStudyStore(),
        callTool: through(target),
        now: () => new Date(saturday),
      });
      const { snapshot } = await school.current(CONTEXT);
      expect(
        snapshot?.assignments.find((entry) => entry.id === "chem2-lab6"),
      ).toMatchObject({
        dueDate: "2026-11-02",
        dueTime: "23:59",
        // Monday 2 November is CST, though that Saturday was CDT.
        due: "2026-11-03T05:59:00.000Z",
      });
      // The calendar keeps the deadline on the same Monday as the notice.
      const deadlines = await googleWorkspace(target, "calendar_list_events", {
        timeMin: "2026-10-31T05:00:00.000Z",
        timeMax: "2026-11-03T06:00:00.000Z",
        maxResults: 50,
      });
      expect(
        (
          JSON.parse(deadlines.text) as {
            events: { summary: string; start: string }[];
          }
        ).events.find((event) => event.summary === "Chem lab report due")
          ?.start,
      ).toBe("2026-11-02");
    } finally {
      await weekend.stop();
    }
  });
});
