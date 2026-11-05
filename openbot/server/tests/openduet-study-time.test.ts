import { describe, expect, test } from "bun:test";
import {
  addDays,
  clockOf,
  formatDay,
  isDate,
  isTimeZone,
  minutesOf,
  weekdayOf,
  zonedInstant,
  zonedParts,
} from "../src/openduet/study/time";

/*
 * The time helpers the scheduler, the calendar and the Classroom parser stand on. Chicago is the
 * demo student's zone, and its clocks went back on Sunday 2026-11-01 at 02:00 CDT (07:00 UTC), to
 * 01:00 CST: that day has 25 hours and 01:30 happens twice. They went forward on 2026-03-08 at
 * 02:00 CST (08:00 UTC), so that day has 23 hours and 02:30 never happens.
 */

const CHICAGO = "America/Chicago";
const at = (iso: string) => new Date(iso);

describe("zonedParts", () => {
  test("reads the student's own day, time, minute and weekday", () => {
    expect(zonedParts(at("2026-11-04T15:00:00Z"), CHICAGO)).toEqual({
      date: "2026-11-04",
      time: "09:00",
      minute: 540,
      weekday: 3,
    });
  });

  test("puts an instant before local midnight on the day before, wherever UTC's day is", () => {
    expect(zonedParts(at("2026-11-05T05:59:59.999Z"), CHICAGO)).toMatchObject({
      date: "2026-11-04",
      time: "23:59",
      minute: 1439,
    });
    expect(zonedParts(at("2026-11-05T06:00:00Z"), CHICAGO)).toMatchObject({
      date: "2026-11-05",
      time: "00:00",
      minute: 0,
      weekday: 4,
    });
  });

  test("reads both 1:30s on the day Chicago's clocks go back", () => {
    // 06:30 UTC is 01:30 CDT, an hour later it is 01:30 again, now CST.
    expect(zonedParts(at("2026-11-01T06:30:00Z"), CHICAGO).time).toBe("01:30");
    expect(zonedParts(at("2026-11-01T07:30:00Z"), CHICAGO).time).toBe("01:30");
    expect(zonedParts(at("2026-11-01T07:00:00Z"), CHICAGO).time).toBe("01:00");
    expect(zonedParts(at("2026-11-01T06:59:00Z"), CHICAGO).time).toBe("01:59");
  });

  test("handles zones with half-hour offsets and UTC itself", () => {
    expect(zonedParts(at("2026-11-04T18:30:00Z"), "Asia/Kolkata").time).toBe(
      "00:00",
    );
    expect(zonedParts(at("2026-11-04T18:30:00Z"), "UTC")).toMatchObject({
      date: "2026-11-04",
      time: "18:30",
    });
  });

  test("refuses a zone Intl does not know, and an invalid instant, in a sentence", () => {
    expect(() =>
      zonedParts(at("2026-11-04T15:00:00Z"), "Mars/Olympus"),
    ).toThrow('"Mars/Olympus" is not a time zone this server knows.');
    expect(() => zonedParts(new Date(Number.NaN), CHICAGO)).toThrow(
      "That is not a real moment.",
    );
  });
});

describe("zonedInstant", () => {
  test("is the instant a Chicago clock reads that time, in either offset", () => {
    expect(zonedInstant("2026-11-06", "23:59", CHICAGO).toISOString()).toBe(
      "2026-11-07T05:59:00.000Z",
    );
    expect(zonedInstant("2026-07-04", "09:00", CHICAGO).toISOString()).toBe(
      "2026-07-04T14:00:00.000Z",
    );
  });

  test("round-trips with zonedParts every quarter hour across the change of clocks", () => {
    for (const date of ["2026-10-31", "2026-11-01", "2026-11-02"])
      for (let minute = 0; minute < 24 * 60; minute += 15) {
        const time = clockOf(minute);
        // 01:00 to 01:59 on the 1st happens twice; the round trip holds for the first of them.
        const parts = zonedParts(zonedInstant(date, time, CHICAGO), CHICAGO);
        expect(`${parts.date} ${parts.time}`).toBe(`${date} ${time}`);
      }
  });

  test("takes the first of a repeated time: 01:30 CDT, not 01:30 CST", () => {
    expect(zonedInstant("2026-11-01", "01:30", CHICAGO).toISOString()).toBe(
      "2026-11-01T06:30:00.000Z",
    );
    // An hour after the repeated hour began, the clocks are on CST.
    expect(zonedInstant("2026-11-01", "02:00", CHICAGO).toISOString()).toBe(
      "2026-11-01T08:00:00.000Z",
    );
  });

  test("moves a time the clocks skip forward by the length of the gap: 02:30 is 03:30 CDT", () => {
    const skipped = zonedInstant("2026-03-08", "02:30", CHICAGO);
    expect(skipped.toISOString()).toBe("2026-03-08T08:30:00.000Z");
    expect(zonedParts(skipped, CHICAGO).time).toBe("03:30");
    expect(zonedInstant("2026-03-08", "03:00", CHICAGO).toISOString()).toBe(
      "2026-03-08T08:00:00.000Z",
    );
  });

  test("makes the day the clocks go back 25 hours long, and the day they go forward 23", () => {
    const hours = (date: string) =>
      (zonedInstant(date, "24:00", CHICAGO).getTime() -
        zonedInstant(date, "00:00", CHICAGO).getTime()) /
      3_600_000;
    expect(hours("2026-11-01")).toBe(25);
    expect(hours("2026-03-08")).toBe(23);
    expect(hours("2026-11-04")).toBe(24);
  });

  test("reads 24:00 as the start of the next day", () => {
    expect(zonedInstant("2026-11-04", "24:00", CHICAGO)).toEqual(
      zonedInstant("2026-11-05", "00:00", CHICAGO),
    );
  });

  test("refuses a day that does not exist and a time that is not one", () => {
    expect(() => zonedInstant("2026-02-30", "09:00", CHICAGO)).toThrow(
      "Use a date such as 2026-11-06.",
    );
    expect(() => zonedInstant("2026-11-04", "9:00", CHICAGO)).toThrow(
      "Use a valid time, such as 18:00.",
    );
  });
});

describe("day arithmetic", () => {
  test("addDays crosses months, years and leap days, both ways", () => {
    expect(addDays("2026-11-04", 2)).toBe("2026-11-06");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-11-04", 0)).toBe("2026-11-04");
    // The day the clocks change is still one day.
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  test("addDays refuses part of a day", () => {
    expect(() => addDays("2026-11-04", 0.5)).toThrow(
      "Add a whole number of days.",
    );
  });

  test("weekdayOf counts from Sunday", () => {
    expect(weekdayOf("2026-11-01")).toBe(0);
    expect(weekdayOf("2026-11-04")).toBe(3);
    expect(weekdayOf("2026-11-07")).toBe(6);
  });

  test("isDate accepts real days only", () => {
    expect(isDate("2026-11-04")).toBe(true);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2026-13-01")).toBe(false);
    expect(isDate("2026-11-4")).toBe(false);
    expect(isDate("Nov 4")).toBe(false);
  });
});

describe("clock times", () => {
  test("minutesOf reads 00:00 to 24:00", () => {
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("08:45")).toBe(525);
    expect(minutesOf("23:59")).toBe(1439);
    expect(minutesOf("24:00")).toBe(1440);
  });

  test("minutesOf refuses anything else, in a plain sentence", () => {
    for (const bad of ["24:01", "25:00", "7:00", "12:60", "1200", "", "noon"])
      expect(() => minutesOf(bad)).toThrow("Use a valid time, such as 18:00.");
  });

  test("clockOf writes minutes back, and 1440 as 24:00", () => {
    expect(clockOf(0)).toBe("00:00");
    expect(clockOf(525)).toBe("08:45");
    expect(clockOf(1440)).toBe("24:00");
    for (const minute of [0, 1, 59, 60, 719, 1439, 1440])
      expect(minutesOf(clockOf(minute))).toBe(minute);
    for (const bad of [-1, 1441, 12.5, Number.NaN])
      expect(() => clockOf(bad)).toThrow(
        "Use a whole number of minutes from 0 to 1440.",
      );
  });
});

describe("isTimeZone", () => {
  test("knows the zones Intl knows", () => {
    expect(isTimeZone(CHICAGO)).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Asia/Kolkata")).toBe(true);
  });

  test("refuses everything else without throwing", () => {
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone("   ")).toBe(false);
  });
});

describe("formatDay", () => {
  test("says Today and Tomorrow, and the day itself otherwise", () => {
    expect(formatDay("2026-11-04", "2026-11-04")).toBe("Today");
    expect(formatDay("2026-11-05", "2026-11-04")).toBe("Tomorrow");
    expect(formatDay("2026-11-06", "2026-11-04")).toBe("Fri, Nov 6");
    expect(formatDay("2026-11-03", "2026-11-04")).toBe("Tue, Nov 3");
    expect(formatDay("2027-01-01", "2026-12-31")).toBe("Tomorrow");
    expect(formatDay("2027-01-02", "2026-12-31")).toBe("Sat, Jan 2");
  });

  test("refuses a day that is not one", () => {
    expect(() => formatDay("2026-11-31", "2026-11-04")).toThrow(
      "Use a date such as 2026-11-06.",
    );
  });
});
