import { describe, expect, test } from "bun:test";
import { CLASS_COLORS } from "@openbot/shared/study";
import {
  blockMinutes,
  classColorVar,
  clockMinutes,
  dayLabel,
  formatMinutes,
  formatTimeRange,
  plural,
  shuffled,
} from "@/components/duet/study";

/*
 * The words and numbers the study cards print. The spaces that hold a number to its unit are
 * no-break spaces, so these compare with them folded back into plain ones, as Testing Library does.
 */

const plain = (text: string) => text.replace(/ /g, " ");

describe("lengths", () => {
  test("minutes and hours, as the plan's heading says them", () => {
    expect(plain(formatMinutes(45))).toBe("45 min");
    expect(plain(formatMinutes(60))).toBe("1 h");
    expect(plain(formatMinutes(150))).toBe("2 h 30 min");
    expect(plain(formatMinutes(0))).toBe("0 min");
    expect(plain(formatMinutes(-5))).toBe("0 min");
    expect(plain(formatMinutes(Number.NaN))).toBe("0 min");
  });

  test("a number never wraps away from its unit", () => {
    expect(formatMinutes(150)).toBe("2 h 30 min");
  });

  test("a block's length from its two times, 0 when either is not a time", () => {
    expect(blockMinutes("16:05", "16:50")).toBe(45);
    expect(blockMinutes("23:15", "24:00")).toBe(45);
    expect(blockMinutes("16:50", "16:05")).toBe(0);
    expect(blockMinutes("4pm", "16:50")).toBe(0);
    expect(clockMinutes("24:01")).toBeNull();
    expect(clockMinutes("12:60")).toBeNull();
  });

  test("one session, three sessions", () => {
    expect(plural(1, "session", "sessions")).toBe("1 session");
    expect(plural(3, "session", "sessions")).toBe("3 sessions");
    expect(plural(0, "session", "sessions")).toBe("0 sessions");
  });
});

describe("times", () => {
  test("AM or PM once when both ends share it, at each end when they don't", () => {
    expect(plain(formatTimeRange("16:05", "16:50"))).toBe("4:05 – 4:50 PM");
    expect(plain(formatTimeRange("11:30", "12:15"))).toBe(
      "11:30 AM – 12:15 PM",
    );
    expect(plain(formatTimeRange("09:00", "09:30"))).toBe("9:00 – 9:30 AM");
    expect(plain(formatTimeRange("00:00", "00:45"))).toBe("12:00 – 12:45 AM");
    expect(plain(formatTimeRange("23:15", "24:00"))).toBe(
      "11:15 PM – 12:00 AM",
    );
  });

  test("a time it cannot read is printed as it came", () => {
    expect(plain(formatTimeRange("after school", "17:00"))).toBe(
      "after school – 17:00",
    );
  });
});

describe("days", () => {
  test("Today and Tomorrow from the student's today, then the date", () => {
    expect(dayLabel("2026-11-04", "2026-11-04")).toBe("Today");
    expect(dayLabel("2026-11-05", "2026-11-04")).toBe("Tomorrow");
    expect(dayLabel("2026-11-06", "2026-11-04")).toBe("Fri, Nov 6");
    // Across a month and a year.
    expect(dayLabel("2027-01-01", "2026-12-31")).toBe("Tomorrow");
    expect(dayLabel("2026-11-03", "2026-11-04")).toBe("Tue, Nov 3");
  });

  test("without a today it never guesses one", () => {
    expect(dayLabel("2026-11-04")).toBe("Wed, Nov 4");
    expect(dayLabel("2026-11-04", null)).toBe("Wed, Nov 4");
    expect(dayLabel("someday", "2026-11-04")).toBe("someday");
  });
});

describe("colours and order", () => {
  test("every class colour is a duet token, never a raw colour", () => {
    for (const color of CLASS_COLORS)
      expect(classColorVar(color)).toMatch(/^var\(--duet-[a-z0-9-]+\)$/);
    expect(new Set(CLASS_COLORS.map(classColorVar)).size).toBe(
      CLASS_COLORS.length,
    );
  });

  test("a shuffle keeps every item and never hands back the same order", () => {
    const items = ["a", "b", "c", "d", "e"];
    let seed = 7;
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    for (let run = 0; run < 50; run++) {
      const order = shuffled(items, random);
      expect([...order].sort()).toEqual(items);
      expect(order).not.toEqual(items);
    }
    // A random source that never moves anything still moves something.
    expect(shuffled(["a", "b"], () => 0.999)).toEqual(["b", "a"]);
    expect(shuffled(["a"])).toEqual(["a"]);
    expect(shuffled([])).toEqual([]);
    expect(items).toEqual(["a", "b", "c", "d", "e"]);
  });
});
