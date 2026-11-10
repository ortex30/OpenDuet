import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CalendarDeadline,
  type CalendarEvent,
  CLASS_COLORS,
  type ClassColor,
  type HelpLevel,
  type SchoolClass,
} from "@openbot/shared/study";
import { addDays, zonedInstant, zonedParts } from "./study/time";

/**
 * A local school pack dropped in by hand (see data/private/README.md).
 *
 * It is never committed. Academic OS reads it only when ACADEMIC_OS_PRIVATE_DEMO
 * is on, so a checkout that happens to contain the files does not change tests
 * or a deployment that did not ask for them.
 *
 * Current-term rows are the live deadlines. `historical_unconfirmed_spring_2026`
 * is context from an earlier term and is counted, then left out.
 */

export type PrivateHelp = HelpLevel;

export type PrivateClass = {
  id: string;
  name: string;
  teacher: string | null;
  /** Block number from the pack, when one was recorded. */
  block: string | null;
  /** The short name a student actually says, such as "Calc BC". */
  shortName: string | null;
  help: PrivateHelp;
  /** Paths relative to the pack directory. */
  materials: string[];
};

export type PrivateAssignment = {
  id: string;
  classId: string;
  title: string;
  due: string;
  /** "HH:mm" in the pack's time zone. Tests and quizzes sit in the morning. */
  dueTime: string;
  kind: "assignment" | "quiz" | "test";
  help: PrivateHelp;
  /** Null when the pack did not record a point value. Never invented. */
  points: number | null;
  /** True when the pack says the work is already finished. */
  completed: boolean;
  estimateMin: number;
  source: string | null;
};

export type PrivatePack = {
  dir: string;
  school: string;
  timeZone: string;
  classes: PrivateClass[];
  assignments: PrivateAssignment[];
  /** Spring 2026 rows that were present and not loaded as deadlines. */
  historicalExcluded: number;
};

export type PrivateDemoSummary = {
  available: true;
  school: string;
  timeZone: string;
  historicalExcluded: number;
  classes: {
    id: string;
    name: string;
    teacher: string;
    help: PrivateHelp;
  }[];
  assignments: {
    id: string;
    classId: string;
    title: string;
    dueAt: string;
    points: number | null;
    estimateMin: number;
    helpLevel: PrivateHelp;
    source: string | null;
  }[];
};

const DEMO_FLAG = "ACADEMIC_OS_PRIVATE_DEMO";

/**
 * The pack records a block number, not bell times. Those hours are not invented
 * onto the calendar. A quest or exam is the due morning at 9:00, one day only.
 */
const ASSESSMENT_START = "09:00";
const ASSESSMENT_END = "10:00";

export function repoRoot(): string {
  return fileURLToPath(new URL("../../../../", import.meta.url));
}

export function privateDemoRequested(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env[DEMO_FLAG]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** The pack directory, or null when none of the usual places holds classes.json. */
export function privatePackDir(
  env: Record<string, string | undefined> = process.env,
  root = repoRoot(),
): string | null {
  const named = env.ACADEMIC_OS_DATA_DIR?.trim();
  const candidates = [
    named,
    join(root, "data/private"),
    join(root, "data/private/academic-os-data"),
    join(root, "data/private/school-pack"),
  ].filter((dir): dir is string => Boolean(dir));
  for (const dir of candidates) {
    if (existsSync(join(dir, "classes.json"))) return dir;
  }
  return null;
}

/** The pack when the demo flag is on and a directory was found. Otherwise null. */
export function loadEnabledPack(
  env: Record<string, string | undefined> = process.env,
): PrivatePack | null {
  if (!privateDemoRequested(env)) return null;
  const dir = privatePackDir(env);
  return dir ? loadPrivatePack(dir) : null;
}

export function loadPrivatePack(dir: string): PrivatePack {
  const classesFile = readJson(join(dir, "classes.json"), "classes.json");
  const workFile = readJson(
    join(dir, "assignments_and_tests.json"),
    "assignments_and_tests.json",
  );
  const timeZone =
    text(classesFile.timezone) ?? text(workFile.timezone) ?? "America/Chicago";
  const school = text(classesFile.school) ?? "School";
  const rawClasses = asArray(classesFile.classes, "classes");
  const classes = rawClasses
    .map((row) => parseClass(asRecord(row, "class")))
    .filter((row) => row !== null)
    .sort((a, b) => {
      const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return byName || a.id.localeCompare(b.id);
    });
  const byId = new Map(classes.map((row) => [row.id, row]));
  const current = asArray(
    workFile.current_term_2026_2027,
    "current_term_2026_2027",
  );
  const historical = historicalCount(
    workFile.historical_unconfirmed_spring_2026,
  );
  const assignments = current
    .map((row) => parseAssignment(asRecord(row, "assignment"), byId))
    .filter((row): row is PrivateAssignment => row !== null)
    .sort(
      (a, b) =>
        a.due.localeCompare(b.due) ||
        a.classId.localeCompare(b.classId) ||
        a.title.localeCompare(b.title, "en"),
    );
  return {
    dir,
    school,
    timeZone,
    classes,
    assignments,
    historicalExcluded: historical,
  };
}

export function privateDemoSummary(pack: PrivatePack): PrivateDemoSummary {
  return {
    available: true,
    school: pack.school,
    timeZone: pack.timeZone,
    historicalExcluded: pack.historicalExcluded,
    classes: pack.classes.map((row) => ({
      id: row.id,
      name: row.name,
      teacher: row.teacher ?? "",
      help: row.help,
    })),
    assignments: pack.assignments.map((row) => ({
      id: row.id,
      classId: row.classId,
      title: row.title,
      dueAt: zonedInstant(row.due, row.dueTime, pack.timeZone).toISOString(),
      points: row.points,
      estimateMin: row.estimateMin,
      helpLevel: row.help,
      source: row.source,
    })),
  };
}

/** A fast hello: the student's name and what is due tomorrow morning. */
export function schoolGreeting(
  pack: PrivatePack,
  now: Date,
  name: string | null,
): string {
  const parts = zonedParts(now, pack.timeZone);
  const tomorrow = addDays(parts.date, 1);
  const morning = pack.assignments.filter(
    (row) =>
      row.due === tomorrow && row.kind !== "assignment" && !row.completed,
  );
  const who = name?.trim().split(/\s+/)[0] ?? "";
  const hello = who && !who.includes("@") ? `Hey ${who}.` : "Hey.";
  if (morning.length === 0)
    return `${hello} Nothing is due first thing tomorrow.`;
  const list = morning
    .map((row) => {
      const short = row.title.split(" - ").at(-1)?.trim() || row.title;
      return `${short} at 9:00 AM`;
    })
    .join(", ");
  return `${hello} Tomorrow morning: ${list}.`;
}

/** Calendar rows for one inclusive range, in the pack's time zone. */
export function packCalendarSlice(
  pack: PrivatePack,
  from: string,
  to: string,
  now: Date,
) {
  const parts = zonedParts(now, pack.timeZone);
  const classes: SchoolClass[] = pack.classes.map((row, index) => ({
    id: row.id,
    name: row.name,
    teacher: row.teacher,
    period: row.block,
    color: CLASS_COLORS[index % CLASS_COLORS.length] as ClassColor,
  }));
  const events: CalendarEvent[] = [];
  for (const row of pack.assignments) {
    if (row.due < from || row.due > to || row.kind === "assignment") continue;
    const schoolClass = pack.classes.find((item) => item.id === row.classId);
    const short = row.title.split(" - ").at(-1)?.trim() || row.title;
    events.push({
      id: `pack-due-${row.id}`,
      title: schoolClass?.shortName
        ? `${schoolClass.shortName}: ${short}`
        : short,
      date: row.due,
      start: ASSESSMENT_START,
      end: ASSESSMENT_END,
      classId: row.classId,
    });
  }
  const deadlines: CalendarDeadline[] = pack.assignments
    .filter(
      (row) => from <= row.due && row.due <= to && row.kind === "assignment",
    )
    .map((row) => ({
      assignmentId: row.id,
      classId: row.classId,
      title: row.title,
      date: row.due,
      time: row.dueTime,
      kind: row.kind,
      help: row.help,
    }));
  return {
    timeZone: pack.timeZone,
    today: parts.date,
    nowMinute: parts.minute,
    classes,
    events,
    allDay: [] as { id: string; title: string; date: string }[],
    deadlines,
  };
}

/** Markdown headings, short enough to be a study topic. */
export function materialHeadings(markdown: string, limit = 8): string[] {
  const found: string[] = [];
  for (const match of markdown.matchAll(/^#{1,3}[ \t]+(.+)$/gm)) {
    const text = match[1]?.replace(/\s+/g, " ").trim() ?? "";
    if (!text || text.length > 80) continue;
    if (found.includes(text)) continue;
    found.push(text);
    if (found.length >= limit) break;
  }
  return found;
}

const RESULTS = ["missed", "partly", "correct"] as const;

/** A few topics per class so Learn has something to show. Headings only, not the notes. */
export function studyTopicsFromPack(
  pack: PrivatePack,
  read: (relativePath: string) => string,
) {
  const topics: {
    subject: string;
    topic: string;
    result: (typeof RESULTS)[number];
  }[] = [];
  for (const row of pack.classes) {
    const headings = row.materials.flatMap((file) => {
      try {
        return materialHeadings(read(file), 3);
      } catch {
        return [];
      }
    });
    const picked = headings
      .filter((heading) => !templateHeading(heading))
      .slice(0, 3);
    const names =
      picked.length > 0 ? picked : [`${row.shortName ?? row.name} review`];
    names.forEach((topic, index) => {
      topics.push({
        subject: row.name,
        topic,
        result: RESULTS[index % RESULTS.length] ?? "partly",
      });
    });
  }
  return topics;
}

export type StudyGuideDraft = {
  title: string;
  summary: string;
  classId: string;
  assignmentId: string;
  blocks: (
    | { type: "text"; text: string }
    | { type: "heading"; text: string }
    | { type: "bullets"; items: string[] }
  )[];
};

/**
 * A short study guide for the next quiz or test that is not set to No help.
 * Built from headings in the student's own notes. Chemistry's red-light rule
 * is skipped here.
 */
export function studyGuideFromPack(
  pack: PrivatePack,
  read: (relativePath: string) => string,
  today: string,
): StudyGuideDraft | null {
  const eligible = pack.assignments.filter((row) => row.help !== "none");
  const assessed = eligible.filter(
    (row) => row.kind === "quiz" || row.kind === "test",
  );
  const pool = (assessed.length > 0 ? assessed : eligible)
    .slice()
    .sort(
      (a, b) =>
        a.due.localeCompare(b.due) || a.classId.localeCompare(b.classId),
    );
  const upcoming = pool.filter((row) => row.due >= today);
  const chosen = upcoming[0] ?? pool[pool.length - 1];
  if (!chosen) return null;
  const schoolClass = pack.classes.find((row) => row.id === chosen.classId);
  if (!schoolClass) return null;
  const file = pickMaterial(schoolClass.materials, chosen.title);
  if (!file) return null;
  let markdown = "";
  try {
    markdown = read(file);
  } catch {
    return null;
  }
  const headings = materialHeadings(markdown, 8);
  const items =
    headings.length > 0 ? headings : ["Read your notes for this class."];
  const title = `${schoolClass.name} study guide`.slice(0, 80);
  const summary = `${chosen.title} · due ${chosen.due}`.slice(0, 140);
  return {
    title,
    summary,
    classId: schoolClass.id,
    assignmentId: chosen.id,
    blocks: [
      {
        type: "text",
        text: `${chosen.title} is due ${chosen.due}. This list is from your notes. It is not the test and not an essay.`,
      },
      { type: "heading", text: "What to review" },
      { type: "bullets", items },
    ],
  };
}

function templateHeading(heading: string): boolean {
  return /^(gaps?|contents|sources?|citations?|how to use|notes|review guide)$/i.test(
    heading.trim(),
  );
}

function pickMaterial(files: readonly string[], title: string): string | null {
  if (files.length === 0) return null;
  const words = title.toLowerCase();
  const scored = files.map((file) => {
    const name = file.toLowerCase();
    let score = 0;
    if (words.includes("leq") && name.includes("leq")) score += 5;
    if (/unit\s*5/.test(words) && name.includes("unit5")) score += 5;
    if (name.includes("review") || name.includes("focus")) score += 1;
    return { file, score };
  });
  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return scored[0]?.file ?? null;
}

function parseClass(row: Record<string, unknown>): PrivateClass | null {
  const status = (text(row.status) ?? "current").toLowerCase();
  if (status !== "current") return null;
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  const teachers = asArray(row.teachers ?? [], "teachers").map((entry) =>
    asRecord(entry, "teacher"),
  );
  return {
    id,
    name,
    teacher: teacherLabel(teachers),
    block: text(row.block),
    shortName: text(row.short_name),
    help: helpForClass(id, name),
    materials: asArray(row.materials ?? [], "materials")
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0),
  };
}

function teacherLabel(teachers: Record<string, unknown>[]): string | null {
  const names = teachers
    .map((row) => text(row.name))
    .filter((name): name is string => Boolean(name));
  const confirmed = teachers
    .filter((row) => /confirmed/i.test(text(row.confidence) ?? ""))
    .map((row) => text(row.name))
    .filter((name): name is string => Boolean(name));
  if (confirmed.length > 0) return confirmed.join(", ");
  if (names.length === 1) return names[0] ?? null;
  if (names.length > 1) return names.slice(0, 2).join(" & ");
  return null;
}

/** Chemistry's syllabus is on file. Other classes have no teacher AI rule. */
export function teacherRuleOnFile(id: string, name: string): boolean {
  return id === "chem" || /chemistry/i.test(name);
}

/** Chemistry's recorded rule is red. Anything unrecorded stays at hints, never full help. */
export function helpForClass(id: string, name: string): PrivateHelp {
  if (teacherRuleOnFile(id, name)) return "none";
  return "hints";
}

function parseAssignment(
  row: Record<string, unknown>,
  classes: Map<string, PrivateClass>,
): PrivateAssignment | null {
  const classId = text(row.class_id);
  const title = text(row.name);
  const due = text(row.due);
  if (!classId || !title || !due || !/^\d{4}-\d{2}-\d{2}$/.test(due))
    return null;
  const schoolClass = classes.get(classId);
  if (!schoolClass) return null;
  const kind = assignmentKind(text(row.type) ?? "");
  const help = schoolClass.help;
  return {
    id: slug(`${classId}-${due}-${title}`),
    classId,
    title,
    due,
    dueTime: kind === "assignment" ? "23:59" : "09:00",
    kind,
    help,
    points: recordedPoints(row.points),
    completed: row.completion_confirmed === true,
    estimateMin: kind === "test" ? 90 : kind === "quiz" ? 40 : 45,
    source: text(row.notion_url),
  };
}

function recordedPoints(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function assignmentKind(type: string): PrivateAssignment["kind"] {
  const value = type.toLowerCase();
  if (value.includes("quiz")) return "quiz";
  if (
    value.includes("exam") ||
    value.includes("test") ||
    value.includes("quest")
  )
    return "test";
  return "assignment";
}

function historicalCount(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items.length : 0;
}

function readJson(path: string, label: string): Record<string, unknown> {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`The school pack is missing ${label}.`);
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return asRecord(parsed, label);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The school pack's ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`The school pack's ${label} must be a list.`);
  }
  return value;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(0, 96) || "item";
}
