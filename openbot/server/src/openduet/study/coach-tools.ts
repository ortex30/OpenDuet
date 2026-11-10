import { randomUUID } from "node:crypto";
import {
  HELP_LEVEL_LABEL,
  type HelpLevel,
  helpLevelRank,
} from "@openbot/shared/study";
import type { GrantedTool } from "@openbot/toolkit/granted-tool";
import { z } from "zod";
import { loadEnabledPack } from "../private-pack";
import { StudyInputError, type StudyToolDeps } from "./contracts";
import { schoolSnapshotFromPack } from "./craft";
import { teacherRuleRefusal } from "./guard";
import { buildGuideInput } from "./notes-input";
import { publicItem, storedPracticeSchema } from "./practice";
import { writePractice } from "./practice-model";

/**
 * Chat's lookup for a teacher's level, and a notes quiz the card runs.
 *
 * class_help reads the school pack first, so "Calculus" resolves to hints
 * without mail. make_notes_quiz builds the quiz from those notes.
 */

export const CLASS_HELP_TOOL = "class_help";
export const NOTES_QUIZ_TOOL = "make_notes_quiz";

const MAY = {
  full: "Explain, quiz, and give feedback. Still do not hand over finished work to submit.",
  hints:
    "Explain the concept and practice from the notes. Do not solve work they will turn in.",
  none: "Do not help with this class. Offer to plan their time or help with a different class.",
} as const;

export function coachTools(deps: StudyToolDeps): GrantedTool[] {
  const now = () => deps.now?.() ?? new Date();
  return [
    {
      name: CLASS_HELP_TOOL,
      ref: `openduet/${CLASS_HELP_TOOL}`,
      description:
        "Look up a class's AI help level from the school pack. Call this before explaining, tutoring, or quizzing. The level it returns is known. Never tell the student the level is unavailable.",
      parameters: z.object({
        class: z
          .string()
          .describe(
            "The class, as the student named it. Calculus matches AP Calculus BC.",
          ),
      }),
      initiator: deps.initiator,
      async execute(args: unknown) {
        const body = asRecord(args);
        const named = typeof body.class === "string" ? body.class.trim() : "";
        if (!named) return JSON.stringify({ error: "Name the class." });
        const pack = loadEnabledPack();
        if (!pack) {
          return JSON.stringify({
            className: named,
            level: "hints",
            label: HELP_LEVEL_LABEL.hints,
            source: "default",
            may: MAY.hints,
          });
        }
        try {
          const input = buildGuideInput(pack, { className: named }, now());
          const target = await deps.rules.target(
            deps.actorId,
            schoolSnapshotFromPack(pack, now()),
            { className: input.className },
            now(),
          );
          if (!target.ok) {
            return JSON.stringify({
              error: target.reason,
              classes: pack.classes.map((row) => ({
                name: row.name,
                shortName: row.shortName,
                level: row.help,
                label: HELP_LEVEL_LABEL[row.help],
              })),
            });
          }
          const level = stricter(input.help, target.level);
          return JSON.stringify({
            className: target.className,
            level,
            label: HELP_LEVEL_LABEL[level],
            source: level === input.help ? "class" : target.source,
            may: MAY[level],
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Name the class.";
          return JSON.stringify({ error: message });
        }
      },
    },
    {
      name: NOTES_QUIZ_TOOL,
      ref: `openduet/${NOTES_QUIZ_TOOL}`,
      description: [
        "Make a short quiz or a practice test from the student's own class notes and save it.",
        "mode quiz is a few questions. mode test is a longer practice test, with AP-style questions where they fit.",
        "The card runs it and grades it. Never write the questions or answers in the chat. Say one short sentence.",
        "If the class is set to no AI help, say so in one sentence and offer another class.",
      ].join(" "),
      parameters: z.object({
        class: z.string().describe("The class name."),
        focus: z
          .string()
          .optional()
          .describe("A unit or period, such as Period 5 or Unit 5."),
        mode: z
          .enum(["quiz", "test"])
          .optional()
          .describe("quiz for a quick check, test for a practice test."),
      }),
      initiator: deps.initiator,
      async execute(args: unknown) {
        const body = asRecord(args);
        const named = typeof body.class === "string" ? body.class.trim() : "";
        const focus = typeof body.focus === "string" ? body.focus.trim() : "";
        const mode = body.mode === "test" ? "test" : "quiz";
        if (!named) return "Refused. Name the class.";
        const pack = loadEnabledPack();
        if (!pack) {
          return "Refused. No class notes are loaded. Call make_quiz instead.";
        }
        let input: ReturnType<typeof buildGuideInput>;
        try {
          input = buildGuideInput(
            pack,
            { className: named, ...(focus ? { focus } : {}) },
            now(),
          );
        } catch (error) {
          const message =
            error instanceof StudyInputError
              ? error.message
              : "Name the class.";
          return `Refused. ${message}`;
        }
        const target = await deps.rules.target(
          deps.actorId,
          schoolSnapshotFromPack(pack, now()),
          { className: input.className },
          now(),
        );
        if (!target.ok) return `Refused. ${target.reason}`;
        const level = stricter(input.help, target.level);
        if (level === "none") {
          return teacherRuleRefusal({ ...target, level: "none" });
        }
        const made = await writePractice(input, mode, process.env);
        if ("refused" in made) return `Refused. ${made.refused}`;
        const id = randomUUID();
        const record = {
          title: made.title,
          classId: input.classId,
          className: input.className,
          focus: input.focus,
          subject: made.subject,
          mode: made.mode,
          suggestedMinutes: made.suggestedMinutes,
          items: made.items,
          createdAt: now().toISOString(),
          result: null,
        };
        storedPracticeSchema.parse(record);
        await deps.store.put(deps.actorId, {
          id,
          kind: "practice",
          botId: deps.botId,
          classId: input.classId,
          data: record,
        });
        return JSON.stringify({
          kind: "practice",
          id,
          title: made.title,
          className: input.className,
          count: made.items.length,
          mode: made.mode,
        });
      },
    },
  ];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stricter(a: HelpLevel, b: HelpLevel): HelpLevel {
  return helpLevelRank(a) >= helpLevelRank(b) ? a : b;
}

/** What the card is allowed to draw. Answers stay on the server. */
export function practiceView(data: unknown, id: string) {
  const parsed = storedPracticeSchema.safeParse(data);
  if (!parsed.success)
    throw new StudyInputError("That practice isn't here anymore.");
  return {
    id,
    title: parsed.data.title,
    className: parsed.data.className,
    mode: parsed.data.mode,
    suggestedMinutes: parsed.data.suggestedMinutes,
    items: parsed.data.items.map(publicItem),
    result: parsed.data.result ?? null,
  };
}
