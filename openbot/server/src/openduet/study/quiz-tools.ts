import { randomUUID } from "node:crypto";
import {
  FLASHCARDS_TOOL,
  PROGRESS_TOOL,
  type ProgressToolResult,
  QUIZ_TOOL,
  RULED_STUDY_TOOLS,
  type SchoolSnapshot,
} from "@openbot/shared/study";
import type { GrantedTool } from "@openbot/toolkit/granted-tool";
import { REFUSAL_MARKER } from "../../plugins/tools";
import type { StudyContext, StudyTarget, StudyToolDeps } from "./contracts";
import { rulesUncheckedRefusal, teacherRuleRefusal } from "./guard";
import {
  DECK_CARDS,
  deckData,
  deckInputSchema,
  deckToolResult,
  newDeck,
  newQuiz,
  offeredDeckSchema,
  offeredProgressSchema,
  offeredQuizSchema,
  practiceFrom,
  progressInputSchema,
  progressSummary,
  QUIZ_QUESTIONS,
  quizData,
  quizInputSchema,
  quizToolResult,
  refusalFor,
  withoutBlank,
} from "./quizzes";

/*
 * make_quiz, make_flashcards and show_progress: a practice quiz the card runs and the server grades,
 * a deck to flip through, and what the practice adds up to. Each is saved for the student and drawn
 * as a card, so the chat only ever says a sentence about it.
 *
 * guard.ts wraps make_quiz and make_flashcards before the model is handed them, and checks the
 * class's teacher rule each time one runs. It reads the class from the argument named `class` and
 * the assignment from `assignment`, so those two names are a contract with it: renaming either, or
 * letting a call name no class, would let a quiz be made without the rule being checked.
 */

/** Nothing is made on a guess: classes that cannot be read are as good as a class not found. */
const COULD_NOT_READ = `${REFUSAL_MARKER} The student's classes couldn't be read just now, so nothing was made. Tell them in one sentence and offer to try again.`;

type Resolved = Extract<StudyTarget, { ok: true }>;

/**
 * A second lock behind guard.ts, which refuses No help before these tools run and records an audit
 * row. These tools check the level they resolved as well, in the guard's words, so a No-help quiz
 * is never made if they are ever held without the guard, or if a rule was made stricter between the
 * guard's read and this one.
 */
function pausedBy(target: Resolved): string | null {
  return target.level === "none" ? teacherRuleRefusal(target) : null;
}

/** The tools a teacher's rule pauses, which make nothing when no rule can be read. */
const RULED: ReadonlySet<string> = new Set(RULED_STUDY_TOOLS);

/** "all" and "every class" mean no class, as leaving it out does. */
function everyClass(named: string | undefined): boolean {
  const words = named?.trim().toLowerCase() ?? "";
  return (
    words === "" ||
    words === "all" ||
    words === "all classes" ||
    words === "every class"
  );
}

/** The study tools a Bot holds for this run, before guard.ts wraps the two a teacher's rule pauses. */
export function quizTools(deps: StudyToolDeps): GrantedTool[] {
  const context: StudyContext = {
    actorId: deps.actorId,
    botId: deps.botId,
    initiator: deps.initiator,
  };
  const now = () => deps.now?.() ?? new Date();

  /** The student's classes now, or null when there are none to read. */
  async function classes(): Promise<SchoolSnapshot | null> {
    return (await deps.school.current(context)).snapshot;
  }

  /** The class (and assignment) the model named, matched the way guard.ts matches it, or a refusal. */
  async function find(
    tool: string,
    named: { className: string; assignment?: string | null },
  ): Promise<
    | { ok: true; target: Resolved; snapshot: SchoolSnapshot | null }
    | { ok: false; refusal: string }
  > {
    try {
      const { snapshot, why } = await deps.school.current(context);
      // No classes were ever read, so no class's rule can be: a quiz or a deck is never made at
      // the default level. Progress is only a count of practice, so show_progress still answers.
      if (!snapshot && RULED.has(tool))
        return { ok: false, refusal: rulesUncheckedRefusal(why) };
      const target = await deps.rules.target(
        deps.actorId,
        snapshot,
        named,
        now(),
      );
      if (!target.ok)
        return { ok: false, refusal: `${REFUSAL_MARKER} ${target.reason}` };
      return { ok: true, target, snapshot };
    } catch (error) {
      console.error(
        JSON.stringify({
          type: "openduet-study-class-read-failed",
          tool,
          error: String(error),
        }),
      );
      return { ok: false, refusal: COULD_NOT_READ };
    }
  }

  const refusedAdvice =
    "If it is refused because of a teacher's rule, tell the student in one short sentence and offer to plan their time or help with another class; never quiz them on it another way. If it is refused for anything else, fix what it says and call it again.";

  return [
    {
      name: QUIZ_TOOL,
      ref: `openduet/${QUIZ_TOOL}`,
      description: [
        `Make a practice quiz for the student and save it: ${QUIZ_QUESTIONS.offered.min} to ${QUIZ_QUESTIONS.offered.max} multiple-choice questions on one class, each with four choices, the index of the right one, a one-sentence explanation and its topic.`,
        "Name the class exactly as their Classroom notices do, and the assignment when the quiz is for one.",
        'The app shows it as a card under your message, and the card runs the quiz and grades it, so never write the questions, choices or answers in the chat: say one short sentence, such as "Here\'s a 5-question quiz on trig identities."',
        refusedAdvice,
      ].join(" "),
      parameters: offeredQuizSchema,
      initiator: deps.initiator,
      async execute(args) {
        const checked = quizInputSchema.safeParse(
          withoutBlank(args ?? {}, ["assignment"]),
        );
        if (!checked.success)
          return refusalFor(QUIZ_TOOL, "this quiz", checked.error.issues);
        const input = checked.data;
        const place = await find(QUIZ_TOOL, {
          className: input.class,
          assignment: input.assignment ?? null,
        });
        if (!place.ok) return place.refusal;
        const paused = pausedBy(place.target);
        if (paused) return paused;
        const quiz = newQuiz(input, place.target, {
          id: randomUUID(),
          at: now(),
        });
        await deps.store.put(deps.actorId, {
          id: quiz.id,
          kind: "quiz",
          botId: deps.botId,
          classId: quiz.classId,
          data: quizData(quiz),
        });
        return JSON.stringify(quizToolResult(quiz));
      },
    },
    {
      name: FLASHCARDS_TOOL,
      ref: `openduet/${FLASHCARDS_TOOL}`,
      description: [
        `Make a deck of flashcards for the student and save it: ${DECK_CARDS.offered.min} to ${DECK_CARDS.offered.max} cards on one class, each one fact or term with a short front and a back of at most 20 words, from the basics to the hardest.`,
        "Name the class exactly as their Classroom notices do, and the assignment when the deck is for one.",
        "The app shows it as a card the student flips through, so never list the cards in the chat: say one sentence about the deck.",
        refusedAdvice,
      ].join(" "),
      parameters: offeredDeckSchema,
      initiator: deps.initiator,
      async execute(args) {
        const checked = deckInputSchema.safeParse(
          withoutBlank(args ?? {}, ["assignment"]),
        );
        if (!checked.success)
          return refusalFor(FLASHCARDS_TOOL, "this deck", checked.error.issues);
        const input = checked.data;
        const place = await find(FLASHCARDS_TOOL, {
          className: input.class,
          assignment: input.assignment ?? null,
        });
        if (!place.ok) return place.refusal;
        const paused = pausedBy(place.target);
        if (paused) return paused;
        const deck = newDeck(input, place.target, {
          id: randomUUID(),
          at: now(),
        });
        await deps.store.put(deps.actorId, {
          id: deck.id,
          kind: "deck",
          botId: deps.botId,
          classId: deck.classId,
          data: deckData(deck),
        });
        return JSON.stringify(deckToolResult(deck));
      },
    },
    {
      name: PROGRESS_TOOL,
      ref: `openduet/${PROGRESS_TOOL}`,
      description: [
        "Show the student's practice so far: how many practice quizzes they took and questions they got right, each topic weakest first, and what they missed lately.",
        "Give the class to see one class, or leave it out for every class. It counts practice quizzes only; it is not a grade.",
        "The app shows it as a card, so don't repeat its numbers: say in one or two short sentences which topic to review first, and offer a quiz or flashcards on it.",
      ].join(" "),
      parameters: offeredProgressSchema,
      initiator: deps.initiator,
      async execute(args) {
        const checked = progressInputSchema.safeParse(
          withoutBlank(args ?? {}, ["class"]),
        );
        if (!checked.success)
          return refusalFor(
            PROGRESS_TOOL,
            "this summary",
            checked.error.issues,
          );
        let classId: string | null = null;
        let snapshot: SchoolSnapshot | null = null;
        const named = checked.data.class;
        if (named !== undefined && !everyClass(named)) {
          const place = await find(PROGRESS_TOOL, { className: named });
          if (!place.ok) return place.refusal;
          classId = place.target.classId;
          snapshot = place.snapshot;
        } else {
          // Only for the classes' names: practice is still shown when the classes can't be read.
          snapshot = await classes().catch(() => null);
        }
        const { attempts, classNames } = practiceFrom(
          await deps.store.list(deps.actorId, "attempt", {
            limit: 500,
            ...(classId ? { classId } : {}),
          }),
        );
        for (const schoolClass of snapshot?.classes ?? [])
          classNames.set(schoolClass.id, schoolClass.name);
        const result: ProgressToolResult = {
          kind: "progress",
          summary: progressSummary(attempts, classNames, classId),
        };
        return JSON.stringify(result);
      },
    },
  ];
}
