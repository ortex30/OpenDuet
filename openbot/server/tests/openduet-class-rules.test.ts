import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunAgentInput } from "@ag-ui/client";
import {
  FIRST_DAY_REQUEST_SCHOOL,
  firstDayGreeting,
  readFirstDay,
} from "@openbot/shared/first-day";
import { classRulesText, withClassRules } from "../src/openduet/class-rules";
import { loadPrivatePack } from "../src/openduet/private-pack";
import { schoolSnapshotFromPack } from "../src/openduet/study/craft";
import { buildGuideInput } from "../src/openduet/study/notes-input";
import { resolveStudyTarget } from "../src/openduet/study/rules";

function packDir() {
  const root = mkdtempSync(join(tmpdir(), "rules-"));
  mkdirSync(join(root, "materials"), { recursive: true });
  writeFileSync(
    join(root, "materials/calc.md"),
    "# Unit 5\n\nThe fundamental theorem of calculus relates an integral to the antiderivative evaluated at the bounds.\n",
  );
  writeFileSync(
    join(root, "classes.json"),
    JSON.stringify({
      timezone: "America/Chicago",
      school: "Example",
      classes: [
        {
          id: "calc-bc",
          name: "AP Calculus BC",
          short_name: "Calc BC",
          status: "Current",
          materials: ["materials/calc.md"],
        },
        {
          id: "chem",
          name: "Advanced Chemistry",
          short_name: "Adv Chem",
          status: "Current",
          materials: ["materials/calc.md"],
        },
      ],
    }),
  );
  writeFileSync(
    join(root, "assignments_and_tests.json"),
    JSON.stringify({
      current_term_2026_2027: [
        {
          name: "Unit 5 Quest",
          class_id: "calc-bc",
          type: "quest",
          due: "2026-11-11",
        },
      ],
    }),
  );
  return root;
}

test("Calculus resolves to hints and chemistry stays no help", () => {
  const pack = loadPrivatePack(packDir());
  const now = new Date("2026-11-10T18:00:00.000Z");
  const snapshot = schoolSnapshotFromPack(pack, now);
  const calculus = resolveStudyTarget(
    snapshot,
    { classes: {}, assignments: {} },
    { className: "Calculus" },
    now,
  );
  expect(calculus.ok).toBe(true);
  if (!calculus.ok) return;
  expect(calculus.className).toBe("AP Calculus BC");
  expect(calculus.level).toBe("hints");
  const calc = buildGuideInput(pack, { className: "Calc BC" }, now);
  expect(calc.classId).toBe("calc-bc");
  expect(calc.help).toBe("hints");
  const text = classRulesText(pack);
  expect(text).toContain("AP Calculus BC (Calc BC): Hints only.");
  expect(text).toContain("Advanced Chemistry (Adv Chem): No help.");
  expect(text).toContain("Never say the AI help level is unavailable");
});

test("the school-pack first day does not mention connecting mail", () => {
  const message = firstDayGreeting("school");
  expect(readFirstDay(message)).toBe(FIRST_DAY_REQUEST_SCHOOL);
  expect(message).not.toContain("aren't connected");
  expect(message).not.toContain("google-workspace");
});

test("class rules are added to a run only when the pack is on", () => {
  const input = {
    threadId: "t",
    runId: "r",
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  } as RunAgentInput;
  expect(withClassRules(input, {})).toBe(input);
  const root = packDir();
  const next = withClassRules(input, {
    ACADEMIC_OS_PRIVATE_DEMO: "1",
    ACADEMIC_OS_DATA_DIR: root,
  });
  expect(next.context.some((entry) => entry.value.includes("Hints only"))).toBe(
    true,
  );
  expect(next).not.toBe(input);
});
