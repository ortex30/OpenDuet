import type { GuideInput } from "./craft";
import { notesForGuide } from "./guide-write";
import { completeJson, sharedWords } from "./model-json";
import {
  answerFor,
  draftPractice,
  type GradedItem,
  gradePracticeLocal,
  type PracticeAnswer,
  type PracticeItem,
  type PracticePaper,
  type PracticeResult,
  summarize,
} from "./practice";

/**
 * The notes draft is the paper the student sees when the model is off or
 * adds a fact the notes do not support. With a key, the model may tighten
 * the wording. Grading uses the model for written answers and keeps the
 * rubric grade when the model is harsher than the notes, or kinder than the
 * answer supports.
 */

export async function writePractice(
  input: GuideInput,
  mode: PracticePaper["mode"],
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<PracticePaper | { refused: string }> {
  const draft = draftPractice(input, mode);
  if ("refused" in draft) return draft;
  const notes = notesForGuide(input);
  const model = await completeJson({
    env,
    fetchImpl,
    maxTokens: 5000,
    system: [
      "You write a practice test from a student's own class notes.",
      "Return JSON only.",
      "Do not add facts, dates, formulas, or examples the notes do not contain.",
      "Keep every item id and kind. You may rewrite prompt, stimulus, choices, answer, and rubric text.",
      "Math stays in $...$ so it can be drawn.",
      "These are practice questions. They are not an assignment to turn in.",
      input.help === "hints"
        ? "Hints only: do not write a solution the student could submit for a grade."
        : "Teach. Do not hand over finished work to submit.",
    ].join(" "),
    user: `Class: ${input.className}\nFocus: ${input.focus}\nSubject: ${draft.subject}\nMode: ${draft.mode}\n\nNotes:\n${notes.slice(0, 14000)}\n\nDraft JSON:\n${JSON.stringify({ items: draft.items })}`,
  });
  return mergeDraft(draft, model, notes);
}

export function mergeDraft(
  draft: PracticePaper,
  model: unknown,
  notes: string,
): PracticePaper {
  const items = readItems(model);
  if (!items) return draft;
  return {
    ...draft,
    items: draft.items.map((item) => {
      const next = items.find(
        (row) => row.id === item.id && row.kind === item.kind,
      );
      if (!next) return item;
      return groundedItem(item, next, notes);
    }),
  };
}

function groundedItem(
  item: PracticeItem,
  next: Partial<PracticeItem>,
  notes: string,
): PracticeItem {
  const prompt = typeof next.prompt === "string" ? next.prompt.trim() : "";
  const stimulus =
    typeof next.stimulus === "string" ? next.stimulus.trim() : "";
  const answer = typeof next.answer === "string" ? next.answer.trim() : "";
  if (!prompt || !answer || noisy(prompt) || noisy(answer) || noisy(stimulus))
    return item;
  if (!supported(answer, notes) || (stimulus && !supported(stimulus, notes)))
    return item;
  const choices = next.choices;
  if (choices?.some((choice) => noisy(choice))) return item;
  const choiceOk =
    !choices ||
    (choices.length === 4 &&
      choices.every((choice) => choice.trim().length > 0) &&
      (item.answerIndex === undefined ||
        supported(
          choices[next.answerIndex ?? item.answerIndex ?? 0] ?? "",
          notes,
        )));
  if (!choiceOk || !choices) {
    return {
      ...item,
      prompt: clip(prompt, 700),
      ...(stimulus ? { stimulus: clip(stimulus, 400) } : {}),
      answer: clip(answer, 500),
    };
  }
  const index = next.answerIndex ?? item.answerIndex ?? 0;
  return {
    ...item,
    prompt: clip(prompt, 700),
    ...(stimulus ? { stimulus: clip(stimulus, 400) } : {}),
    choices: choices.map((choice) =>
      clip(choice.trim(), 180),
    ) as PracticeItem["choices"],
    answerIndex: index,
    answer: clip(answer, 500),
  };
}

export async function gradePractice(
  items: readonly PracticeItem[],
  answers: readonly PracticeAnswer[],
  notes: string,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<PracticeResult> {
  const local = gradePracticeLocal(items, answers);
  const model = await completeJson({
    env,
    fetchImpl,
    maxTokens: 2500,
    system: [
      "You grade a high school practice test from the student's notes and the rubric.",
      'Return JSON only: {"items":[{"id":"","earned":0,"feedback":""}]}',
      "earned is an integer from 0 to that item's points.",
      "feedback is specific: what they got, what is missing, and the note it comes from.",
      "A blank or off-topic answer earns 0.",
      "Do not mark an answer right when the notes do not support it.",
      "Partial credit is for a real part of the rubric, not for trying.",
    ].join(" "),
    user: JSON.stringify({
      notes: notes.slice(0, 8000),
      items: items.map((item) => ({
        id: item.id,
        kind: item.kind,
        prompt: item.prompt,
        points: item.points,
        answer: item.answer,
        rubric: item.rubric,
        student: studentText(item, answers),
      })),
    }),
  });
  return mergeGrades(local, model, items, answers, notes);
}

export function mergeGrades(
  local: PracticeResult,
  model: unknown,
  items: readonly PracticeItem[],
  answers: readonly PracticeAnswer[],
  notes: string,
): PracticeResult {
  const rows = readGradeRows(model);
  if (!rows) return local;
  const graded: GradedItem[] = local.items.map((item) => {
    const source = items.find((row) => row.id === item.id);
    const given = source ? answerFor(source, answers) : undefined;
    const text = `${given?.text ?? ""}`.trim();
    const row = rows.find((entry) => entry.id === item.id);
    if (!source || !row) return item;
    if (source.kind !== "mcq" && text.length < 8) return item;
    if (source.kind === "mcq") return item;
    const supportedAnswer =
      sharedWords(text, `${source.answer}\n${notes}`) >= 2;
    let earned = clamp(row.earned, 0, item.points);
    earned = supportedAnswer
      ? Math.max(earned, item.earned)
      : Math.min(earned, item.earned);
    const ratio = item.points === 0 ? 0 : earned / item.points;
    const feedback =
      row.feedback.length > 20 && (supportedAnswer || earned === 0)
        ? row.feedback
        : item.feedback;
    return {
      ...item,
      earned,
      correct: ratio >= 0.75,
      partial: ratio >= 0.34 && ratio < 0.75,
      feedback,
    };
  });
  return summarize(graded);
}

function studentText(
  item: PracticeItem,
  answers: readonly PracticeAnswer[],
): string {
  const given = answerFor(item, answers);
  if (item.kind === "mcq") return `choice ${given?.choice ?? ""}`;
  return given?.text?.trim() ?? "";
}

function readItems(model: unknown): Partial<PracticeItem>[] | null {
  if (!model || typeof model !== "object") return null;
  const items = (model as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  return items.filter(
    (item) => item && typeof item === "object",
  ) as Partial<PracticeItem>[];
}

function readGradeRows(
  model: unknown,
): { id: string; earned: number; feedback: string }[] | null {
  if (!model || typeof model !== "object") return null;
  const items = (model as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  const rows = items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: unknown; earned?: unknown; feedback?: unknown };
    if (typeof row.id !== "string" || typeof row.earned !== "number") return [];
    return [
      {
        id: row.id,
        earned: row.earned,
        feedback: typeof row.feedback === "string" ? row.feedback.trim() : "",
      },
    ];
  });
  return rows.length > 0 ? rows : null;
}

function noisy(text: string): boolean {
  return /citation|source page|source tag|arguable|not in your files|\bblank\b|\*\*/.test(
    text,
  );
}

function supported(text: string, notes: string): boolean {
  const needle = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .slice(0, 48);
  const hay = notes.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  if (needle.length >= 24 && hay.includes(needle)) return true;
  return sharedWords(text, notes) >= 3;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}
