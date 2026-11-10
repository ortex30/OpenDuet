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
import {
  clipAt,
  guideFromModelText,
  guideProblems,
  prepareNotes,
  scrubGuideText,
} from "../src/openduet/study/guide-write";
import {
  statedMinutes,
  usesSharedEvening,
} from "../src/openduet/study/plan-tools";

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
      "AP United States History doesn't allow AI help, so no quiz was made. Review your own notes.",
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
  const leq = plan.blocks.find((block) => /leq/i.test(block.title));
  const minutes = plan.blocks
    .filter((block) => block.assignmentId === leq?.assignmentId)
    .reduce((sum, block) => {
      const [sh, sm] = block.start.split(":").map(Number);
      const [eh, em] = block.end.split(":").map(Number);
      return sum + (eh * 60 + em - (sh * 60 + sm));
    }, 0);
  expect(minutes).toBeGreaterThanOrEqual(45);
  const again = planTonight(
    loadPrivatePack(root),
    new Date("2026-11-10T22:00:00.000Z"),
    [leq?.assignmentId ?? ""],
  );
  expect(again.blocks.some((block) => /leq/i.test(block.title))).toBe(false);
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

test("a guide keeps a formula as math and drops a source label", () => {
  const notes = `# Unit 5

## The rule
What it is: a label that should not survive on the page.
**FTC, part 1.** If $F'=f$ on $[a,b]$, then $\\int_a^b f(x)\\,dx = F(b)-F(a)$. The definite integral equals the change in the antiderivative.
† This sentence is my synthesis and should not be copied as a source label.
`;
  const guide = craftGuide({
    ...input,
    className: "AP Calculus BC",
    focus: "Unit 5",
    files: [{ path: "materials/calc-unit5-review.md", markdown: notes }],
  });
  expect(guide.markdown).toContain("$");
  expect(guide.markdown).not.toContain("int _a^b");
  expect(guide.markdown.toLowerCase()).not.toContain("what it is:");
  expect(guide.markdown).not.toContain("†");
});

test("a model guide keeps note facts, math, and no source dump", () => {
  const source = prepareNotes(`# Period 5

## Compromise
What happened: The Compromise of 1850 admitted California as a free state and added a stricter fugitive slave law.
**Kansas-Nebraska Act** — The 1854 law let settlers vote on slavery and replaced the Missouri Compromise line.
`);
  const raw = JSON.stringify({
    title: "APUSH Period 5",
    summary: "Slavery's expansion splits the Union, 1844–1877.",
    opening:
      "Period 5 turns on whether slavery would expand with the country. The Compromise of 1850 and the Kansas-Nebraska Act show the Senate could not settle it.",
    sections: [
      {
        heading: "The Compromise of 1850",
        text: "The Compromise of 1850 admitted California as a free state and added a stricter fugitive slave law. What it is: a bargain, not a solution. [L16 44:54]",
      },
      {
        heading: "Kansas-Nebraska",
        text: "The Kansas-Nebraska Act in 1854 let settlers vote on slavery and replaced the Missouri Compromise line.",
      },
      {
        heading: "The Missouri Compromise line",
        text: "The Kansas-Nebraska Act replaced the Missouri Compromise line when settlers were allowed to vote on slavery.",
      },
      {
        heading: "Invented",
        text: "In 1492 the Senate invented a new ocean and a new country that the notes never mention at all.",
      },
    ],
    terms: [
      {
        term: "Kansas-Nebraska Act",
        remember:
          "The 1854 law let settlers vote on slavery and replaced the Missouri Compromise line.",
      },
      {
        term: "Compromise of 1850",
        remember:
          "The Compromise of 1850 admitted California as a free state and added a stricter fugitive slave law.",
      },
      {
        term: "Missouri Compromise",
        remember:
          "The Missouri Compromise line was replaced when settlers were allowed to vote on slavery.",
      },
      {
        term: "Fugitive slave law",
        remember: "The Compromise of 1850 added a stricter fugitive slave law.",
      },
    ],
    timeline: [
      {
        date: "1850",
        title: "Compromise of 1850",
        text: "California entered as a free state and the fugitive slave law got stricter.",
      },
      {
        date: "1854",
        title: "Kansas-Nebraska Act",
        text: "Settlers would vote on slavery, and the Missouri Compromise line was replaced.",
      },
      {
        date: "1492",
        title: "Not in the notes",
        text: "An invented landing that the notes do not describe in any way.",
      },
      {
        date: "1850",
        title: "Fugitive slave law",
        text: "The stricter fugitive slave law was part of the Compromise of 1850.",
      },
    ],
    practice: [
      {
        prompt: "What did the Compromise of 1850 do about California?",
        answer: "The Compromise of 1850 admitted California as a free state.",
      },
      {
        prompt: "What did the Kansas-Nebraska Act replace?",
        answer:
          "It replaced the Missouri Compromise line and let settlers vote on slavery.",
      },
      {
        prompt: "Why did the fugitive slave law matter in 1850?",
        answer: "The Compromise of 1850 added a stricter fugitive slave law.",
      },
    ],
  });
  const guide = guideFromModelText(
    raw,
    { ...input, focus: "APUSH Period 5" },
    source,
  );
  if (!guide) throw new Error("guide was dropped");
  expect(guide.markdown).toContain("Compromise of 1850");
  expect(guide.markdown).toContain("Kansas-Nebraska");
  expect(guide.markdown).not.toContain("1492");
  expect(guide.markdown.toLowerCase()).not.toContain("what it is:");
  expect(guide.markdown).not.toContain("[L16");
  expect(guideProblems(guide.markdown)).toEqual([]);
  expect(scrubGuideText("What happened: Polk settled Oregon.")).toBe(
    "Polk settled Oregon.",
  );
});

test("a class calendar is not a timeline", () => {
  const source = prepareNotes(
    "Exam 3 is November 12 2026. Density equals mass divided by volume. The ideal gas law uses pressure volume temperature and moles. Avogadro number is 6.02 times 10 to the 23.",
  );
  const guide = guideFromModelText(
    JSON.stringify({
      title: "Units 1 and 2",
      summary: "Gases, density, and energy.",
      opening:
        "Units 1 and 2 connect visible lab behavior to particle models. Density equals mass divided by volume, and the ideal gas law uses pressure, volume, temperature, and moles.",
      sections: [
        {
          heading: "Density",
          text: "Density equals mass divided by volume, and that relationship stays constant for a given substance.",
        },
        {
          heading: "Gases",
          text: "The ideal gas law uses pressure, volume, temperature, and moles. One mole of gas at STP has a volume of 22.4 liters.",
        },
        {
          heading: "Amount",
          text: "Avogadro number is 6.02 times 10 to the 23, and the mole is the amount used in gas problems.",
        },
      ],
      terms: [],
      timeline: [
        {
          date: "November 12, 2026",
          title: "Exam 3 window",
          text: "Exam 3 was noted as November 12 2026.",
        },
      ],
      practice: [],
    }),
    {
      ...input,
      className: "Advanced Chemistry",
      help: "none",
      focus: "Units 1-2",
    },
    source,
  );
  if (!guide) throw new Error("guide was dropped");
  expect(guide.markdown).not.toContain("2026");
  expect(guide.markdown).toContain("not an answer to turn in");
  expect(guide.markdown).not.toContain("## Practice");
});

test("with a key, the model guide replaces the draft", async () => {
  const body = JSON.stringify({
    title: "APUSH Period 5",
    summary:
      "From 1844 to 1877 the fight over slavery's expansion breaks the Union.",
    opening:
      "The Missouri Compromise drew a line and kept a balance of free and slave states in the Senate. Later fights over the Mexican Cession reopened that argument.",
    sections: [
      {
        heading: "Slavery and the West",
        text: "The Missouri Compromise drew a line at the Senate balance of free and slave states. Later fights over the Mexican Cession reopened that argument.",
      },
      {
        heading: "Emancipation",
        text: "The Emancipation Proclamation in 1863 freed enslaved people in Confederate-held territory and let Black men join the Union army.",
      },
      {
        heading: "Gettysburg",
        text: "The July 1863 Union victory at Gettysburg ended Lee's invasion of the North.",
      },
    ],
    terms: [
      {
        term: "Emancipation Proclamation",
        remember:
          "Lincoln's 1863 order freed enslaved people in Confederate-held territory and let Black men join the Union army.",
      },
      {
        term: "Gettysburg",
        remember:
          "The July 1863 Union victory ended Lee's invasion of the North.",
      },
      {
        term: "Missouri Compromise",
        remember:
          "The Missouri Compromise drew a line and kept a balance of free and slave states in the Senate.",
      },
      {
        term: "Mexican Cession",
        remember:
          "Later fights over the Mexican Cession reopened the argument about slavery in the West.",
      },
    ],
    timeline: [],
    practice: [
      {
        prompt: "What did the Emancipation Proclamation do in 1863?",
        answer:
          "It freed enslaved people in Confederate-held territory and let Black men join the Union army.",
      },
      {
        prompt: "What did Gettysburg end?",
        answer:
          "The July 1863 Union victory ended Lee's invasion of the North.",
      },
      {
        prompt: "What did the Missouri Compromise keep in the Senate?",
        answer: "It kept a balance of free and slave states in the Senate.",
      },
    ],
  });
  let called = false;
  const guide = craftGuide(input);
  const polished = await polishGuide(
    guide,
    NOTES,
    { OPENAI_API_KEY: "test-key" },
    async () => {
      called = true;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: body } }] }),
        { status: 200 },
      );
    },
    input,
  );
  expect(called).toBe(true);
  expect(polished).not.toBe(guide);
  expect(polished.markdown).toContain("Emancipation Proclamation");
  expect(polished.title).toBe("APUSH Period 5");
});

test("clipAt stays inside the page limit", () => {
  const long = `${"The Missouri Compromise kept a balance. ".repeat(20)}`;
  expect(clipAt(long, 240).length).toBeLessThanOrEqual(240);
  expect(clipAt("Short.", 240)).toBe("Short.");
});

test("a no-help guide is not sent to a model", async () => {
  let called = false;
  const guide = craftGuide({ ...input, help: "none" });
  const polished = await polishGuide(
    guide,
    NOTES,
    { OPENAI_API_KEY: "test-key" },
    async () => {
      called = true;
      return new Response("no");
    },
    { ...input, help: "none" },
  );
  expect(called).toBe(false);
  expect(polished).toBe(guide);
});

test("tonight puts tomorrow morning ahead of 11:59 homework and honors a short evening", () => {
  const root = mkdtempSync(join(tmpdir(), "craft-rank-"));
  mkdirSync(join(root, "materials"));
  writeFileSync(
    join(root, "classes.json"),
    JSON.stringify({
      timezone: "America/Chicago",
      school: "Example",
      classes: [
        {
          id: "calc",
          name: "AP Calculus BC",
          short_name: "Calc BC",
          status: "Current",
          block: "4",
          teachers: [],
          materials: [],
        },
        {
          id: "latin",
          name: "Honors Latin 4",
          short_name: "Latin",
          status: "Current",
          block: "1",
          teachers: [],
          materials: [],
        },
        {
          id: "apush",
          name: "AP United States History",
          short_name: "APUSH",
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
          name: "Latin form",
          class_id: "latin",
          type: "homework",
          due: "2026-11-10",
        },
        {
          name: "APUSH LEQ 3",
          class_id: "apush",
          type: "in-class essay / test",
          due: "2026-11-11",
        },
        {
          name: "Unit 5 Quest",
          class_id: "calc",
          type: "quest / test",
          due: "2026-11-11",
        },
      ],
      historical_unconfirmed_spring_2026: { items: [] },
    }),
  );
  const pack = loadPrivatePack(root);
  const now = new Date("2026-11-10T22:00:00.000Z");
  const plan = planTonight(pack, now);
  expect(plan.blocks[0]?.title.toLowerCase()).toMatch(/quest|leq/);
  expect(plan.blocks.some((block) => /draft the/i.test(block.title))).toBe(
    false,
  );
  expect(plan.blocks.some((block) => /don't draft/i.test(block.title))).toBe(
    true,
  );
  const short = planTonight(pack, now, { minutes: 30 });
  expect(short.totalMinutes).toBeLessThanOrEqual(30);
  expect(short.totalMinutes).toBeLessThan(plan.totalMinutes);
  expect(short.remaining.some((item) => item.minutes > 0)).toBe(true);
});

test("chat's one-day plan is the same evening planner, and two hours means 120", () => {
  expect(
    usesSharedEvening(
      { days: 1, startDate: "2026-11-10", startDay: "today" },
      "2026-11-10",
      "tuesday",
    ),
  ).toBe(true);
  // A guessed date does not opt out when the day was also named as today.
  expect(
    usesSharedEvening(
      {
        days: 1,
        startDate: "2026-03-09",
        startDay: "today",
        startInDays: 0,
      },
      "2026-11-10",
      "tuesday",
    ),
  ).toBe(true);
  expect(
    usesSharedEvening(
      { days: 1, startDay: "tomorrow", startDate: "2026-11-10" },
      "2026-11-10",
      "tuesday",
    ),
  ).toBe(false);
  expect(
    usesSharedEvening(
      { days: 1, startDate: "2026-03-09" },
      "2026-11-10",
      "tuesday",
    ),
  ).toBe(false);
  expect(
    usesSharedEvening(
      { days: 3, startDay: "saturday" },
      "2026-11-10",
      "tuesday",
    ),
  ).toBe(false);
  expect(statedMinutes("Viren has exactly two hours tonight", 60)).toBe(120);
  expect(statedMinutes("a normal evening", 90)).toBe(90);
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
