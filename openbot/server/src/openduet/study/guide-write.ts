import { studyModels } from "../model-env";
import type { PageBlock } from "../page-content";
import { pageBlockSchema } from "../page-content";
import type { CraftedGuide, GuideInput } from "./craft";

/**
 * A study guide written from the student's notes.
 *
 * The page is the length of one sitting: a point, a few sections, the terms
 * worth memorizing, a timeline when the notes have dates, and retrieval
 * questions with the answers after them. Anything the notes do not support
 * is left out. Citations, lecture asides, and source labels are not part of
 * the page.
 */

type ModelGuide = {
  title?: string;
  summary?: string;
  opening?: string;
  sections?: { heading?: string; text?: string }[];
  terms?: { term?: string; remember?: string }[];
  timeline?: { date?: string; title?: string; text?: string }[];
  practice?: { prompt?: string; answer?: string }[];
};

const SOURCE_LABEL =
  /^(?:[-*]\s*)?(?:\*\*)?(?:what it is|what happened|why it mattered|background|who|interests)(?:\*\*)?:\s*/i;

/** Take the filing notes off a line the student should not have to read. */
export function scrubGuideText(value: string): string {
  return value
    .replace(/[†⚑⚠]/g, "")
    .replace(/\[[^\]]{0,90}\]/g, (whole) => {
      const inner = whole.slice(1, -1);
      if (
        /lecture|notes|outline|amsco|mm:ss|\d:\d|p\d|p\.\d|key\b/i.test(
          inner,
        ) ||
        (/\d/.test(inner) && /[A-Za-z]/.test(inner))
      )
        return "";
      return whole;
    })
    .replace(SOURCE_LABEL, "")
    .replace(/\barguable angle\b[^.?!]*/gi, "")
    .replace(/\bnot in your files\b[^.?!]*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The notes, without the wrapper that talks about the files instead of the class. */
export function prepareNotes(markdown: string): string {
  const kept: string[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push("");
      continue;
    }
    if (trimmed.startsWith(">")) continue;
    if (
      /^(source tags|citations|flags|coverage gaps|cite key|contents)\b/i.test(
        trimmed.replace(/^#+\s*/, ""),
      )
    )
      continue;
    if (
      /arguable angle|not in your files|not from your files|reviewed by|built only from|speech-to-text|lecture timestamp|my synthesis|correction_ledger|changes_ledger/i.test(
        trimmed,
      )
    )
      continue;
    if (
      /^#{1,6}\s+.*(source|citation|how to use this|conflicts and open)/i.test(
        trimmed,
      )
    )
      continue;
    const clean = scrubGuideText(trimmed);
    if (clean.length < 2) continue;
    kept.push(clean);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function scoreFile(path: string, focus: string): number {
  const name = path.toLowerCase();
  const words = focus.toLowerCase();
  let total = 0;
  const period = /period\s*(\d+)/.exec(words);
  if (period?.[1] && name.includes(`period-${period[1]}`)) total += 8;
  if (period?.[1] && name.includes(`period-${period[1]}-deep`)) total += 4;
  if (
    period?.[1] &&
    name.includes("timeline") &&
    name.includes(`period-${period[1]}`)
  )
    total += 3;
  const unit = /unit\s*(\d+)/.exec(words);
  if (unit?.[1] && name.includes(`unit${unit[1]}`)) total += 8;
  const chapter = /ch(?:apter)?s?\s*(\d+)/.exec(words);
  if (chapter?.[1] && name.includes(`ch${chapter[1]}`)) total += 6;
  if (/\bleq\b/.test(words) && name.includes("leq")) total += 10;
  if (/\bchem\b|units?\s*1/.test(words) && name.includes("chem")) total += 4;
  if (name.includes("deep") || name.includes("review")) total += 1;
  if (name.includes("lecture")) total -= 2;
  return total;
}

/** The notes that match this guide, cleaned and short enough to send. */
export function notesForGuide(input: GuideInput): string {
  const ranked = [...input.files]
    .map((file) => ({ file, score: scoreFile(file.path, input.focus) }))
    .sort(
      (a, b) =>
        b.score - a.score || b.file.markdown.length - a.file.markdown.length,
    );
  const pieces: string[] = [];
  let budget = 48_000;
  for (const row of ranked) {
    if (pieces.length > 0 && row.score <= 0) break;
    const clean = prepareNotes(row.file.markdown);
    if (clean.length < 40) continue;
    pieces.push(fitNotes(clean, budget));
    budget -= clean.length;
    if (pieces.length >= 2 || budget < 2_000) break;
  }
  if (pieces.length === 0 && ranked[0])
    pieces.push(fitNotes(prepareNotes(ranked[0].file.markdown), 48_000));
  return pieces.join("\n\n").trim();
}

/** Keep the opening and the close when a file is longer than the model should read. */
function fitNotes(clean: string, budget: number): string {
  if (clean.length <= budget) return clean;
  const head = Math.floor(budget * 0.7);
  const tail = Math.max(0, budget - head - 48);
  return `${clean.slice(0, head)}\n\n${clean.slice(-tail)}`;
}

function groundedSentences(text: string, source: string): string {
  const hay = source.toLowerCase();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const kept = sentences.filter((sentence) => {
    if (
      /arguable|not in your files|what it is:|what happened:|why it mattered:|lecture timestamp|comprehensive overview|in this guide|it is important to note|delve/i.test(
        sentence,
      )
    )
      return false;
    const years = sentence.match(/\b\d{4}\b/g) ?? [];
    if (years.some((year) => !source.includes(year))) return false;
    const words = sentence
      .toLowerCase()
      .replace(/[^a-z0-9$\\ ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 5 && !word.startsWith("$"));
    if (words.length === 0) return sentence.length > 12;
    const hits = words.filter((word) => hay.includes(word)).length;
    return hits >= Math.min(2, words.length);
  });
  return kept.join(" ");
}

function clipAt(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = cut.lastIndexOf(". ");
  if (stop > max * 0.55) return cut.slice(0, stop + 1);
  return `${cut.trimEnd()}…`;
}

function subjectHint(input: GuideInput): string {
  const name = `${input.className} ${input.focus}`.toLowerCase();
  if (input.help === "none") {
    const math = /chem|calc|math|statistic/.test(name)
      ? " Write equations and scientific notation in LaTeX between dollar signs."
      : "";
    return `This class does not allow AI on graded work. Organize only what the notes say, for review. Do not write practice questions or answers that could be turned in. Each key term needs a specific fact.${math} Leave the timeline empty.`;
  }
  if (/calc|statistic|chem|math/.test(name)) {
    return "For formulas, units, and scientific notation, use LaTeX between single dollar signs, as in $\\int_a^b f(x)\\,dx=F(b)-F(a)$. A worked example ends with the finished result in math, then one sentence on the mistake that loses the point. Do not stop after naming the steps.";
  }
  if (/history|apush|english|latin/.test(name)) {
    return "Each section is a claim a student could use, then the names, dates, and what changed. Write it so it could support an essay, without writing the essay. One practice question asks for a claim and two pieces of evidence. The answer gives the claim and the evidence, not a full essay.";
  }
  return "Lead with the idea, then the fact that makes it stick.";
}

function promptFor(input: GuideInput, notes: string): string {
  return [
    "Write a study guide a strong high school student would actually use the night before.",
    "Length: about 700 to 1100 words. One sitting. Not a dump of the notes, and not a five-line summary.",
    "Shape:",
    "- title: the topic in a few words. Do not write study guide, night-before, or review sheet.",
    "- 4 to 6 sections. A short heading and one tight paragraph each. No walls of text.",
    "- terms: 6 to 8, each a term and one sentence",
    "- opening: two or three sentences on the point of this material",
    "- timeline: 6 to 10 dated events from the subject itself, only when the notes give those dates. Never a class calendar, a homework due date, or an exam day. Otherwise an empty list.",
    "- practice: 4 questions that make the student retrieve a fact or a rule. Answers specific enough to check.",
    subjectHint(input),
    "Use only facts from the notes. If the notes do not say it, leave it out.",
    "No citations, brackets, page numbers, lecture times, daggers, or labels like What it is, What happened, Why it mattered, Background, Who.",
    "No filler and no talk about the files, the guide, or yourself.",
    `Class: ${input.className}`,
    `Focus: ${input.focus}`,
    "Return JSON with keys title, summary, opening, sections (heading, text), terms (term, remember), timeline (date, title, text), practice (prompt, answer).",
    "",
    "Notes:",
    notes,
  ].join("\n");
}

export async function writeGuideFromNotes(
  input: GuideInput,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<CraftedGuide | null> {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const notes = notesForGuide(input);
  if (notes.length < 80) return null;
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
          model: studyModels(env).guide,
          max_completion_tokens: 5000,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You write study guides from a student's own class notes. You return JSON only. You never add facts the notes do not contain.",
            },
            { role: "user", content: promptFor(input, notes) },
          ],
        }),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    text = body.choices?.[0]?.message?.content ?? "";
  } catch {
    return null;
  }
  return guideFromModelText(text, input, notes);
}

/** Turn the model's JSON into page blocks. Null when it is not a guide. */
export function guideFromModelText(
  text: string,
  input: GuideInput,
  source: string,
): CraftedGuide | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: ModelGuide;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as ModelGuide;
  } catch {
    return null;
  }
  let dropped = 0;
  const keep = (value: string) => {
    const scrubbed = scrubGuideText(value);
    const grounded = groundedSentences(scrubbed, source);
    const before = scrubbed.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    const after = grounded.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    dropped += Math.max(0, before - after);
    return grounded;
  };
  const blocks: PageBlock[] = [];
  const opening = keep(parsed.opening ?? "");
  if (opening.length >= 40)
    blocks.push({ type: "text", text: clipAt(opening, 700) });
  const sections = (parsed.sections ?? []).slice(0, 6);
  for (const section of sections) {
    const heading = scrubGuideText(section.heading ?? "");
    const body = keep(section.text ?? "");
    if (heading.length < 2 || body.length < 40) continue;
    if (/source|citation|how to use|arguable/i.test(heading)) continue;
    blocks.push({ type: "heading", text: clipAt(heading, 120) });
    blocks.push({ type: "text", text: clipAt(body, 900) });
  }
  const terms = (parsed.terms ?? [])
    .map((term) => ({
      term: scrubGuideText(term.term ?? ""),
      remember: keep(term.remember ?? ""),
    }))
    .filter(
      (term) =>
        term.term.length >= 2 &&
        term.term.length <= 60 &&
        term.remember.length >= 12 &&
        source.toLowerCase().includes(term.term.toLowerCase().slice(0, 24)),
    )
    .slice(0, 8);
  if (terms.length >= 4) {
    blocks.push({ type: "heading", text: "Key terms" });
    blocks.push({
      type: "table",
      columns: ["Term", "Remember"],
      rows: terms.map((term) => [
        clipAt(term.term, 60),
        clipAt(term.remember, 240),
      ]),
    });
  }
  const events = (parsed.timeline ?? [])
    .map((event) => ({
      date: scrubGuideText(event.date ?? ""),
      title: scrubGuideText(event.title ?? ""),
      text: keep(event.text ?? ""),
    }))
    .filter((event) => {
      const blob = `${event.date} ${event.title} ${event.text}`;
      if (
        /\b202[4-9]\b/.test(blob) ||
        /homework|agenda|due at|exam window|assignment snapshot|worksheet/i.test(
          blob,
        )
      )
        return false;
      const year = /\b(\d{4})\b/.exec(`${event.date} ${event.title}`)?.[1];
      if (year && !source.includes(year)) return false;
      const words = event.title
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 4);
      return (
        event.date.length > 0 &&
        words.some((word) => source.toLowerCase().includes(word))
      );
    })
    .slice(0, 10);
  if (events.length >= 3) {
    blocks.push({ type: "heading", text: "Timeline" });
    blocks.push({
      type: "timeline",
      items: events.map((event) => ({
        date: clipAt(event.date, 60),
        title: clipAt(event.title, 120),
        ...(event.text ? { text: clipAt(event.text, 300) } : {}),
      })),
    });
  }
  if (input.help === "none") {
    blocks.push({
      type: "text",
      text: "This class does not allow AI on graded work. The notes above are for review. They are not an answer to turn in.",
    });
  } else {
    const practice = (parsed.practice ?? [])
      .map((item) => ({
        prompt: scrubGuideText(item.prompt ?? ""),
        answer: keep(item.answer ?? ""),
      }))
      .filter((item) => item.prompt.length >= 12 && item.answer.length >= 12)
      .slice(0, 5);
    if (practice.length >= 3) {
      blocks.push({ type: "heading", text: "Practice" });
      blocks.push({
        type: "bullets",
        items: practice.map((item) => clipAt(item.prompt, 300)),
      });
      blocks.push({ type: "heading", text: "Answers" });
      blocks.push({
        type: "table",
        columns: ["Prompt", "Answer"],
        rows: practice.map((item) => [
          clipAt(item.prompt, 240),
          clipAt(item.answer, 240),
        ]),
      });
    }
  }
  const valid = blocks.filter(
    (block) => pageBlockSchema.safeParse(block).success,
  );
  const prose = valid.filter((block) => block.type === "heading").length;
  if (prose < 3) return null;
  const title = clipAt(
    scrubGuideText(parsed.title ?? "") || `${input.className}: ${input.focus}`,
    80,
  );
  const summary = clipAt(
    scrubGuideText(parsed.summary ?? "") || input.focus,
    140,
  );
  return {
    title,
    summary,
    blocks: valid,
    dropped,
    markdown: renderBlocks(title, valid),
  };
}

function renderBlocks(title: string, blocks: PageBlock[]): string {
  const lines = [`# ${title}`, ""];
  for (const block of blocks) {
    if (block.type === "heading") lines.push(`## ${block.text}`, "");
    else if (block.type === "text") lines.push(block.text, "");
    else if (block.type === "bullets") {
      for (const item of block.items) lines.push(`- ${item}`);
      lines.push("");
    } else if (block.type === "table") {
      lines.push(`| ${block.columns.join(" | ")} |`);
      for (const row of block.rows) lines.push(`| ${row.join(" | ")} |`);
      lines.push("");
    } else if (block.type === "timeline") {
      for (const item of block.items)
        lines.push(
          `- ${item.date}: ${item.title}${item.text ? ` — ${item.text}` : ""}`,
        );
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

/** Problems a person would notice on the page. Empty means it is fit to hand over. */
export function guideProblems(markdown: string): string[] {
  const problems: string[] = [];
  if (/what it is:|what happened:|why it mattered:/i.test(markdown))
    problems.push("source label");
  if (/[†⚑]/.test(markdown)) problems.push("dagger");
  if (/\[[A-Za-z][^\]]{0,40}\d/.test(markdown)) problems.push("citation");
  if (/int _a\^b/.test(markdown)) problems.push("raw tex");
  if (
    /in this guide|comprehensive overview|it is important to note|delve into/i.test(
      markdown,
    )
  )
    problems.push("filler");
  if (markdown.length < 500) problems.push("short");
  if (markdown.length > 14_000) problems.push("long");
  return problems;
}
