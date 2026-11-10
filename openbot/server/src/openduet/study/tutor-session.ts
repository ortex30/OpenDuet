import { prepareReadableMath } from "@openbot/shared/math-text";
import type { GuideInput } from "./craft";
import { craftTutor, type TutorStep } from "./craft";
import { notesForGuide } from "./guide-write";
import { completeJson, sharedWords } from "./model-json";

/**
 * An adaptive tutor turn from the student's notes.
 *
 * The opening explains simply, gives one example from the notes, and asks a
 * check. A wrong answer gets a simpler explanation and a new question. A
 * right answer moves to teach-back. Chemistry and any no-help class are refused.
 */

export type TutorOpening = TutorStep & { example: string };

export type TutorReply = {
  understood: boolean;
  feedback: string;
  /** A simpler explanation when the answer was off. */
  adjustment: string | null;
  example: string | null;
  nextCheck: string | null;
  teachBack: string | null;
};

export async function openTutor(
  input: GuideInput,
  topic: string,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<TutorOpening | { refused: string }> {
  const drafted = craftTutor(input, topic);
  if ("refused" in drafted) return drafted;
  const notes = cleanNotes(notesForGuide(input));
  const example = exampleFrom(notes, drafted.explanation);
  const opening: TutorOpening = {
    ...drafted,
    explanation: prepareReadableMath(drafted.explanation),
    example,
  };
  const model = await completeJson({
    env,
    fetchImpl,
    maxTokens: 900,
    system: [
      'You are a high school tutor. Return JSON only: {"explanation":"","example":"","check":""}.',
      "Use only the notes. Two short sentences, then one example that appears in the notes, then one check question.",
      "Write every formula between single dollar signs as LaTeX, such as $\\int_a^b f(x)\\,dx$. Never leave a formula as int _a^b or with raw underscores.",
      "Do not do graded work. Do not write an answer the student could turn in.",
      "If the class is hints, explain the idea with a note example. Do not solve their assignment.",
    ].join(" "),
    user: `Class: ${input.className}\nTopic: ${topic || input.focus}\n\nNotes:\n${notes.slice(0, 7000)}\n\nDraft:\n${opening.explanation}`,
  });
  return applyOpening(opening, model, notes);
}

export function applyOpening(
  opening: TutorOpening,
  model: unknown,
  notes: string,
): TutorOpening {
  if (!model || typeof model !== "object") return opening;
  const row = model as {
    explanation?: unknown;
    example?: unknown;
    check?: unknown;
  };
  const explanation =
    typeof row.explanation === "string" ? row.explanation.trim() : "";
  const example = typeof row.example === "string" ? row.example.trim() : "";
  const check = typeof row.check === "string" ? row.check.trim() : "";
  if (
    explanation.length < 40 ||
    sharedWords(explanation, notes) < 2 ||
    (example && (!usableSentence(example) || sharedWords(example, notes) < 2))
  ) {
    return opening;
  }
  return {
    ...opening,
    explanation: prepareReadableMath(explanation),
    example: prepareReadableMath(example || opening.example),
    check: prepareReadableMath(check.length > 8 ? check : opening.check),
  };
}

export async function answerTutor(
  input: {
    opening: TutorOpening;
    answer: string;
    phase: "check" | "teach";
    notes: string;
  },
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<TutorReply> {
  const local = localReply(input.opening, input.answer, input.phase);
  const model = await completeJson({
    env,
    fetchImpl,
    maxTokens: 900,
    system: [
      "You are a high school tutor. Return JSON only.",
      '{"understood":false,"feedback":"","adjustment":"","example":"","nextCheck":"","teachBack":""}',
      "Use only the notes. If the answer is wrong, say what was off, give a simpler explanation, a different note example, and one new check question.",
      "Write every formula between single dollar signs as LaTeX. Never leave raw underscores such as int _a^b.",
      "If the answer is right, ask them to teach it back in their own words.",
      "Do not write a finished answer they could turn in. Do not solve graded work.",
    ].join(" "),
    user: `Phase: ${input.phase}\nTopic: ${input.opening.topic}\nExplanation: ${input.opening.explanation}\nExample: ${input.opening.example}\nQuestion: ${input.opening.check}\nStudent: ${input.answer}\n\nNotes:\n${cleanNotes(input.notes).slice(0, 6000)}`,
  });
  return applyReply(local, model, input.answer, input.notes);
}

export function localReply(
  opening: TutorOpening,
  answer: string,
  phase: "check" | "teach",
): TutorReply {
  const text = answer.trim();
  const overlap = sharedWords(
    text,
    `${opening.explanation} ${opening.example}`,
  );
  const understood = text.length >= 12 && overlap >= 2;
  if (!understood) {
    return {
      understood: false,
      feedback: "Not quite. The notes' point is still missing.",
      adjustment: opening.explanation,
      example: opening.example,
      nextCheck: `In one sentence, what does ${opening.topic} mean in your notes?`,
      teachBack: null,
    };
  }
  if (phase === "teach") {
    return {
      understood: true,
      feedback: "That matches your notes.",
      adjustment: null,
      example: null,
      nextCheck: null,
      teachBack: null,
    };
  }
  return {
    understood: true,
    feedback: "That matches your notes.",
    adjustment: null,
    example: null,
    nextCheck: null,
    teachBack: `Teach ${opening.topic} back in two sentences, as if to a classmate who missed class.`,
  };
}

export function applyReply(
  local: TutorReply,
  model: unknown,
  answer: string,
  notes: string,
): TutorReply {
  if (!model || typeof model !== "object") return local;
  const row = model as {
    understood?: unknown;
    feedback?: unknown;
    adjustment?: unknown;
    example?: unknown;
    nextCheck?: unknown;
    teachBack?: unknown;
  };
  const feedback = typeof row.feedback === "string" ? row.feedback.trim() : "";
  if (feedback.length < 8) return local;
  const overlap = sharedWords(answer, notes);
  let understood = row.understood === true;
  if (understood && answer.trim().length < 12) understood = false;
  if (understood && overlap < 2 && !local.understood) understood = false;
  if (!understood && local.understood && overlap >= 2) understood = true;
  const adjustment =
    typeof row.adjustment === "string" &&
    sharedWords(row.adjustment, notes) >= 2
      ? row.adjustment.trim()
      : local.adjustment;
  const example =
    typeof row.example === "string" &&
    usableSentence(row.example) &&
    sharedWords(row.example, notes) >= 2
      ? prepareReadableMath(row.example.trim())
      : local.example
        ? prepareReadableMath(local.example)
        : null;
  return {
    understood,
    feedback,
    adjustment: understood
      ? null
      : adjustment
        ? prepareReadableMath(adjustment)
        : null,
    example: understood ? null : example,
    nextCheck: understood ? null : textOf(row.nextCheck) || local.nextCheck,
    teachBack: understood ? textOf(row.teachBack) || local.teachBack : null,
  };
}

function cleanNotes(notes: string): string {
  return notes.replace(/<!--[\s\S]*?-->/g, " ").replace(/^\s*source:.*$/gim, "");
}

/** A sentence a student can learn from, not a file header or a citation. */
export function usableSentence(sentence: string): boolean {
  const text = sentence.trim();
  if (text.length < 40 || text.length > 280) return false;
  if (text.startsWith("#") || text.startsWith("|")) return false;
  return !/<!--|-->|^\s*source:|citation|what it is|local file:|how to use/i.test(
    text,
  );
}

function exampleFrom(notes: string, fallback: string): string {
  const sentences = notes
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim());
  const usable = sentences.filter(usableSentence);
  const withMath = usable.find((sentence) => sentence.includes("$"));
  const chosen = (withMath ?? usable[0] ?? fallback).replace(
    /^\s*[-*]\s*/,
    "",
  );
  return prepareReadableMath(chosen);
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 8
    ? value.trim()
    : null;
}
