// Shared domain types for Pace. Every module imports from here — do not fork
// these shapes locally. Dates are "YYYY-MM-DD" strings, times are "HH:mm"
// 24-hour strings; never pass Date objects across module boundaries.

export type ID = string;

/** Feed identity is hashed; private subscription URLs are never retained. */
export interface CalendarEventSource {
  sourceId: string;
  uid: string;
  recurrenceId?: string;
  sequence: number;
  stamp?: string;
  fingerprint: string;
}

export interface CalendarImportRecord extends CalendarEventSource {
  id: ID;
  cancelled?: boolean;
  removalReason?: "cancelled" | "missing";
}

export interface CalendarOccurrence {
  date: string;
  start: string;
  end: string;
}

// ---------- Profile (derived from the onboarding quiz) ----------

export type QuizAnswers = Record<string, string>; // questionId -> optionId

export interface TimeWindow {
  start: string; // "HH:mm"
  end: string;
}

/** A one-day exception to the student's normal wake/sleep availability.
 *  Missing start/end inherit the profile; blocked windows remove capacity. */
export interface DayAvailabilityOverride {
  date: string;
  start?: string;
  end?: string;
  blocked: TimeWindow[];
  updatedAt: string;
}

export interface Profile {
  chronotype: "early" | "balanced" | "late";
  peakWindows: TimeWindow[]; // preferred deep-work windows, derived from chronotype
  /** Protected reset after a class or work shift. Optional only for profiles
   *  persisted before the field existed; current quiz/profile writes include it. */
  postCommitmentBufferMin?: number;
  wake: string; // earliest schedulable time
  sleep: string; // latest schedulable time
  focusSpanMin: number; // length of one work block (25–80)
  breakMin: number; // short break between blocks
  longBreakEvery: number; // blocks before a double-length break
  dailyCapMin: number; // max scheduled study/task minutes per weekday
  weekendPolicy: "protect" | "light" | "full";
  pacing: "steady" | "ramp"; // even spread vs intensity ramp toward deadlines
  hardFirst: boolean; // toughest work goes into peak-energy windows first
  variety: "batch" | "mix"; // one subject per day vs mixing subjects
  bufferDays: number; // finish-by cushion before due dates (0–2)
  procrastinationStyle: "starter" | "deadline";
  /** When a rebounded/skipped session is auto-rescheduled, where it should land.
   *  Absent → treated as "auto" (engine's default nearest-legal search). */
  reboundWhen?: "same-day-later" | "next-day" | "next-evening" | "auto";
}

/** A slot a rebound just vacated. The engine treats it like busy time ON THAT
 *  DATE so a later rebuild won't silently refill the spot the student cleared —
 *  waivable only by the hard-deadline escape hatch. Minutes-since-midnight. */
export interface ReboundVacatedSlot {
  date: string;
  startMin: number;
  endMin: number;
}

// ---------- Life data ----------

export interface Course {
  id: ID;
  name: string;
  color: string; // key into COURSE_COLORS (lib/helpers.ts)
  examDate?: string; // enables backward planning when present
  weeklyEffortMin: number; // steady study minutes per week
  createdAt: string;
}

/** Recurring weekly busy time: class meetings, work shifts, sports. */
export interface Commitment {
  id: ID;
  title: string;
  courseId?: ID;
  days: number[]; // 0=Sun … 6=Sat
  start: string;
  end: string;
  kind: "class" | "work" | "activity" | "other";
  calendarSource?: CalendarEventSource;
  calendarOccurrences?: CalendarOccurrence[];
}

/** A single dated busy event: appointment, game, trip day. */
export interface OneOff {
  id: ID;
  title: string;
  date: string;
  start: string;
  end: string;
  courseId?: ID;
  kind?: Commitment["kind"];
  calendarSource?: CalendarEventSource;
}

export type TaskPriority = "asap" | "high" | "medium" | "low";
export type DeadlineType = "soft" | "hard";
export type TaskPreferredWindow =
  | "peak"
  | "morning"
  | "afternoon"
  | "evening"
  | "any";
/** Coarse target for an assistant-driven reschedule. "earlier"/"later" are
 *  relative to the block's current time; the engine resolves the exact slot. */
export type RescheduleWindow =
  | "earlier"
  | "later"
  | "morning"
  | "afternoon"
  | "evening"
  | "any";
export type StudyStage = "understand" | "practice" | "review" | "exam-ready";

export interface Task {
  id: ID;
  title: string;
  courseId?: ID;
  due?: string;
  dueTime?: string; // local clock deadline on due; absent means date-only
  sourceUrl?: string;
  calendarSource?: CalendarEventSource;
  /** Concurrent same-field edits need an explicit student review. */
  syncConflicts?: string[];
  estimateMin: number;
  /** Student-reported effort still outstanding after a partial-work check-in.
   *  When present, this is the planner's canonical remaining total; the
   *  original estimate stays untouched so learning samples remain honest. */
  remainingEstimateMin?: number;
  /** Earliest day a Rebound-generated continuation may resume. This is
   *  separate from the student's explicit startDate and never rewrites it. */
  resumeOn?: string;
  /** Defaults are applied at read/schedule time for migration safety. */
  priority?: TaskPriority;
  deadlineType?: DeadlineType;
  startDate?: string;
  minChunkMin?: number;
  preferredWindow?: TaskPreferredWindow;
  dependsOn?: ID[];
  studyStage?: StudyStage;
  done: boolean;
  createdAt: string;
  /** Set when this task is an auto-generated review for a study set. Used to
   *  deduplicate adaptive reviews and to link the task back to its set. */
  studySetId?: ID;
  /** Zero-based curriculum unit for a generated course-plan task. Calendar and
   *  task entry points use it to reopen the exact lesson instead of the top of
   *  the full study set. */
  studyUnitIndex?: number;
  /** Plain-language explanation for scheduled/system-created tasks, e.g. an
   *  "Adaptive review" rationale. Rendered as a quiet label where space allows. */
  reason?: string;
  /** Optional short summary of what the task involves — AI-generated on demand
   *  (see /api/describe) or user-entered. Shown in the task detail view. */
  description?: string;
  /** Planner-scoped study plan (unit names, session goals, ordering) the
   *  assistant writes on request. Never researched or invented facts. */
  plan?: string;
}

/** A repeatable, completable activity. Unlike a Commitment, a routine is
 *  flexible work that the engine places around busy time and schoolwork. */
export interface Routine {
  id: ID;
  title: string;
  days: number[]; // 0=Sun … 6=Sat
  durationMin: number;
  preferredStart?: string; // preferred "HH:mm" start; engine may move it
  courseId?: ID;
  active: boolean;
  createdAt: string;
}

// ---------- The schedule ----------

export type BlockStatus = "todo" | "done" | "missed" | "partial";

/** Engine-managed work block. Fixed commitments/one-offs are NOT blocks —
 *  views merge them in via getDayAgenda(). */
export interface Block {
  id: ID;
  date: string;
  start: string;
  end: string;
  kind: "task" | "study" | "routine";
  refId: ID; // taskId, courseId, or routineId
  title: string;
  courseId?: ID;
  status: BlockStatus;
  movedFrom?: string; // date it was healed away from
  rebounds?: number; // times the user has pressed Rebound on this block
  locked?: boolean; // user-placed; engine must not move it
  occurrenceDate?: string; // original recurring date; stable when a routine moves
  completedOn?: string; // activity/streak date; independent of scheduled date
  /** Set when this block was minted from flashcard review demand. Deep-links
   *  the block to that set's review session; refId also carries the setId
   *  (not a courseId) for these blocks. */
  reviewSetId?: ID;
  /** Whole-assignment remainder reported when this became partial. Kept on the
   *  historical block so the calendar can explain the Rebound truthfully. */
  reportedRemainingMin?: number;
}

export type WorkSessionOutcome = "finished" | "partial" | "not-started";

/** Coarse planned daypart retained for on-device rhythm learning. Exact clock
 *  times are deliberately excluded from the learning row. */
export type WorkSessionWindow = "morning" | "afternoon" | "evening";

export type WorkSessionReason =
  | "ran-out-of-time"
  | "got-stuck"
  | "low-energy"
  | "interrupted"
  | "plan-too-big";

/** A bounded, content-light learning signal. Titles and uploaded source text
 *  are deliberately excluded; the planner needs timing/outcome evidence, not
 *  a second copy of a student's schoolwork. */
export interface WorkSession {
  id: ID;
  blockId: ID;
  taskId?: ID;
  courseId?: ID;
  outcome: WorkSessionOutcome;
  /** Daypart the student says they actually started. Manual check-ins derive
   *  this from a time input; timer/system flows may fall back to the planned
   *  block. Exact clock time is not retained. */
  observedWindow?: WorkSessionWindow;
  plannedMin: number;
  actualMin?: number;
  remainingMin?: number;
  reason?: WorkSessionReason;
  recordedAt: string;
}

/** Unified item for rendering a day: blocks + commitments + one-offs. */
export interface AgendaItem {
  id: ID;
  date: string;
  start: string;
  end: string;
  kind: "block" | "commitment" | "oneoff";
  title: string;
  courseId?: ID;
  block?: Block; // present when kind === "block"
}

export interface HealMove {
  title: string;
  from: string; // date
  to: string;
}

/** A single slot on a schedule move, kept whole so a receipt can show the
 *  clock time and not just the day. */
export interface AppliedSlot {
  date: string;
  start: string;
  end: string;
}

/** One row of the "Changes" receipt under an assistant reply.
 *
 *  `note` is the sentence the store already wrote and is ALWAYS present — it
 *  stays the source of truth and the fallback for every row. The structured
 *  fields are filled in only by the branches that genuinely have them (the
 *  three schedule moves), so a row like "Added task X" or "Learned: …" renders
 *  as its sentence rather than as an empty before/after skeleton. */
export interface AppliedChange {
  note: string;
  title?: string;
  blockId?: ID;
  before?: AppliedSlot;
  after?: AppliedSlot;
  /** Why the engine chose this slot. Already written at the move site; this is
   *  the field that carries it out to the student. */
  reason?: string;
  /** The engine had to leave the requested window to find a legal opening. */
  relaxed?: boolean;
  /** The "move" resolved to the slot the block was already in. The store still
   *  reports it as a reschedule, so the receipt has to say plainly that nothing
   *  moved rather than draw an arrow between two identical times. */
  unchanged?: boolean;
  failed?: boolean;
}

export interface HealNote {
  at: string; // ISO timestamp
  summary: string;
  moves: HealMove[];
  moveCount?: number; // total when the rendered move list is intentionally capped
  overloaded?: boolean; // couldn't fit everything before its deadline
  source?: "automatic" | "rebound" | "assistant" | "manual";
  /** Durable outcome when the exact repair was undone from any receipt
   *  surface. Kept on the history note so every view and reload agrees. */
  undo?: { restored: number; skipped: number };
}

// ---------- Study tools ----------

export type FlashcardFormat =
  | "basic"
  | "listen-recall"
  | "cloze"
  | "typed-blank"
  | "multiple-choice"
  | "image-occlusion";

export type GeneratableFlashcardFormat = Exclude<
  FlashcardFormat,
  "image-occlusion"
>;

/** A small, durable media reference. Uploaded binaries live outside the
 * schedule envelope; `assetId` addresses that device/cloud asset while `src`
 * supports a bounded HTTPS reference. Every image requires useful alt text. */
export interface FlashcardImage {
  assetId?: ID;
  src?: string;
  alt: string;
  width?: number;
  height?: number;
}

/** Browser speech-synthesis preferences. These change presentation, not the
 * answer contract, so toggling them does not reset spaced-review history. */
export interface FlashcardReadAloud {
  front?: boolean;
  back?: boolean;
  language?: string;
}

export interface FlashcardOcclusion {
  id: ID;
  /** Normalized image coordinates in the inclusive 0..1 range. */
  x: number;
  y: number;
  width: number;
  height: number;
  answer: string;
  label?: string;
}

interface FlashcardBase {
  id: ID;
  front: string;
  back: string;
  /** Student-owned review metadata. Missing means not bookmarked. */
  bookmarked?: boolean;
  /** Zero-based library unit. Optional for legacy and note-generated cards. */
  unitIndex?: number;
  /** Optional images on ordinary term/definition sides. */
  frontImage?: FlashcardImage;
  backImage?: FlashcardImage;
  readAloud?: FlashcardReadAloud;
}

/** Missing format is the persisted legacy representation of a basic card. */
export interface BasicFlashcard extends FlashcardBase {
  format?: "basic";
}

/** A listen-first retrieval cue. Browser speech is always available as an
 * explicit action when supported, while the stored front remains the durable
 * text alternative and source of truth. Nothing autoplays. */
export interface ListenRecallFlashcard extends FlashcardBase {
  format: "listen-recall";
}

/** `clozeTemplate` uses one or more `{{hidden text}}` spans. `front` is its
 * blanked projection and `back` is the fully revealed projection. */
export interface ClozeFlashcard extends FlashcardBase {
  format: "cloze";
  clozeTemplate: string;
}

/** Exact, deterministic active recall. The prompt contains at least one
 * visible blank and accepted answers are checked before the back is shown. */
export interface TypedBlankFlashcard extends FlashcardBase {
  format: "typed-blank";
  acceptedAnswers: string[];
}

export interface MultipleChoiceFlashcard extends FlashcardBase {
  format: "multiple-choice";
  choices: string[];
  answerIndex: number;
}

/** One card may expose several labeled masks over the same image. Coordinates
 * remain resolution-independent so editor and player reflow consistently. */
export interface ImageOcclusionFlashcard extends FlashcardBase {
  format: "image-occlusion";
  image: FlashcardImage;
  occlusions: FlashcardOcclusion[];
}

export type Flashcard =
  | BasicFlashcard
  | ListenRecallFlashcard
  | ClozeFlashcard
  | TypedBlankFlashcard
  | MultipleChoiceFlashcard
  | ImageOcclusionFlashcard;

export type QuizQuestionKind =
  | "applied"
  | "idea"
  | "skill"
  | "practice"
  | "trap";

export type StudyMaterialDepth = "summary" | "standard" | "comprehensive";
export type StudyDifficulty = "high-school" | "ap" | "college";
export type PracticeQuestionFormat =
  | "multiple-choice"
  | "true-false"
  | "fill-blank"
  | "short-answer"
  | "free-response";

export type AssessmentPassageLayer =
  | "recognition"
  | "mechanism"
  | "application";

export type AssessmentPreset =
  | "standard"
  | "ap-history"
  | "ap-science"
  | "ap-english"
  | "sat-reading-writing"
  | "sat-math";

export type StudyExplanationStyle =
  | "concise"
  | "guided"
  | "step-by-step"
  | "deep-connections";

/** One bounded stimulus shared by a recognition -> mechanism -> application
 * question group. The body is inert plain text; rendering never interprets it
 * as HTML or instructions. */
export interface AssessmentPassage {
  id: ID;
  title?: string;
  body: string;
}

/** A point-bearing semantic grading criterion. `maxPoints` is always a small
 * positive integer and the generated question sanitizer derives the rubric
 * total instead of accepting a model-supplied total. */
export interface AssessmentRubricCriterion {
  id: ID;
  label: string;
  description: string;
  maxPoints: number;
}

/** User-selected controls for AI-built study material. Every normalized
 *  settings object contains all five question-count keys, including zeroes. */
export interface StudyGenerationSettings {
  /** Missing on legacy output and treated as a complete study set. Assessment
   * artifacts intentionally request zero flashcards and a question bank. */
  artifactKind?: "study-set" | "assessment";
  depth: StudyMaterialDepth;
  difficulty: StudyDifficulty;
  language: string;
  focus: string;
  /** Missing on legacy material and normalized to the balanced guided style. */
  explanationStyle?: StudyExplanationStyle;
  /** Exact number of two-sided retrieval cards requested for this set. */
  flashcardCount: number;
  /** Exact per-format request. Missing on legacy persisted settings, which
   * normalize to an all-basic deck using `flashcardCount`. */
  flashcardFormatCounts?: Record<GeneratableFlashcardFormat, number>;
  /** Optional browser TTS flags applied deterministically after generation. */
  flashcardReadAloud?: { front: boolean; back: boolean };
  /** Optional assessment style. Missing keeps legacy general-purpose output. */
  assessmentPreset?: AssessmentPreset;
  /** Number of three-question passage groups. Missing on legacy persisted
   * settings and normalized to zero. */
  passageGroupCount?: number;
  /** Exact standalone per-format request. Passage groups add one recognition
   * multiple-choice, one mechanism short-answer, and one application
   * free-response question each. */
  questionCounts: Record<PracticeQuestionFormat, number>;
}

export interface QuizQuestion {
  id: ID;
  q: string;
  choices: string[];
  answerIndex: number;
  why: string;
  /** Missing on legacy questions and therefore treated as multiple-choice. */
  format?: PracticeQuestionFormat;
  /** Accepted responses for typed questions. Multiple-choice keeps using
   *  choices + answerIndex; other formats keep those legacy fields as [] + 0. */
  acceptedAnswers?: string[];
  /** Optional shared stimulus and the question's fixed role within its
   * recognition -> mechanism -> application passage group. Both fields are
   * present together or absent together. */
  passageId?: ID;
  passageLayer?: AssessmentPassageLayer;
  /** Free-response only. Deterministic formats reject these semantic-grading
   * fields rather than accidentally exposing or applying them. */
  rubric?: AssessmentRubricCriterion[];
  referenceAnswer?: string;
  maxResponseChars?: number;
  /** Optional bounded concept label used for answer-level analytics. */
  topic?: string;
  /** Zero-based library unit. Optional for legacy and note-generated quizzes. */
  unitIndex?: number;
  /** The retrieval move this question asks for. */
  kind?: QuizQuestionKind;
}

export type StudySourceKind =
  | "pasted"
  | "dictation"
  | "text-file"
  | "photo"
  | "pdf"
  | "docx"
  | "pptx"
  | "audio"
  | "video";

export type StudySourceProcessingStatus = "processing" | "ready" | "failed";
export type StudySourceLocatorKind = "page" | "slide" | "section";

export type StudySourceOriginalFileStatus =
  | "saving"
  | "ready"
  | "device-only"
  | "failed";

/** Non-secret state for the optional private copy of an imported original.
 * Object paths and signed tokens never enter local state or source sync. */
export interface StudySourceOriginalFile {
  status: StudySourceOriginalFileStatus;
  assetId?: string;
  savedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** A stable character range inside extracted plain text. `index` is one-based
 * so labels and citations match the page/slide numbers students see. */
export interface StudySourceLocator {
  kind: StudySourceLocatorKind;
  index: number;
  label: string;
  start: number;
  end: number;
}

/** Non-secret provenance for an explicitly transcribed recording. The media
 * bytes and provider credential never enter source or planner persistence. */
export interface StudySourceTranscription {
  provider: "openai";
  model: "gpt-4o-transcribe";
  createdAt: string;
}

/** Provenance and processing state for an imported source. The original binary
 * never enters the schedule envelope: only this non-secret pointer can refer to
 * a separate private, owner-scoped Storage object. */
export interface StudySourceMaterial {
  status: StudySourceProcessingStatus;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
  sha256?: string;
  totalUnits?: number;
  extractedUnits?: number;
  truncated?: boolean;
  locators?: StudySourceLocator[];
  transcription?: StudySourceTranscription;
  originalFile?: StudySourceOriginalFile;
  /** True after a student edits extracted text. Locator citations are removed
   * at that point rather than pointing at stale page/slide offsets. */
  edited?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/** One reversible, student-created source checkpoint. Source history stores
 * inert text rather than HTML and is capped by both count and total characters
 * before it enters local or owner-scoped cloud persistence. */
export interface StudySourceRevision {
  id: ID;
  title: string;
  content: string;
  savedAt: string;
}

/** A student-owned piece of class material: pasted notes, imported documents,
 * or an editable transcription from a photo. Sources are the durable,
 * editable, citable origin of study sets. */
export interface StudySource {
  id: ID;
  courseId?: ID;
  title: string;
  kind: StudySourceKind;
  content: string;
  /** Missing on pasted/dictated/photo and legacy sources, which are implicitly ready. */
  material?: StudySourceMaterial;
  /** Newest-first manual checkpoints. Missing preserves legacy sources. */
  history?: StudySourceRevision[];
  createdAt: string;
  updatedAt: string;
}

/** Bounded provenance for an artifact generated from an existing deck. Card
 * text is never copied here; the digest only detects later deck edits. */
export interface StudySetGenerationInput {
  kind: "flashcards";
  setId: ID;
  deckRevision: string;
  cardCount: number;
  /** True when generation received a capped prefix rather than the whole deck. */
  truncated?: boolean;
}

/** A bounded Rebound-owned visual accent for identifying a study artifact.
 * Missing means the default cobalt treatment and keeps legacy records compact. */
export type StudySetCoverTheme =
  | "cobalt"
  | "grove"
  | "saffron"
  | "terracotta"
  | "ink";

/** Learner-owned organization for the Study and Assessment libraries. Folder
 * names are inert plain text and contain no study content. Membership lives in
 * a separate stable-ID collection so moving an artifact never rewrites its
 * cards, questions, source lineage, drafts, or mastery evidence. */
export interface StudyFolder {
  id: ID;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Exactly one optional folder membership per study artifact. `id` equals
 * `setId`, giving cross-device reconciliation one stable item identity when a
 * learner moves the same artifact between folders. */
export interface StudyFolderAssignment {
  id: ID;
  setId: ID;
  folderId: ID;
  updatedAt: string;
}

export interface StudySet {
  id: ID;
  courseId?: ID;
  /** Missing preserves the legacy complete-set behavior. Assessment artifacts
   * remain StudySets so question IDs, drafts, results, mastery, and sync keep
   * one canonical identity without duplicating answer-bearing content. */
  artifactKind?: "study-set" | "assessment";
  /** Preferred opening mode for an assessment artifact. A newer saved draft
   * can still resume its own mode instead of being overwritten. */
  defaultAssessmentMode?: AssessmentMode;
  /** Standalone assessment versions remain separate canonical StudySets so
   * each version keeps independent question IDs, drafts, results, and mastery
   * receipts. The shared group id powers honest "Version N" navigation. */
  assessmentVariantGroupId?: ID;
  /** One-based, bounded label within `assessmentVariantGroupId`. Missing on
   * legacy assessments is interpreted as version 1 without mutating them. */
  assessmentVariantNumber?: number;
  /** Stable catalog identity for deterministic curriculum lessons and plans. */
  librarySubjectId?: string;
  /** Authored library packet version used to refresh corrected lessons once. */
  libraryContentVersion?: number;
  topic: string;
  /** Optional learner-authored plain-text context for identifying the set.
   * It is never treated as source material or rendered as HTML. */
  description?: string;
  /** Optional learner-selected presentation only; never affects generation,
   * mastery, recommendation, or source-grounding behavior. */
  coverTheme?: StudySetCoverTheme;
  guide?: string; // markdown study guide
  /** Legacy inline notes, retained for migration. New sets prefer sourceIds. */
  sourceNotes?: string;
  /** IDs of StudySource records this set was generated from (may be empty for
   *  legacy sets or topic-only generation). */
  sourceIds?: ID[];
  /** Source updatedAt values captured when generation ran. New sets use this
   *  to prevent an edited source from being presented later as the unchanged
   *  evidence behind generated material or tutor citations. */
  sourceVersions?: Record<ID, string>;
  /** True when generation used capped excerpts rather than every selected
   *  source in full. The attached sourceIds include only contributors. */
  sourceContextTruncated?: boolean;
  /** Optional non-source lineage for assessment generation. */
  generationInput?: StudySetGenerationInput;
  /** Generated learning goals and glossary. Optional for legacy/library sets. */
  objectives?: string[];
  keyTerms?: { term: string; definition: string }[];
  /** The normalized controls used to generate this set. */
  generationSettings?: StudyGenerationSettings;
  /** Shared assessment stimuli. Missing keeps legacy flat quizzes readable. */
  passages?: AssessmentPassage[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
  recap?: string; // spoken-style recap for audio
  createdAt: string;
}

/** A durable record of a learning activity, used for mastery. Unlike the
 *  transient QuizResult/SrsEntry, these accumulate the full history. */
export interface LearningEvent {
  id: ID;
  setId: ID;
  courseId?: ID;
  kind: "flashcard" | "quiz" | "guided-session";
  correct: number;
  total: number;
  at: string;
}

export type FlashcardReviewRating = "again" | "hard" | "good" | "easy";
export type FlashcardConfidence = 1 | 2 | 3;
export type FlashcardReviewContext = "review-hub" | "deck" | "guided";

/** Immutable, content-free evidence for device-local review analytics. The
 * mutable schedule remains in SrsEntry and this ledger is never replayed into
 * scheduling state. */
export interface FlashcardReviewEvent {
  id: ID;
  /** Device-local Lamport order. Higher values were accepted later; equal
   * values are concurrent and use the receipt id as a deterministic tie. */
  acceptedOrder: number;
  setId: ID;
  cardId: ID;
  at: string;
  utcOffsetMinutes: number;
  rating: FlashcardReviewRating;
  easeFactor: number;
  contentDigest: string;
  context: FlashcardReviewContext;
}

/** Flashcard review state. `due` and `box` keep legacy Leitner saves valid;
 * `dueAt` is the minute-level schedule used by the review modes. FSRS fields
 * power adaptive intervals; missing FSRS fields are seeded from ease/box. */
export interface SrsEntry {
  cardId: ID;
  /** Versioned digest of the answer-bearing card content reviewed. It lets
   * sync discard stale progress after a concurrent semantic card edit. */
  contentDigest?: string;
  box: number;
  due: string;
  /** False only for confidence metadata saved before a card enters scheduling. */
  scheduleInitialized?: boolean;
  dueAt?: string;
  lastReviewed?: string;
  /** Canonical instant of the scheduling transition. Legacy rows may omit it. */
  lastReviewedAt?: string;
  /** Stable immutable review receipt that produced the current schedule. */
  lastReviewEventId?: ID;
  lastRating?: FlashcardReviewRating;
  easeFactor?: number;
  reviewCount?: number;
  confidence?: FlashcardConfidence;
  confidenceUpdatedAt?: string;
  /** FSRS memory stability in days. */
  stability?: number;
  /** FSRS difficulty on a 1–10 scale. */
  difficulty?: number;
  /** Successful FSRS repetitions (ts-fsrs `reps`). */
  reps?: number;
  /** FSRS lapse count. */
  lapses?: number;
  /** FSRS queue state. */
  fsrsState?: "new" | "learning" | "review" | "relearning";
  /** Last scheduled interval length in days. */
  scheduledDays?: number;
  /** Days elapsed at the last review transition. */
  elapsedDays?: number;
}

export type AssessmentMode = "learn" | "test" | "exam";
export type AssessmentContext = "standalone" | "guided" | "curriculum";
export type AssessmentScope = "full" | "focused" | "unit-check";
export type AssessmentReviewStatus =
  | "auto"
  | "manual"
  | "pending"
  | "provisional"
  | "accepted"
  | "challenged"
  | "failed";

/** Bounded answer evidence for analytics and review. Raw learner responses are
 * intentionally excluded from the schedule envelope. */
export interface AssessmentAnswerResult {
  questionId: ID;
  format: PracticeQuestionFormat;
  /** Missing on early additive results and derivable from the enclosing score. */
  answered?: boolean;
  correct: boolean | null;
  confidence?: 1 | 2 | 3;
  durationMs?: number;
  earnedPoints?: number;
  possiblePoints?: number;
  topic?: string;
  revision?: string;
  reviewStatus?: AssessmentReviewStatus;
}

export interface QuizResult {
  /** Optional stable attempt identity; absent on legacy score-only results. */
  id?: ID;
  setId: ID;
  /** Present for curriculum unit checks; older and free-form quizzes omit it. */
  unitIndex?: number;
  mode?: AssessmentMode;
  context?: AssessmentContext;
  scope?: AssessmentScope;
  durationMs?: number;
  questionFingerprint?: string;
  /** True while one or more semantic grades still require review. */
  provisional?: boolean;
  answers?: AssessmentAnswerResult[];
  score: number;
  total: number;
  at: string;
}

// ---------- Notebooks (cloud tables — supabase/migrations/0004) ----------

/** A per-user collection of study sources with a source-grounded AI chat.
 *  Unlike store state, notebooks live in dedicated Supabase tables (owner-keyed
 *  RLS) and never ride the profiles.schedule sync envelope — source text is far
 *  too large for its 128KB cap. Access goes through lib/notebooks.ts. */
export interface Notebook {
  id: ID;
  title: string;
  color?: string; // key into COURSE_COLORS (lib/helpers.ts)
  createdAt: string; // ISO timestamp
  updatedAt: string;
  sourceCount?: number; // present on list reads
}

export type NotebookSourceKind = "pdf" | "text-file" | "pasted" | "photo";

/** One piece of the student's own material: browser-extracted PDF text, an
 *  imported text file, pasted notes, or reviewed photo transcription. Plain
 *  text only — never binary. */
export interface NotebookSource {
  id: ID;
  notebookId: ID;
  title: string;
  kind: NotebookSourceKind;
  content: string;
  createdAt: string;
}

/** One turn of a notebook's persistent chat. sourceIds records the sources the
 *  assistant cited, as returned by /api/notebook (which derives them from real
 *  Citations-API spans). It is a display record, not a trusted authority —
 *  chips only render for ids that still resolve to a live source. */
export interface NotebookMessage {
  id: ID;
  notebookId: ID;
  role: "user" | "assistant";
  content: string;
  sourceIds: ID[];
  createdAt: string;
}

// ---------- Database (canonical user knowledge) ----------

export type DatabaseTab = "all" | "notebooks";

export type KnowledgeItemKind =
  | "photo"
  | "pdf"
  | "text-file"
  | "pasted"
  | "link";

export type KnowledgeClassificationStatus =
  | "pending"
  | "classifying"
  | "ready"
  | "needs-review"
  | "failed";
export type KnowledgeUploadStatus =
  | "reserved"
  | "ready"
  | "deleting"
  | "failed";

export type KnowledgeLinkKind = "course" | "unit" | "task" | "study-set";

/** A reusable, editable unit label. Unit keys are intentionally user-scoped:
 *  task/course ids live in the synced schedule envelope rather than relational
 *  tables, so knowledge links validate ownership against that envelope. */
export interface KnowledgeUnit {
  id: ID;
  courseId?: ID;
  name: string;
  source: "ai" | "user";
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeLink {
  id: ID;
  itemId: ID;
  kind: KnowledgeLinkKind;
  targetId: ID;
  label: string;
  createdAt: string;
}

/** One canonical source shared by Database, task context, Study, Notebooks,
 *  and Rebound retrieval. Originals remain private; signed URLs are ephemeral
 *  presentation fields and are never persisted in the client store. */
export interface KnowledgeItem {
  id: ID;
  title: string;
  kind: KnowledgeItemKind;
  content: string;
  mimeType?: string;
  sourceUrl?: string;
  storagePath?: string;
  thumbnailPath?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  fileSize: number;
  checksum?: string;
  tags: string[];
  classificationStatus: KnowledgeClassificationStatus;
  uploadStatus?: KnowledgeUploadStatus;
  classificationMethod?: "ai" | "rules" | "manual";
  links: KnowledgeLink[];
  notebookIds: ID[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Assistant ----------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
  /** Clear generation active when this turn was written. Missing on legacy
   * conversations created before durable cross-device clears. */
  clearVersionId?: string;
}

/** A clear generation makes deletion independent of untrusted message clocks.
 * `at` orders concurrent device clears; `id` deterministically breaks ties. */
export interface ChatClearVersion {
  id: string;
  at: string;
}

/** One durable fact Rebound has learned about the student. Append-only log
 *  rendered in Settings; a digest rides in every chat's context. */
export interface LearnedNote {
  id: ID;
  at: string; // ISO timestamp
  text: string;
  source: "chat" | "reschedule" | "manual" | "quiz";
  /** Optional structured time-of-day constraint parsed from an explicit rule
   *  ("I can never focus before 10am"). Minutes since midnight, 0–1439.
   *  notBeforeMin bars work before it; notAfterMin bars work after it. Consumed
   *  deterministically by the engine via the store's engineInput avoidWindows —
   *  additive/optional so notes persisted before this field stay valid. */
  notBeforeMin?: number;
  notAfterMin?: number;
}

/** What the AI (or fallback parser) extracts from free text. */
export interface ParsedAdditions {
  courses: { name: string; examDate?: string; weeklyEffortMin?: number }[];
  commitments: {
    title: string;
    days: number[];
    start: string;
    end: string;
    kind: Commitment["kind"];
    courseName?: string;
    calendarSource?: CalendarEventSource;
    calendarOccurrences?: CalendarOccurrence[];
  }[];
  oneOffs: {
    title: string;
    date: string;
    start: string;
    end: string;
    calendarSource?: CalendarEventSource;
  }[];
  tasks: {
    title: string;
    courseName?: string;
    due?: string;
    dueTime?: string;
    description?: string;
    sourceUrl?: string;
    calendarSource?: CalendarEventSource;
    estimateMin?: number;
    priority?: TaskPriority;
    deadlineType?: DeadlineType;
    startDate?: string;
    minChunkMin?: number;
    preferredWindow?: TaskPreferredWindow;
    studyStage?: StudyStage;
  }[];
  routines: {
    title: string;
    days: number[];
    durationMin: number;
    preferredStart?: string;
    courseName?: string;
  }[];
  unplaced: { text: string; reason: string }[];
  /** Reconciliation intent is supplied only by the confirmed calendar path. */
  calendarImport?: {
    sourceId: string;
    seenUids: string[];
    cancellations: (CalendarEventSource & { expired?: boolean })[];
    complete: boolean;
    removeMissing: boolean;
    replaceUids?: string[];
    missingSources?: CalendarEventSource[];
  };
  /** Whitelisted Profile fields stated in the text (sleep, study windows,
   *  focus/break lengths, …). Optional; intake previews it as one confirmable
   *  preference update before applying it. */
  profile?: Partial<Profile>;
}

/** A bounded Database source that the chat assistant cited in its final reply. */
export interface AssistantContextSource {
  id: ID;
  title: string;
  excerpt: string;
  excerptChars: number;
  labels: string[];
}

/** A structured clarifying question the chat assistant may return instead of
 *  actions when it needs the student's decision first. The client renders it
 *  as a tappable card; the chosen answer goes back as a normal user message. */
export interface AssistantClarifyingQuestion {
  prompt: string;
  /** single = pick one; multi = pick any that apply. */
  type: "single" | "multi";
  options: string[];
}

/** Actions the chat assistant may return; the client executes them via the
 *  store and reports what changed. Server must validate against this list. */
export type AssistantAction =
  | {
      type: "addTask";
      title: string;
      courseName?: string;
      due?: string;
      estimateMin?: number;
      priority?: TaskPriority;
      deadlineType?: DeadlineType;
      startDate?: string;
      minChunkMin?: number;
      preferredWindow?: TaskPreferredWindow;
      studyStage?: StudyStage;
      dependsOnTaskIds?: ID[];
      /** Links the task (and its blocks) to a study set. Accepts a real set id
       *  or the sentinel "library:<subjectId>" — resolved by executeActions to
       *  the set created by an addLibrarySet action in the same batch, or to
       *  the newest existing set for that library subject. */
      studySetId?: string;
      /** Planner-scoped study plan written into the task's plan field. */
      plan?: string;
    }
  | {
      type: "addRoutine";
      title: string;
      days: number[];
      durationMin: number;
      preferredStart?: string;
      courseName?: string;
      active: boolean;
    }
  | {
      type: "addCommitment";
      title: string;
      days: number[];
      start: string;
      end: string;
      kind: Commitment["kind"];
    }
  | {
      type: "addOneOff";
      title: string;
      date: string;
      start: string;
      end: string;
      courseName?: string;
      kind?: Commitment["kind"];
    }
  | {
      type: "addCourse";
      name: string;
      examDate?: string;
      weeklyEffortMin?: number;
    }
  /** Adds a prebuilt subject from lib/study-library.ts as a study set (static
   *  outline — no AI/network content). courseName links it to a class; when
   *  omitted, a course whose name matches the subject is linked if present. */
  | {
      type: "addLibrarySet";
      subjectId: string;
      courseName?: string;
      /** Build one linked Learn -> Practice -> Check task per curriculum unit
       *  and let Rebound place those tasks on the calendar. */
      schedulePlan?: true;
      targetDate?: string;
      pace?: "sprint" | "steady" | "deep";
    }
  | {
      type: "moveBlock";
      blockId: ID;
      date: string;
      start?: string;
      override?: boolean;
    }
  | { type: "unlockBlock"; blockId: ID }
  | {
      type: "rescheduleBlock";
      blockId: ID;
      date?: string;
      when?: RescheduleWindow;
      notBeforeMin?: number;
      /** Locally-built chip actions only (the sanitizer strips it from model
       *  output): marks notBeforeMin as positional — it binds to `date` and
       *  spill days take their earliest slot instead of carrying the floor. */
      floorScope?: "date";
    }
  /** Move EVERY remaining todo block of one task to a new window at once
   *  (e.g. "switch my essay to after 6"). The executor loops the task's blocks
   *  through the rescheduleBlock path with the same when/notBeforeMin floor. */
  | {
      type: "rescheduleTask";
      taskId: ID;
      when?: RescheduleWindow;
      notBeforeMin?: number;
    }
  /** Move every still-flexible task/study block in one bounded source window.
   *  The executor resolves live blocks at apply time, so a schedule rebuild
   *  between the AI read and the action cannot invalidate a list of block ids.
   *  Fixed commitments/one-offs are not blocks; routines, locked work, and
   *  non-todo history are excluded explicitly by the executor. */
  | {
      type: "rescheduleFlexibleBlocks";
      fromDate: string;
      toDate: string;
      fromWhen?: "morning" | "afternoon" | "evening" | "any";
      when?: "morning" | "afternoon" | "evening" | "any";
      notBeforeMin?: number;
      /** Student-named work that must stay put. Matching is normalized and
       *  case-insensitive against block, parent-task, and course titles. */
      excludeTitles?: string[];
    }
  | { type: "completeTask"; taskId: ID }
  | { type: "removeTask"; taskId: ID }
  | {
      type: "updateTask";
      taskId: ID;
      title?: string;
      courseName?: string;
      due?: string;
      estimateMin?: number;
      priority?: TaskPriority;
      deadlineType?: DeadlineType;
      startDate?: string;
      minChunkMin?: number;
      preferredWindow?: TaskPreferredWindow;
      studyStage?: StudyStage;
      plan?: string;
    }
  | {
      type: "updateCourse";
      name: string;
      examDate?: string;
      weeklyEffortMin?: number;
    }
  | { type: "removeCourse"; name: string }
  | {
      type: "updateRoutine";
      routineId: ID;
      title?: string;
      days?: number[];
      durationMin?: number;
      preferredStart?: string;
      active?: boolean;
    }
  | { type: "removeRoutine"; routineId: ID }
  | { type: "removeCommitment"; commitmentId: ID }
  | { type: "removeOneOff"; oneOffId: ID }
  | {
      type: "markBlock";
      blockId: ID;
      /** Partial requires an exact whole-task remainder and cannot be inferred
       * by the generic assistant mark action. */
      status: Exclude<BlockStatus, "partial">;
    }
  | {
      type: "setDayAvailability";
      date: string;
      start?: string;
      end?: string;
      blocked: TimeWindow[];
    }
  | { type: "clearDayAvailability"; date: string }
  | { type: "rememberAboutMe"; text: string }
  | {
      type: "recordLearning";
      text: string;
      notBeforeMin?: number;
      notAfterMin?: number;
    }
  | { type: "updateProfile"; patch: Partial<Profile> }
  | { type: "rebuild" };

export interface InsightsResponse {
  observations: string[];
  suggestion?: { text: string; patch: Partial<Profile> };
}

// ---------- Discussion ----------

export interface Thread {
  id: ID;
  title: string;
  course: string | null;
  display_name: string;
  created_at: string;
  post_count?: number;
}

export interface Post {
  id: ID;
  thread_id: ID;
  display_name: string;
  body: string;
  created_at: string;
}

// ---------- App state ----------

export interface StreakState {
  current: number;
  best: number;
  lastActiveDate?: string;
}
