import { client } from "@/lib/client";

/**
 * Notes quizzes and practice tests. The server keeps the answers.
 */

export type PracticeKind =
  | "mcq"
  | "short"
  | "saq"
  | "leq"
  | "steps"
  | "chapter";

export type PracticeItem = {
  id: string;
  kind: PracticeKind;
  prompt: string;
  stimulus?: string;
  parts?: string[];
  choices?: string[];
  points: number;
  topic: string;
};

export type PracticeGrade = {
  id: string;
  topic: string;
  kind: PracticeKind;
  earned: number;
  points: number;
  correct: boolean;
  partial: boolean;
  feedback: string;
  rubric: { text: string; met: boolean }[];
};

export type PracticeResult = {
  earned: number;
  points: number;
  summary: string;
  items: PracticeGrade[];
};

export type PracticePaper = {
  id: string;
  title: string;
  className: string;
  mode: "quiz" | "test";
  suggestedMinutes: number;
  items: PracticeItem[];
  result: PracticeResult | null;
};

export function createPractice(input: {
  classId: string;
  focus?: string;
  mode: "quiz" | "test";
}) {
  return client<PracticePaper>(
    "/api/openduet/study/workshop/practice",
    "practice",
    {
      method: "POST",
      body: input,
      fallback: "Couldn't make that practice.",
    },
  );
}

export function loadPractice(id: string) {
  return client<PracticePaper>(
    `/api/openduet/study/workshop/practice/${id}`,
    "practice",
    { fallback: "Couldn't load that practice." },
  );
}

export async function gradePractice(
  id: string,
  answers: { id: string; choice?: number; text?: string }[],
) {
  const response = await client(
    `/api/openduet/study/workshop/practice/${id}/grade`,
    {
      method: "POST",
      body: { answers },
      fallback: "Couldn't check that practice.",
    },
  );
  const body = (await response.json()) as {
    result?: PracticeResult;
  };
  if (!body.result) throw new Error("Couldn't check that practice.");
  return body.result;
}
