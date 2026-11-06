import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { DuetIcon } from "@/components/duet/icons";
import type { AgentProfile } from "@/lib/agents/queries";
import { startTaskMutationOptions } from "@/lib/tasks/mutations";
import type { TaskRecord } from "@/lib/tasks/queries";
import { queryClient } from "@/query-client";
import { CoachButton, CoachSheet, FIELD } from "./kit";

/**
 * Hands a piece of planning to the Bot as a task of its own. The instruction is written out, folded
 * away under "Edit what I'll ask" so the student sees one line rather than a prompt, and editable
 * first. It carries the teacher's AI rule, so the Bot helps only as allowed; anything it would send
 * still stops for the person's answer.
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
    <CoachSheet onClose={onClose} open title="Get help with this">
      <p className="type-sub mb-1 text-duet-ink-2">
        <span className="font-semibold text-duet-ink">{title}</span>. Your coach
        follows your teacher's AI rule for it.
      </p>
      <details className="group">
        <summary className="type-sub inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-duet-ink-2 outline-none hover:text-duet-ink focus-visible:underline [&::-webkit-details-marker]:hidden">
          Edit what I'll ask
          <DuetIcon
            className="transition-transform group-open:rotate-90"
            name="chevronRight"
            size={14}
            stroke={2.2}
          />
        </summary>
        <textarea
          aria-label="What to ask"
          className={`${FIELD} mt-1 min-h-48 resize-none`}
          disabled={start.isPending}
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          value={draft}
        />
      </details>
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
