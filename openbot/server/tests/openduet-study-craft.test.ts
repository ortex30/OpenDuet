import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageBlockSchema } from "../src/openduet/page-content";
import { loadPrivatePack } from "../src/openduet/private-pack";
import {
  checkTeachBack,
  craftGuide,
  craftQuiz,
  craftTutor,
  craftWritten,
  gradeWritten,
  planTonight,
  polishGuide,
  polishTutor,
  schoolSnapshotFromPack,
} from "../src/openduet/study/craft";

const NOTES = `# Period 5

## Slavery and the West

The Missouri Compromise drew a line at 36°30' and kept a balance of free and slave states in the Senate. Later fights over the Mexican Cession reopened that argument.

## The Civil War

**Emancipation Proclamation** — Lincoln's 1863 order freed enslaved people in Confederate-held territory and let Black men join the Union army.
**Gettysburg** — The July 1863 Union victory ended Lee's invasion of the North.
1861: Confederate forces fired on Fort Sumter and the Civil War began.
`;

const input = {
  classId: "apush",
  className: "AP United States History",
  help: "hints" as const,
  focus: "APUSH Period 5",
  due: "2026-11-11",
  notes: "",
  files: [{ path: "materials/apush-period-5.md", markdown: NOTES }],
};

test("a guide keeps note facts, drops fluff, and puts answers after the questions", () => {
  const guide = craftGuide(input, [
    "In conclusion, this comprehensive overview shows that everything changed forever in every way.",
  ]);
  expect(guide.dropped).toBe(1);
  expect(guide.markdown).toContain("Missouri Compromise");
  expect(guide.markdown).toContain("## Answers");
  expect(guide.markdown.indexOf("## Practice")).toBeLessThan(
    guide.markdown.indexOf("## Answers"),
  );
  expect(guide.markdown).not.toContain("comprehensive overview");
  for (const block of guide.blocks)
    expect(pageBlockSchema.safeParse(block).success).toBe(true);
});

test("a no-help class gets notes and no practice test", () => {
  const guide = craftGuide({
    ...input,
    className: "Advanced Chemistry",
    help: "none",
  });
  expect(guide.markdown).toContain("not allowed");
  expect(guide.markdown).not.toContain("## Practice");
  expect(craftQuiz({ ...input, help: "none" })).toEqual({
    refused:
      "AP United States History is set to no AI help, so no practice test was made.",
  });
});

test("a quiz uses the note's definition and not a made-up one", () => {
  const extra = `
**Kansas-Nebraska Act** — The 1854 law that let settlers vote on slavery and replaced the Missouri Compromise line.
**Dred Scott** — The 1857 decision that said Congress could not ban slavery in the territories.
`;
  const quiz = craftQuiz({
    ...input,
    files: [{ path: "notes.md", markdown: NOTES + extra }],
  });
  if ("refused" in quiz) throw new Error(quiz.refused);
  expect(quiz.questions).toHaveLength(4);
  const emancipation = quiz.questions.find((item) =>
    item.question.includes("Emancipation"),
  );
  expect(emancipation?.choices[emancipation.answer]).toContain("1863");
});

test("teach-back accepts an answer that uses the note and asks again when it does not", () => {
  const step = craftTutor(input, "Civil War");
  if ("refused" in step) throw new Error(step.refused);
  const good = checkTeachBack(step, step.explanation);
  expect(good.understood).toBe(true);
  const weak = checkTeachBack(step, "It was a war.");
  expect(weak.understood).toBe(false);
  expect(weak.teachBack.length).toBeGreaterThan(10);
});

test("tonight plans tests ahead of homework and skips the weekend spring rows", () => {
  const root = mkdtempSync(join(tmpdir(), "craft-"));
  mkdirSync(join(root, "materials"));
  writeFileSync(
    join(root, "classes.json"),
    JSON.stringify({
      timezone: "America/Chicago",
      school: "Example",
      classes: [
        {
          id: "apush",
          name: "AP United States History",
          status: "Current",
          block: "2",
          teachers: [{ name: "Ms. Peña", confidence: "confirmed" }],
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
          name: "APUSH LEQ 3",
          class_id: "apush",
          type: "test",
          due: "2026-11-11",
        },
        {
          name: "Reading notes",
          class_id: "apush",
          type: "homework",
          due: "2026-11-11",
        },
      ],
      historical_unconfirmed_spring_2026: {
        items: [{ name: "Old", due: "2026-04-21" }],
      },
    }),
  );
  const pack = loadPrivatePack(root);
  const plan = planTonight(pack, new Date("2026-11-10T22:00:00.000Z"));
  expect(plan.blocks.length).toBeGreaterThan(0);
  expect(plan.blocks[0]?.assignmentId ?? "").toContain("leq");
  const snapshot = schoolSnapshotFromPack(
    pack,
    new Date("2026-11-10T22:00:00.000Z"),
  );
  expect(
    snapshot.assignments.every((item) => item.dueDate !== "2026-04-21"),
  ).toBe(true);
});

test("a guide uses a term written as a bold label, and drops citation fluff", () => {
  const notes = `# Unit 5

## Formula sheet
**FTC, part 1.** If F is an antiderivative of f on a closed interval, the definite integral equals the change in F. [5.01 Notes p2]
**Net change.** The integral of a rate from a to b equals the change in the quantity. [5.01]
**Second FTC.** The derivative of an integral from a constant to x is the integrand at x.
**Chain rule, variable upper limit.** When the upper limit is a function, multiply by that function's derivative.

## Sources
**Arguable angle:** This comprehensive overview is not from the notes and should never be studied.
`;
  const guide = craftGuide({
    ...input,
    className: "AP Calculus BC",
    focus: "Unit 5 Quest",
    files: [
      { path: "materials/lectures.md", markdown: "A short index of lectures." },
      { path: "materials/calc-unit5-review.md", markdown: notes },
    ],
  });
  expect(guide.markdown).toContain("FTC, part 1");
  expect(guide.markdown).toContain("antiderivative");
  expect(guide.markdown).not.toContain("[5.01");
  expect(guide.markdown).not.toContain("Arguable");
  expect(guide.markdown).not.toContain("comprehensive overview");
});

test("short answer and a free response are graded from the notes", () => {
  const made = craftWritten(input);
  if ("refused" in made) throw new Error(made.refused);
  const free = made.questions.find((item) => item.kind === "free");
  const short = made.questions.find((item) => item.kind === "short");
  if (!free || !short) throw new Error("missing a written question");
  expect(free.prompt.toLowerCase()).toContain("saq");
  const grades = gradeWritten(made.questions, [
    { id: short.id, text: short.answer },
    { id: free.id, text: "It was a war." },
  ]);
  expect(grades.find((item) => item.id === short.id)?.correct).toBe(true);
  expect(grades.find((item) => item.id === free.id)?.correct).toBe(false);
});

test("tonight leaves last week's work off the evening", () => {
  const root = mkdtempSync(join(tmpdir(), "craft-past-"));
  mkdirSync(join(root, "materials"));
  writeFileSync(
    join(root, "classes.json"),
    JSON.stringify({
      timezone: "America/Chicago",
      school: "Example",
      classes: [
        {
          id: "apush",
          name: "AP United States History",
          status: "Current",
          block: "2",
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
          name: "Old translation",
          class_id: "apush",
          type: "homework",
          due: "2026-11-05",
        },
        {
          name: "APUSH LEQ 3",
          class_id: "apush",
          type: "test",
          due: "2026-11-11",
        },
      ],
      historical_unconfirmed_spring_2026: { items: [] },
    }),
  );
  const plan = planTonight(
    loadPrivatePack(root),
    new Date("2026-11-10T22:00:00.000Z"),
  );
  expect(
    plan.blocks.some((block) => /old translation/i.test(block.title)),
  ).toBe(false);
  expect(plan.blocks.some((block) => /leq/i.test(block.title))).toBe(true);
});

test("without a key the tutor is not sent to a model", async () => {
  let called = false;
  const step = craftTutor(input, "Civil War");
  if ("refused" in step) throw new Error(step.refused);
  const polished = await polishTutor(step, NOTES, {}, async () => {
    called = true;
    return new Response("no");
  });
  expect(called).toBe(false);
  expect(polished.explanation).toBe(step.explanation);
});

test("without a key the guide is not sent to a model", async () => {
  let called = false;
  const guide = craftGuide(input);
  const polished = await polishGuide(guide, NOTES, {}, async () => {
    called = true;
    return new Response("no");
  });
  expect(called).toBe(false);
  expect(polished).toBe(guide);
});
