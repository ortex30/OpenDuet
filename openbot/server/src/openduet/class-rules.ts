import type { RunAgentInput } from "@ag-ui/client";
import { HELP_LEVEL_LABEL } from "@openbot/shared/study";
import { loadEnabledPack, type PrivatePack } from "./private-pack";

/**
 * The teacher's levels, put on every chat run when the school pack is loaded.
 *
 * Chat used to look the level up in Classroom mail. With no mail connected,
 * a calculus answer said the level was unavailable even though the pack sets
 * Calculus to hints. The pack is the source. A listed level is known.
 */

export const CLASS_RULES_CONTEXT = "Academic OS class rules";
export const CLASS_RULES_MESSAGE_ID = "openduet:class-rules";

const MAY = {
  full: "Teach and give feedback. Do not hand over finished work to submit.",
  hints:
    "Explain concepts and practice from the notes. Do not solve work they will turn in.",
  none: "Do not explain, quiz, tutor, or check work for this class.",
} as const;

export function classRulesText(pack: PrivatePack): string {
  const lines = pack.classes.map((row) => {
    const short = row.shortName ? ` (${row.shortName})` : "";
    return `${row.name}${short}: ${HELP_LEVEL_LABEL[row.help]}. ${MAY[row.help]}`;
  });
  return [
    "CLASS RULES. These are the teacher's AI help levels. They come from the school pack, which is already loaded.",
    "When a class is listed, its level is known. Never say the AI help level is unavailable, missing, or that you could not look it up.",
    "Do not search mail for a level that is listed here. Mail and calendar are optional.",
    ...lines,
  ].join("\n");
}

/** The run's input with the class rules on it, or the same input when no pack is on. */
export function withClassRules(
  input: RunAgentInput,
  env: Record<string, string | undefined> = process.env,
): RunAgentInput {
  const pack = loadEnabledPack(env);
  const text = pack ? classRulesText(pack) : null;
  const messages = input.messages.filter(
    (message) => message.id !== CLASS_RULES_MESSAGE_ID,
  );
  const context = input.context.filter(
    (entry) => entry.description !== CLASS_RULES_CONTEXT,
  );
  if (
    !text &&
    messages.length === input.messages.length &&
    context.length === input.context.length
  ) {
    return input;
  }
  return {
    ...input,
    messages: [
      ...(text
        ? [
            {
              id: CLASS_RULES_MESSAGE_ID,
              role: "system" as const,
              content: text,
            },
          ]
        : []),
      ...messages,
    ],
    context: [
      ...context,
      ...(text ? [{ description: CLASS_RULES_CONTEXT, value: text }] : []),
    ],
  };
}
