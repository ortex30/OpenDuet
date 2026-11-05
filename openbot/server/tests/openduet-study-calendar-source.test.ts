import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectAppRefusal } from "@openbot/shared/connect-prompt";
import type { SchoolClass } from "@openbot/shared/study";
import {
  type FakeGoogle,
  startFakeGoogle,
} from "../../scripts/fake-google/server";
import { CALENDAR_LIST, type CallTool } from "../src/openduet/brief";
import {
  EVENTS_PER_CALL,
  readCalendar,
} from "../src/openduet/study/calendar-source";
import type { StudyContext } from "../src/openduet/study/contracts";
import { addDays, zonedInstant, zonedParts } from "../src/openduet/study/time";
import { callTool as googleWorkspace } from "../src/plugins/google-workspace-rest";
import { PluginRefusedError } from "../src/plugins/plugin-store/model";

/*
 * The student's Google Calendar as the plan tool, Apply and the Calendar tab read it: one local day
 * per request, each timed event on the student's own day and clock and split at midnight, all-day
 * events on every day they cover, events matched to classes by title, and anything that could not
 * be read said as a sentence. First against a stand-in that answers the way the Calendar adapter
 * does, then through the real adapter against the fake Google's demo student.
 */

const CONTEXT: StudyContext = {
  actorId: "jordan",
  botId: "academic-os",
  initiator: { kind: "person" },
};
const TZ = "America/Chicago";

type Seed = {
  id: string;
  summary?: string;
  /** RFC 3339 for a timed event, or "YYYY-MM-DD" for an all-day one (its end is the day after). */
  start: string;
  end: string;
  status?: "confirmed" | "tentative" | "cancelled";
  location?: string;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A timed seed at a Chicago wall-clock time, written as Google writes it for that zone. */
function at(
  date: string,
  start: string,
  end: string,
  id: string,
  summary = id,
) {
  return {
    id,
    summary,
    start: zonedInstant(date, start, TZ).toISOString(),
    end: zonedInstant(date, end, TZ).toISOString(),
  } satisfies Seed;
}

type Failure = Error | string | null;

/**
 * A stand-in for the plugin store's callTool over the Calendar adapter (google-workspace-rest.ts):
 * Google's bounds (timeMin against an event's end, timeMax against its start), start order, at
 * most maxResults (25 by default, 50 at most), and the calendar's zone named only when timeMax is
 * left out, or UTC with a note when the zone can't be read. `fail` answers a call instead.
 */
function calendarAdapter(
  seeds: Seed[],
  options: {
    timeZone?: string | null;
    fail?: (args: Record<string, unknown>) => Failure;
    text?: (args: Record<string, unknown>) => string | null;
  } = {},
) {
  const calls: Record<string, unknown>[] = [];
  const zone = options.timeZone === undefined ? TZ : options.timeZone;
  const span = (seed: Seed): [number, number] =>
    DATE_ONLY.test(seed.start)
      ? [
          zonedInstant(seed.start, "00:00", TZ).getTime(),
          zonedInstant(seed.end, "00:00", TZ).getTime(),
        ]
      : [Date.parse(seed.start), Date.parse(seed.end)];
  const callTool: CallTool = async (input) => {
    calls.push(input.args);
    expect(input.ref).toBe(CALENDAR_LIST);
    expect(input).toMatchObject(CONTEXT);
    const failure = options.fail?.(input.args) ?? null;
    if (failure instanceof Error) throw failure;
    if (typeof failure === "string") return { text: failure, isError: true };
    const text = options.text?.(input.args);
    if (typeof text === "string") return { text, isError: false };
    const max =
      input.args.maxResults === undefined ? 25 : Number(input.args.maxResults);
    if (!Number.isInteger(max) || max < 1 || max > 50)
      return {
        text: "maxResults must be a number from 1 to 50.",
        isError: true,
      };
    const timeMin =
      typeof input.args.timeMin === "string"
        ? Date.parse(input.args.timeMin)
        : Date.parse("2026-11-04T20:10:00.000Z");
    let named: Record<string, string> = {};
    let timeMax: number;
    if (typeof input.args.timeMax === "string")
      timeMax = Date.parse(input.args.timeMax);
    else {
      const day = zone ?? "UTC";
      named = zone
        ? { timeZone: zone }
        : {
            timeZone: "UTC",
            note: "Your calendar's time zone could not be read, so today was taken to end at midnight UTC.",
          };
      timeMax = zonedInstant(
        zonedParts(new Date(timeMin), day).date,
        "24:00",
        day,
      ).getTime();
    }
    const items = seeds
      .filter((seed) => {
        const [start, end] = span(seed);
        return end > timeMin && start < timeMax;
      })
      .sort((a, b) => span(a)[0] - span(b)[0])
      .slice(0, max)
      .map((seed) => ({
        id: seed.id,
        summary: seed.summary ?? "(no title)",
        start: seed.start,
        end: seed.end,
        ...(seed.location ? { location: seed.location } : {}),
        attendees: [],
        status: seed.status ?? "confirmed",
      }));
    return {
      text: JSON.stringify({ ...named, events: items }),
      isError: false,
    };
  };
  return { callTool, calls };
}

const CLASSES: SchoolClass[] = [
  {
    id: "apush1",
    name: "AP US History",
    teacher: "Mr. Grant",
    period: "Period 1",
    color: "sky",
  },
  {
    id: "chem2",
    name: "Chemistry",
    teacher: "Dr. Okoro",
    period: "Period 2",
    color: "violet",
  },
  {
    id: "apchem",
    name: "AP Chemistry",
    teacher: "Ms. Lee",
    period: null,
    color: "teal",
  },
  // Listed before Spanish III, so the longer name has to win on its own merits.
  {
    id: "spanish1",
    name: "Spanish",
    teacher: null,
    period: null,
    color: "orange",
  },
  {
    id: "spanish5",
    name: "Spanish III",
    teacher: "Sra. Morales",
    period: "Period 5",
    color: "rose",
  },
  { id: "art", name: "Art", teacher: null, period: null, color: "lime" },
];

describe("reading the calendar", () => {
  test("asks for one local day at a time, 50 at most, so a week one call couldn't hold is read whole", async () => {
    // Nine a day for a week: 63 events, more than one call answers.
    const seeds: Seed[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays("2026-10-29", offset);
      for (let hour = 8; hour < 17; hour++)
        seeds.push(
          at(
            date,
            `${String(hour).padStart(2, "0")}:00`,
            `${String(hour).padStart(2, "0")}:50`,
            `block${hour}-${date}`,
          ),
        );
    }
    const google = calendarAdapter(seeds);
    const once = await google.callTool({
      ref: CALENDAR_LIST,
      args: {
        timeMin: zonedInstant("2026-10-29", "00:00", TZ).toISOString(),
        timeMax: zonedInstant("2026-11-04", "24:00", TZ).toISOString(),
        maxResults: 50,
      },
      ...CONTEXT,
    });
    expect(JSON.parse(once.text).events).toHaveLength(50);

    google.calls.length = 0;
    const read = await readCalendar(
      google.callTool,
      CONTEXT,
      { from: "2026-10-29", to: "2026-11-04" },
      { timeZone: TZ },
    );
    expect(read.couldNotRead).toEqual([]);
    expect(read.events).toHaveLength(63);
    expect(google.calls).toHaveLength(7);
    for (const call of google.calls)
      expect(call.maxResults).toBe(EVENTS_PER_CALL);
    // Each day from its own midnight to the next, the 25-hour day the clocks went back included.
    const window = (date: string) =>
      google.calls.find(
        (call) =>
          call.timeMin === zonedInstant(date, "00:00", TZ).toISOString(),
      );
    expect(window("2026-11-01")).toEqual({
      timeMin: "2026-11-01T05:00:00.000Z",
      timeMax: "2026-11-02T06:00:00.000Z",
      maxResults: 50,
    });
    expect(window("2026-10-31")?.timeMax).toBe("2026-11-01T05:00:00.000Z");
    expect(read.events[0]).toEqual({
      id: "block8-2026-10-29",
      title: "block8-2026-10-29",
      date: "2026-10-29",
      start: "08:00",
      end: "08:50",
    });
  });

  test("learns the student's zone from the calendar when it isn't given", async () => {
    const google = calendarAdapter([
      at("2026-11-04", "19:30", "20:15", "debate", "Debate club prep"),
    ]);
    const read = await readCalendar(google.callTool, CONTEXT, {
      from: "2026-11-04",
      to: "2026-11-04",
    });
    expect(read.timeZone).toBe(TZ);
    // Asked with no timeMax, the adapter names the zone; one event is all that answer needs.
    expect(google.calls[0]).toEqual({ maxResults: 1 });
    expect(read.events).toEqual([
      {
        id: "debate",
        title: "Debate club prep",
        date: "2026-11-04",
        start: "19:30",
        end: "20:15",
      },
    ]);
  });

  test("reads in UTC and says so when the calendar names no zone", async () => {
    const google = calendarAdapter(
      [at("2026-11-04", "19:30", "20:15", "debate")],
      { timeZone: null },
    );
    const read = await readCalendar(google.callTool, CONTEXT, {
      from: "2026-11-05",
      to: "2026-11-05",
    });
    expect(read.timeZone).toBe("UTC");
    expect(read.couldNotRead).toEqual([
      "Google Calendar didn't say which time zone you're in, so times are shown in UTC.",
    ]);
    // 7:30 PM in Chicago is 1:30 AM the next day in UTC.
    expect(read.events).toMatchObject([
      { id: "debate", date: "2026-11-05", start: "01:30", end: "02:15" },
    ]);
  });

  test("puts each event on the student's own day and clock, whatever offset Google wrote", async () => {
    const google = calendarAdapter([
      {
        id: "utc",
        start: "2026-11-05T01:30:00Z",
        end: "2026-11-05T02:00:00Z",
      },
      {
        id: "eastern",
        start: "2026-11-04T20:30:00-05:00",
        end: "2026-11-04T21:00:00-05:00",
      },
      {
        id: "central",
        start: "2026-11-04T08:00:00-06:00",
        end: "2026-11-04T08:50:00-06:00",
      },
      // 1:30 happens twice the night the clocks go back: once before the change, once after.
      {
        id: "first-1-30",
        start: "2026-11-01T01:30:00-05:00",
        end: "2026-11-01T01:45:00-05:00",
      },
      {
        id: "second-1-30",
        start: "2026-11-01T01:30:00-06:00",
        end: "2026-11-01T01:45:00-06:00",
      },
      // Across the change: 45 minutes that read 1:30 to 1:15 on the wall.
      {
        id: "across",
        start: "2026-11-01T01:30:00-05:00",
        end: "2026-11-01T01:15:00-06:00",
      },
    ]);
    const read = await readCalendar(
      google.callTool,
      CONTEXT,
      { from: "2026-11-01", to: "2026-11-04" },
      { timeZone: TZ },
    );
    const times = Object.fromEntries(
      read.events.map((event) => [
        event.id,
        `${event.date} ${event.start}-${event.end}`,
      ]),
    );
    expect(times).toEqual({
      utc: "2026-11-04 19:30-20:00",
      eastern: "2026-11-04 19:30-20:00",
      central: "2026-11-04 08:00-08:50",
      "first-1-30": "2026-11-01 01:30-01:45",
      "second-1-30": "2026-11-01 01:30-01:45",
      across: "2026-11-01 01:30-02:15",
    });
  });

  test("splits an event at midnight and keeps only the days asked for, each piece once", async () => {
    const google = calendarAdapter([
      {
        id: "late",
        summary: "Late study group",
        start: "2026-11-04T23:00:00-06:00",
        end: "2026-11-05T01:00:00-06:00",
      },
      {
        id: "trip",
        summary: "Field trip",
        start: "2026-11-03T20:00:00-06:00",
        end: "2026-11-07T09:00:00-06:00",
      },
      {
        id: "to-midnight",
        start: "2026-11-05T22:00:00-06:00",
        end: "2026-11-06T00:00:00-06:00",
      },
    ]);
    const read = await readCalendar(
      google.callTool,
      CONTEXT,
      { from: "2026-11-04", to: "2026-11-06" },
      { timeZone: TZ },
    );
    expect(
      read.events.map(
        (event) => `${event.id} ${event.date} ${event.start}-${event.end}`,
      ),
    ).toEqual([
      "trip 2026-11-04 00:00-24:00",
      "late 2026-11-04 23:00-24:00",
      "late 2026-11-05 00:00-01:00",
      "trip 2026-11-05 00:00-24:00",
      "to-midnight 2026-11-05 22:00-24:00",
      "trip 2026-11-06 00:00-24:00",
    ]);
  });

  test("a whole day is midnight to midnight, the 23-hour day the clocks go forward too", async () => {
    const google = calendarAdapter([
      {
        id: "retreat",
        start: "2026-03-07T20:00:00-06:00",
        end: "2026-03-09T09:00:00-05:00",
      },
    ]);
    const read = await readCalendar(
      google.callTool,
      CONTEXT,
      { from: "2026-03-08", to: "2026-03-08" },
      { timeZone: TZ },
    );
    expect(read.events).toMatchObject([
      { id: "retreat", date: "2026-03-08", start: "00:00", end: "24:00" },
    ]);
  });

  test("an all-day event is on every day it covers, and never a timed one", async () => {
    const google = calendarAdapter([
      {
        id: "chemlabdue",
        summary: "Chem lab report due",
        start: "2026-11-05",
        end: "2026-11-06",
      },
      {
        id: "spirit",
        summary: "Spirit week",
        start: "2026-11-02",
        end: "2026-11-07",
      },
    ]);
    const read = await readCalendar(
      google.callTool,
      CONTEXT,
      { from: "2026-11-05", to: "2026-11-08" },
      { timeZone: TZ },
    );
    expect(read.events).toEqual([]);
    expect(read.allDay).toEqual([
      { id: "chemlabdue", title: "Chem lab report due", date: "2026-11-05" },
      { id: "spirit", title: "Spirit week", date: "2026-11-05" },
      { id: "spirit", title: "Spirit week", date: "2026-11-06" },
    ]);
  });

  test("an all-day event keeps its own days when the student's zone isn't the calendar's", async () => {
    // Google spans it in the calendar's zone (Chicago), so New York's next day overlaps its last hour.
    const google = calendarAdapter([
      {
        id: "chemlabdue",
        summary: "Chem lab report due",
        start: "2026-11-05",
        end: "2026-11-06",
      },
    ]);
    const read = await readCalendar(
      google.callTool,
      CONTEXT,
      { from: "2026-11-05", to: "2026-11-06" },
      { timeZone: "America/New_York" },
    );
    expect(read.allDay).toEqual([
      { id: "chemlabdue", title: "Chem lab report due", date: "2026-11-05" },
    ]);
  });

  test("names the class an event is for, by whole words", async () => {
    const day = "2026-11-04";
    const google = calendarAdapter([
      at(day, "08:00", "08:50", "p1", "AP US History (Mr. Grant)"),
      at(day, "08:55", "09:45", "p2", "Chemistry (Dr. Okoro)"),
      at(day, "10:00", "10:30", "review", "AP Chemistry review"),
      at(day, "12:20", "13:10", "p5", "Spanish III (Sra. Morales)"),
      at(day, "14:45", "15:15", "help", "Chem lab help session"),
      at(day, "15:30", "16:00", "board", "Smart board training"),
      at(day, "20:30", "21:00", "vocab", "Study for Spanish 3 vocab"),
    ]);
    const read = await readCalendar(
      google.callTool,
      CONTEXT,
      { from: day, to: day },
      { timeZone: TZ, classes: CLASSES },
    );
    expect(
      Object.fromEntries(
        read.events.map((event) => [event.id, event.classId ?? null]),
      ),
    ).toEqual({
      p1: "apush1",
      p2: "chem2",
      review: "apchem",
      p5: "spanish5",
      help: null,
      board: null,
      vocab: "spanish5",
    });
  });

  test("keeps where an event is, and leaves out cancelled ones and ones with no length", async () => {
    const day = "2026-11-04";
    const google = calendarAdapter([
      {
        ...at(day, "15:30", "17:30", "soccer", "Soccer practice"),
        location: "Field B",
      },
      {
        ...at(day, "16:00", "17:00", "cancelled", "Cancelled tutoring"),
        status: "cancelled",
      },
      {
        ...at(day, "19:30", "20:15", "debate", "Debate club prep"),
        status: "tentative",
      },
      at(day, "18:00", "18:00", "instant", "A reminder"),
    ]);
    const read = await readCalendar(
      google.callTool,
      CONTEXT,
      { from: day, to: day },
      { timeZone: TZ },
    );
    expect(read.events).toEqual([
      {
        id: "soccer",
        title: "Soccer practice",
        date: day,
        start: "15:30",
        end: "17:30",
        location: "Field B",
      },
      // Tentative is still on their calendar, so it still takes the time.
      {
        id: "debate",
        title: "Debate club prep",
        date: day,
        start: "19:30",
        end: "20:15",
      },
    ]);
  });

  describe("what could not be read", () => {
    const refusal = (reason?: "reconnect" | "shared") =>
      new PluginRefusedError(
        connectAppRefusal({
          serverId: "google-workspace",
          title: "Gmail and Google Calendar",
          message:
            "You have not connected your Gmail and Google Calendar account. Connect it and ask again.",
          ...(reason ? { reason } : {}),
        }),
        null,
      );
    const UNAUTHORIZED =
      "Google Calendar refused this request (401): Request had invalid authentication credentials.";
    const cases: [string, Failure, string][] = [
      [
        "not connected",
        refusal(),
        "Google Calendar isn't connected, so your calendar couldn't be read. Connect Google on the Connections page.",
      ],
      [
        "to reconnect",
        refusal("reconnect"),
        "Google Calendar needs reconnecting, so your calendar couldn't be read. Reconnect Google on the Connections page.",
      ],
      [
        "a shared account nobody connected",
        refusal("shared"),
        "The shared Google account isn't connected, so your calendar couldn't be read. An admin has to connect it.",
      ],
      [
        "a Bot without the tool",
        new PluginRefusedError(
          "This Bot has not been given the tool google-workspace/calendar_list_events.",
          null,
        ),
        "This Bot hasn't been given Google Calendar, so your calendar couldn't be read. Ask an admin to give it Google Calendar.",
      ],
      [
        "Google's own refusal",
        UNAUTHORIZED,
        `Your calendar couldn't be read from Google Calendar. ${UNAUTHORIZED}`,
      ],
    ];
    for (const [name, failure, sentence] of cases)
      test(`${name} is one sentence however many days it hit, never a throw`, async () => {
        const google = calendarAdapter([], { fail: () => failure });
        const read = await readCalendar(
          google.callTool,
          CONTEXT,
          { from: "2026-11-04", to: "2026-11-06" },
          { timeZone: TZ },
        );
        expect(read).toEqual({
          timeZone: TZ,
          events: [],
          allDay: [],
          couldNotRead: [sentence],
        });
        expect(google.calls).toHaveLength(3);
      });

    test("a day that failed is named, and the rest are still read", async () => {
      const thursday = zonedInstant("2026-11-05", "00:00", TZ).toISOString();
      const google = calendarAdapter(
        [
          at("2026-11-04", "15:30", "17:30", "wed"),
          at("2026-11-05", "15:30", "17:30", "thu"),
          at("2026-11-06", "15:30", "17:30", "fri"),
        ],
        {
          fail: (args) =>
            args.timeMin === thursday
              ? "Google Calendar refused this request (503): Backend Error."
              : null,
        },
      );
      const read = await readCalendar(
        google.callTool,
        CONTEXT,
        { from: "2026-11-04", to: "2026-11-06" },
        { timeZone: TZ },
      );
      expect(read.events.map((event) => event.id)).toEqual(["wed", "fri"]);
      expect(read.couldNotRead).toEqual([
        "Your calendar for Thu Nov 5 couldn't be read from Google Calendar. Google Calendar refused this request (503): Backend Error.",
      ]);
    });

    test("a day that came back full says so", async () => {
      const seeds = Array.from({ length: 55 }, (_, index) =>
        at(
          "2026-11-04",
          `${String(8 + Math.floor(index / 6)).padStart(2, "0")}:${String((index % 6) * 10).padStart(2, "0")}`,
          `${String(8 + Math.floor(index / 6)).padStart(2, "0")}:${String((index % 6) * 10 + 5).padStart(2, "0")}`,
          `busy${index}`,
        ),
      );
      const read = await readCalendar(
        calendarAdapter(seeds).callTool,
        CONTEXT,
        { from: "2026-11-04", to: "2026-11-04" },
        { timeZone: TZ },
      );
      expect(read.events).toHaveLength(50);
      expect(read.couldNotRead).toEqual([
        "Only the first 50 events were read on Wed Nov 4.",
      ]);
    });

    test("an answer that can't be read says so", async () => {
      const read = await readCalendar(
        calendarAdapter([], { text: () => "<html>Service Unavailable</html>" })
          .callTool,
        CONTEXT,
        { from: "2026-11-04", to: "2026-11-05" },
        { timeZone: TZ },
      );
      expect(read.couldNotRead).toEqual([
        "Google Calendar sent your calendar in a way that couldn't be read. Try again in a minute.",
      ]);
    });

    test("a calendar that won't say its zone is said once, and no day is asked for", async () => {
      const google = calendarAdapter([], { fail: () => refusal() });
      const read = await readCalendar(google.callTool, CONTEXT, {
        from: "2026-11-04",
        to: "2026-11-10",
      });
      expect(read).toEqual({
        timeZone: "UTC",
        events: [],
        allDay: [],
        couldNotRead: [
          "Google Calendar isn't connected, so your calendar couldn't be read. Connect Google on the Connections page.",
        ],
      });
      expect(google.calls).toHaveLength(1);
    });
  });

  test("refuses a range that isn't one", async () => {
    const { callTool } = calendarAdapter([]);
    const read = (from: string, to: string) =>
      readCalendar(callTool, CONTEXT, { from, to }, { timeZone: TZ });
    await expect(read("2026-11-05", "2026-11-04")).rejects.toThrow(RangeError);
    await expect(read("2026-02-30", "2026-03-01")).rejects.toThrow(RangeError);
    await expect(read("2026-11-01", "2026-12-15")).rejects.toThrow(
      "Read at most 31 days at a time.",
    );
  });
});

describe("the demo student's week, through the real adapter", () => {
  // Wednesday, November 4, 2026, at 2:10 PM in Chicago.
  const NOW = Date.parse("2026-11-04T20:10:00.000Z");
  let fake: FakeGoogle;
  let callTool: CallTool;
  const asked: Record<string, unknown>[] = [];

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

  beforeAll(async () => {
    fake = startFakeGoogle({ persona: "student", now: () => NOW });
    const connection = { url: fake.url, token: await signIn(fake.url) };
    callTool = async (input) => {
      asked.push(input.args);
      const result = await googleWorkspace(
        connection,
        input.ref.split("/")[1] ?? "",
        input.args,
      );
      return { text: result.text, isError: result.isError };
    };
  });

  afterAll(async () => {
    await fake.stop();
  });

  test("reads every event of the school week, which one call would cut off", async () => {
    const today = zonedParts(new Date(NOW), TZ).date;
    const range = { from: addDays(today, -1), to: addDays(today, 6) };
    const whole = await callTool({
      ref: CALENDAR_LIST,
      args: {
        timeMin: zonedInstant(range.from, "00:00", TZ).toISOString(),
        timeMax: zonedInstant(range.to, "24:00", TZ).toISOString(),
        maxResults: 50,
      },
      ...CONTEXT,
    });
    expect(JSON.parse(whole.text).events).toHaveLength(50);

    asked.length = 0;
    const read = await readCalendar(callTool, CONTEXT, range, {
      classes: CLASSES,
    });
    expect(read.timeZone).toBe(TZ);
    expect(read.couldNotRead).toEqual([]);
    expect(read.events.length + read.allDay.length).toBeGreaterThan(50);
    // The zone, then one call per day.
    expect(asked).toHaveLength(9);
    expect(asked.every((args) => Number(args.maxResults) <= 50)).toBe(true);

    const todays = read.events.filter((event) => event.date === today);
    expect(
      todays.map((event) => [
        event.title,
        event.start,
        event.end,
        event.classId ?? null,
      ]),
    ).toEqual([
      ["AP US History (Mr. Grant)", "08:00", "08:50", "apush1"],
      ["Chemistry (Dr. Okoro)", "08:55", "09:45", "chem2"],
      ["English 11 (Ms. Alvarez)", "09:50", "10:40", null],
      ["Precalculus (Mr. Chen)", "10:45", "11:35", null],
      ["Lunch", "11:40", "12:15", null],
      ["Spanish III (Sra. Morales)", "12:20", "13:10", "spanish5"],
      ["Study hall", "13:15", "14:05", null],
      ["Chem lab help session", "14:45", "15:15", null],
      ["Soccer practice", "15:30", "17:30", null],
      ["Debate club prep", "19:30", "20:15", null],
    ]);
    expect(todays.find((event) => event.title === "Soccer practice")).toEqual(
      expect.objectContaining({ location: "Field B" }),
    );
    expect(read.allDay).toEqual([
      {
        id: "chemlabdue",
        title: "Chem lab report due",
        date: addDays(today, 1),
      },
      {
        id: "precalcquiz",
        title: "Precalc quiz: Unit 4 trig identities",
        date: addDays(today, 1),
      },
      { id: "apushdbq", title: "APUSH DBQ essay due", date: addDays(today, 2) },
      {
        id: "spanishvocab",
        title: "Spanish vocab test: Unidad 5",
        date: addDays(today, 5),
      },
      {
        id: "englishessay",
        title: "English: Gatsby essay due",
        date: addDays(today, 6),
      },
    ]);
  });
});
