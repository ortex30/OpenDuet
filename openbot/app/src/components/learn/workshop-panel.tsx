import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DuetCard, SectionLabel } from "@/components/duet/kit";
import { SmallPill } from "@/components/shell/suggestion-card";
import type { PrivateDemoPayload } from "@/lib/coach/seed";

/**
 * Guides, quizzes and tutoring from the student's own notes. Hidden when no
 * school pack is loaded, so the generic demo is unchanged.
 */

type ClassRow = PrivateDemoPayload["classes"][number];

type Tutor = {
  topic: string;
  explanation: string;
  check: string;
  expects: string[];
};

type QuizPublic = {
  id: string;
  title: string;
  className: string;
  questions: { id: string; question: string; choices: string[] }[];
};

type WrittenPublic = {
  id: string;
  kind: "short" | "free";
  prompt: string;
  topic: string;
};

export function WorkshopPanel({
  onOpenPage,
}: {
  onOpenPage: (pageId: string) => void;
}) {
  const pack = useQuery({
    queryKey: ["private-demo"],
    queryFn: async () => {
      const response = await fetch("/api/openduet/study/private-demo", {
        credentials: "include",
      });
      if (!response.ok) return { available: false as const };
      return (await response.json()) as {
        available?: boolean;
      } & Partial<PrivateDemoPayload>;
    },
  });
  const [classId, setClassId] = useState("");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tutor, setTutor] = useState<Tutor | null>(null);
  const [tutorNote, setTutorNote] = useState("");
  const [answer, setAnswer] = useState("");
  const [quiz, setQuiz] = useState<QuizPublic | null>(null);
  const [written, setWritten] = useState<WrittenPublic[]>([]);
  const [essays, setEssays] = useState<Record<string, string>>({});
  const [picks, setPicks] = useState<number[]>([]);
  const [grade, setGrade] = useState("");
  const client = useQueryClient();
  if (!pack.data || pack.data.available !== true) return null;
  const classes = pack.data.classes ?? [];
  const selected = classId || classes[0]?.id || "";

  async function post(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok)
      throw new Error(payload.error || "That didn't work. Try again.");
    return payload as Record<string, unknown>;
  }

  return (
    <DuetCard className="px-4 py-4" data-workshop="">
      <SectionLabel>From your notes</SectionLabel>
      <p className="type-sub mb-3 text-duet-ink-2">
        A study guide, a quiz, or a short lesson, using your class notes.
      </p>
      <label className="type-caption mb-3 block text-duet-ink-2">
        Class
        <select
          className="type-sub mt-1 w-full rounded-xl bg-duet-tile px-3 py-2 text-duet-ink"
          value={selected}
          onChange={(event) => {
            setClassId(event.target.value);
            setTutor(null);
            setQuiz(null);
            setWritten([]);
            setGrade("");
            setError("");
          }}
        >
          {classes.map((row: ClassRow) => (
            <option key={row.id} value={row.id}>
              {row.name}
              {row.help === "none" ? " · no AI on graded work" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="type-caption mb-3 block text-duet-ink-2">
        Focus
        <input
          className="type-sub mt-1 w-full rounded-xl bg-duet-tile px-3 py-2 text-duet-ink"
          value={focus}
          placeholder="Period 5, LEQ 3, Unit 5"
          onChange={(event) => setFocus(event.target.value)}
        />
      </label>
      {error ? (
        <p className="type-sub mb-3 text-duet-red" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SmallPill
          disabled={busy !== ""}
          primary
          onClick={() => {
            setBusy("guide");
            setError("");
            void post("/api/openduet/study/workshop/guide", {
              classId: selected,
              ...(focus.trim() ? { focus: focus.trim() } : {}),
            })
              .then((body) => {
                const pageId = body.pageId;
                if (typeof pageId === "string") onOpenPage(pageId);
              })
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error ? reason.message : "Try again.",
                ),
              )
              .finally(() => setBusy(""));
          }}
        >
          {busy === "guide" ? "Writing the guide…" : "Study guide"}
        </SmallPill>
        <SmallPill
          disabled={busy !== ""}
          onClick={() => {
            setBusy("quiz");
            setError("");
            setGrade("");
            setWritten([]);
            void post("/api/openduet/study/workshop/quiz", {
              classId: selected,
              ...(focus.trim() ? { focus: focus.trim() } : {}),
            })
              .then(async (body) => {
                const quizId = body.quizId;
                if (typeof quizId !== "string") return;
                const response = await fetch(
                  `/api/openduet/study/quizzes/${quizId}`,
                  { credentials: "include" },
                );
                const loaded = (await response.json()) as { quiz?: QuizPublic };
                if (!loaded.quiz) throw new Error("The quiz didn't load.");
                setQuiz(loaded.quiz);
                setPicks(loaded.quiz.questions.map(() => -1));
                setWritten(
                  Array.isArray(body.written)
                    ? (body.written as WrittenPublic[])
                    : [],
                );
                setEssays({});
              })
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error ? reason.message : "Try again.",
                ),
              )
              .finally(() => setBusy(""));
          }}
        >
          {busy === "quiz" ? "Writing the quiz…" : "Quiz"}
        </SmallPill>
        <SmallPill
          disabled={busy !== ""}
          onClick={() => {
            setBusy("tutor");
            setError("");
            setTutorNote("");
            setAnswer("");
            void post("/api/openduet/study/workshop/tutor", {
              classId: selected,
              ...(focus.trim() ? { topic: focus.trim() } : {}),
            })
              .then((body) => {
                const step = body.tutor as Tutor | undefined;
                if (step?.explanation) setTutor(step);
              })
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error ? reason.message : "Try again.",
                ),
              )
              .finally(() => setBusy(""));
          }}
        >
          {busy === "tutor" ? "Starting…" : "Tutor"}
        </SmallPill>
      </div>
      {tutor ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="type-row font-semibold">{tutor.topic}</p>
          <p className="type-sub text-duet-ink">{tutor.explanation}</p>
          <p className="type-sub font-semibold">{tutor.check}</p>
          <textarea
            className="type-sub min-h-24 rounded-xl bg-duet-tile px-3 py-2 text-duet-ink"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Teach it back in your own words."
          />
          <SmallPill
            disabled={busy !== "" || answer.trim().length < 8}
            onClick={() => {
              setBusy("check");
              void post("/api/openduet/study/workshop/tutor/check", {
                ...tutor,
                answer,
              })
                .then((body) => {
                  const check = body.check as
                    | {
                        understood?: boolean;
                        teachBack?: string;
                        missing?: string[];
                      }
                    | undefined;
                  setTutorNote(
                    check?.understood
                      ? "That matches your notes. Teach it back once more, out loud."
                      : check?.teachBack ||
                          "Try once more, using the notes' own words.",
                  );
                  void client.invalidateQueries({ queryKey: ["study"] });
                })
                .catch((reason: unknown) =>
                  setError(
                    reason instanceof Error ? reason.message : "Try again.",
                  ),
                )
                .finally(() => setBusy(""));
            }}
          >
            Check
          </SmallPill>
          {tutorNote ? (
            <p className="type-sub text-duet-ink-2">{tutorNote}</p>
          ) : null}
        </div>
      ) : null}
      {quiz ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="type-row font-semibold">{quiz.title}</p>
          {quiz.questions.map((question, index) => (
            <fieldset key={question.id} className="flex flex-col gap-1">
              <legend className="type-sub mb-1 font-semibold">
                {index + 1}. {question.question}
              </legend>
              {question.choices.map((choice, choiceIndex) => (
                <label key={choice} className="type-sub flex items-start gap-2">
                  <input
                    type="radio"
                    name={question.id}
                    checked={picks[index] === choiceIndex}
                    onChange={() =>
                      setPicks((current) =>
                        current.map((pick, pickIndex) =>
                          pickIndex === index ? choiceIndex : pick,
                        ),
                      )
                    }
                  />
                  <span>{choice}</span>
                </label>
              ))}
            </fieldset>
          ))}
          {written.map((item) => (
            <label key={item.id} className="flex flex-col gap-1">
              <span className="type-sub font-semibold">
                {item.kind === "free" ? "Free response" : "Short answer"}.{" "}
                {item.prompt}
              </span>
              <textarea
                className="type-sub min-h-20 rounded-xl bg-duet-tile px-3 py-2 text-duet-ink"
                value={essays[item.id] ?? ""}
                onChange={(event) =>
                  setEssays((current) => ({
                    ...current,
                    [item.id]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
          <SmallPill
            disabled={busy !== ""}
            primary
            onClick={() => {
              if (picks.some((pick) => pick < 0)) {
                setError("Answer every question.");
                return;
              }
              setBusy("grade");
              setError("");
              void post(
                `/api/openduet/study/workshop/quizzes/${quiz.id}/grade`,
                {
                  answers: picks,
                  written: written.map((item) => ({
                    id: item.id,
                    text: essays[item.id] ?? "",
                  })),
                },
              )
                .then((body) => {
                  const attempt = body.attempt as
                    | {
                        correct?: number;
                        total?: number;
                        results?: {
                          correct: boolean;
                          explanation: string;
                          question: string;
                        }[];
                      }
                    | undefined;
                  const misses = (attempt?.results ?? []).filter(
                    (item) => !item.correct,
                  );
                  const writtenGrades = Array.isArray(body.written)
                    ? (body.written as {
                        correct?: boolean;
                        explanation?: string;
                      }[])
                    : [];
                  const writtenLine = writtenGrades
                    .filter(
                      (item) => item.correct === false && item.explanation,
                    )
                    .map((item) => item.explanation)
                    .slice(0, 1)
                    .join(" ");
                  setGrade(
                    `${attempt?.correct ?? 0} of ${attempt?.total ?? quiz.questions.length} multiple choice right.` +
                      (misses[0]
                        ? ` ${misses[0].explanation}`
                        : " Multiple choice looks right.") +
                      (writtenLine ? ` ${writtenLine}` : ""),
                  );
                  void client.invalidateQueries({ queryKey: ["study"] });
                })
                .catch((reason: unknown) =>
                  setError(
                    reason instanceof Error ? reason.message : "Try again.",
                  ),
                )
                .finally(() => setBusy(""));
            }}
          >
            {busy === "grade" ? "Checking…" : "Check answers"}
          </SmallPill>
          {grade ? <p className="type-sub">{grade}</p> : null}
        </div>
      ) : null}
    </DuetCard>
  );
}
