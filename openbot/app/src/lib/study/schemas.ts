import {
  type AssignmentKind,
  type AssignmentStatus,
  CLASS_COLORS,
  type CalendarAllDay,
  type CalendarDeadline,
  type CalendarEvent,
  type CalendarView,
  type ClassColor,
  type ClassRules,
  type DeckToolResult,
  type Flashcard,
  type FlashcardDeck,
  HELP_LEVELS,
  type HelpLevel,
  type PlanStatus,
  type PlanToolResult,
  type ProgressSummary,
  type ProgressToolResult,
  type ProgressTopic,
  type QuizAttempt,
  type QuizPublic,
  type QuizQuestionPublic,
  type QuizResult,
  type QuizToolResult,
  type RuleSource,
  type RulesChange,
  type RulesView,
  type SchoolAssignment,
  type SchoolClass,
  type SchoolSnapshot,
  type StudyBlock,
  type StudyPlan,
} from "@openbot/shared/study";
import { z } from "zod";
import { asText, REFUSAL_MARKER } from "@/lib/plugins/tool-result";

/*
 * The app's reading of what /api/openduet/study and the study tools send, one schema per type in
 * shared/study.ts that crosses the wire. Each is checked against its shared type twice: `satisfies`
 * where it is written, so a wrong field is reported on that schema, and `SchemasMirrorShared` at the
 * foot, which also fails when the shared type gains a field the schema does not read.
 *
 * Structural on purpose: the server already checked every value against the same types, so a schema
 * here makes sure the app draws the shapes it knows and refuses anything else, without a second copy
 * of the server's rules to drift from them. Unknown keys are dropped, as z.object does.
 */

export const helpLevelSchema = z.enum(
  HELP_LEVELS,
) satisfies z.ZodType<HelpLevel>;

export const classColorSchema = z.enum(
  CLASS_COLORS,
) satisfies z.ZodType<ClassColor>;

export const assignmentKindSchema = z.enum([
  "assignment",
  "quiz",
  "test",
  "announcement",
  "material",
]) satisfies z.ZodType<AssignmentKind>;

export const assignmentStatusSchema = z.enum([
  "open",
  "missing",
  "returned",
]) satisfies z.ZodType<AssignmentStatus>;

export const ruleSourceSchema = z.enum([
  "override",
  "notice",
  "default",
]) satisfies z.ZodType<RuleSource>;

export const planStatusSchema = z.enum([
  "proposed",
  "applied",
  "discarded",
]) satisfies z.ZodType<PlanStatus>;

/* School data, parsed from the student's Google Classroom notices */

export const schoolClassSchema = z.object({
  id: z.string(),
  name: z.string(),
  teacher: z.string().nullable(),
  period: z.string().nullable(),
  color: classColorSchema,
}) satisfies z.ZodType<SchoolClass>;

export const schoolAssignmentSchema = z.object({
  id: z.string(),
  classId: z.string(),
  title: z.string(),
  kind: assignmentKindSchema,
  status: assignmentStatusSchema,
  due: z.string().nullable(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  points: z.number().nullable(),
  grade: z.string().nullable(),
  help: helpLevelSchema.nullable(),
  minutes: z.number(),
  link: z.string().nullable(),
  noticeId: z.string(),
}) satisfies z.ZodType<SchoolAssignment>;

export const schoolSnapshotSchema = z.object({
  syncedAt: z.string(),
  timeZone: z.string(),
  classes: z.array(schoolClassSchema),
  assignments: z.array(schoolAssignmentSchema),
  couldNotRead: z.array(z.string()),
}) satisfies z.ZodType<SchoolSnapshot>;

/* Teacher rules */

export const classRulesSchema = z.object({
  classId: z.string(),
  className: z.string(),
  teacher: z.string().nullable(),
  level: helpLevelSchema,
  source: ruleSourceSchema,
  override: helpLevelSchema.nullable(),
  assignments: z.array(
    z.object({
      assignmentId: z.string(),
      title: z.string(),
      kind: assignmentKindSchema.optional(),
      due: z.string().nullable(),
      status: assignmentStatusSchema,
      notice: helpLevelSchema.nullable(),
      override: helpLevelSchema.nullable(),
      level: helpLevelSchema,
      source: ruleSourceSchema,
    }),
  ),
}) satisfies z.ZodType<ClassRules>;

export const rulesViewSchema = z.object({
  classes: z.array(classRulesSchema),
  timeZone: z.string(),
  canLoosen: z.boolean(),
  syncedAt: z.string().nullable(),
  couldNotRead: z.array(z.string()),
}) satisfies z.ZodType<RulesView>;

/** What PUT /api/openduet/study/rules is sent: a level to set, or null to clear an override. */
export const rulesChangeSchema = z.object({
  classes: z.record(z.string(), helpLevelSchema.nullable()).optional(),
  assignments: z.record(z.string(), helpLevelSchema.nullable()).optional(),
}) satisfies z.ZodType<RulesChange>;

/* Quizzes, flashcards and progress */

export const quizQuestionPublicSchema = z.object({
  id: z.string(),
  question: z.string(),
  choices: z.array(z.string()),
  topic: z.string(),
}) satisfies z.ZodType<QuizQuestionPublic>;

export const quizPublicSchema = z.object({
  id: z.string(),
  title: z.string(),
  classId: z.string(),
  className: z.string(),
  assignmentId: z.string().nullable(),
  questions: z.array(quizQuestionPublicSchema),
  createdAt: z.string(),
}) satisfies z.ZodType<QuizPublic>;

export const quizResultSchema = z.object({
  questionId: z.string(),
  topic: z.string(),
  question: z.string(),
  choices: z.array(z.string()),
  selected: z.number(),
  correctIndex: z.number(),
  correct: z.boolean(),
  explanation: z.string(),
}) satisfies z.ZodType<QuizResult>;

export const quizAttemptSchema = z.object({
  id: z.string(),
  quizId: z.string(),
  classId: z.string(),
  results: z.array(quizResultSchema),
  correct: z.number(),
  total: z.number(),
  at: z.string(),
  reviewTaskAdded: z.boolean(),
}) satisfies z.ZodType<QuizAttempt>;

export const flashcardSchema = z.object({
  front: z.string(),
  back: z.string(),
}) satisfies z.ZodType<Flashcard>;

export const flashcardDeckSchema = z.object({
  id: z.string(),
  title: z.string(),
  classId: z.string(),
  className: z.string(),
  assignmentId: z.string().nullable(),
  cards: z.array(flashcardSchema),
  createdAt: z.string(),
}) satisfies z.ZodType<FlashcardDeck>;

export const progressTopicSchema = z.object({
  classId: z.string(),
  className: z.string(),
  topic: z.string(),
  correct: z.number(),
  total: z.number(),
}) satisfies z.ZodType<ProgressTopic>;

export const progressSummarySchema = z.object({
  classId: z.string().nullable(),
  attempts: z.number(),
  answered: z.number(),
  correct: z.number(),
  topics: z.array(progressTopicSchema),
  recentMisses: z.array(
    z.object({
      quizId: z.string(),
      classId: z.string(),
      topic: z.string(),
      question: z.string(),
      at: z.string(),
    }),
  ),
  note: z.string(),
}) satisfies z.ZodType<ProgressSummary>;

/* Study plans and the calendar */

export const studyBlockSchema = z.object({
  id: z.string(),
  assignmentId: z.string().nullable(),
  classId: z.string().nullable(),
  title: z.string(),
  date: z.string(),
  start: z.string(),
  end: z.string(),
  late: z.boolean().optional(),
}) satisfies z.ZodType<StudyBlock>;

export const studyPlanSchema = z.object({
  id: z.string(),
  status: planStatusSchema,
  reason: z.string(),
  timeZone: z.string(),
  startDate: z.string(),
  days: z.number(),
  blocks: z.array(studyBlockSchema),
  remaining: z.array(
    z.object({
      assignmentId: z.string(),
      title: z.string(),
      minutes: z.number(),
      due: z.string().nullable(),
    }),
  ),
  warnings: z.array(z.string()),
  totalMinutes: z.number(),
  createdAt: z.string(),
  appliedAt: z.string().nullable(),
  stale: z.boolean(),
  staleReason: z.enum(["changed", "started"]).nullable(),
}) satisfies z.ZodType<StudyPlan>;

export const calendarEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  start: z.string(),
  end: z.string(),
  location: z.string().optional(),
  classId: z.string().optional(),
}) satisfies z.ZodType<CalendarEvent>;

export const calendarAllDaySchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
}) satisfies z.ZodType<CalendarAllDay>;

export const calendarDeadlineSchema = z.object({
  assignmentId: z.string(),
  classId: z.string(),
  title: z.string(),
  date: z.string(),
  time: z.string().nullable(),
  kind: assignmentKindSchema,
  help: helpLevelSchema.nullable(),
}) satisfies z.ZodType<CalendarDeadline>;

export const calendarViewSchema = z.object({
  timeZone: z.string(),
  today: z.string(),
  nowMinute: z.number(),
  from: z.string(),
  to: z.string(),
  classes: z.array(schoolClassSchema),
  events: z.array(calendarEventSchema),
  allDay: z.array(calendarAllDaySchema),
  blocks: z.array(studyBlockSchema),
  deadlines: z.array(calendarDeadlineSchema),
  couldNotRead: z.array(z.string()),
}) satisfies z.ZodType<CalendarView>;

/* What each study tool returns. The cards read the full record by id. */

export const quizToolResultSchema = z.object({
  kind: z.literal("quiz"),
  id: z.string(),
  title: z.string(),
  className: z.string(),
  count: z.number(),
}) satisfies z.ZodType<QuizToolResult>;

export const deckToolResultSchema = z.object({
  kind: z.literal("deck"),
  id: z.string(),
  title: z.string(),
  className: z.string(),
  count: z.number(),
}) satisfies z.ZodType<DeckToolResult>;

export const progressToolResultSchema = z.object({
  kind: z.literal("progress"),
  summary: progressSummarySchema,
}) satisfies z.ZodType<ProgressToolResult>;

export const planToolResultSchema = z.object({
  kind: z.literal("plan"),
  id: z.string(),
  blocks: z.number(),
  totalMinutes: z.number(),
  remainingMinutes: z.number(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<PlanToolResult>;

/**
 * A study tool's result as its card reads it: the record the tool returned, or null for a refusal
 * ("Refused. ...", a teacher's rule among them) and for anything that is not that record.
 *
 * Read the way readPage reads make_page's (lib/copilot/page-card-tool.tsx): a server tool's text can
 * arrive JSON-encoded once more on its way through the runtime, so a string is unwrapped up to twice,
 * and a refusal is caught at either depth. A card draws nothing for a refusal, and the Bot says why.
 */
export function readToolResult<T>(
  result: unknown,
  schema: z.ZodType<T>,
): T | null {
  let value = result;
  for (let pass = 0; pass < 2 && typeof value === "string"; pass++) {
    if (asText(value).trimStart().startsWith(REFUSAL_MARKER)) return null;
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/*
 * The compile-time half of the agreement. `Mirrors` is true only when a schema's output and its
 * shared type are assignable both ways, and `Holds` refuses anything but true, so this list stops the
 * app compiling the moment a field is added, dropped or retyped on either side.
 */
type Mirrors<Schema extends z.ZodType, Shared> = [z.output<Schema>] extends [
  Shared,
]
  ? [Shared] extends [z.output<Schema>]
    ? true
    : false
  : false;
type Holds<Check extends true> = Check;

export type SchemasMirrorShared = [
  Holds<Mirrors<typeof helpLevelSchema, HelpLevel>>,
  Holds<Mirrors<typeof classColorSchema, ClassColor>>,
  Holds<Mirrors<typeof assignmentKindSchema, AssignmentKind>>,
  Holds<Mirrors<typeof assignmentStatusSchema, AssignmentStatus>>,
  Holds<Mirrors<typeof ruleSourceSchema, RuleSource>>,
  Holds<Mirrors<typeof planStatusSchema, PlanStatus>>,
  Holds<Mirrors<typeof schoolClassSchema, SchoolClass>>,
  Holds<Mirrors<typeof schoolAssignmentSchema, SchoolAssignment>>,
  Holds<Mirrors<typeof schoolSnapshotSchema, SchoolSnapshot>>,
  Holds<Mirrors<typeof classRulesSchema, ClassRules>>,
  Holds<Mirrors<typeof rulesViewSchema, RulesView>>,
  Holds<Mirrors<typeof rulesChangeSchema, RulesChange>>,
  Holds<Mirrors<typeof quizQuestionPublicSchema, QuizQuestionPublic>>,
  Holds<Mirrors<typeof quizPublicSchema, QuizPublic>>,
  Holds<Mirrors<typeof quizResultSchema, QuizResult>>,
  Holds<Mirrors<typeof quizAttemptSchema, QuizAttempt>>,
  Holds<Mirrors<typeof flashcardSchema, Flashcard>>,
  Holds<Mirrors<typeof flashcardDeckSchema, FlashcardDeck>>,
  Holds<Mirrors<typeof progressTopicSchema, ProgressTopic>>,
  Holds<Mirrors<typeof progressSummarySchema, ProgressSummary>>,
  Holds<Mirrors<typeof studyBlockSchema, StudyBlock>>,
  Holds<Mirrors<typeof studyPlanSchema, StudyPlan>>,
  Holds<Mirrors<typeof calendarEventSchema, CalendarEvent>>,
  Holds<Mirrors<typeof calendarAllDaySchema, CalendarAllDay>>,
  Holds<Mirrors<typeof calendarDeadlineSchema, CalendarDeadline>>,
  Holds<Mirrors<typeof calendarViewSchema, CalendarView>>,
  Holds<Mirrors<typeof quizToolResultSchema, QuizToolResult>>,
  Holds<Mirrors<typeof deckToolResultSchema, DeckToolResult>>,
  Holds<Mirrors<typeof progressToolResultSchema, ProgressToolResult>>,
  Holds<Mirrors<typeof planToolResultSchema, PlanToolResult>>,
];
