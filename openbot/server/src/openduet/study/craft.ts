import type { SchoolSnapshot } from "@openbot/shared/study";
import { studyModels } from "../model-env";
import type { PageBlock } from "../page-content";
import {
  type PrivateAssignment,
  type PrivatePack,
  packCalendarSlice,
} from "../private-pack";
import { writeGuideFromNotes } from "./guide-write";
import { makePlan, type PlanDraft } from "./scheduler";
import { addDays, weekdayOf, zonedInstant, zonedParts } from "./time";

/**
 * Study guides, practice, tutoring and tonight's plan, built from the
 * student's own notes.
 *
 * A guide is four passes: an outline of the notes, a draft that copies only
 * what those notes say, a check that drops anything the notes do not support,
 * then blocks the page viewer already draws. A model may tighten wording when
 * a key is set. A sentence it adds that the notes do not support is dropped.
 */

export type NoteFile = { path: string; markdown: string };

export type GuideInput = {
  classId: string;
  className: string;
  /** none: recall from the notes only. No essay, no worked solution. */
  help: "full" | "hints" | "none";
  focus: string;
  due: string | null;
  notes: string;
  files: NoteFile[];
};

export type CraftedGuide = {
  title: string;
  summary: string;
  blocks: PageBlock[];
  /** Sentences removed because the notes do not say them. */
  dropped: number;
  markdown: string;
};

export type CraftedQuiz = {
  title: string;
  questions: {
    question: string;
    choices: [string, string, string, string];
    answer: number;
    explanation: string;
    topic: string;
  }[];
};

export type TutorStep = {
  topic: string;
  explanation: string;
  check: string;
  /** Phrases from the notes a good answer includes. Not shown up front. */
  expects: string[];
};

export type TutorCheck = {
  understood: boolean;
  missing: string[];
  teachBack: string;
};

const META =
  /https?:\/\/|notion\.com|this pack|copyright|generated \d|read-only/i;

type Section = { heading: string; sentences: string[] };

/** Outline, draft, check, and render. `extra` is optional model prose. */
export function craftGuide(
  input: GuideInput,
  extra: readonly string[] = [],
): CraftedGuide {
  const primary = pickFile(input.files, input.focus) ?? input.files[0];
  const source = primary?.markdown ?? "";
  const sections = primary ? outline(primary.markdown) : [];
  const terms = keyTerms(source).slice(0, 8);
  const events = timeline(source).slice(0, 8);
  let dropped = 0;
  const kept: Section[] = [];
  for (const section of selectSections(sections, 6)) {
    const sentences = section.sentences.filter((sentence) => {
      if (keepSentence(sentence, source)) return true;
      dropped += 1;
      return false;
    });
    if (sentences.length > 0)
      kept.push({ heading: section.heading, sentences: sentences.slice(0, 2) });
  }
  for (const sentence of extra) {
    if (!keepSentence(sentence, source)) dropped += 1;
  }
  const questions = recallQuestions(terms, input);
  const title = clip(`${input.className} study guide`, 80);
  const summary = clip(
    input.due ? `${input.focus} · due ${input.due}` : input.focus,
    140,
  );
  const blocks: PageBlock[] = [];
  blocks.push({
    type: "text",
    text: intro(input),
  });
  for (const section of kept) {
    blocks.push({ type: "heading", text: clip(section.heading, 120) });
    blocks.push({
      type: "text",
      text: clip(section.sentences.join(" "), 2000),
    });
  }
  if (terms.length > 0) {
    blocks.push({ type: "heading", text: "Key terms" });
    blocks.push({
      type: "table",
      columns: ["Term", "Remember"],
      rows: terms.map((term) => [
        clip(term.term, 60),
        clip(term.remember, 240),
      ]),
    });
  }
  if (events.length > 0) {
    blocks.push({ type: "heading", text: "Timeline" });
    blocks.push({
      type: "timeline",
      items: events.map((event) => ({
        date: clip(event.date, 60),
        title: clip(event.title, 120),
        ...(event.text ? { text: clip(event.text, 300) } : {}),
      })),
    });
  }
  if (questions.length > 0 && input.help !== "none") {
    blocks.push({ type: "heading", text: "Practice" });
    blocks.push({
      type: "bullets",
      items: questions.map((item) => clip(item.prompt, 300)),
    });
    blocks.push({ type: "heading", text: "Answers" });
    blocks.push({
      type: "table",
      columns: ["Prompt", "Answer"],
      rows: questions.map((item) => [
        clip(item.prompt, 240),
        clip(item.answer, 240),
      ]),
    });
  } else if (input.help === "none") {
    blocks.push({
      type: "text",
      text: "This class does not allow AI on graded work. The notes above are for review. They are not an answer to turn in.",
    });
  }
  return {
    title,
    summary,
    blocks,
    dropped,
    markdown: renderMarkdown(title, blocks),
  };
}

/** Multiple choice from the notes. Refuses a class set to no help. */
export function craftQuiz(
  input: GuideInput,
): CraftedQuiz | { refused: string } {
  if (input.help === "none") {
    return {
      refused: `${input.className} is set to no AI help, so no practice test was made.`,
    };
  }
  const source =
    (pickFile(input.files, input.focus) ?? input.files[0])?.markdown ?? "";
  const terms = keyTerms(source);
  if (terms.length < 4) {
    return {
      refused:
        "The notes don't have enough distinct terms for a fair quiz yet.",
    };
  }
  const questions = terms.slice(0, 4).flatMap((term) => {
    const others = terms
      .filter((item) => item.term !== term.term)
      .map((item) => item.remember);
    const choices = uniqueChoices(term.remember, others, term.term);
    if (!choices) return [];
    const remember = clip(readable(term.remember), 180);
    return [
      {
        question: clip(`What should you remember about ${term.term}?`, 400),
        choices,
        answer: choices.findIndex(
          (choice) => sameWords(choice) === sameWords(remember),
        ),
        explanation: clip(readable(term.remember), 500),
        topic: clip(term.term, 80),
      },
    ];
  });
  const usable = questions.filter((item) => item.answer >= 0);
  if (usable.length < 2) {
    return {
      refused:
        "The notes don't have enough distinct terms for a fair quiz yet.",
    };
  }
  return {
    title: clip(`${input.className} practice`, 120),
    questions: usable.slice(0, 4),
  };
}

export type WrittenQuestion = {
  id: string;
  kind: "short" | "free";
  prompt: string;
  /** The note's own wording, shown after grading. */
  answer: string;
  topic: string;
  /** Phrases a full-credit answer includes. Not shown until the check. */
  expects: string[];
};

export type WrittenGrade = {
  id: string;
  kind: "short" | "free";
  prompt: string;
  topic: string;
  correct: boolean;
  partial: boolean;
  explanation: string;
};

/**
 * Short answer plus one free-response prompt (an SAQ-style explain, or a
 * calc rule). Graded from the notes, not by a model.
 */
export function craftWritten(
  input: GuideInput,
): { questions: WrittenQuestion[] } | { refused: string } {
  if (input.help === "none") {
    return {
      refused: `${input.className} is set to no AI help, so no practice test was made.`,
    };
  }
  const source =
    (pickFile(input.files, input.focus) ?? input.files[0])?.markdown ?? "";
  const terms = keyTerms(source);
  const shorts = terms.slice(0, 2).flatMap((term, index) => {
    const expects = expectsFrom(term.remember);
    if (expects.length === 0) return [];
    return [
      {
        id: `s${index + 1}`,
        kind: "short" as const,
        prompt: clip(
          `In one sentence, what do the notes say about ${term.term}?`,
          300,
        ),
        answer: clip(term.remember, 400),
        topic: clip(term.term, 80),
        expects,
      },
    ];
  });
  const free = freeResponse(input, terms);
  const questions = free ? [...shorts, free] : shorts;
  if (questions.length === 0) {
    return {
      refused: "The notes don't have enough to write a fair question yet.",
    };
  }
  return { questions };
}

/** Full credit when every note phrase is there. Partial when some are. */
export function gradeWritten(
  questions: readonly WrittenQuestion[],
  answers: readonly { id: string; text: string }[],
): WrittenGrade[] {
  return questions.map((question) => {
    const text =
      answers.find((item) => item.id === question.id)?.text.trim() ?? "";
    const missing = question.expects.filter(
      (phrase) => !text.toLowerCase().includes(phrase.toLowerCase()),
    );
    const hit = question.expects.length - missing.length;
    const correct = question.expects.length > 0 && missing.length === 0;
    const partial = !correct && hit > 0;
    return {
      id: question.id,
      kind: question.kind,
      prompt: question.prompt,
      topic: question.topic,
      correct,
      partial,
      explanation: correct
        ? "That matches your notes."
        : `The notes say: ${question.answer}`,
    };
  });
}

/** One concept from the notes, then a check, then teach-back. */
export function craftTutor(
  input: GuideInput,
  topic: string,
): TutorStep | { refused: string } {
  if (input.help === "none") {
    return {
      refused: `${input.className} is set to no AI help. Review your own notes, and don't ask for the graded work.`,
    };
  }
  const primary = pickFile(input.files, topic || input.focus) ?? input.files[0];
  const source = primary?.markdown ?? "";
  const sections = primary ? outline(primary.markdown) : [];
  const useful = sections.filter(
    (section) =>
      !/review guide|citation|how to use|source/i.test(section.heading),
  );
  const pool = useful.length > 0 ? useful : sections;
  const match =
    pool.find((section) =>
      section.heading.toLowerCase().includes(topic.toLowerCase()),
    ) ?? pool[0];
  if (!match || match.sentences.length === 0) {
    return { refused: "Those notes don't have a section to teach from yet." };
  }
  const sentences = match.sentences.filter((sentence) =>
    keepSentence(sentence, source),
  );
  const explanation = sentences.slice(0, 2).join(" ");
  const points = distinctive(explanation).slice(0, 3);
  const expects =
    points.length > 0 ? points : [explanation.split(" ").slice(0, 6).join(" ")];
  return {
    topic: match.heading,
    explanation,
    check: `In your own words, what do the notes say about ${match.heading}?`,
    expects,
  };
}

/** A teach-back is understood when it uses the note's own points. */
export function checkTeachBack(step: TutorStep, answer: string): TutorCheck {
  const missing = step.expects.filter(
    (phrase) => !answer.toLowerCase().includes(phrase.toLowerCase()),
  );
  return {
    understood: missing.length === 0,
    missing,
    teachBack: missing.length
      ? `Teach it back in one or two sentences, and include ${missing[0]}.`
      : "Teach it back once more, as if to a classmate who missed class.",
  };
}

/** One evening, tests and quizzes first, fitted around classes. */
export function planTonight(pack: PrivatePack, now: Date): PlanDraft {
  const parts = zonedParts(now, pack.timeZone);
  const soon = addDays(parts.date, 3);
  const tasks = pack.assignments
    .filter((item) => item.due >= parts.date && item.due <= soon)
    .map((item) => ({
      id: item.id,
      title: item.title,
      classId: item.classId,
      due: item.due,
      dueTime: item.dueTime,
      minutes: item.kind === "test" ? 50 : item.kind === "quiz" ? 30 : 25,
    }));
  const priority = [...tasks]
    .sort((a, b) => rank(b.id, pack, parts.date) - rank(a.id, pack, parts.date))
    .map((task) => task.id);
  const slice = packCalendarSlice(
    pack,
    parts.date,
    addDays(parts.date, 1),
    now,
  );
  const plan = makePlan(
    {
      today: parts.date,
      nowMinute: parts.minute,
      tasks,
      busy: slice.events.map((event) => ({
        id: event.id,
        date: event.date,
        start: event.start,
        end: event.end,
        kind: "commitment" as const,
      })),
      availability: () => ({
        enabled: true,
        start: "16:00",
        end: "22:00",
        cap: 120,
        focus: 25,
        rest: 5,
      }),
      classBufferMin: 10,
      minutes: 120,
      days: 1,
      priority,
    },
    {
      newId() {
        return `tonight-${Math.random().toString(36).slice(2, 8)}`;
      },
    },
  );
  const scheduled = new Set(plan.blocks.map((block) => block.assignmentId));
  const left = tasks.filter((task) => !scheduled.has(task.id)).slice(0, 4);
  if (left.length === 0) return plan;
  return {
    ...plan,
    warnings: [
      ...plan.warnings,
      `Also due soon, if you have time: ${left.map((task) => task.title).join("; ")}`,
    ],
  };
}

export function schoolSnapshotFromPack(
  pack: PrivatePack,
  now: Date,
): SchoolSnapshot {
  const slice = packCalendarSlice(pack, "2026-01-01", "2026-01-01", now);
  return {
    syncedAt: now.toISOString(),
    timeZone: pack.timeZone,
    classes: slice.classes,
    couldNotRead: [],
    assignments: pack.assignments.map((item) => ({
      id: item.id,
      classId: item.classId,
      title: item.title,
      kind: item.kind,
      status: "open" as const,
      due: zonedInstant(item.due, item.dueTime, pack.timeZone).toISOString(),
      dueDate: item.due,
      dueTime: item.dueTime,
      points: item.points,
      grade: null,
      help: item.help,
      minutes: item.estimateMin,
      link: item.source,
      noticeId: `pack:${item.id}`,
    })),
  };
}

/**
 * Ask the guide model to add nothing the notes do not already say.
 * Without a key, the drafted guide is the one that is saved.
 */
export async function polishGuide(
  guide: CraftedGuide,
  source: string,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
  input?: GuideInput,
): Promise<CraftedGuide> {
  if (input) {
    const written = await writeGuideFromNotes(input, env, fetchImpl);
    if (written) return written;
    return guide;
  }
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return guide;
  const model = studyModels(env).guide;
  let text = "";
  try {
    const response = await fetchImpl(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "Rewrite for a high school student. Use only facts from the notes. No filler. No citations. Return plain sentences separated by blank lines.",
            },
            {
              role: "user",
              content: `Notes:\n${source.slice(0, 12000)}\n\nDraft:\n${guide.markdown.slice(0, 6000)}`,
            },
          ],
        }),
      },
    );
    if (!response.ok) return guide;
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    text = body.choices?.[0]?.message?.content ?? "";
  } catch {
    return guide;
  }
  const added = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 40 && keepSentence(line, source));
  if (added.length === 0) return guide;
  return {
    ...guide,
    blocks: [
      guide.blocks[0] ?? { type: "text", text: added[0] ?? "" },
      { type: "heading", text: "From your notes" },
      { type: "text", text: clip(added.slice(0, 4).join(" "), 2000) },
      ...guide.blocks.slice(1),
    ],
    markdown: renderMarkdown(guide.title, [
      { type: "text", text: clip(added.slice(0, 4).join(" "), 2000) },
      ...guide.blocks,
    ]),
  };
}

const SKIP_TERM =
  /^(why it mattered|who|background|interests|arguable(\s+angle)?|not in your files|source tags?|citations?|flags?|i can|default rule|red|yellow|green|note|notes|reviewed by)$/i;

/** A file name or a worksheet index, not something to memorize. */
function inventory(term: string, remember: string): boolean {
  if (/^=/.test(remember)) return true;
  if (
    /\b\d+\.\d+\b/.test(term) &&
    /notes|homework|warm|activity|practice|key|review/i.test(
      `${term} ${remember}`,
    )
  )
    return true;
  return /notes and homework|warm-up|for each|practice - practice/i.test(
    remember,
  );
}

function fluff(text: string): boolean {
  return (
    META.test(text) ||
    /arguable angle|not from your files|not in your files|source tags|what it is:|what happened:|why it mattered:|check with |\[fixed #|reviewed by|built only from|copy of claude|sources\/ folder|speech-to-text|notes \/ hw|key for each|^\d+\.\d+\s+(notes|activity)|\/workspace|\.md\b|local reviewed|evaluate the extent|source page|handwritten key|lecture timestamp/i.test(
      text,
    )
  );
}

/**
 * A short tutor pass on the cheaper model. Anything the notes do not say is
 * dropped, and with no key the drafted explanation is the one that is shown.
 */
export async function polishTutor(
  step: TutorStep,
  source: string,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<TutorStep> {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return step;
  let text = "";
  try {
    const response = await fetchImpl(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: studyModels(env).fast,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "Explain this to a high school student in two sentences. Use only the notes. No filler.",
            },
            {
              role: "user",
              content: `Notes:\n${source.slice(0, 6000)}\n\nDraft:\n${step.explanation}`,
            },
          ],
        }),
      },
    );
    if (!response.ok) return step;
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    text = body.choices?.[0]?.message?.content ?? "";
  } catch {
    return step;
  }
  const added = text
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => keepSentence(line, source));
  if (added.length === 0) return step;
  const explanation = added.slice(0, 2).join(" ");
  const points = distinctive(explanation).slice(0, 3);
  return {
    ...step,
    explanation,
    expects: points.length > 0 ? points : step.expects,
  };
}

function outline(markdown: string): Section[] {
  const sections: Section[] = [];
  let heading = "";
  let body: string[] = [];
  const flush = () => {
    const sentences = body
      .map((sentence) => readable(sentence))
      .filter(
        (sentence) =>
          sentence.length >= 40 &&
          sentence.length <= 280 &&
          !sentence.includes("|") &&
          !fluff(sentence) &&
          !/^for\b/i.test(sentence),
      );
    if (heading && !fluff(heading) && sentences.length > 0)
      sections.push({ heading: readable(heading), sentences });
    body = [];
  };
  for (const line of markdown.split("\n")) {
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (headingMatch?.[2]) {
      flush();
      heading = headingMatch[2];
      continue;
    }
    if (line.trim() && !fluff(line)) body.push(line.trim());
  }
  flush();
  return sections;
}

/** The sections worth a sitting: high-value first, then back in note order. */
function selectSections(sections: Section[], limit: number): Section[] {
  const ranked = sections.map((section, index) => ({
    section,
    index,
    score: sectionScore(section),
  }));
  const good = ranked.filter((row) => row.score > 0);
  const pool = good.length >= 2 ? good : ranked;
  const picked = [...pool].sort((a, b) => b.score - a.score).slice(0, limit);
  picked.sort((a, b) => a.index - b.index);
  return picked.map((row) => row.section);
}

function sectionScore(section: Section): number {
  if (
    /source|citation|gap|flag|how to use|arguable|what this file|reviewed by/i.test(
      section.heading,
    )
  )
    return -5;
  let score = Math.min(section.sentences.length, 3);
  if (/\d{4}/.test(section.heading)) score += 2;
  if (section.sentences.some((sentence) => /\d{4}/.test(sentence))) score += 1;
  return score;
}

function keyTerms(markdown: string): { term: string; remember: string }[] {
  const found: { term: string; remember: string }[] = [];
  const seen = new Set<string>();
  const add = (term: string, remember: string) => {
    const cleanTerm = readable(term)
      .replace(/[.:—-]+$/g, "")
      .trim();
    const clean = readable(remember);
    const key = cleanTerm.toLowerCase();
    if (
      cleanTerm.length < 2 ||
      cleanTerm.length > 40 ||
      clean.length < 12 ||
      seen.has(key) ||
      SKIP_TERM.test(cleanTerm) ||
      /arguable|not in your|not from your|source tag|citation/i.test(
        cleanTerm,
      ) ||
      /^(how to|what it|what happened|in one|in two|why it|background|for|cite key|sources|review)$/i.test(
        cleanTerm,
      ) ||
      /workspace|\.md\b|my synthesis|lecture timestamp/i.test(clean) ||
      inventory(cleanTerm, clean) ||
      fluff(clean) ||
      /not from the notes|comprehensive overview/i.test(clean)
    )
      return;
    seen.add(key);
    found.push({ term: cleanTerm, remember: clean });
  };
  for (const match of markdown.matchAll(
    /\*\*([^*]{2,60})\*\*\s*[—.:-]?\s*([^\n]{12,400})/g,
  )) {
    if (match[1] && match[2]) add(match[1], match[2]);
  }
  for (const match of markdown.matchAll(
    /^([A-Z][^:\n]{2,40}):\s+([^\n]{12,240})$/gm,
  )) {
    if (match[1] && match[2]) add(match[1], match[2]);
  }
  return found;
}

function timeline(
  markdown: string,
): { date: string; title: string; text?: string }[] {
  const events: { date: string; title: string; text?: string; year: number }[] =
    [];
  for (const line of markdown.split("\n")) {
    if (
      line.trim().startsWith("#") ||
      line.includes("|") ||
      fluff(line) ||
      /updated|this text is|reviewed guide|\bfor:/i.test(line)
    )
      continue;
    const text = readable(line);
    const match = /\b(1[5-9]\d{2}|20\d{2})\b/.exec(text);
    if (!match?.[1] || text.length < 20) continue;
    const wrapped = new RegExp(`\\(\\s*${match[1]}\\s*\\)`);
    const title = (
      wrapped.test(text)
        ? text.replace(wrapped, "")
        : text.replace(match[1], "")
    )
      .replace(/^[\s:.,\-–—]+/, "")
      .replace(/\(\s*\)/g, "")
      .trim();
    events.push({
      date: match[1],
      title: clip(title || text, 120),
      text: clip(text, 300),
      year: Number(match[1]),
    });
  }
  events.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
  const unique: typeof events = [];
  for (const event of events) {
    if (
      unique.some(
        (item) => item.title.slice(0, 40) === event.title.slice(0, 40),
      )
    )
      continue;
    unique.push(event);
  }
  if (unique.length <= 8) return unique;
  const step = (unique.length - 1) / 7;
  return Array.from({ length: 8 }, (_, index) => {
    const event = unique[Math.round(index * step)];
    return event ?? unique[0];
  }).filter((event): event is (typeof unique)[number] => Boolean(event));
}

function recallQuestions(
  terms: { term: string; remember: string }[],
  input: GuideInput,
): { prompt: string; answer: string }[] {
  const prompts = terms.slice(0, 5).map((term) => ({
    prompt: `What should you remember about ${term.term}?`,
    answer: term.remember,
  }));
  if (input.help === "none" || !/history|apush|calc/i.test(input.className))
    return prompts;
  const style = /calc/i.test(input.className)
    ? `State the rule from the notes for ${input.focus}.`
    : `In two or three sentences, explain one development covered in ${input.focus}. Use only what the notes say.`;
  return [
    ...prompts.slice(0, 4),
    {
      prompt: style,
      answer: terms[0]?.remember ?? "Use the points in the notes above.",
    },
  ];
}

function keepSentence(sentence: string, source: string): boolean {
  const clean = sentence.replace(/\s+/g, " ").trim();
  if (clean.length < 40 || META.test(clean)) return false;
  const needle = clean
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .slice(0, 48);
  const hay = source.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  return needle.length >= 24 && hay.includes(needle);
}

function distinctive(text: string): string[] {
  return text
    .split(/[,.]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8 && part.length <= 40)
    .slice(0, 3);
}

function pickFile(files: NoteFile[], focus: string): NoteFile | null {
  if (files.length === 0) return null;
  const words = focus.toLowerCase();
  const ranked = files.map((file) => ({
    file,
    score: score(file.path, words),
  }));
  const best = Math.max(...ranked.map((row) => row.score));
  if (best > 0) {
    return (
      ranked
        .filter((row) => row.score === best)
        .sort((a, b) => b.file.markdown.length - a.file.markdown.length)[0]
        ?.file ?? null
    );
  }
  return (
    [...files].sort(
      (a, b) =>
        fileRecency(b.path) - fileRecency(a.path) ||
        b.markdown.length - a.markdown.length,
    )[0] ?? null
  );
}

function score(path: string, words: string): number {
  const name = path.toLowerCase();
  let total = 0;
  const period = /period\s*(\d+)/.exec(words);
  if (period?.[1] && name.includes(`period-${period[1]}`)) total += 8;
  if (period?.[1] && name.includes(`period-${period[1]}-deep`)) total += 4;
  const unit = /unit\s*(\d+)/.exec(words);
  if (unit?.[1] && name.includes(`unit${unit[1]}`)) total += 8;
  if (/\bleq\b/.test(words) && name.includes("leq")) total += 8;
  if (name.includes("deep") || name.includes("review")) total += 2;
  if (name.includes("lecture")) total -= 2;
  return total;
}

function fileRecency(path: string): number {
  const period = /period-(\d+)/.exec(path);
  if (period?.[1]) return 100 + Number(period[1]);
  const unit = /unit(\d+)/.exec(path);
  if (unit?.[1]) return Number(unit[1]);
  return 0;
}

/**
 * Notes the student can scan. Citations and source labels come off.
 * Math stays in `$...$` so the page can draw it, instead of `int _a^b`.
 */
function readable(value: string): string {
  const math: string[] = [];
  const hold = (tex: string) => {
    math.push(tex.replace(/\\,/g, "").replace(/\s+/g, " ").trim());
    return `\uE000${math.length - 1}\uE000`;
  };
  let text = value
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, tex: string) => hold(tex))
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, tex: string) => hold(tex))
    .replace(/\\\(([^)]*)\\\)/g, (_, tex: string) => hold(tex))
    .replace(/\$([^$\n]+)\$/g, (_, tex: string) => hold(tex))
    .replace(
      /\\(?:displaystyle\s*)?(?:int|frac|dfrac|sum|sqrt|lim)(?:\{[^{}]*\}|\[[^\]]*\]|[_^\\]|[a-zA-Z0-9])+/g,
      (tex) => hold(tex),
    );
  text = text
    .replace(/\\(?:displaystyle|left|right|text)/g, "")
    .replace(/\\cdot/g, "·")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\,/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\[[^\]]{1,80}\]/g, (whole) => {
      const inner = whole.slice(1, -1);
      return /\d/.test(inner) &&
        (/[A-Za-z]/.test(inner) || /\d+\.\d+/.test(inner))
        ? ""
        : whole;
    })
    .replace(/\s*\([^)]{0,30}\bpp\.[^)]*\)/gi, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[†⚑⚠]/g, "")
    .replace(
      /^(?:what it is|what happened|why it mattered|background|who|interests):\s*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();
  return text
    .replace(/\uE000(\d+)\uE000/g, (_, index: string) => {
      const tex = math[Number(index)] ?? "";
      return tex ? `$${tex}$` : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function sameWords(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueChoices(
  correct: string,
  pool: readonly string[],
  seed: string,
): [string, string, string, string] | null {
  const right = clip(readable(correct), 180);
  if (right.length < 8) return null;
  const choices = [right];
  for (const item of pool) {
    const text = clip(readable(item), 180);
    if (
      text.length < 8 ||
      choices.some((choice) => sameWords(choice) === sameWords(text))
    )
      continue;
    choices.push(text);
    if (choices.length === 4) break;
  }
  for (const filler of [
    "None of these",
    "The notes do not say",
    "A later unit",
  ]) {
    if (choices.length === 4) break;
    if (!choices.some((choice) => sameWords(choice) === sameWords(filler)))
      choices.push(filler);
  }
  if (choices.length < 4) return null;
  return shuffle(choices, seed) as [string, string, string, string];
}

function expectsFrom(text: string): string[] {
  const clean = readable(text);
  const points = distinctive(clean);
  if (points.length > 0) return points.slice(0, 2);
  const words = clean.split(" ").slice(0, 6).join(" ");
  return words.length >= 8 ? [words] : [];
}

function freeResponse(
  input: GuideInput,
  terms: { term: string; remember: string }[],
): WrittenQuestion | null {
  const basis = terms[0];
  if (!basis) return null;
  const expects = expectsFrom(basis.remember);
  if (expects.length === 0) return null;
  const history = /history|apush/i.test(input.className);
  const calc = /calc/i.test(input.className);
  const prompt = history
    ? `Short response, in the style of an SAQ. In two or three sentences, explain one development in ${input.focus}. Use only what your notes say.`
    : calc
      ? `State the rule from your notes for ${input.focus}, and what it is used for.`
      : `Explain ${input.focus} in two or three sentences, using only your notes.`;
  return {
    id: "f1",
    kind: "free",
    prompt: clip(prompt, 400),
    answer: clip(`${basis.term}: ${basis.remember}`, 500),
    topic: clip(input.focus, 80),
    expects,
  };
}

function rank(id: string, pack: PrivatePack, today: string): number {
  const item = pack.assignments.find((row) => row.id === id);
  if (!item) return 0;
  const kind = item.kind === "test" ? 3 : item.kind === "quiz" ? 2 : 1;
  return (item.due === today ? 10 : 0) + kind;
}

function shuffle(choices: string[], seed: string): string[] {
  const copy = [...choices];
  let hash = 0;
  for (const char of seed) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const swap = hash % (index + 1);
    const current = copy[index];
    const other = copy[swap];
    if (current !== undefined && other !== undefined) {
      copy[index] = other;
      copy[swap] = current;
    }
  }
  return copy;
}

function intro(input: GuideInput): string {
  const when = input.due ? ` Due ${input.due}.` : "";
  const rule =
    input.help === "none"
      ? " AI help is not allowed on graded work for this class."
      : input.help === "hints"
        ? " Hints only: this is for studying, not for work you will turn in."
        : "";
  return clip(
    `${input.focus}.${when}${rule} Taken from your class notes.`,
    2000,
  );
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function renderMarkdown(title: string, blocks: PageBlock[]): string {
  const lines = [`# ${title}`, ""];
  for (const block of blocks) {
    if (block.type === "heading") lines.push(`## ${block.text}`, "");
    else if (block.type === "text") lines.push(block.text, "");
    else if (block.type === "bullets") {
      for (const item of block.items) lines.push(`- ${item}`);
      lines.push("");
    } else if (block.type === "table") {
      lines.push(`| ${block.columns.join(" | ")} |`);
      lines.push(`| ${block.columns.map(() => "---").join(" | ")} |`);
      for (const row of block.rows) lines.push(`| ${row.join(" | ")} |`);
      lines.push("");
    } else if (block.type === "timeline") {
      for (const item of block.items)
        lines.push(`- ${item.date}: ${item.title}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function guideInputFromAssignment(
  pack: PrivatePack,
  assignment: PrivateAssignment,
  files: NoteFile[],
): GuideInput {
  const schoolClass = pack.classes.find((row) => row.id === assignment.classId);
  return {
    classId: assignment.classId,
    className: schoolClass?.name ?? assignment.classId,
    help: assignment.help,
    focus: assignment.title,
    due: assignment.due,
    notes: "",
    files,
  };
}

export function weekdayName(date: string): string {
  return (
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayOf(date)] ?? ""
  );
}
