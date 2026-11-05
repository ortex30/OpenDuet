import type { TeacherRuleBlock } from "@openbot/shared/study";
import { BuildIn } from "../build-in";
import { DuetCard } from "../kit";
import { HelpLevelPill } from "./help-level-pill";

/**
 * What the notice says, built from the refusal's facts rather than the sentence the model read, so
 * the words are the same every time: the class, the assignment if one decided it, and that planning
 * is not affected.
 */
export function teacherRuleSentence(block: TeacherRuleBlock): string {
  const where = block.assignment
    ? `${block.className} while “${block.assignment}” is open`
    : block.className;
  return `AI quizzes and flashcards are paused for ${where}. Planning still works.`;
}

/**
 * Who the rule is from, only as far as the facts say. A rule changed on the Teacher rules screen is
 * not the teacher's notice, so it is not put in the teacher's name; a level nobody set names nobody.
 */
export function teacherRuleSetBy(block: TeacherRuleBlock): string | null {
  if (block.source === "override") return "Set in Teacher rules";
  if (block.source === "notice")
    return block.teacher ? `Set by ${block.teacher}` : "Set by your teacher";
  return null;
}

/**
 * Where a quiz or a deck would have been when a teacher's rule paused it: the level, who set it, and
 * a sentence on what is paused. Calm on purpose: it is the teacher's rule, not an error, and the
 * Bot says the same in a line of its own.
 */
export function TeacherRuleNotice({
  block,
  what,
}: {
  block: TeacherRuleBlock;
  /** What was paused, for the card's name: "Quiz", "Flashcards". */
  what: string;
}) {
  const setBy = teacherRuleSetBy(block);
  return (
    <BuildIn order={0}>
      <DuetCard
        aria-label={`${what} paused`}
        className="px-4 py-3"
        role="region"
      >
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <HelpLevelPill level={block.level} />
          {setBy ? (
            <p className="type-sub text-duet-ink-2 [overflow-wrap:anywhere]">
              {setBy}
            </p>
          ) : null}
        </div>
        <p className="type-sub mt-2 text-duet-ink [overflow-wrap:anywhere]">
          {teacherRuleSentence(block)}
        </p>
      </DuetCard>
    </BuildIn>
  );
}
