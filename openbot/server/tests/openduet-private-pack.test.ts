import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  helpForClass,
  loadEnabledPack,
  loadPrivatePack,
  materialHeadings,
  packCalendarSlice,
  privateDemoRequested,
  privateDemoSummary,
  studyGuideFromPack,
} from "../src/openduet/private-pack";

function writePack(root: string) {
  mkdirSync(join(root, "materials"), { recursive: true });
  writeFileSync(
    join(root, "classes.json"),
    JSON.stringify({
      timezone: "America/Chicago",
      school: "Example School",
      classes: [
        {
          id: "chem",
          name: "Advanced Chemistry",
          status: "Current",
          block: "5",
          teachers: [
            { name: "Ms. Albach", confidence: "course instructor (team)" },
          ],
          materials: ["materials/chem.md"],
        },
        {
          id: "calc-bc",
          name: "AP Calculus BC",
          status: "Current",
          block: "4",
          teachers: [{ name: "Mr. Otto", confidence: "confirmed" }],
          materials: ["materials/calc-unit5-review.md"],
        },
        {
          id: "babson",
          name: "Summer program",
          status: "Past",
          teachers: [],
          materials: [],
        },
      ],
    }),
  );
  writeFileSync(
    join(root, "assignments_and_tests.json"),
    JSON.stringify({
      current_term_2026_2027: [
        {
          name: "AP Calculus BC - Unit 5 Quest",
          class_id: "calc-bc",
          type: "quest / test",
          due: "2026-11-11",
        },
        {
          name: "Advanced Chemistry - Summative Exam 3",
          class_id: "chem",
          type: "exam",
          due: "2026-11-12",
        },
        {
          name: "Dropped class homework",
          class_id: "babson",
          type: "homework",
          due: "2026-11-11",
        },
      ],
      historical_unconfirmed_spring_2026: {
        note: "Not live.",
        items: [
          { name: "WHAP timeline", due: "2026-04-21" },
          { name: "CSP exam", due: "2026-04-21" },
        ],
      },
    }),
  );
  writeFileSync(
    join(root, "materials/calc-unit5-review.md"),
    "# Unit 5\n\n## Antiderivatives\n\n## FTC\n\n## Accumulation\n",
  );
  writeFileSync(join(root, "materials/chem.md"), "# Units 1-2\n");
}

test("chemistry is no help and an unrecorded class stays at hints", () => {
  expect(helpForClass("chem", "Advanced Chemistry")).toBe("none");
  expect(helpForClass("calc-bc", "AP Calculus BC")).toBe("hints");
});

test("the pack keeps current classes and drops the spring rows and past courses", () => {
  const root = mkdtempSync(join(tmpdir(), "pack-"));
  writePack(root);
  const pack = loadPrivatePack(root);
  expect(pack.school).toBe("Example School");
  expect(pack.classes.map((row) => row.id)).toEqual(["chem", "calc-bc"]);
  expect(pack.classes.find((row) => row.id === "calc-bc")?.teacher).toBe(
    "Mr. Otto",
  );
  expect(pack.classes.find((row) => row.id === "chem")?.help).toBe("none");
  expect(pack.historicalExcluded).toBe(2);
  expect(pack.assignments.map((row) => row.title)).toEqual([
    "AP Calculus BC - Unit 5 Quest",
    "Advanced Chemistry - Summative Exam 3",
  ]);
  expect(pack.assignments[0]?.kind).toBe("test");
  expect(pack.assignments[0]?.help).toBe("hints");
  expect(pack.assignments[1]?.help).toBe("none");
  const summary = privateDemoSummary(pack);
  expect(summary.assignments[0]?.dueAt).toBe("2026-11-11T15:00:00.000Z");
  expect(summary.historicalExcluded).toBe(2);
});

test("the calendar slice uses weekdays in range and skips the chemistry deadline's help", () => {
  const root = mkdtempSync(join(tmpdir(), "pack-"));
  writePack(root);
  const pack = loadPrivatePack(root);
  const slice = packCalendarSlice(
    pack,
    "2026-11-10",
    "2026-11-12",
    new Date("2026-11-10T18:00:00.000Z"),
  );
  expect(slice.today).toBe("2026-11-10");
  // Quests and exams sit at 9:00 on their due day. Block numbers are not hours.
  expect(slice.events.map((event) => [event.date, event.start])).toEqual([
    ["2026-11-11", "09:00"],
    ["2026-11-12", "09:00"],
  ]);
  expect(slice.events.every((event) => event.end === "10:00")).toBe(true);
  expect(slice.deadlines).toEqual([]);
  const guide = studyGuideFromPack(
    pack,
    (file) => readFile(root, file),
    "2026-11-10",
  );
  expect(guide?.classId).toBe("calc-bc");
  expect(guide?.blocks.find((block) => block.type === "bullets")).toEqual({
    type: "bullets",
    items: ["Unit 5", "Antiderivatives", "FTC", "Accumulation"],
  });
});

test("the demo flag is what turns the pack on", () => {
  expect(privateDemoRequested({})).toBe(false);
  expect(privateDemoRequested({ ACADEMIC_OS_PRIVATE_DEMO: "1" })).toBe(true);
  const root = mkdtempSync(join(tmpdir(), "pack-"));
  writePack(root);
  expect(
    loadEnabledPack({
      ACADEMIC_OS_PRIVATE_DEMO: "1",
      ACADEMIC_OS_DATA_DIR: root,
    })?.school,
  ).toBe("Example School");
  expect(loadEnabledPack({ ACADEMIC_OS_DATA_DIR: root })).toBeNull();
});

test("headings stay short and unique", () => {
  expect(materialHeadings("# One\n# One\n## Two\n")).toEqual(["One", "Two"]);
});

function readFile(root: string, file: string) {
  return readFileSync(join(root, file), "utf8");
}
