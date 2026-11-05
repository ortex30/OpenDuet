/*
 * The study cards (quiz, flashcards, progress, a study plan and a teacher's rule) as props-only
 * components, so each can be drawn and tested alone. The tool renderers read the records and own
 * the requests; these only draw them and say what the person pressed.
 */

export { FlashcardDeck } from "./flashcard-deck";
export {
  blockMinutes,
  classColorVar,
  clockMinutes,
  dayLabel,
  formatMinutes,
  formatTimeRange,
  plural,
  shuffled,
} from "./format";
export { HelpLevelPill } from "./help-level-pill";
export { ProgressCard, weakestFirst } from "./progress-card";
export { QuizCard } from "./quiz-card";
export {
  blocksByDay,
  StudyPlanCard,
  studyLinkClassName,
} from "./study-plan-card";
export {
  TeacherRuleNotice,
  teacherRuleSentence,
  teacherRuleSetBy,
} from "./teacher-rule-notice";
export {
  TeacherRulesView,
  type TeacherRulesViewProps,
} from "./teacher-rules-view";
