import { useRenderTool } from "@copilotkit/react-core/v2";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { DuetCard } from "@/components/duet/kit";
import { PracticeSession } from "@/components/learn/practice-session";
import {
  gradePractice,
  loadPractice,
  type PracticePaper,
} from "@/lib/study/practice";

/**
 * The notes quiz from make_notes_quiz, drawn under the Bot's sentence.
 * The card loads the paper by id, so the answer key never travels in the tool result.
 */

const resultSchema = z.object({
  kind: z.literal("practice"),
  id: z.string(),
  title: z.string(),
  className: z.string(),
  count: z.number(),
  mode: z.enum(["quiz", "test"]),
});

export function PracticeCardTool() {
  useRenderTool({
    name: "make_notes_quiz",
    parameters: z.object({
      class: z.string().optional(),
      focus: z.string().optional(),
      mode: z.string().optional(),
    }),
    render: ({ result }) => <PracticeTool result={result} />,
  });
  return null;
}

function PracticeTool({ result }: { result: unknown }) {
  const parsed =
    typeof result === "string"
      ? resultSchema.safeParse(safeJson(result))
      : resultSchema.safeParse(result);
  if (!parsed.success) return null;
  return <Loaded id={parsed.data.id} />;
}

function Loaded({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const paper = useQuery({
    queryKey: ["practice", id],
    queryFn: () => loadPractice(id),
  });
  if (!paper.data) return null;
  return (
    <DuetCard className="px-4 py-4">
      <PracticeSession
        paper={paper.data}
        busy={busy}
        onGrade={async (answers) => {
          setBusy(true);
          try {
            const graded = await gradePractice(id, answers);
            const next: PracticePaper = { ...paper.data, result: graded };
            queryClient.setQueryData(["practice", id], next);
            void queryClient.invalidateQueries({ queryKey: ["study"] });
            return graded;
          } finally {
            setBusy(false);
          }
        }}
      />
    </DuetCard>
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
