import { useRenderTool } from "@copilotkit/react-core/v2";
import { PROGRESS_TOOL } from "@openbot/shared/study";
import { z } from "zod";
import { ToolLine } from "@/components/channels/tool-line";
import { BuildInProvider, useArrivedLive } from "@/components/duet/build-in";
import { ProgressCard } from "@/components/duet/study";
import { readToolName } from "@/lib/plugins/tool-name";
import { progressToolResultSchema, readToolResult } from "@/lib/study/schemas";
import { HeldUntilReplied } from "./page-card-tool";

/*
 * Draws the server's `show_progress` (server/src/openduet/study/quiz-tools.ts) as the student's
 * practice so far, under the Bot's line about what to review first. Drawn straight from the tool's
 * result, with nothing to fetch: the summary is what the practice added up to when the Bot looked,
 * which is what its line is about.
 */

const parameters = z.object({ class: z.string().optional() });

/** The tool's line while it counts the practice, then the card. */
function ProgressToolView({
  result,
  running,
}: {
  result: unknown;
  running: boolean;
}) {
  const live = useArrivedLive(running);
  if (running)
    return <ToolLine label={readToolName(PROGRESS_TOOL, true).label} running />;
  const shown = readToolResult(result, progressToolResultSchema);
  // Nothing for a refusal, such as a class that isn't the student's: the Bot asks again.
  if (!shown) return null;
  return (
    <BuildInProvider value={live}>
      <HeldUntilReplied title="Practice so far" tool={PROGRESS_TOOL}>
        <ProgressCard summary={shown.summary} />
      </HeldUntilReplied>
    </BuildInProvider>
  );
}

export function ProgressCardTool() {
  useRenderTool({
    name: PROGRESS_TOOL,
    parameters,
    render: ({ result, status }) => (
      <ProgressToolView
        result={result}
        running={status !== "complete" && result === undefined}
      />
    ),
  });
  return null;
}
