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
  const understood = answerHits(text, opening);
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
  _answer: string,
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
  // A miss stays a miss. The model, and a pasted explanation, cannot flip it.
  let understood = local.understood && row.understood !== false;
  if (!local.understood) understood = false;
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
    feedback: consistentFeedback(understood, unlist(feedback), local.feedback),
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
  return notes
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^\s*source:.*$/gim, "");
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

/** The note's points, in the student's words. A paste of the explanation, or a non-answer, misses. */
function answerHits(answer: string, opening: TutorOpening): boolean {
  if (answer.length < 12 || nonAnswer(answer)) return false;
  if (pastedExplanation(answer, opening.explanation)) return false;
  const expects = opening.expects.filter((phrase) => phrase.trim().length >= 4);
  if (expects.length === 0) return false;
  const hit = expects.filter((phrase) => phraseHit(answer, phrase)).length;
  return expects.length >= 3 ? hit >= 2 : hit >= 1;
}

function phraseHit(answer: string, phrase: string): boolean {
  if (answer.toLowerCase().includes(phrase.toLowerCase())) return true;
  return sharedWords(answer, phrase) >= 2 && phrase.split(/\s+/).length <= 6;
}

function nonAnswer(answer: string): boolean {
  return /^(idk|i don'?t know|no idea|huh|what|ok|okay|yes|no|sure|n\/a|none)\b[.!?\s]*$/i.test(
    answer,
  );
}

function pastedExplanation(answer: string, explanation: string): boolean {
  const left = answer.trim().toLowerCase().replace(/\s+/g, " ");
  const right = explanation.trim().toLowerCase().replace(/\s+/g, " ");
  if (left.length < 24 || right.length < 24) return false;
  if (left === right || right.includes(left) || left.includes(right))
    return true;
  const slice = right.slice(0, Math.min(80, right.length));
  return left.includes(slice);
}

function consistentFeedback(
  understood: boolean,
  feedback: string,
  fallback: string,
): string {
  const praise =
    /\b(strong|matches|nailed|correct|nice work|good answer)\b/i.test(feedback);
  const miss =
    /does not answer|doesn't answer|not quite|missing|off topic|does not match|doesn't match/i.test(
      feedback,
    );
  if (praise && miss) return fallback;
  if (understood && miss) return fallback;
  if (!understood && praise) return fallback;
  return feedback;
}

function unlist(text: string): string {
  return text
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function exampleFrom(notes: string, fallback: string): string {
  const sentences = notes
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => unlist(sentence.trim()));
  const usable = sentences.filter(usableSentence);
  const withMath = usable.find((sentence) => sentence.includes("$"));
  const chosen = withMath ?? usable[0] ?? unlist(fallback);
  return prepareReadableMath(chosen);
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 8
    ? value.trim()
    : null;
}
