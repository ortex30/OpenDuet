import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { DuetCard, SectionLabel } from "@/components/duet/kit";
import { SmallPill } from "@/components/shell/suggestion-card";
import { client } from "@/lib/client";
import type { PrivateDemoPayload } from "@/lib/coach/seed";
import {
  createPractice,
  gradePractice,
  type PracticePaper,
} from "@/lib/study/practice";
import { PracticeSession } from "./practice-session";
import { TutorSession } from "./tutor-session";

/**
 * Guides, quizzes and tutoring from the student's own notes. Hidden when no
 * school pack is loaded, so the generic demo is unchanged.
 */

type ClassRow = PrivateDemoPayload["classes"][number];

export function WorkshopPanel({
  onOpenPage,
}: {
  onOpenPage: (pageId: string) => void;
}) {
  const pack = useQuery({
    queryKey: ["private-demo"],
    queryFn: async () => {
      const response = await client("/api/openduet/study/private-demo", {
        fallback: "Couldn't load your classes.",
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
  const [showTutor, setShowTutor] = useState(false);
  const [paper, setPaper] = useState<PracticePaper | null>(null);
  const queryClient = useQueryClient();
  const lock = useRef(false);
  const PAPER_KEY = "academic-os.practice";

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PAPER_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as PracticePaper;
      if (saved?.id && saved.result == null) setPaper(saved);
    } catch {
      // A bad saved quiz is ignored. The student can start a new one.
    }
  }, []);

  function remember(next: PracticePaper | null) {
    setPaper(next);
    if (!next || next.result) window.localStorage.removeItem(PAPER_KEY);
    else window.localStorage.setItem(PAPER_KEY, JSON.stringify(next));
  }
  if (pack.data?.available !== true) return null;
  const classes = pack.data.classes ?? [];
  const selected = classId || classes[0]?.id || "";

  async function openGuide() {
    if (lock.current) return;
    lock.current = true;
    setBusy("guide");
    setError("");
    try {
      const response = await client("/api/openduet/study/workshop/guide", {
        method: "POST",
        body: {
          classId: selected,
          ...(focus.trim() ? { focus: focus.trim() } : {}),
        },
        fallback: "Couldn't write that guide.",
      });
      const body = (await response.json()) as { pageId?: string };
      if (body.pageId) onOpenPage(body.pageId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Try again.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }

  async function openPractice(mode: "quiz" | "test", topic = focus.trim()) {
    if (lock.current) return;
    lock.current = true;
    setBusy(mode);
    setError("");
    setShowTutor(false);
    try {
      remember(
        await createPractice({
          classId: selected,
          mode,
          ...(topic ? { focus: topic } : {}),
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Try again.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }

  return (
    <DuetCard className="px-4 py-4" data-workshop="">
      <SectionLabel>From your notes</SectionLabel>
      <p className="type-sub mb-3 text-duet-ink-2">
        A study guide, a quiz, a practice test, or a lesson from your class
        notes.
      </p>
      <label className="type-caption mb-3 block text-duet-ink-2">
        Class
        <select
          className="type-sub mt-1 w-full rounded-xl bg-duet-tile px-3 py-2 text-duet-ink"
          value={selected}
          onChange={(event) => {
            setClassId(event.target.value);
            remember(null);
            setShowTutor(false);
            setError("");
          }}
        >
          {classes.map((row: ClassRow) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      {classes.find((row) => row.id === selected)?.help === "none" ? (
        <p className="type-caption mb-3 text-duet-ink-2">
          No AI help on graded work. A guide can still organize your notes.
        </p>
      ) : null}
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
      {busy ? (
        <div aria-hidden className="mb-3 flex flex-col gap-2">
          <div className="study-shimmer h-3 w-2/5 rounded-full" />
          <div className="study-shimmer h-3 w-full rounded-full" />
          <div className="study-shimmer h-24 w-full rounded-2xl" />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SmallPill
          disabled={busy !== ""}
          primary
          onClick={() => void openGuide()}
        >
          {busy === "guide" ? "Writing the guide…" : "Study guide"}
        </SmallPill>
        <SmallPill
          disabled={busy !== ""}
          onClick={() => void openPractice("quiz")}
        >
          {busy === "quiz" ? "Writing the quiz…" : "Quiz"}
        </SmallPill>
        <SmallPill
          disabled={busy !== ""}
          onClick={() => void openPractice("test")}
        >
          {busy === "test" ? "Writing the test…" : "Practice test"}
        </SmallPill>
        <SmallPill
          disabled={busy !== ""}
          onClick={() => {
            remember(null);
            setShowTutor(true);
            setError("");
          }}
        >
          Tutor
        </SmallPill>
      </div>
      {paper ? (
        <PracticeSession
          key={paper.id}
          paper={paper}
          busy={busy === "grade"}
          onGrade={async (answers) => {
            setBusy("grade");
            try {
              const result = await gradePractice(paper.id, answers);
              // Keep the scored paper on screen so the student sees what landed
              // and what missed. The saved copy is cleared because it is finished.
              remember({ ...paper, result });
              void queryClient.invalidateQueries({ queryKey: ["study"] });
              return result;
            } finally {
              setBusy("");
            }
          }}
        />
      ) : null}
      {showTutor ? (
        <TutorSession
          key={`${selected}:${focus}`}
          classId={selected}
          topic={focus.trim()}
          onQuiz={(topic) => void openPractice("quiz", topic)}
        />
      ) : null}
    </DuetCard>
  );
}
