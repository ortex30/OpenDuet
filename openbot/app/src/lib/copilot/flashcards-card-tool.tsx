import { useRenderTool } from "@copilotkit/react-core/v2";
import { type DeckToolResult, FLASHCARDS_TOOL } from "@openbot/shared/study";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ToolLine } from "@/components/channels/tool-line";
import { BuildInProvider, useArrivedLive } from "@/components/duet/build-in";
import {
  FlashcardDeck,
  plural,
  TeacherRuleNotice,
} from "@/components/duet/study";
import { readToolName } from "@/lib/plugins/tool-name";
import { deckQueryOptions } from "@/lib/study/quizzes";
import { deckToolResultSchema, readToolResult } from "@/lib/study/schemas";
import { HeldUntilReplied } from "./page-card-tool";
import {
  readTeacherRule,
  StudyCardPlaceholder,
  useSendOnce,
} from "./quiz-card-tool";

/*
 * Draws the server's `make_flashcards` (server/src/openduet/study/quiz-tools.ts) as a deck to flip
 * through, under the Bot's line about it. The tool's result names the deck; the card reads its cards
 * by id, so the deck is the saved one after a reload, never the call's streaming arguments.
 * "Quiz me on these" asks for a quiz in the student's own words, as if they had typed it.
 */

const parameters = z.object({ title: z.string().optional() });

/** The deck the tool made, read by its id; the read starts while the card waits for the Bot's words. */
export function DeckToolCard({ made }: { made: DeckToolResult }) {
  const read = useQuery(deckQueryOptions(made.id));
  const sendOnce = useSendOnce();
  const deck = read.data;
  return (
    <HeldUntilReplied title={made.title} tool={FLASHCARDS_TOOL}>
      {deck ? (
        <FlashcardDeck
          deck={deck}
          onQuizMe={sendOnce(`Quiz me on these flashcards: "${deck.title}".`)}
        />
      ) : (
        <StudyCardPlaceholder
          error={read.isError ? read.error.message : null}
          name={`Flashcards: ${made.title}`}
          onRetry={() => void read.refetch()}
          schoolClass={made.className}
          size={plural(made.count, "card", "cards")}
          title={made.title}
        />
      )}
    </HeldUntilReplied>
  );
}

/** The tool's line while it makes the deck, then the deck, or the teacher's rule that paused it. */
function DeckToolView({
  result,
  running,
}: {
  result: unknown;
  running: boolean;
}) {
  const live = useArrivedLive(running);
  if (running)
    return (
      <ToolLine label={readToolName(FLASHCARDS_TOOL, true).label} running />
    );
  const rule = readTeacherRule(result);
  // Not held like a card: the line holding a card's place says what was made, and nothing was.
  if (rule)
    return (
      <BuildInProvider value={live}>
        <TeacherRuleNotice block={rule} what="Flashcards" />
      </BuildInProvider>
    );
  const made = readToolResult(result, deckToolResultSchema);
  // Nothing for any other refusal: the Bot is told what to fix and tries again.
  if (!made) return null;
  return (
    <BuildInProvider value={live}>
      <DeckToolCard made={made} />
    </BuildInProvider>
  );
}

export function FlashcardsCardTool() {
  useRenderTool({
    name: FLASHCARDS_TOOL,
    parameters,
    render: ({ result, status }) => (
      <DeckToolView
        result={result}
        running={status !== "complete" && result === undefined}
      />
    ),
  });
  return null;
}
