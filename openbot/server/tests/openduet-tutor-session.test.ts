import { expect, test } from "bun:test";
import type { GuideInput } from "../src/openduet/study/craft";
import {
  applyOpening,
  applyReply,
  localReply,
  openTutor,
  type TutorOpening,
} from "../src/openduet/study/tutor-session";

const NOTES = `# The Civil War

## Emancipation

The Emancipation Proclamation in 1863 freed enslaved people in Confederate-held territory and let Black men join the Union army. It did not free people in the border states.
`;

const input: GuideInput = {
  classId: "apush",
  className: "AP United States History",
  help: "hints",
  focus: "Civil War",
  due: null,
  notes: "",
  files: [{ path: "notes.md", markdown: NOTES }],
};

test("a wrong answer gets a simpler check, and a right one asks for teach-back", async () => {
  const opening = await openTutor(input, "Emancipation", {});
  if ("refused" in opening) throw new Error(opening.refused);
  const weak = localReply(opening, "It was a war.", "check");
  expect(weak.understood).toBe(false);
  expect(weak.adjustment).toBeTruthy();
  expect(weak.nextCheck).toBeTruthy();
  const strong = localReply(opening, opening.explanation, "check");
  expect(strong.understood).toBe(true);
  expect(strong.teachBack).toContain("Teach");
});

test("chemistry is refused", async () => {
  const refused = await openTutor(
    { ...input, className: "Advanced Chemistry", help: "none" },
    "moles",
    {},
  );
  expect(refused).toEqual({
    refused:
      "Advanced Chemistry is set to no AI help. Review your own notes, and don't ask for the graded work.",
  });
});

test("a file comment is not the example", () => {
  const opening: TutorOpening = {
    topic: "FTC",
    explanation:
      "The integral of a rate from a to b is the net change in that quantity.",
    example:
      "The integral of a rate from a to b is the net change in that quantity.",
    check: "What does the integral of a rate mean?",
    expects: ["net change"],
  };
  const kept = applyOpening(
    opening,
    {
      explanation:
        "The integral of a rate from a to b is the net change in that quantity.",
      example:
        "<!-- Source: box study guide for AP Calculus BC Unit 5, reviewed Nov 9, 2026.",
      check: "What does the integral of a rate mean in your notes?",
    },
    "The integral of a rate from a to b is the net change in that quantity. <!-- Source: box study guide",
  );
  expect(kept.example).not.toContain("<!--");
  expect(kept.example).not.toContain("Source:");
});

test("a model explanation that leaves the notes is ignored", () => {
  const opening: TutorOpening = {
    topic: "Emancipation",
    explanation:
      "The Emancipation Proclamation in 1863 freed enslaved people in Confederate-held territory.",
    example: "It let Black men join the Union army.",
    check: "What did the proclamation do?",
    expects: ["1863"],
  };
  const kept = applyOpening(
    opening,
    {
      explanation: "The proclamation ended slavery on the moon in 1969.",
      example: "Astronauts were freed too.",
      check: "Why the moon?",
    },
    NOTES,
  );
  expect(kept.explanation).toBe(opening.explanation);
});

test("the model cannot call a short wrong answer understood", () => {
  const opening: TutorOpening = {
    topic: "Emancipation",
    explanation:
      "The Emancipation Proclamation in 1863 freed enslaved people in Confederate-held territory.",
    example: "It let Black men join the Union army.",
    check: "What did the proclamation do?",
    expects: ["1863"],
  };
  const local = localReply(opening, "no", "check");
  const turn = applyReply(
    local,
    {
      understood: true,
      feedback: "Yes, that is a complete explanation of the proclamation.",
      teachBack: "Teach it back.",
    },
    "no",
    NOTES,
  );
  expect(turn.understood).toBe(false);
});
