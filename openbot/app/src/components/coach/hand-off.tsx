import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { AgentProfile } from "@/lib/agents/queries";
import { startTaskMutationOptions } from "@/lib/tasks/mutations";
import type { TaskRecord } from "@/lib/tasks/queries";
import { queryClient } from "@/query-client";
import { CoachButton, CoachSheet, FIELD } from "./kit";

/**
 * Hands a piece of planning to the Bot as a task of its own, with the instruction written out and
 * editable first. The instruction carries the teacher's AI rule, so the Bot helps only as allowed;
 * anything it would send still stops for the person's answer.
 */
export function HandOffSheet({
  bot,
  title,
  instruction,
  onClose,
  onStarted,
}: {
  bot: AgentProfile;
  title: string;
  instruction: string;
  onClose: () => void;
  onStarted: (task: TaskRecord) => void;
}) {
  const [draft, setDraft] = useState(instruction);
  const start = useMutation(startTaskMutationOptions(queryClient));
  return (
    <CoachSheet onClose={onClose} open title={`Hand "${title}" to ${bot.name}`}>
      <p className="type-sub mb-2 text-duet-ink-2">
        {bot.name} works on it as a task and follows the teacher's AI rule. Edit
        anything first.
      </p>
      <textarea
        aria-label="What to ask"
        className={`${FIELD} min-h-48 resize-none`}
        disabled={start.isPending}
        maxLength={4000}
        onChange={(e) => setDraft(e.target.value)}
        value={draft}
      />
      {start.error ? (
        <p className="type-sub mt-2 text-duet-red" role="alert">
          {start.error.message}
        </p>
      ) : null}
      <CoachButton
        className="mt-3 w-full"
        disabled={!draft.trim() || start.isPending}
        onClick={() =>
          start.mutate(
            { botId: bot.id, instruction: draft.trim() },
            { onSuccess: (task) => onStarted(task) },
          )
        }
        primary
      >
        {start.isPending ? "Starting…" : "Start"}
      </CoachButton>
    </CoachSheet>
  );
}
