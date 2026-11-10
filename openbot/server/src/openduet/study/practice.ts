import { z } from "zod";
import type { GuideInput } from "./craft";
import { notesForGuide } from "./guide-write";

/**
 * A practice quiz or a practice test built from the student's notes.
 *
 * Multiple choice is graded exactly. Written answers carry a rubric. The
 * model may grade those when a key is set; the rubric grade here is the
 * fallback and the floor for an answer that already hits the notes.
 */

export type PracticeMode = "quiz" | "test";
export type PracticeSubject = "history" | "calc" | "stats" | "general";
export type PracticeKind =
  | "mcq"
  | "short"
  | "saq"
  | "leq"
  | "steps"
  | "chapter";

export type RubricPoint = { id: string; text: string; points: number };

export type PracticeItem = {
  id: string;
  kind: PracticeKind;
  prompt: string;
  stimulus?: string;
  /** SAQ parts, shown as separate boxes and graded as one answer. */
  parts?: string[];
  choices?: [string, string, string, string];
  answerIndex?: number;
  /** What the notes say. Not shown until the check. */
  answer: string;
  rubric: RubricPoint[];
  topic: string;
  points: number;
};

export type PracticePaper = {
  title: string;
  subject: PracticeSubject;
  mode: PracticeMode;
  suggestedMinutes: number;
  items: PracticeItem[];
};

export type PracticeAnswer = { id: string; choice?: number; text?: string };

export type GradedPoint = { text: string; met: boolean };

export type GradedItem = {
  id: string;
  topic: string;
  kind: PracticeKind;
  earned: number;
  points: number;
  correct: boolean;
  partial: boolean;
  feedback: string;
  rubric: GradedPoint[];
};

export type PracticeResult = {
  earned: number;
  points: number;
  summary: string;
  items: GradedItem[];
};

const KIND = ["mcq", "short", "saq", "leq", "steps", "chapter"] as const;

const rubricSchema = z.object({
  id: z.string(),
  text: z.string(),
  points: z.number(),
});

const itemSchema = z.object({
  id: z.string(),
  kind: z.enum(KIND),
  prompt: z.string(),
  stimulus: z.string().optional(),
  parts: z.array(z.string()).optional(),
  choices: z.tuple([z.string(), z.string(), z.string(), z.string()]).optional(),
  answerIndex: z.number().int().min(0).max(3).optional(),
  answer: z.string(),
  rubric: z.array(rubricSchema),
  topic: z.string(),
  points: z.number(),
});

const resultSchema = z.object({
  earned: z.number(),
  points: z.number(),
  summary: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      topic: z.string(),
      kind: z.enum(KIND),
      earned: z.number(),
      points: z.number(),
      correct: z.boolean(),
      partial: z.boolean(),
      feedback: z.string(),
      rubric: z.array(z.object({ text: z.string(), met: z.boolean() })),
    }),
  ),
});

export const storedPracticeSchema = z.object({
  title: z.string(),
  classId: z.string(),
  className: z.string(),
  focus: z.string(),
  subject: z.enum(["history", "calc", "stats", "general"]),
  mode: z.enum(["quiz", "test"]),
  suggestedMinutes: z.number(),
  items: z.array(itemSchema).min(1),
  createdAt: z.string(),
  result: resultSchema.nullable().optional(),
  /** Set while a grade is in flight, so a second click cannot grade again. */
  grading: z.boolean().optional(),
});

export type StoredPractice = z.infer<typeof storedPracticeSchema> & {
  id: string;
};

export function subjectOf(className: string): PracticeSubject {
  const name = className.toLowerCase();
  if (/history|apush/.test(name)) return "history";
  if (/calc/.test(name)) return "calc";
  if (/stat/.test(name)) return "stats";
  return "general";
}

export function draftPractice(
  input: GuideInput,
  mode: PracticeMode,
): PracticePaper | { refused: string } {
  if (input.help === "none") {
    return {
      refused: `${input.className} doesn't allow AI help, so no ${mode === "test" ? "practice test" : "quiz"} was made. Review your own notes.`,
    };
  }
  const notes = notesForGuide(input);
  if (notes.length < 80) {
    return {
      refused: "The notes don't have enough to write a fair question yet.",
    };
  }
  const subject = subjectOf(input.className);
  const sections = sectionsOf(notes);
  const formulas = formulaLines(notes);
  const plan = shape(subject, mode);
  const items: PracticeItem[] = [];
  let mcq = 0;
  for (const kind of plan) {
    const made = makeItem(kind, subject, sections, formulas, items.length, mcq);
    if (!made) continue;
    if (made.kind === "mcq") mcq += 1;
    items.push(made);
  }
  if (items.length < 2) {
    return {
      refused: "The notes don't have enough to write a fair question yet.",
    };
  }
  const label = mode === "test" ? "practice test" : "quiz";
  return {
    title: clip(`${input.className}: ${input.focus} ${label}`, 120),
    subject,
    mode,
    suggestedMinutes: mode === "quiz" ? 8 : subject === "history" ? 35 : 25,
    items,
  };
}

function shape(subject: PracticeSubject, mode: PracticeMode): PracticeKind[] {
  if (subject === "history" && mode === "test")
    return ["mcq", "mcq", "mcq", "saq", "leq"];
  if (subject === "history") return ["mcq", "mcq", "saq"];
  if (subject === "calc" && mode === "test")
    return ["mcq", "mcq", "steps", "steps"];
  if (subject === "calc") return ["mcq", "steps"];
  if (subject === "stats" && mode === "test")
    return ["chapter", "chapter", "mcq", "chapter"];
  if (subject === "stats") return ["chapter", "mcq"];
  if (mode === "test") return ["mcq", "mcq", "mcq", "short", "short"];
  return ["mcq", "mcq", "short"];
}

type Section = { heading: string; body: string; sentences: string[] };

function makeItem(
  kind: PracticeKind,
  subject: PracticeSubject,
  sections: Section[],
  formulas: string[],
  index: number,
  mcqCount: number,
): PracticeItem | null {
  if (sections.length === 0 && kind !== "steps") return null;
  const section = sections[index % Math.max(sections.length, 1)];
  const id = `q${index + 1}`;
  if (kind === "mcq") {
    return subject === "history" && mcqCount < 2
      ? stimulusMcq(id, sections, index)
      : termMcq(id, sections, index);
  }
  if (kind === "saq") return section ? saq(id, section) : null;
  if (kind === "leq") return section ? leq(id, section) : null;
  if (kind === "steps") {
    const formula = formulas[index % Math.max(formulas.length, 1)];
    if (formula) return steps(id, formula, index);
    return section ? stepsFromSection(id, section) : null;
  }
  if (kind === "chapter") return section ? chapter(id, section) : null;
  return section ? short(id, section) : null;
}

function stimulusMcq(
  id: string,
  sections: Section[],
  index: number,
): PracticeItem | null {
  const section = sections[index % sections.length];
  if (!section) return null;
  const stimulus = plain(section.sentences[0] ?? "");
  if (!stimulus || noisy(stimulus)) return termMcq(id, sections, index);
  const headings = unique(
    sections.map((item) => clip(plain(item.heading), 80)),
  );
  const correct = clip(plain(section.heading), 80);
  const choices = four(
    correct,
    headings.filter((item) => item !== correct),
    id,
  );
  if (!choices) return termMcq(id, sections, index);
  return {
    id,
    kind: "mcq",
    prompt:
      "The note above is best understood as evidence of which development?",
    stimulus: clip(stimulus, 280),
    choices: choices.choices,
    answerIndex: choices.index,
    answer: clip(section.sentences[0] ?? section.body, 400),
    rubric: pointsOf(section.sentences[0] ?? section.body, 1),
    topic: clip(section.heading, 80),
    points: 1,
  };
}

function termMcq(
  id: string,
  sections: Section[],
  index: number,
): PracticeItem | null {
  const section = sections[index % sections.length];
  if (!section) return null;
  const others = sections
    .filter((item) => item.heading !== section.heading)
    .map((item) => plain(item.sentences[0] ?? item.heading))
    .filter((item) => item.length > 12 && !noisy(item))
    .map((item) => clip(item, 180));
  const correct = clip(plain(section.sentences[0] ?? section.body), 180);
  if (!correct || noisy(correct)) return null;
  const choices = four(correct, others, id);
  if (!choices) return null;
  return {
    id,
    kind: "mcq",
    prompt: `Which statement matches your notes on ${clip(section.heading, 80)}?`,
    choices: choices.choices,
    answerIndex: choices.index,
    answer: correct,
    rubric: pointsOf(correct, 1),
    topic: clip(section.heading, 80),
    points: 1,
  };
}

function saq(id: string, section: Section): PracticeItem {
  const basis = section.sentences.slice(0, 2).join(" ");
  return {
    id,
    kind: "saq",
    prompt: `Use your notes on ${clip(section.heading, 80)}. Answer a, b, and c in a sentence each.`,
    parts: [
      "Identify one specific development in this part of the notes.",
      "Explain one cause or effect the notes give for it.",
      "Connect it to one other development in your notes.",
    ],
    answer: clip(basis || section.body, 500),
    rubric: [
      ...pointsOf(section.sentences[0] ?? section.body, 1),
      ...pointsOf(section.sentences[1] ?? section.body, 1).map((point, i) => ({
        ...point,
        id: `b${i}`,
      })),
      {
        id: "link",
        text: "A second development from the notes, named in your own words",
        points: 1,
      },
    ],
    topic: clip(section.heading, 80),
    points: 3,
  };
}

function leq(id: string, section: Section): PracticeItem {
  return {
    id,
    kind: "leq",
    prompt: `Outline only, not a full essay. To what extent did ${clip(section.heading, 80)} change life in the United States? Use your notes. Include a thesis, two pieces of evidence, and one limit or other side.`,
    answer: clip(section.sentences.slice(0, 2).join(" ") || section.body, 500),
    rubric: [
      {
        id: "thesis",
        text: "A thesis that takes a side on the extent of change",
        points: 1,
      },
      ...pointsOf(section.sentences[0] ?? section.body, 1),
      ...pointsOf(
        section.sentences[1] ?? section.sentences[0] ?? section.body,
        1,
      ).map((point, i) => ({ ...point, id: `e${i}` })),
      {
        id: "limit",
        text: "A limit, a different group, or a change over time from the notes",
        points: 1,
      },
    ],
    topic: clip(section.heading, 80),
    points: 4,
  };
}

function steps(id: string, formula: string, index: number): PracticeItem {
  const shown = plain(formula);
  const topic = shown
    .replace(/\$[^$]+\$/g, " ")
    .replace(/[|#]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "")
    .trim();
  return {
    id,
    kind: "steps",
    prompt: `Work this in steps from your notes.\n\n${clip(shown, 500)}`,
    parts: [
      "Say what the rule computes.",
      "Name the inputs.",
      "Apply it in one sentence to a different function than the example.",
    ],
    answer: clip(shown, 400),
    rubric: pointsOf(topic || formula, 1).concat([
      {
        id: "inputs",
        text: "The inputs the rule needs, such as the bounds or the function",
        points: 1,
      },
      {
        id: "apply",
        text: "The rule applied to a new function, not copied as the only step",
        points: 1,
      },
    ]),
    topic: clip(topic.slice(0, 80) || `Rule ${index + 1}`, 80),
    points: 3,
  };
}

function stepsFromSection(id: string, section: Section): PracticeItem {
  return {
    id,
    kind: "steps",
    prompt: `Work this in steps from your notes on ${clip(section.heading, 80)}. State the rule, name what it uses, then apply it in one sentence.`,
    answer: clip(section.sentences[0] ?? section.body, 400),
    rubric: pointsOf(section.sentences[0] ?? section.body, 2),
    topic: clip(section.heading, 80),
    points: 2,
  };
}

function chapter(id: string, section: Section): PracticeItem {
  const stimulus = section.sentences[0];
  return {
    id,
    kind: "chapter",
    prompt: `Chapter problem on ${clip(section.heading, 80)}. What does the method in your notes say to do, and what result should you expect?`,
    ...(stimulus ? { stimulus: clip(stimulus, 320) } : {}),
    answer: clip(section.sentences.slice(0, 2).join(" ") || section.body, 500),
    rubric: pointsOf(section.sentences[0] ?? section.body, 2),
    topic: clip(section.heading, 80),
    points: 2,
  };
}

function short(id: string, section: Section): PracticeItem {
  return {
    id,
    kind: "short",
    prompt: `In one or two sentences, what do your notes say about ${clip(section.heading, 80)}?`,
    answer: clip(section.sentences[0] ?? section.body, 400),
    rubric: pointsOf(section.sentences[0] ?? section.body, 2),
    topic: clip(section.heading, 80),
    points: 2,
  };
}

export function gradePracticeLocal(
  items: readonly PracticeItem[],
  answers: readonly PracticeAnswer[],
): PracticeResult {
  const graded = items.map((item) => gradeItem(item, answerFor(item, answers)));
  return summarize(graded);
}

function gradeItem(
  item: PracticeItem,
  given: PracticeAnswer | undefined,
): GradedItem {
  if (item.kind === "mcq") {
    const choice = given?.choice;
    const correct = choice === item.answerIndex;
    return {
      id: item.id,
      topic: item.topic,
      kind: item.kind,
      earned: correct ? item.points : 0,
      points: item.points,
      correct,
      partial: false,
      feedback: correct
        ? "That matches your notes."
        : `The notes say: ${clip(item.answer, 220)}`,
      rubric: item.rubric.map((point) => ({ text: point.text, met: correct })),
    };
  }
  const text = given?.text?.trim() ?? "";
  if (text.length < 8) {
    return {
      id: item.id,
      topic: item.topic,
      kind: item.kind,
      earned: 0,
      points: item.points,
      correct: false,
      partial: false,
      feedback: "No answer yet. Use a point from your notes.",
      rubric: item.rubric.map((point) => ({ text: point.text, met: false })),
    };
  }
  const marks = item.rubric.map((point) => ({
    text: point.text,
    met: pointHit(point.text, text, item.answer),
    points: point.points,
  }));
  const earned = Math.min(
    item.points,
    marks.reduce((sum, point) => sum + (point.met ? point.points : 0), 0),
  );
  const ratio = item.points === 0 ? 0 : earned / item.points;
  const met = marks.filter((point) => point.met).map((point) => point.text);
  const missed = marks.filter((point) => !point.met).map((point) => point.text);
  const feedback = [
    met.length > 0
      ? `You had ${met.join("; ")}.`
      : "That misses the notes' point.",
    missed.length > 0 ? `Still missing ${missed.join("; ")}.` : "",
    missed.length > 0 ? `The notes say: ${clip(item.answer, 220)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    id: item.id,
    topic: item.topic,
    kind: item.kind,
    earned,
    points: item.points,
    correct: ratio >= 0.75,
    partial: ratio >= 0.34 && ratio < 0.75,
    feedback,
    rubric: marks.map(({ text: label, met: hit }) => ({
      text: label,
      met: hit,
    })),
  };
}

export function summarize(items: GradedItem[]): PracticeResult {
  const earned = items.reduce((sum, item) => sum + item.earned, 0);
  const points = items.reduce((sum, item) => sum + item.points, 0);
  const misses = items.filter((item) => !item.correct).length;
  const summary =
    misses === 0
      ? `${earned} of ${points}. Nothing to put in review.`
      : `${earned} of ${points}. ${misses === 1 ? "1 miss is" : `${misses} misses are`} in your review.`;
  return { earned, points, summary, items };
}

export function answerFor(
  item: PracticeItem,
  answers: readonly PracticeAnswer[],
): PracticeAnswer | undefined {
  return answers.find((answer) => answer.id === item.id);
}

/** A rubric line counts when the answer uses its words or the note's words. */
export function pointHit(
  point: string,
  answer: string,
  basis: string,
): boolean {
  if (softHit(point, answer)) return true;
  // A stance or a link is met when the answer takes a side or names a contrast
  // and still touches the notes.
  if (/thesis|side|extent/i.test(point)) {
    return (
      /extent|largely|partly|mostly|limited|significant/i.test(answer) &&
      softHit(basis, answer)
    );
  }
  if (
    /limit|different group|change over time|second development|new function|inputs/i.test(
      point,
    )
  ) {
    return (
      /however|although|but|while|yet|limit|except|different|instead|bounds|from|to/i.test(
        answer,
      ) && softHit(basis, answer)
    );
  }
  return false;
}

function softHit(point: string, answer: string): boolean {
  const hay = answer.toLowerCase();
  const needle = point.toLowerCase().replace(/\$[^$]*\$/g, " ");
  if (needle.length >= 12 && hay.includes(needle)) return true;
  const words = needle
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3);
  if (words.length === 0) return false;
  const got = words.filter((word) => hay.includes(word)).length;
  return got >= Math.max(2, Math.ceil(words.length * 0.67));
}

export function sectionsOf(notes: string): Section[] {
  const sections: Section[] = [];
  let heading = "";
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join(" ").replace(/\s+/g, " ").trim();
    const sentences = body
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(
        (sentence) =>
          sentence.length >= 40 &&
          sentence.length <= 320 &&
          !sentence.includes("|") &&
          !noisy(sentence),
      );
    if (
      heading &&
      !/source|citation|how to use|coverage|mistake|contents|answer key|flag|review guide|study guide|deep guide|starter/i.test(
        heading,
      ) &&
      sentences.length > 0
    ) {
      sections.push({
        heading: heading.replace(/[*_`]/g, "").trim(),
        body: body.slice(0, 800),
        sentences,
      });
    }
    lines = [];
  };
  for (const line of notes.split("\n")) {
    const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (match?.[2]) {
      flush();
      heading = match[2];
      continue;
    }
    if (line.trim()) lines.push(line.trim());
  }
  flush();
  return sections;
}

function noisy(text: string): boolean {
  return /citation|source page|source tag|arguable|not in your files|reviewed by|correction ledger|how to read|\bblank\b/i.test(
    text,
  );
}

/** Markdown marks off a line a student should read, keeping the math. */
function plain(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s*/, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function formulaLines(notes: string): string[] {
  return notes
    .split("\n")
    .map((line) => line.trim())
    .map((line) => plain(line))
    .filter(
      (line) =>
        line.includes("$") &&
        line.length > 12 &&
        line.length < 420 &&
        !noisy(line),
    );
}

function pointsOf(text: string, each: number): RubricPoint[] {
  const words = text
    .replace(/\$[^$]*\$/g, " ")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3);
  const chunks: string[] = [];
  for (
    let index = 0;
    index + 2 < words.length && chunks.length < 2;
    index += 4
  ) {
    chunks.push(words.slice(index, index + 3).join(" "));
  }
  if (chunks.length === 0 && text.trim()) chunks.push(clip(text, 80));
  return chunks.map((chunk, index) => ({
    id: `p${index}`,
    text: chunk,
    points: each,
  }));
}

function four(
  correct: string,
  pool: string[],
  seed: string,
): { choices: [string, string, string, string]; index: number } | null {
  const fillers = [
    "A later chapter, not this one",
    "The notes do not say this",
    "None of these",
    "A different unit",
  ];
  const choices = [correct];
  for (const item of [...pool, ...fillers]) {
    if (choices.length === 4) break;
    const text = clip(item, 160);
    if (!choices.some((choice) => same(choice) === same(text)))
      choices.push(text);
  }
  if (choices.length < 4) return null;
  const spun = rotate(choices, hash(seed));
  const index = spun.findIndex((choice) => same(choice) === same(correct));
  if (index < 0) return null;
  return { choices: spun as [string, string, string, string], index };
}

function rotate<T>(items: T[], seed: number): T[] {
  const count = seed % items.length;
  return [...items.slice(count), ...items.slice(0, count)];
}

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 33 + char.charCodeAt(0)) >>> 0;
  return value;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = same(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function same(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function publicItem(item: PracticeItem) {
  return {
    id: item.id,
    kind: item.kind,
    prompt: item.prompt,
    ...(item.stimulus ? { stimulus: item.stimulus } : {}),
    ...(item.parts ? { parts: item.parts } : {}),
    ...(item.choices ? { choices: item.choices } : {}),
    points: item.points,
    topic: item.topic,
  };
}
