import { useEffect, useRef, useState } from "react";
import { PageText } from "@/components/duet/page-text";
import { SmallPill } from "@/components/shell/suggestion-card";
import type {
  PracticeItem,
  PracticePaper,
  PracticeResult,
} from "@/lib/study/practice";

/**
 * A quiz or a practice test. Timed is a choice before it starts. Math in the
 * notes is drawn. The result names what was missed and says it is in review.
 */

export function PracticeSession({
  paper,
  onGrade,
  busy,
}: {
  paper: PracticePaper;
  onGrade: (
    answers: { id: string; choice?: number; text?: string }[],
  ) => Promise<PracticeResult>;
  busy: boolean;
}) {
  const [timed, setTimed] = useState(paper.mode === "test");
  const [started, setStarted] = useState(
    paper.mode === "quiz" || paper.result != null,
  );
  const [left, setLeft] = useState(paper.suggestedMinutes * 60);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PracticeResult | null>(paper.result);
  const [error, setError] = useState("");
  const grading = useRef(false);
  const submitRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  async function submit(force = false) {
    setError("");
    const answers = paper.items.map((item) =>
      item.kind === "mcq"
        ? { id: item.id, choice: picks[item.id] ?? -1 }
        : { id: item.id, text: texts[item.id] ?? "" },
    );
    const incomplete = answers.some(
      (answer) =>
        ("choice" in answer && (answer.choice ?? -1) < 0) ||
        ("text" in answer && (answer.text ?? "").trim().length < 8),
    );
    if (!force && incomplete) {
      setError("Answer every question.");
      return;
    }
    if (grading.current) return;
    grading.current = true;
    try {
      setResult(await onGrade(answers));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Try again.");
    } finally {
      grading.current = false;
    }
  }

  submitRef.current = submit;

  useEffect(() => {
    if (!started || !timed || result) return;
    if (left <= 0) {
      void submitRef.current(true);
      return;
    }
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [started, timed, left, result]);

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-row font-semibold">{paper.title}</p>
        {started && timed && !result ? (
          <p className="type-row font-semibold tabular-nums" role="timer">
            {clock(left)}
          </p>
        ) : null}
      </div>
      {!started ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="type-sub flex items-center gap-2 text-duet-ink">
            <input
              type="checkbox"
              checked={timed}
              onChange={(event) => setTimed(event.target.checked)}
            />
            Timed, {paper.suggestedMinutes} min
          </label>
          <SmallPill primary onClick={() => setStarted(true)}>
            Start
          </SmallPill>
        </div>
      ) : null}
      {started && !result
        ? paper.items.map((item, index) => (
            <Question
              index={index}
              item={item}
              key={item.id}
              pick={picks[item.id] ?? -1}
              text={texts[item.id] ?? ""}
              onPick={(choice) =>
                setPicks((current) => ({ ...current, [item.id]: choice }))
              }
              onText={(value) =>
                setTexts((current) => ({ ...current, [item.id]: value }))
              }
            />
          ))
        : null}
      {started && !result ? (
        <SmallPill disabled={busy} primary onClick={() => void submit()}>
          {busy ? "Checking…" : "Check answers"}
        </SmallPill>
      ) : null}
      {error ? (
        <p className="type-sub text-duet-red" role="alert">
          {error}
        </p>
      ) : null}
      {result ? <Results result={result} /> : null}
    </div>
  );
}

function Question({
  item,
  index,
  pick,
  text,
  onPick,
  onText,
}: {
  item: PracticeItem;
  index: number;
  pick: number;
  text: string;
  onPick: (choice: number) => void;
  onText: (value: string) => void;
}) {
  const label =
    item.kind === "mcq"
      ? "Multiple choice"
      : item.kind === "saq"
        ? "SAQ"
        : item.kind === "leq"
          ? "LEQ outline"
          : item.kind === "steps"
            ? "Multi-step"
            : item.kind === "chapter"
              ? "Chapter problem"
              : "Short answer";
  return (
    <fieldset className="flex flex-col gap-2 rounded-2xl bg-duet-card px-4 py-4 shadow-duet-card">
      <legend className="type-sub mb-1">
        <span className="font-semibold">
          {index + 1}. {label}
        </span>
        <span className="mt-1 block">
          <PageText text={item.prompt} />
        </span>
      </legend>
      {item.stimulus ? (
        <blockquote className="type-sub border-l-2 border-duet-accent px-3 text-duet-ink">
          <PageText text={item.stimulus} />
        </blockquote>
      ) : null}
      {item.choices
        ? item.choices.map((choice, choiceIndex) => (
            <label
              key={choice}
              className="type-sub flex min-h-11 items-start gap-3 rounded-xl bg-duet-tile px-3 py-2.5 leading-relaxed"
            >
              <input
                className="mt-1 size-4 shrink-0"
                type="radio"
                name={item.id}
                checked={pick === choiceIndex}
                onChange={() => onPick(choiceIndex)}
              />
              <span className="min-w-0 flex-1">
                <PageText text={choice} />
              </span>
            </label>
          ))
        : null}
      {item.parts ? (
        item.parts.map((part, partIndex) => (
          <label key={part} className="flex flex-col gap-1">
            <span className="type-sub">{part}</span>
            <textarea
              className="type-sub min-h-16 rounded-xl bg-duet-tile px-3 py-2 text-duet-ink"
              value={partValue(text, partIndex)}
              onChange={(event) =>
                onText(
                  joinParts(
                    text,
                    partIndex,
                    event.target.value,
                    item.parts?.length ?? 0,
                  ),
                )
              }
            />
          </label>
        ))
      ) : item.kind !== "mcq" ? (
        <textarea
          className="type-sub min-h-24 rounded-xl bg-duet-tile px-3 py-2 text-duet-ink"
          value={text}
          onChange={(event) => onText(event.target.value)}
        />
      ) : null}
    </fieldset>
  );
}

function Results({ result }: { result: PracticeResult }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-duet-tile px-4 py-4">
      <p className="type-display font-semibold">{result.summary}</p>
      {result.items.map((item) => (
        <div key={item.id} className="flex flex-col gap-1">
          <p className="type-sub font-semibold">
            {item.topic}. {item.earned} of {item.points}.
          </p>
          <p className="type-sub text-duet-ink">
            <PageText text={item.feedback} />
          </p>
        </div>
      ))}
    </div>
  );
}

function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function partValue(joined: string, index: number): string {
  return joined.split("\n")[index] ?? "";
}

function joinParts(
  joined: string,
  index: number,
  value: string,
  count: number,
): string {
  const parts = joined.split("\n");
  while (parts.length < count) parts.push("");
  parts[index] = value;
  return parts.slice(0, count).join("\n");
}
