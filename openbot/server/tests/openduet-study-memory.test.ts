import { describe, expect, test } from "bun:test";
import {
  dueAfter,
  keyOf,
  levelOf,
  masteryOf,
  nextBox,
  nextMisconceptions,
  overviewOf,
  type StudyTopic,
} from "../src/openduet/study-memory";

const now = new Date("2026-11-05T21:00:00Z");

describe("Leitner boxes", () => {
  test("a right answer moves up a box, never past 5", () => {
    expect(nextBox(1, "correct")).toBe(2);
    expect(nextBox(4, "correct")).toBe(5);
    expect(nextBox(5, "correct")).toBe(5);
  });
  test("partly right stays, a miss goes back to box 1", () => {
    expect(nextBox(3, "partly")).toBe(3);
    expect(nextBox(5, "missed")).toBe(1);
  });
  test("out-of-range boxes are clamped before moving", () => {
    expect(nextBox(0, "partly")).toBe(1);
    expect(nextBox(9, "partly")).toBe(5);
  });
  test("box 1 comes back the next morning, box 5 about two weeks out", () => {
    // Practiced at 9 PM: due 12 hours early, so 9 AM the next day.
    expect(dueAfter(now, 1).toISOString()).toBe("2026-11-06T09:00:00.000Z");
    expect(dueAfter(now, 5).toISOString()).toBe("2026-11-21T09:00:00.000Z");
  });
});

describe("mastery", () => {
  test("nothing practiced is 0 and new", () => {
    const mastery = masteryOf({
      box: 1,
      correctCount: 0,
      partlyCount: 0,
      missedCount: 0,
    });
    expect(mastery).toBe(0);
    expect(levelOf(mastery, 0)).toBe("new");
  });
  test("box 5 with every answer right is 100 and strong", () => {
    const mastery = masteryOf({
      box: 5,
      correctCount: 4,
      partlyCount: 0,
      missedCount: 0,
    });
    expect(mastery).toBe(100);
    expect(levelOf(mastery, 4)).toBe("strong");
  });
  test("a single miss is shaky", () => {
    const mastery = masteryOf({
      box: 1,
      correctCount: 0,
      partlyCount: 0,
      missedCount: 1,
    });
    expect(mastery).toBe(0);
    expect(levelOf(mastery, 1)).toBe("shaky");
  });
  test("partly counts half", () => {
    expect(
      masteryOf({ box: 1, correctCount: 0, partlyCount: 2, missedCount: 0 }),
    ).toBe(20);
  });
});

describe("mistakes", () => {
  test("a new note is added once, even when said again in other case", () => {
    let items = nextMisconceptions(
      [],
      {
        result: "missed",
        misconception: "Thinks mass changes acceleration due to gravity",
      },
      now,
    );
    items = nextMisconceptions(
      items,
      {
        result: "missed",
        misconception: "thinks mass changes acceleration due to gravity ",
      },
      now,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.fixedAt).toBeUndefined();
  });
  test("fixed closes every open note", () => {
    const items = nextMisconceptions(
      [
        { note: "a", at: now.toISOString() },
        { note: "b", at: now.toISOString() },
      ],
      { result: "correct", fixed: true },
      now,
    );
    expect(items.every((item) => item.fixedAt)).toBe(true);
  });
  test("only the five newest open notes are kept", () => {
    let items: ReturnType<typeof nextMisconceptions> = [];
    for (const note of ["1", "2", "3", "4", "5", "6", "7"])
      items = nextMisconceptions(
        items,
        { result: "missed", misconception: note },
        now,
      );
    expect(items.map((item) => item.note)).toEqual(["3", "4", "5", "6", "7"]);
  });
});

function topic(overrides: Partial<StudyTopic>): StudyTopic {
  return {
    id: overrides.topic ?? "t",
    subject: "Physics",
    topic: "t",
    box: 1,
    mastery: 50,
    level: "getting-there",
    correctCount: 1,
    partlyCount: 0,
    missedCount: 1,
    lastResult: "correct",
    lastActivity: "quiz",
    openMistakes: [],
    fixedMistakes: 0,
    due: false,
    dueAt: "2026-11-07T09:00:00.000Z",
    lastPracticedAt: "2026-11-04T09:00:00.000Z",
    ...overrides,
  };
}

describe("overview", () => {
  test("groups classes case-insensitively and ranks the weakest class first", () => {
    const overview = overviewOf(
      [
        topic({
          subject: "Physics",
          topic: "Forces",
          mastery: 80,
          level: "strong",
        }),
        topic({ subject: "physics", topic: "Energy", mastery: 60 }),
        topic({
          subject: "Latin",
          topic: "Ablative",
          mastery: 20,
          level: "shaky",
          due: true,
          dueAt: "2026-11-05T09:00:00.000Z",
          openMistakes: ["Confuses ablative and dative"],
        }),
      ],
      now,
    );
    expect(
      overview.subjects.map((s) => [s.subject, s.mastery, s.topics]),
    ).toEqual([
      ["Latin", 20, 1],
      ["Physics", 70, 2],
    ]);
    expect(overview.totals).toEqual({
      topics: 3,
      due: 1,
      strong: 1,
      openMistakes: 1,
      practicedThisWeek: 3,
    });
    expect(overview.due.map((t) => t.topic)).toEqual(["Ablative"]);
    expect(overview.weakest[0]?.topic).toBe("Ablative");
    expect(overview.mistakes).toEqual([
      {
        topicId: "Ablative",
        subject: "Latin",
        topic: "Ablative",
        note: "Confuses ablative and dative",
      },
    ]);
  });
  test("keys ignore case and extra spaces", () => {
    expect(keyOf("  Newton's   Second Law ")).toBe("newton's second law");
  });
});
