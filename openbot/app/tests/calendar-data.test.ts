import { describe, expect, test } from "bun:test";
import {
  CLASS_COLORS,
  type CalendarEvent,
  type SchoolClass,
  type StudyBlock,
} from "@openbot/shared/study";
import {
  classColor,
  clockLabel,
  dayWindow,
  isCalendarDate,
  PROPOSED_ID_PREFIX,
  stepDay,
  toCalendarData,
  toCourses,
  UNCLASSED_COURSE_ID,
  visibleDates,
  weekDates,
  zonedNow,
} from "@/components/calendar/rebound/calendar-data";
import { COURSE_COLORS } from "@/components/calendar/rebound/lib/helpers";
import { usePace } from "@/components/calendar/rebound/lib/store";

/**
 * The adapter between Academic OS's calendar (shared/study.ts) and Rebound's timeline: Google events
 * become fixed commitments in their class's colour, applied study blocks become blocks, and a
 * proposed plan's blocks are laid over both, marked, without taking anything's place.
 */

const classes: SchoolClass[] = [
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
];

const apush: CalendarEvent = {
  id: "period1apush",
  title: "AP US History (Mr. Grant)",
  date: "2026-11-04",
  start: "08:00",
  end: "08:50",
  location: "Room 214",
  classId: "apush1",
};
const lunch: CalendarEvent = {
  id: "lunch",
  title: "Lunch",
  date: "2026-11-04",
  start: "11:40",
  end: "12:15",
};
const applied: StudyBlock = {
  id: "block-1",
  assignmentId: "chem-lab6",
  classId: "chem2",
  title: "Lab 6 report: data table",
  date: "2026-11-04",
  start: "18:00",
  end: "18:45",
};
const general: StudyBlock = {
  id: "block-2",
  assignmentId: null,
  classId: null,
  title: "Review notes",
  date: "2026-11-05",
  start: "16:00",
  end: "16:30",
};

describe("days", () => {
  test("a week runs Sunday to Saturday around the day, as Rebound's week view lays it out", () => {
    expect(weekDates("2026-11-04")).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
    ]);
    // Across a month's end, and from the Sunday itself.
    expect(weekDates("2026-11-01")[0]).toBe("2026-11-01");
    expect(weekDates("2026-10-31")).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
  });

  test("Day view shows the day alone, and a step is a day in Day view and a week in Week view", () => {
    expect(visibleDates("2026-11-04", "day")).toEqual(["2026-11-04"]);
    expect(visibleDates("2026-11-04", "week")).toHaveLength(7);
    expect(stepDay("2026-11-04", "day", 1)).toBe("2026-11-05");
    expect(stepDay("2026-11-01", "day", -1)).toBe("2026-10-31");
    expect(stepDay("2026-11-04", "week", -1)).toBe("2026-10-28");
    expect(stepDay("2026-12-28", "week", 1)).toBe("2027-01-04");
  });

  test("only a real day written YYYY-MM-DD is taken from a link", () => {
    expect(isCalendarDate("2026-11-04")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    for (const text of [
      "2026-02-30",
      "2026-13-01",
      "20261104",
      "2026-11-4",
      "",
      "tomorrow",
    ])
      expect([text, isCalendarDate(text)]).toEqual([text, false]);
  });
});

describe("colours", () => {
  test("every class colour the contract names is one of Rebound's course colours", () => {
    for (const color of CLASS_COLORS) {
      expect(Object.keys(COURSE_COLORS)).toContain(color);
      expect(classColor(color)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("each class becomes a course in its own colour, beside one neutral course for the rest", () => {
    expect(toCourses(classes)).toEqual([
      {
        id: "apush1",
        name: "AP US History",
        color: "rose",
        weeklyEffortMin: 0,
        createdAt: "",
      },
      {
        id: "chem2",
        name: "Chemistry",
        color: "teal",
        weeklyEffortMin: 0,
        createdAt: "",
      },
      {
        id: UNCLASSED_COURSE_ID,
        name: "",
        color: "slate",
        weeklyEffortMin: 0,
        createdAt: "",
      },
    ]);
  });
});

describe("toCalendarData", () => {
  test("a Google event is a fixed commitment under its class, and one with no class is neutral", () => {
    const data = toCalendarData({
      dates: ["2026-11-04"],
      classes,
      events: [apush, lunch],
      blocks: [],
    });
    expect(data.agendaByDate).toEqual([
      [
        {
          id: "event:period1apush",
          date: "2026-11-04",
          start: "08:00",
          end: "08:50",
          kind: "commitment",
          title: "AP US History (Mr. Grant)",
          courseId: "apush1",
        },
        {
          id: "event:lunch",
          date: "2026-11-04",
          start: "11:40",
          end: "12:15",
          kind: "commitment",
          title: "Lunch",
          courseId: UNCLASSED_COURSE_ID,
        },
      ],
    ]);
    // What the detail card reads back, under the timeline's own occurrence key.
    expect(data.items.get("2026-11-04::event:period1apush")).toEqual({
      kind: "event",
      key: "2026-11-04::event:period1apush",
      event: apush,
    });
  });

  test("a class the student does not have is not taken on trust: its event is drawn neutral", () => {
    const data = toCalendarData({
      dates: ["2026-11-04"],
      classes,
      events: [{ ...apush, id: "club", classId: "robotics" }],
      blocks: [],
    });
    expect(data.agendaByDate[0]?.[0]?.courseId).toBe(UNCLASSED_COURSE_ID);
  });

  test("an applied study block is a block in its class's colour, and general study is neutral", () => {
    const data = toCalendarData({
      dates: ["2026-11-04", "2026-11-05"],
      classes,
      events: [],
      blocks: [applied, general],
    });
    expect(data.allBlocks).toEqual([
      {
        id: "block:block-1",
        date: "2026-11-04",
        start: "18:00",
        end: "18:45",
        kind: "study",
        refId: "chem-lab6",
        title: "Lab 6 report: data table",
        courseId: "chem2",
        status: "todo",
      },
      {
        id: "block:block-2",
        date: "2026-11-05",
        start: "16:00",
        end: "16:30",
        kind: "study",
        refId: "block-2",
        title: "Review notes",
        courseId: UNCLASSED_COURSE_ID,
        status: "todo",
      },
    ]);
    expect(data.agendaByDate.map((day) => day.map((item) => item.id))).toEqual([
      ["block:block-1"],
      ["block:block-2"],
    ]);
    expect(data.agendaByDate[0]?.[0]?.kind).toBe("block");
    expect(data.agendaByDate[0]?.[0]?.block?.id).toBe("block:block-1");
    expect(data.items.get("2026-11-05::block:block-2")).toEqual({
      kind: "block",
      key: "2026-11-05::block:block-2",
      block: general,
      proposed: false,
    });
  });

  test("a proposed plan is laid over the applied blocks, marked, and replaces none of them", () => {
    // Its block shares an applied block's id and time: both stay, told apart by their ids.
    const proposed: StudyBlock[] = [
      { ...applied, title: "Lab 6 report: graph" },
      {
        ...general,
        id: "block-3",
        date: "2026-11-04",
        start: "20:00",
        end: "20:30",
      },
    ];
    const data = toCalendarData({
      dates: ["2026-11-04"],
      classes,
      events: [apush],
      blocks: [applied],
      proposed: [
        ...proposed,
        { ...general, id: "elsewhere", date: "2026-11-09" },
      ],
    });
    expect(data.agendaByDate[0]?.map((item) => [item.id, item.title])).toEqual([
      ["event:period1apush", "AP US History (Mr. Grant)"],
      ["block:block-1", "Lab 6 report: data table"],
      [`${PROPOSED_ID_PREFIX}block-1`, "Proposed: Lab 6 report: graph"],
      [`${PROPOSED_ID_PREFIX}block-3`, "Proposed: Review notes"],
    ]);
    // The store sees every block, the one on another day too; the applied one is untouched.
    expect(data.allBlocks.map((block) => block.id)).toEqual([
      "block:block-1",
      "proposed:block-1",
      "proposed:block-3",
      "proposed:elsewhere",
    ]);
    expect(data.allBlocks[0]).toMatchObject({
      title: "Lab 6 report: data table",
      courseId: "chem2",
    });
    // The card reads the plan's own title, without the words the timeline adds.
    expect(data.items.get("2026-11-04::proposed:block-1")).toEqual({
      kind: "block",
      key: "2026-11-04::proposed:block-1",
      block: proposed[0] as StudyBlock,
      proposed: true,
    });
  });

  test("only the days asked for are laid out, in their order", () => {
    const data = toCalendarData({
      dates: ["2026-11-05", "2026-11-04"],
      classes,
      events: [apush],
      blocks: [applied, general],
    });
    expect(data.agendaByDate.map((day) => day.map((item) => item.id))).toEqual([
      ["block:block-2"],
      ["event:period1apush", "block:block-1"],
    ]);
  });

  test("a time the timeline cannot draw is left out, and the same id twice on a day is drawn once", () => {
    const data = toCalendarData({
      dates: ["2026-11-04"],
      classes,
      events: [
        { ...lunch, id: "backwards", start: "13:00", end: "12:00" },
        { ...lunch, id: "words", start: "noon", end: "1pm" },
        { ...lunch, id: "late", start: "24:00", end: "24:00" },
        { ...lunch, id: "to-midnight", start: "22:30", end: "24:00" },
        apush,
        { ...apush, title: "A copy of period 1" },
      ],
      blocks: [{ ...applied, id: "bad", end: "25:00" }],
    });
    expect(data.agendaByDate[0]?.map((item) => item.id)).toEqual([
      "event:to-midnight",
      "event:period1apush",
    ]);
    expect(data.agendaByDate[0]?.[1]?.title).toBe("AP US History (Mr. Grant)");
    expect(data.allBlocks).toEqual([]);
  });
});

describe("read-only", () => {
  test("the store the timeline is given refuses every write, so a drag reached by accident fails", () => {
    expect(() => usePace.getState()).toThrow(
      "The calendar is read-only; plans change through Apply.",
    );
  });
});

describe("dayWindow", () => {
  test("draws 7 AM to 11 PM, widened to the hour around anything earlier or later, and now", () => {
    expect(dayWindow([[]])).toEqual({ wakeMinute: 420, sleepMinute: 1380 });
    const data = toCalendarData({
      dates: ["2026-11-04"],
      classes,
      events: [
        { ...lunch, id: "swim", start: "05:45", end: "06:30" },
        { ...lunch, id: "late", start: "23:10", end: "23:40" },
      ],
      blocks: [],
    });
    expect(dayWindow(data.agendaByDate)).toEqual({
      wakeMinute: 300,
      sleepMinute: 1440,
    });
    expect(dayWindow([[]], 6 * 60 + 15)).toEqual({
      wakeMinute: 360,
      sleepMinute: 1380,
    });
  });
});

describe("times", () => {
  test("a clock time is written as the timeline writes it, and an end at midnight is 12 AM", () => {
    expect(clockLabel("18:30")).toBe("6:30 PM");
    expect(clockLabel("08:00")).toBe("8 AM");
    expect(clockLabel("12:00")).toBe("12 PM");
    expect(clockLabel("00:00")).toBe("12 AM");
    // An event clipped at midnight ends at "24:00": the end of the day, not noon.
    expect(clockLabel("24:00")).toBe("12 AM");
  });

  test("now is the student's own day and minute in their zone, by this device's clock", () => {
    // 9 PM Wednesday in Chicago is 3 AM Thursday in UTC and noon Thursday in Tokyo.
    const evening = new Date("2026-11-05T03:00:00.000Z");
    expect(zonedNow(evening, "America/Chicago")).toEqual({
      day: "2026-11-04",
      minute: 21 * 60,
    });
    expect(zonedNow(evening, "UTC")).toEqual({
      day: "2026-11-05",
      minute: 180,
    });
    expect(zonedNow(evening, "Asia/Tokyo")).toEqual({
      day: "2026-11-05",
      minute: 12 * 60,
    });
    // Midnight starts a day at minute 0, never "24:00" of the day before.
    expect(
      zonedNow(new Date("2026-11-05T06:00:00.000Z"), "America/Chicago"),
    ).toEqual({ day: "2026-11-05", minute: 0 });
    expect(zonedNow(evening, "Mars/Olympus")).toBeNull();
  });
});
