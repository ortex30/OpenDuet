import type {
  HelpLevel,
  RuleOverrides,
  RuleSource,
  RulesChange,
  RulesView,
  SchoolSnapshot,
} from "@openbot/shared/study";
import type { AuditInitiator } from "../../audit";
import type { CallTool } from "../brief";

/*
 * Academic OS's study features on the server: the seams between the pieces, declared once so each
 * piece can be built and tested on its own.
 *
 *   store.ts       StudyStore, one owner-scoped table (openduet_study_records) for every kind below
 *   school.ts      SchoolService, the student's classes and assignments read from Classroom notices
 *   rules.ts       RulesService and resolveStudyTarget, the teacher's AI-help level for a class
 *   guard.ts       guardTeacherRules, which pauses make_quiz and make_flashcards under "No help"
 *   quiz-tools.ts  make_quiz, make_flashcards, show_progress
 *   plan-tools.ts  propose_study_plan
 *   routes.ts      /api/openduet/study, which mounts quiz-routes, plan-routes and rules-routes
 *
 * Every record belongs to one person (owner_user_id), and every read and write names that person.
 */

/** What a record holds. school and rules are one per person; the rest are many. */
export type StudyKind =
  | "school"
  | "rules"
  | "quiz"
  | "attempt"
  | "deck"
  | "plan";

export type StudyRecord = {
  id: string;
  ownerUserId: string;
  botId: string | null;
  kind: StudyKind;
  classId: string | null;
  /** attempt: the quiz it answers. */
  refId: string | null;
  /** plan: proposed, applied or discarded. */
  status: string | null;
  /** plan: the span of its blocks, so the calendar can ask for a range. */
  startsAt: Date | null;
  endsAt: Date | null;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type StudyRecordInput = {
  id: string;
  kind: StudyKind;
  botId?: string | null;
  classId?: string | null;
  refId?: string | null;
  status?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  data: Record<string, unknown>;
};

export type StudyRecordChange = Partial<Omit<StudyRecordInput, "id" | "kind">>;

export type StudyListFilter = {
  classId?: string;
  refId?: string;
  status?: string;
  /** Only records whose [startsAt, endsAt) overlaps [from, to). */
  overlapping?: { from: Date; to: Date };
  /** Newest first; defaults to 200, at most 500. */
  limit?: number;
};

export type StudyStore = {
  /** The person's record of that kind and id, or null (also for somebody else's id). */
  get(owner: string, kind: StudyKind, id: string): Promise<StudyRecord | null>;
  /**
   * Inserts the record, or replaces the person's own record with the same id. Throws
   * StudyNotFoundError when the id belongs to somebody else.
   */
  put(owner: string, record: StudyRecordInput): Promise<StudyRecord>;
  /**
   * Inserts the record unless one with the same id exists, and returns whichever is stored. How an
   * attempt is made idempotent: its id is derived from its quiz's.
   */
  insertOnce(
    owner: string,
    record: StudyRecordInput,
  ): Promise<{ record: StudyRecord; created: boolean }>;
  /** The person's records of a kind, newest first. */
  list(
    owner: string,
    kind: StudyKind,
    filter?: StudyListFilter,
  ): Promise<StudyRecord[]>;
  /**
   * Read, change and write one record under a row lock, so two tabs cannot both apply a plan.
   * `change` may throw (a StudyConflictError, say) to leave the record as it was. Throws
   * StudyNotFoundError when the person has no such record.
   */
  update(
    owner: string,
    kind: StudyKind,
    id: string,
    change: (
      current: StudyRecord,
    ) => StudyRecordChange | Promise<StudyRecordChange>,
  ): Promise<StudyRecord>;
};

/** 404: no such record for this person. */
export class StudyNotFoundError extends Error {
  override name = "StudyNotFoundError";
  constructor(message = "That isn't here anymore.") {
    super(message);
  }
}

/** 409: the request is fine but the state moved, such as a plan that went stale. */
export class StudyConflictError extends Error {
  override name = "StudyConflictError";
}

/** 403: a student loosening a teacher's rule. */
export class StudyForbiddenError extends Error {
  override name = "StudyForbiddenError";
}

/** 400: the request itself is wrong, in a sentence the person can act on. */
export class StudyInputError extends Error {
  override name = "StudyInputError";
}

/** Who a tool call or a route works for, and through which Bot it reads Gmail and Calendar. */
export type StudyContext = {
  actorId: string;
  botId: string;
  initiator: AuditInitiator;
};

export type SchoolRead = {
  /** Null when the notices could not be read at all; `why` says why. */
  snapshot: SchoolSnapshot | null;
  why: string | null;
};

export type SchoolService = {
  /**
   * The person's classes and assignments. Re-read from Gmail when the stored copy is older than
   * `maxAgeMs` (default ten minutes) or when `force` is set; otherwise the stored copy. A failed
   * re-read falls back to the stored copy and says why.
   */
  current(
    context: StudyContext,
    options?: { maxAgeMs?: number; force?: boolean },
  ): Promise<SchoolRead>;
  /** The stored copy only, with no Gmail read. */
  stored(owner: string): Promise<SchoolSnapshot | null>;
};

/** A class (and maybe an assignment) a study tool named, matched against the person's classes. */
export type StudyTarget =
  | {
      ok: true;
      classId: string;
      className: string;
      teacher: string | null;
      assignmentId: string | null;
      assignmentTitle: string | null;
      /** The level the study tools obey here. */
      level: HelpLevel;
      source: RuleSource;
      /** The assignment whose rule decided the level, when one did. */
      decidedBy: string | null;
    }
  | {
      ok: false;
      /** A sentence for the model: what did not match, and the class names it can use. */
      reason: string;
    };

export type RulesService = {
  overrides(owner: string): Promise<RuleOverrides>;
  /** Sets or clears overrides. Throws StudyForbiddenError when loosening without `canLoosen`. */
  change(
    owner: string,
    change: RulesChange,
    options: {
      canLoosen: boolean;
      snapshot: SchoolSnapshot | null;
      now?: Date;
    },
  ): Promise<RuleOverrides>;
  view(
    owner: string,
    snapshot: SchoolSnapshot | null,
    options: { canLoosen: boolean; now?: Date; couldNotRead?: string[] },
  ): Promise<RulesView>;
  /** The level for the class and assignment a tool named. */
  target(
    owner: string,
    snapshot: SchoolSnapshot | null,
    named: { className: string; assignment?: string | null },
    now?: Date,
  ): Promise<StudyTarget>;
};

/** Puts cards on Tasks' Up next (wiring.ts createUpNext). Review tasks from quizzes use it. */
export type UpNextSink = (input: {
  ownerUserId: string;
  agentId: string;
  cards: {
    title: string;
    detail: string;
    sourceApp: string | null;
    sourceLink: string | null;
  }[];
}) => Promise<{ id: string; title: string }[]>;

/** What every study tool factory is given, per run. */
export type StudyToolDeps = StudyContext & {
  store: StudyStore;
  school: SchoolService;
  rules: RulesService;
  callTool: CallTool;
  now?: () => Date;
};

/** What every /api/openduet/study sub-router is given. */
export type StudyRouteDeps = {
  store: StudyStore;
  school: SchoolService;
  rules: RulesService;
  callTool: CallTool;
  upNext: UpNextSink;
  /** The Bot routes read Gmail and Calendar through: the tenant's primary Bot (setup.ts primaryBotIdOf). */
  primaryBot: string;
  now?: () => Date;
};
