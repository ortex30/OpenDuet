import { expect, test } from "bun:test";
import type { GuideInput } from "../src/openduet/study/craft";
import {
  draftPractice,
  gradePracticeLocal,
  subjectOf,
} from "../src/openduet/study/practice";
import { mergeDraft, mergeGrades } from "../src/openduet/study/practice-model";

const HISTORY = `# Period 5

## Slavery and the West

The Missouri Compromise drew a line at 36 degrees and kept a balance of free and slave states in the Senate. Later fights over the Mexican Cession reopened that argument.

## The Civil War

**Emancipation Proclamation** — Lincoln's 1863 order freed enslaved people in Confederate-held territory and let Black men join the Union army.
**Gettysburg** — The July 1863 Union victory ended Lee's invasion of the North.
1861: Confederate forces fired on Fort Sumter and the Civil War began.

## Reconstruction

The Fourteenth Amendment defined national citizenship and limited state power over civil rights. Enforcement acts then tried to protect Black voting in the South.
`;

const CALC = `# Unit 5

## Formula sheet

- **FTC, part 1.** If $F'=f$ on $[a,b]$, then $\\displaystyle\\int_a^b f(x)\\,dx = F(b)-F(a)$.
- **Net change.** $\\displaystyle\\int_a^b F'(t)\\,dt = F(b)-F(a)$.

## Accumulation

Net change adds the signed area of the rate. A positive integral increases the original amount, and a negative integral decreases it.
`;

const STATS = `# Chapters 3 and 4

## Correlation

The correlation r measures the strength and direction of a linear relationship. It has no units and stays between -1 and 1.

## Sampling

A simple random sample gives every group of the same size an equal chance of being chosen. Bias shows up when some people are left out of the sample.
`;

function input(
  className: string,
  markdown: string,
  help: GuideInput["help"] = "hints",
): GuideInput {
  return {
    classId: "class",
    className,
    help,
    focus: "Unit",
    due: null,
    notes: "",
    files: [{ path: "notes.md", markdown }],
  };
}

test("subjects follow the class name", () => {
  expect(subjectOf("AP United States History")).toBe("history");
  expect(subjectOf("AP Calculus BC")).toBe("calc");
  expect(subjectOf("AP Statistics")).toBe("stats");
  expect(subjectOf("Honors Latin 4")).toBe("general");
});

test("a history practice test uses stimulus questions, an SAQ, and an LEQ outline", () => {
  const paper = draftPractice(
    input("AP United States History", HISTORY),
    "test",
  );
  if ("refused" in paper) throw new Error(paper.refused);
  expect(paper.items.map((item) => item.kind)).toEqual([
    "mcq",
    "mcq",
    "mcq",
    "saq",
    "leq",
  ]);
  expect(paper.items[0]?.stimulus).toBeTruthy();
  expect(paper.items.find((item) => item.kind === "saq")?.parts).toHaveLength(
    3,
  );
  expect(paper.items.find((item) => item.kind === "leq")?.prompt).toContain(
    "Outline only",
  );
  expect(paper.suggestedMinutes).toBe(35);
});

test("a calculus quiz keeps a formula in math and asks for steps", () => {
  const paper = draftPractice(input("AP Calculus BC", CALC), "quiz");
  if ("refused" in paper) throw new Error(paper.refused);
  expect(paper.items.map((item) => item.kind)).toEqual(["mcq", "steps"]);
  const steps = paper.items.find((item) => item.kind === "steps");
  expect(steps?.prompt).toContain("$");
  expect(steps?.prompt).toContain("Work this in steps");
});

test("a statistics quiz asks a chapter problem", () => {
  const paper = draftPractice(input("AP Statistics", STATS), "quiz");
  if ("refused" in paper) throw new Error(paper.refused);
  expect(paper.items.some((item) => item.kind === "chapter")).toBe(true);
  expect(
    paper.items.some((item) => item.prompt.includes("Chapter problem")),
  ).toBe(true);
});

test("a no-help class is refused", () => {
  expect(
    draftPractice(input("Advanced Chemistry", HISTORY, "none"), "quiz"),
  ).toEqual({
    refused:
      "Advanced Chemistry is set to no AI help, so no practice test was made.",
  });
});

test("written grading gives partial credit and names the missing point", () => {
  const paper = draftPractice(
    input("AP United States History", HISTORY),
    "quiz",
  );
  if ("refused" in paper) throw new Error(paper.refused);
  const saq = paper.items.find((item) => item.kind === "saq");
  if (!saq) throw new Error("no saq");
  const graded = gradePracticeLocal(paper.items, [
    ...paper.items
      .filter((item) => item.kind === "mcq")
      .map((item) => ({ id: item.id, choice: item.answerIndex })),
    {
      id: saq.id,
      text: "The Fourteenth Amendment defined national citizenship.",
    },
  ]);
  const written = graded.items.find((item) => item.id === saq.id);
  expect(written?.earned).toBeGreaterThan(0);
  expect(written?.correct).toBe(false);
  expect(written?.feedback).toContain("Still missing");
  expect(graded.summary).toContain("review");
});

test("a model rewrite that invents a fact is dropped", () => {
  const paper = draftPractice(
    input("AP United States History", HISTORY),
    "quiz",
  );
  if ("refused" in paper) throw new Error(paper.refused);
  const item = paper.items[0];
  if (!item) throw new Error("no item");
  const merged = mergeDraft(
    paper,
    {
      items: [
        {
          id: item.id,
          kind: item.kind,
          prompt:
            "What year did the moon landing decide the Missouri Compromise?",
          answer:
            "The moon landing in 1969 settled the Senate balance forever.",
        },
      ],
    },
    HISTORY,
  );
  expect(merged.items[0]?.prompt).toBe(item.prompt);
});

test("model grading cannot give full credit to an answer the notes do not support", () => {
  const paper = draftPractice(input("AP Statistics", STATS), "quiz");
  if ("refused" in paper) throw new Error(paper.refused);
  const local = gradePracticeLocal(
    paper.items,
    paper.items.map((item) =>
      item.kind === "mcq"
        ? { id: item.id, choice: item.answerIndex }
        : { id: item.id, text: "I think it is about pizza and nothing else." },
    ),
  );
  const written = paper.items.find((item) => item.kind !== "mcq");
  if (!written) throw new Error("no written");
  const merged = mergeGrades(
    local,
    {
      items: paper.items.map((item) => ({
        id: item.id,
        earned: item.points,
        feedback: "Perfect work, you understood every part of the method.",
      })),
    },
    paper.items,
    paper.items.map((item) =>
      item.kind === "mcq"
        ? { id: item.id, choice: item.answerIndex }
        : { id: item.id, text: "I think it is about pizza and nothing else." },
    ),
    STATS,
  );
  const grade = merged.items.find((item) => item.id === written.id);
  expect(grade?.earned).toBe(0);
});
