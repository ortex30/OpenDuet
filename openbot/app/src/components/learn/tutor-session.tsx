import { useState } from "react";
import { TypingDots } from "@/components/duet/kit";
import { PageText } from "@/components/duet/page-text";
import { SmallPill } from "@/components/shell/suggestion-card";
import { client } from "@/lib/client";
import { cn } from "@/lib/utils";

/**
 * A tutor turn from the notes: a short explanation, a check, and a simpler
 * pass when the answer is off. Teach-back follows a right answer. Quiz me
 * starts a short quiz on the same topic.
 */

type Opening = {
  topic: string;
  explanation: string;
  example: string;
  check: string;
  expects: string[];
};

type Turn = {
  understood: boolean;
  feedback: string;
  adjustment: string | null;
  example: string | null;
  nextCheck: string | null;
  teachBack: string | null;
};

export function TutorSession({
  classId,
  topic,
  onQuiz,
}: {
  classId: string;
  topic: string;
  onQuiz: (topic: string) => void;
}) {
  const [opening, setOpening] = useState<Opening | null>(null);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<"check" | "teach">("check");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const step = await client<Opening>(
        "/api/openduet/study/workshop/tutor",
        "tutor",
        {
          method: "POST",
          body: { classId, ...(topic ? { topic } : {}) },
          fallback: "Couldn't start the tutor.",
        },
      );
      setOpening(step);
      setStarted(true);
      setTurn(null);
      setPhase("check");
      setQuestion(step.check);
      setAnswer("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!opening) return;
    setBusy(true);
    setError("");
    try {
      const response = await client("/api/openduet/study/workshop/tutor/turn", {
        method: "POST",
        body: {
          classId,
          topic: opening.topic,
          explanation: turn?.adjustment || opening.explanation,
          example: turn?.example || opening.example,
          check: question || opening.check,
          expects: opening.expects,
          answer,
          phase,
        },
        fallback: "Couldn't check that.",
      });
      const body = (await response.json()) as { turn?: Turn };
      if (!body.turn) throw new Error("Couldn't check that.");
      setTurn(body.turn);
      setAnswer("");
      const next = body.turn.teachBack || body.turn.nextCheck || question;
      if (next) setQuestion(next);
      if (body.turn.understood && body.turn.teachBack) setPhase("teach");
      if (body.turn.understood && !body.turn.teachBack) setPhase("check");
      if (!body.turn.understood && body.turn.nextCheck) setPhase("check");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  const explanation = turn?.adjustment || opening?.explanation || "";
  const example = turn?.example || opening?.example || "";
  const shown = question || opening?.check || "";

  return (
    <div className="mt-4 flex flex-col gap-2">
      {!started ? (
        <SmallPill disabled={busy} onClick={() => void start()}>
          {busy ? "Starting…" : "Start tutor"}
        </SmallPill>
      ) : null}
      {opening ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-duet-card px-4 py-4 shadow-duet-card">
          <p className="type-row font-semibold">{opening.topic}</p>
          <p className="type-sub text-duet-ink">
            <PageText text={explanation} />
          </p>
          {example ? (
            <p className="type-sub rounded-xl bg-duet-tile px-3 py-3 text-duet-ink">
              <span className="font-semibold">Example from your notes. </span>
              <PageText text={example} />
            </p>
          ) : null}
          <p className="type-sub font-semibold">
            <PageText text={shown} />
          </p>
          <textarea
            className="type-sub min-h-24 rounded-xl bg-duet-tile px-3 py-2 text-duet-ink"
            value={answer}
            placeholder={
              phase === "teach"
                ? "Teach it back in your own words."
                : "Your answer"
            }
            onChange={(event) => setAnswer(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <SmallPill
              disabled={busy || answer.trim().length < 8}
              primary
              onClick={() => void check()}
            >
              {busy
                ? "Checking…"
                : phase === "teach"
                  ? "Teach it back"
                  : "Check"}
            </SmallPill>
            <SmallPill onClick={() => onQuiz(opening.topic)}>
              Quiz me on this
            </SmallPill>
          </div>
          {busy ? <TypingDots label="Thinking" /> : null}
          {turn ? (
            <p
              className={cn(
                "type-sub text-duet-ink-2",
                turn.understood ? "study-bounce" : "study-shake",
              )}
            >
              <PageText text={turn.feedback} />
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="type-sub text-duet-red" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
