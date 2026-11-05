// Deterministic display models for the Week view's context rail and semantic
// event states. Pure and store-free: every fact here is derived from existing
// sources (task-plan insights, feasibility verdicts, task fields, block flags,
// upcoming blocks) — nothing is invented, and a section with no grounded fact
// is omitted rather than filled.

import {
  formatDate,
  formatMinutes,
  formatTime,
  parseDateStr,
  timeToMin,
} from "./helpers";
export type FeasibilityStatus = "ahead" | "onTrack" | "tight" | "behind";
export interface DeadlineVerdict {
  kind: "task" | "exam";
  id: string;
  title: string;
  courseId?: string;
  due: string;
  targetFinish: string;
  requiredMin: number;
  scheduledMin: number;
  availableMin: number;
  status: FeasibilityStatus;
  shortfallMin?: number;
  startBy?: string;
}
import { humanizeTaskPlanReason, type TaskPlanInsight } from "./task-plan";
import type { AgendaItem, Block, StudyStage, Task } from "./types";

// ---------- Semantic event states ----------

export type BlockStateWord =
  | "done"
  | "partial"
  | "missed"
  | "at-risk"
  | "locked"
  | "rebounded"
  | "fixed"
  | "flexible";

export interface BlockStateSemantics {
  /** Every applicable state word, in canonical order. */
  states: BlockStateWord[];
  /** The one state a dense chip may show a glyph for:
   *  done/missed, then at-risk, then locked, then rebounded. */
  glyph: BlockStateWord | null;
  /** Ready-to-append aria-label suffix, e.g. ", done, rebounded". */
  ariaStates: string;
}

/** Visible display words for all seven states — the non-color channel. */
export const BLOCK_STATE_LABELS: Record<BlockStateWord, string> = {
  done: "Done",
  // "Partly done", not "In progress": a partial check-in is a completed
  // moment, and days later "in progress" reads as a stuck timer.
  partial: "Partly done",
  missed: "Missed",
  "at-risk": "At risk",
  locked: "Locked",
  rebounded: "Rebounded",
  fixed: "Fixed",
  flexible: "Flexible",
};

const ARIA_WORDS: Record<BlockStateWord, string> = {
  done: "done",
  partial: "partly done",
  missed: "missed",
  "at-risk": "at risk",
  locked: "locked",
  rebounded: "rebounded",
  fixed: "fixed",
  flexible: "flexible",
};

const GLYPH_PRIORITY: BlockStateWord[] = [
  "done",
  "partial",
  "missed",
  "at-risk",
  "locked",
  "rebounded",
  "fixed",
];

function toSemantics(states: BlockStateWord[]): BlockStateSemantics {
  const glyph = GLYPH_PRIORITY.find((word) => states.includes(word)) ?? null;
  return {
    states,
    glyph,
    ariaStates: states.map((word) => `, ${ARIA_WORDS[word]}`).join(""),
  };
}

/** Semantic states for an engine-managed block. `atRisk` comes from the
 *  caller's task-plan insight; it never applies to finished blocks. */
export function blockStateSemantics(
  block: Block,
  opts: { atRisk?: boolean } = {},
): BlockStateSemantics {
  const states: BlockStateWord[] = [];
  if (block.status === "done") states.push("done");
  if (block.status === "partial") states.push("partial");
  if (block.status === "missed") states.push("missed");
  if (block.status === "todo" && opts.atRisk) states.push("at-risk");
  if (block.locked) states.push("locked");
  if ((block.rebounds ?? 0) >= 1) states.push("rebounded");
  if (block.status === "todo" && !block.locked) states.push("flexible");
  // A done block is history, not movable work — locked/rebounded stay as facts
  // but the done/missed word leads and flexible never applies.
  if (block.status !== "todo") {
    return toSemantics(states.filter((word) => word !== "flexible"));
  }
  return toSemantics(states);
}

/** Semantic state for a commitment/one-off: always simply fixed. */
export function fixedItemSemantics(): BlockStateSemantics {
  return toSemantics(["fixed"]);
}

// ---------- Primary rail state (truthful precedence) ----------

export type RailTone =
  | "complete"
  | "blocked"
  | "needs-plan"
  | "at-risk"
  | "waiting"
  | "attention"
  | "thin"
  | "on-track";

export interface RailPrimaryState {
  tone: RailTone;
  label: string;
  detail?: string;
}

/**
 * One primary state per task, in strict precedence: complete, blocked,
 * unscheduled ("Needs a plan"), at-risk, waiting. Only an otherwise on-track
 * task lets the deadline cushion escalate it — behind reads "Needs attention",
 * tight reads "Planned but cushion is thin". Deadline facts support the state
 * but never contradict it.
 */
export function railPrimaryState(
  insight: TaskPlanInsight,
  verdict?: DeadlineVerdict,
): RailPrimaryState {
  const detail =
    insight.reason &&
    !/^Planned to finish \d{4}-\d{2}-\d{2}$/i.test(insight.reason.trim()) &&
    insight.reason.trim().toLowerCase() !== "scheduled"
      ? humanizeTaskPlanReason(insight.reason)
      : undefined;
  switch (insight.state) {
    case "complete":
      return { tone: "complete", label: "Complete" };
    case "blocked":
      return {
        tone: "blocked",
        label: "Blocked",
        ...(detail ? { detail } : {}),
      };
    case "unscheduled":
      return {
        tone: "needs-plan",
        label: "Needs a plan",
        ...(detail ? { detail } : {}),
      };
    case "at-risk":
      return {
        tone: "at-risk",
        label: "At risk",
        ...(detail ? { detail } : {}),
      };
    case "waiting":
      return {
        tone: "waiting",
        label: "Waiting",
        ...(detail ? { detail } : {}),
      };
  }
  if (verdict?.status === "behind") {
    const fact =
      verdict.shortfallMin !== undefined
        ? `${formatMinutes(verdict.shortfallMin)} more than fits before ${formatDate(verdict.due)}`
        : detail;
    return {
      tone: "attention",
      label: "Needs attention",
      ...(fact ? { detail: fact } : {}),
    };
  }
  if (verdict?.status === "tight") {
    return {
      tone: "thin",
      label: "Planned but cushion is thin",
      ...(detail ? { detail } : {}),
    };
  }
  return { tone: "on-track", label: "On track", ...(detail ? { detail } : {}) };
}

// ---------- Selection context ----------

export interface CalendarSelectionContext {
  kind: "block" | "fixed";
  title: string;
  /** "Monday, June 3, 10 – 11am, 1 hr" */
  timeLine: string;
  typeLabel: string;
  courseName?: string;
  statusLabel?: string;
  /** Exact planner minutes; omitted when this block has no task-plan insight. */
  progressLine?: string;
  /** Next related task/study session, derived from actual calendar blocks. */
  nextSessionLine?: string;
  /** Capacity fact from the deterministic feasibility report. */
  cushionLine?: string;
  semantics: BlockStateSemantics;
  primary?: RailPrimaryState;
  /** Grounded facts only; render no explanation section when empty. */
  explanation: string[];
  description?: string;
  plan?: string;
  stageLabel?: string;
  /** One short polite live-region line for this selection. */
  announcement: string;
}

const STAGE_LABELS: Record<StudyStage, string> = {
  understand: "Understand",
  practice: "Practice",
  review: "Review",
  "exam-ready": "Exam ready",
};

/** "2030-06-03" -> "Monday, June 3" */
function longDate(dateStr: string): string {
  return parseDateStr(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function humanClock(t: string): { text: string; suffix: string } {
  const [h, m] = t.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return {
    text: m === 0 ? `${hour}` : `${hour}:${String(m).padStart(2, "0")}`,
    suffix: h >= 12 ? "pm" : "am",
  };
}

/** "10:00"–"11:00" -> "10 – 11am"; "11:00"–"12:30" -> "11am – 12:30pm" */
function humanTimeRange(start: string, end: string): string {
  const s = humanClock(start);
  const e = humanClock(end);
  return s.suffix === e.suffix
    ? `${s.text} – ${e.text}${e.suffix}`
    : `${s.text}${s.suffix} – ${e.text}${e.suffix}`;
}

/** 90 -> "1 hr 30 mins"; 60 -> "1 hr"; 45 -> "45 mins" */
function humanDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(h === 1 ? "1 hr" : `${h} hrs`);
  if (m > 0 || h === 0) parts.push(m === 1 ? "1 min" : `${m} mins`);
  return parts.join(" ");
}

function timeLineFor(item: {
  date: string;
  start: string;
  end: string;
}): string {
  const duration = Math.max(0, timeToMin(item.end) - timeToMin(item.start));
  return `${longDate(item.date)}, ${humanTimeRange(item.start, item.end)}, ${humanDuration(duration)}`;
}

function deadlineCushionLine(verdict: DeadlineVerdict): string {
  const due = formatDate(verdict.due);
  if (verdict.status === "behind") {
    const shortfall =
      verdict.shortfallMin ??
      Math.max(0, verdict.requiredMin - verdict.availableMin);
    return shortfall > 0
      ? `${formatMinutes(shortfall)} more needed before ${due}`
      : `The current plan does not fit before ${due}`;
  }
  if (verdict.status === "tight") {
    return `Thin cushion before ${due}${verdict.startBy ? ` · start by ${formatDate(verdict.startBy)}` : ""}`;
  }
  if (verdict.status === "ahead") return `Enough room before ${due}`;
  return `${formatMinutes(verdict.scheduledMin)} of ${formatMinutes(verdict.requiredMin)} scheduled before ${due}`;
}

const BLOCK_TYPE_LABELS: Record<Block["kind"], string> = {
  study: "Study",
  routine: "Routine",
  task: "Task",
};

export function findNextRelatedBlock(
  selected: Block,
  candidates: Block[],
): Block | undefined {
  if (!selected.refId) return undefined;
  const selectedStart = `${selected.date}T${selected.start}`;
  return candidates
    .filter(
      (candidate) =>
        candidate.id !== selected.id &&
        candidate.kind === selected.kind &&
        candidate.refId === selected.refId &&
        candidate.status === "todo" &&
        `${candidate.date}T${candidate.start}` > selectedStart,
    )
    .sort((a, b) => {
      const byStart = `${a.date}T${a.start}`.localeCompare(
        `${b.date}T${b.start}`,
      );
      return byStart || a.id.localeCompare(b.id);
    })[0];
}

export function buildBlockSelectionContext(input: {
  block: Block;
  task?: Task;
  insight?: TaskPlanInsight;
  verdict?: DeadlineVerdict;
  courseName?: string;
  nextBlock?: Block;
}): CalendarSelectionContext {
  const { block, task, insight, verdict, courseName, nextBlock } = input;
  const semantics = blockStateSemantics(block, {
    atRisk: insight?.state === "at-risk",
  });
  const primary = insight ? railPrimaryState(insight, verdict) : undefined;
  const statusLabel =
    block.status === "done"
      ? "Done"
      : block.status === "partial"
        ? "Partly done"
        : block.status === "missed"
          ? "Missed"
          : "To do";

  const explanation: string[] = [];
  if (
    task?.reason &&
    !/^Planned to finish \d{4}-\d{2}-\d{2}$/i.test(task.reason.trim()) &&
    task.reason.trim().toLowerCase() !== "scheduled"
  ) {
    explanation.push(task.reason);
  }
  if (block.movedFrom)
    explanation.push(`Moved from ${formatDate(block.movedFrom)}.`);
  const rebounds = block.rebounds ?? 0;
  if (rebounds >= 1) {
    explanation.push(`Rebounded ${rebounds} time${rebounds === 1 ? "" : "s"}.`);
  }
  if (block.locked) {
    explanation.push("Locked in place, so Rebound will not move it.");
  }

  return {
    kind: "block",
    title: block.title,
    timeLine: timeLineFor(block),
    typeLabel: BLOCK_TYPE_LABELS[block.kind],
    ...(courseName ? { courseName } : {}),
    statusLabel,
    ...(insight
      ? {
          progressLine: `${formatMinutes(insight.completedMin)} complete · ${formatMinutes(insight.remainingMin)} remaining · ${formatMinutes(insight.scheduledMin)} scheduled`,
        }
      : {}),
    ...(nextBlock
      ? {
          nextSessionLine: `${formatDate(nextBlock.date)} · ${formatTime(nextBlock.start)} – ${formatTime(nextBlock.end)}`,
        }
      : {}),
    ...(verdict ? { cushionLine: deadlineCushionLine(verdict) } : {}),
    semantics,
    ...(primary ? { primary } : {}),
    explanation,
    ...(task?.description ? { description: task.description } : {}),
    ...(task?.plan ? { plan: task.plan } : {}),
    ...(task?.studyStage ? { stageLabel: STAGE_LABELS[task.studyStage] } : {}),
    announcement: `${block.title}. ${primary ? primary.label : statusLabel}.`,
  };
}

export function buildFixedSelectionContext(input: {
  item: AgendaItem;
  courseName?: string;
}): CalendarSelectionContext {
  const { item, courseName } = input;
  return {
    kind: "fixed",
    title: item.title,
    timeLine: timeLineFor(item),
    typeLabel: item.kind === "commitment" ? "Commitment" : "Event",
    ...(courseName ? { courseName } : {}),
    semantics: fixedItemSemantics(),
    explanation: [],
    announcement: `${item.title}. Fixed time.`,
  };
}

// ---------- Idle context ----------

export interface IdleUpcomingEntry {
  blockId: string;
  title: string;
  timeLine: string;
}

export interface IdleTaskEntry {
  taskId: string;
  title: string;
  detail?: string;
}

export interface CalendarIdleContext {
  upcoming: IdleUpcomingEntry[];
  needsPlan: IdleTaskEntry[];
  atRisk: IdleTaskEntry[];
}

function idleTaskEntries(
  tasks: Task[],
  insights: Map<string, TaskPlanInsight>,
  state: TaskPlanInsight["state"],
): IdleTaskEntry[] {
  return tasks
    .filter((task) => !task.done && insights.get(task.id)?.state === state)
    .sort(
      (a, b) =>
        (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99") ||
        a.title.localeCompare(b.title),
    )
    .map((task) => {
      const reason = insights.get(task.id)?.reason;
      return {
        taskId: task.id,
        title: task.title,
        ...(reason ? { detail: humanizeTaskPlanReason(reason) } : {}),
      };
    });
}

/** What the rail shows with nothing selected: today's unfinished blocks plus
 *  the Needs a plan / At risk task groups the insights already report. */
export function buildIdleContext(input: {
  blocks: Block[];
  tasks: Task[];
  insights: Map<string, TaskPlanInsight>;
  today: string;
  now: string; // "HH:mm"
}): CalendarIdleContext {
  const { blocks, tasks, insights, today, now } = input;
  const upcoming = blocks
    .filter(
      (block) =>
        block.date === today && block.status === "todo" && block.end >= now,
    )
    .sort((a, b) => timeToMin(a.start) - timeToMin(b.start))
    .map((block) => ({
      blockId: block.id,
      title: block.title,
      timeLine: humanTimeRange(block.start, block.end),
    }));
  return {
    upcoming,
    needsPlan: idleTaskEntries(tasks, insights, "unscheduled"),
    atRisk: idleTaskEntries(tasks, insights, "at-risk"),
  };
}
