import {
  HELP_LEVEL_LABEL,
  RULED_STUDY_TOOLS,
  type TeacherRuleBlock,
  teacherRuleText,
} from "@openbot/shared/study";
import type { GrantedTool } from "@openbot/toolkit/granted-tool";
import { type AuditStore, recordAuditEvent } from "../../audit";
import { REFUSAL_MARKER } from "../../plugins/tools";
import type {
  RulesService,
  SchoolService,
  StudyContext,
  StudyTarget,
} from "./contracts";

/*
 * A teacher's "No help" kept in code. make_quiz and make_flashcards are checked against the class's
 * rule each time they run, never when the tools are built: tools are made per request before the
 * conversation is known, and a teacher's notice can arrive mid-conversation. The level comes from
 * the student's Classroom notices and the Teacher rules screen (rules.ts), never from the call's
 * arguments, so neither the model nor a message it read can talk its way past it.
 */

type Resolved = Extract<StudyTarget, { ok: true }>;

/** Nothing is made on a guess: a rule that cannot be read is treated as one that says no. */
const COULD_NOT_CHECK = `${REFUSAL_MARKER} The class's AI help rule couldn't be checked, so nothing was made. Tell the student in one sentence and offer to try again.`;

/**
 * The refusal when the student's classes couldn't be read at all, so no class's rule can be. It
 * says why in school.ts's words, so the model can tell the student what to connect or fix.
 */
export function rulesUncheckedRefusal(why: string | null): string {
  return `${REFUSAL_MARKER} ${why ?? "The student's classes couldn't be read."} The class's AI help rule couldn't be checked, so nothing was made. Tell the student in one sentence what to connect or fix, then stop.`;
}

/** What the model is told to do with a teacher's rule, so the refusal is never read as a fault. */
const TEACHER_RULE_ADVICE =
  "This is the teacher's rule, not an error: tell the student in one short sentence, offer to plan their time or help with a different class, and don't retry or quiz them on it another way.";

/** The same for a level set on the Teacher rules screen, which no teacher posted. */
const SCREEN_RULE_ADVICE =
  "Tell the student in one short sentence that it was set there, offer to plan their time or help with a different class, and don't retry or quiz them on it another way.";

/**
 * The class and assignment a ruled tool's arguments name, read leniently: anything that is not a
 * string is as good as absent. Null when no class is named, which the tool's own schema refuses.
 */
function namedIn(
  args: unknown,
): { className: string; assignment: string | null } | null {
  if (!args || typeof args !== "object") return null;
  const { class: className, assignment } = args as Record<string, unknown>;
  if (typeof className !== "string" || className.trim().length === 0)
    return null;
  return {
    className,
    assignment:
      typeof assignment === "string" && assignment.trim().length > 0
        ? assignment
        : null,
  };
}

/** Whose rule paused the tool and why, in the words the student will hear from the Bot. */
function pausedBecause(target: Resolved): string {
  const teacher = target.teacher ?? "The teacher";
  const level = HELP_LEVEL_LABEL[target.level];
  if (target.assignmentTitle && target.decidedBy === target.assignmentTitle)
    return target.source === "override"
      ? `"${target.assignmentTitle}" in ${target.className} is set to ${level} on the Teacher rules screen, so nothing was made.`
      : `${teacher} set "${target.assignmentTitle}" in ${target.className} to ${level}, so nothing was made.`;
  if (target.source === "override")
    return `${target.className} is set to ${level} on the Teacher rules screen, so nothing was made.`;
  if (target.decidedBy)
    return `${teacher} set ${target.className} to ${level} while "${target.decidedBy}" is open, so nothing was made.`;
  return `${target.className} is set to ${level}, so nothing was made.`;
}

/**
 * The facts the card draws. A level set on the Teacher rules screen is nobody's notice, so it
 * carries no teacher for the Bot to put the rule in the name of.
 */
function teacherRuleBlockOf(target: Resolved): TeacherRuleBlock {
  return {
    classId: target.classId,
    className: target.className,
    level: target.level,
    ...(target.decidedBy ? { assignment: target.decidedBy } : {}),
    ...(target.teacher && target.source !== "override"
      ? { teacher: target.teacher }
      : {}),
    source: target.source,
  };
}

/**
 * The refusal for a level that pauses the tool: the marker and its facts, then what the model is
 * told, which says where the rule came from: a teacher's notice, or the Teacher rules screen.
 */
export function teacherRuleRefusal(target: Resolved): string {
  const advice =
    target.source === "override" ? SCREEN_RULE_ADVICE : TEACHER_RULE_ADVICE;
  return `${REFUSAL_MARKER} ${teacherRuleText(
    teacherRuleBlockOf(target),
    `${pausedBecause(target)} ${advice}`,
  )}`;
}

/**
 * The study tools, with make_quiz and make_flashcards checked against the teacher's rule when they
 * run. Every other tool is returned as it came.
 *
 * Name, ref, initiator, description and parameters are kept as they are: the runtime finds a tool's
 * initiator by its name, and selection and background-run allowlists match it by its ref.
 */
export function guardTeacherRules(
  tools: GrantedTool[],
  deps: StudyContext & {
    school: SchoolService;
    rules: RulesService;
    auditStore?: AuditStore;
    now?: () => Date;
  },
): GrantedTool[] {
  const ruled = new Set<string>(RULED_STUDY_TOOLS);
  const context: StudyContext = {
    actorId: deps.actorId,
    botId: deps.botId,
    initiator: deps.initiator,
  };

  /** Recorded like a policy refusal, and never in the way of one: a failed write still refuses. */
  async function recordRefusal(
    tool: GrantedTool,
    target: Resolved,
    block: TeacherRuleBlock,
  ) {
    if (!deps.auditStore) return;
    try {
      await recordAuditEvent(deps.auditStore, {
        eventType: "openduet.tool_refused",
        targetType: "openduet_tool",
        targetId: tool.ref,
        actorUserId: deps.actorId,
        initiator: deps.initiator,
        payload: {
          bot: deps.botId,
          tool: tool.name,
          refusal: "teacher_rule",
          level: target.level,
          classId: target.classId,
          assignment: block.assignment ?? null,
          source: target.source,
        },
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          type: "openduet-tool-refused-audit-write-failed",
          tool: tool.name,
          error: String(error),
        }),
      );
    }
  }

  return tools.map((tool) =>
    ruled.has(tool.name)
      ? {
          ...tool,
          async execute(args: unknown) {
            const named = namedIn(args);
            if (!named) return tool.execute(args);
            let target: StudyTarget;
            try {
              const { snapshot, why } = await deps.school.current(context);
              // No classes were ever read, so no class's rule can be: nothing is made at the default.
              if (!snapshot) return rulesUncheckedRefusal(why);
              target = await deps.rules.target(
                deps.actorId,
                snapshot,
                named,
                deps.now?.() ?? new Date(),
              );
            } catch (error) {
              console.error(
                JSON.stringify({
                  type: "openduet-teacher-rule-check-failed",
                  tool: tool.name,
                  error: String(error),
                }),
              );
              return COULD_NOT_CHECK;
            }
            // A class that is not the student's: the model is told which ones are, and calls again.
            if (!target.ok) return `${REFUSAL_MARKER} ${target.reason}`;
            if (target.level !== "none") return tool.execute(args);
            await recordRefusal(tool, target, teacherRuleBlockOf(target));
            return teacherRuleRefusal(target);
          },
        }
      : tool,
  );
}
