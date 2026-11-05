import {
  type AssignmentKind,
  type AssignmentStatus,
  CLASS_COLORS,
  type HelpLevel,
  parseHelpLevel,
  type SchoolAssignment,
  type SchoolClass,
  type SchoolSnapshot,
} from "@openbot/shared/study";
import { isDate, zonedInstant } from "./time";

/*
 * The student's classes and assignments, read from the Google Classroom notification emails in
 * their Gmail. Pure: a message in, a notice out, and the notices folded into one snapshot.
 *
 * Deterministic on purpose, and never a model's reading. A teacher's "AI help: No help" pauses the
 * quiz and flashcard tools for that class, so the level must be the teacher's words as written, and
 * the same mail must always give the same classes, ids and levels.
 *
 * Every notice is in one format, made to look like Classroom's own mail:
 *
 *   From: "Dr. Okoro (Google Classroom)" <no-reply@classroom.google.com>
 *   Subject: New assignment: "Lab 6 report: Reaction Rates"
 *
 *   Chemistry · Period 2 · Dr. Okoro          the class line; period and teacher may be missing
 *   New assignment                            the notice type
 *   Lab 6 report: Reaction Rates              the item; absent for some announcements
 *   Due: Fri, Nov 6, 2026, 11:59 PM           each field line optional
 *   Points: 40
 *   Grade: 34/40
 *   Estimated time: 90 min
 *   AI help: Hints only
 *
 *   The teacher's own words.
 *
 *   Open: https://classroom.google.com/c/chem2/a/lab6
 */

/** The notice types the second line of a notice names. */
export const NOTICE_TYPES = [
  "New assignment",
  "New quiz",
  "New test",
  "Due soon",
  "Missing",
  "Returned",
  "Announcement",
  "Material",
] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];

/** The parts of a Gmail message a notice is read from, as gmail_read_message returns them. */
export type ClassroomMessage = {
  id: string;
  from: string;
  subject: string;
  /** ISO 8601, when Gmail says it arrived. */
  date: string;
  body: string;
};

/** One Classroom email, read. */
export type ParsedNotice = {
  /** The Gmail message it was read from. */
  noticeId: string;
  /** When it arrived, ISO 8601, or "" when the message did not say. */
  receivedAt: string;
  type: NoticeType;
  className: string;
  teacher: string | null;
  period: string | null;
  /** The Classroom course id from the Open link, or null when the notice had none. */
  courseId: string | null;
  /** The course id, or a slug of the class name. */
  classId: string;
  /** The course work, announcement or material id from the Open link, or null. */
  itemId: string | null;
  /** Null for a notice that names no item, such as most announcements. */
  title: string | null;
  /** "<courseId>-<itemId>", or a slug of class and title, or null with no title. */
  assignmentId: string | null;
  kind: AssignmentKind;
  /** What this notice says; buildSnapshot decides what the assignment's status is. */
  status: AssignmentStatus;
  due: string | null;
  dueDate: string | null;
  dueTime: string | null;
  points: number | null;
  grade: string | null;
  help: HelpLevel | null;
  /** Minutes the notice gave as its estimate, or null. */
  statedMinutes: number | null;
  /** The estimate, or the default for the kind when the notice gave none. */
  minutes: number;
  link: string | null;
  /** The teacher's free text: instructions, a comment. */
  text: string;
};

/** Longest each part is kept, so an odd email cannot fill a stored snapshot or a model's context. */
const MAX = {
  className: 100,
  teacher: 80,
  period: 40,
  title: 200,
  grade: 40,
  link: 500,
  text: 1_000,
} as const;

const DAY_MS = 86_400_000;

const cut = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * The Gmail adapter cuts a header at 1,000 UTF-16 code units, or one fewer when the cut would split
 * a character in two. A From this long may have lost its end, and the sender's real address with it.
 */
const FROM_MAY_BE_CUT = 999;

/**
 * Whether a From header is Google Classroom's: the address's own domain, not a lookalike. A From that
 * may have been cut short, or that holds more than one address, is never Classroom's, because the
 * address read from it might not be the one the mail came from.
 */
export function isClassroomSender(from: string): boolean {
  if (from.length >= FROM_MAY_BE_CUT) return false;
  if (
    (from.match(/@/g) ?? []).length > 1 ||
    (from.match(/</g) ?? []).length > 1
  )
    return false;
  const address = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from;
  const domain = address.trim().toLowerCase().split("@").pop() ?? "";
  return (
    address.includes("@") &&
    (domain === "classroom.google.com" ||
      domain.endsWith(".classroom.google.com"))
  );
}

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["middot", "·"],
  ["bull", "•"],
  ["ndash", "–"],
  ["mdash", "—"],
  ["rsquo", "’"],
  ["lsquo", "‘"],
  ["rdquo", "”"],
  ["ldquo", "“"],
  ["hellip", "…"],
]);

/**
 * The body as lines of text. Gmail hands back the plain-text part when there is one, but a notice
 * can still arrive as HTML or with Windows line endings, and both read the same once this is done.
 * A paragraph or a line break in HTML becomes a line; a closed paragraph also leaves a blank line,
 * which is what tells an announcement's first sentence from an item's title.
 */
function linesOf(body: string): string[] {
  let text = body.replace(/\r\n?/g, "\n");
  // Block tags only: a plain-text notice that mentions <b> is still plain text, and its line breaks
  // matter. In HTML they do not, so a title wrapped in the source stays one title.
  if (/<(?:p|div|br|table|tr|td|li|html|body)\b[^>]*>/i.test(text)) {
    text = text
      .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\n/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n\n")
      .replace(/<\/(?:div|li|tr|h[1-6]|table|ul|ol|blockquote)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "");
  }
  return text
    .replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (whole, ref) => {
      const name = String(ref);
      if (!name.startsWith("#"))
        return ENTITIES.get(name.toLowerCase()) ?? whole;
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .split("\n")
    .map((line) => line.replace(/[\s ]+/g, " ").trim());
}

const TYPE_WORDS: ReadonlyMap<string, NoticeType> = new Map([
  ["new assignment", "New assignment"],
  ["new quiz", "New quiz"],
  ["new test", "New test"],
  ["due soon", "Due soon"],
  ["due tomorrow", "Due soon"],
  ["due today", "Due soon"],
  ["reminder", "Due soon"],
  ["missing", "Missing"],
  ["returned", "Returned"],
  ["announcement", "Announcement"],
  ["new announcement", "Announcement"],
  ["material", "Material"],
  ["new material", "Material"],
]);

/** A notice type line ("New assignment", "Due soon."), or null for any other line. */
function typeOf(line: string): NoticeType | null {
  const words = line
    .toLowerCase()
    .replace(/[.:!]+$/, "")
    .trim();
  return TYPE_WORDS.get(words) ?? null;
}

/** The subject's own prefix, such as `Due tomorrow: "…"`, read as a notice type. */
function subjectType(subject: string): NoticeType | null {
  const prefix = /^([^:]+):/.exec(subject.trim())?.[1];
  return prefix ? typeOf(prefix) : null;
}

/** The title a subject quotes: `New quiz: "Unit 4 quiz"` gives "Unit 4 quiz". */
function subjectTitle(subject: string): string | null {
  const quoted = /^[^:]+:\s*["“](.+)["”]\s*$/.exec(subject.trim())?.[1];
  return quoted?.trim() || null;
}

const FIELD = /^(due|points|grade|estimated time|ai help|open)\s*:\s*(.*)$/i;
const OPEN = /^open(?: in classroom)?\s*:\s*(\S+)/i;

type Field = "due" | "points" | "grade" | "estimated time" | "ai help";

function fieldOf(line: string): { name: Field; value: string } | null {
  const match = FIELD.exec(line);
  if (!match || match[1].toLowerCase() === "open") return null;
  return { name: match[1].toLowerCase() as Field, value: match[2].trim() };
}

/** A period-like part of the class line: "Period 2", "Per. 4", "Block C", "3rd period", "P5". */
const PERIOD =
  /^(?:(?:period|per\.?|block|hour|mod)\s*[a-z0-9]{1,3}|(?:\d{1,2}(?:st|nd|rd|th)?|[a-h])\s+(?:period|block|hour)|p\d{1,2})$/i;

/** "Chemistry · Period 2 · Dr. Okoro", or with the period or the teacher left out. */
function classLineOf(
  line: string,
): { name: string; period: string | null; teacher: string | null } | null {
  const [name, ...rest] = line
    .split(/\s*[·•∙‧|]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!name || typeOf(name) || FIELD.test(name) || /^https?:/i.test(name))
    return null;
  let period: string | null = null;
  let teacher: string | null = null;
  for (const part of rest) {
    if (!period && PERIOD.test(part)) period = part;
    else if (!teacher) teacher = part;
  }
  return {
    name: cut(name, MAX.className),
    period: period && cut(period, MAX.period),
    teacher: teacher && cut(teacher, MAX.teacher),
  };
}

/** The teacher a From header names: "Dr. Okoro (Google Classroom)" is Dr. Okoro. */
function senderName(from: string): string | null {
  const named = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from)?.[1] ?? "";
  const name = named.replace(/\s*\((?:google\s+)?classroom\)\s*$/i, "").trim();
  return name && !/^(?:google\s+)?classroom$/i.test(name)
    ? cut(name, MAX.teacher)
    : null;
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function monthOf(word: string): number | null {
  const lower = word.toLowerCase().replace(/\.$/, "");
  if (lower.length < 3) return null;
  const index = MONTH_NAMES.findIndex((name) => name.startsWith(lower));
  return index < 0 ? null : index + 1;
}

/** "11:59 PM", "8 am", "10:45AM" or "23:59", as "HH:mm"; null for anything else. */
function clockFrom(text: string): string | null {
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/i.exec(text);
  if (twelve) {
    const hour = Number(twelve[1]);
    const minute = Number(twelve[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    const hours = (hour % 12) + (twelve[3].toLowerCase() === "p" ? 12 : 0);
    return `${String(hours).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const plain = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (plain && Number(plain[1]) < 24 && Number(plain[2]) < 60)
    return `${plain[1].padStart(2, "0")}:${plain[2]}`;
  return null;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/**
 * A due line's day and time. "Fri, Nov 6, 2026, 11:59 PM" as Classroom writes it, and the forms it
 * writes when it is shorter: no weekday, no year (the one nearest the message), no time (11:59 PM,
 * the end of the day, which is what Classroom means by a due date alone). "2026-11-06 23:59" too.
 */
function dueFrom(
  value: string,
  receivedAt: string,
): { date: string; time: string } | null {
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(value.trim());
  if (iso) {
    if (!isDate(iso[1])) return null;
    const time = iso[2] ? clockFrom(iso[2]) : "23:59";
    return time ? { date: iso[1], time } : null;
  }
  const match =
    /^(?:[a-z]{3,9}\.?,?\s+)?([a-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?:(?:\s*,\s*|\s+at\s+|\s+)(.+))?$/i.exec(
      value.trim(),
    );
  if (!match) return null;
  const month = monthOf(match[1]);
  if (!month) return null;
  const day = Number(match[2]);
  let year = match[3] ? Number(match[3]) : null;
  if (year === null) {
    // No year: the one that puts the day nearest the message, so a December notice about a January
    // due date lands in January of the next year.
    const sent = Date.parse(receivedAt);
    if (!Number.isFinite(sent)) return null;
    const base = new Date(sent).getUTCFullYear();
    year = [base - 1, base, base + 1].reduce((best, candidate) =>
      Math.abs(Date.UTC(candidate, month - 1, day) - sent) <
      Math.abs(Date.UTC(best, month - 1, day) - sent)
        ? candidate
        : best,
    );
  }
  const date = `${year}-${pad2(month)}-${pad2(day)}`;
  if (!isDate(date)) return null;
  // A time that cannot be read is taken as the end of the day, like a due date given without one.
  const time = (match[4] && clockFrom(match[4].trim())) || "23:59";
  return { date, time };
}

/** "90 min", "1 hr", "1.5 hours", "1 hr 30 min", or a bare number of minutes. */
function minutesFrom(value: string): number | null {
  const text = value.toLowerCase();
  let total = 0;
  let found = false;
  for (const match of text.matchAll(
    /(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/g,
  )) {
    const amount = Number(match[1].replace(",", "."));
    total += match[2].startsWith("h") ? amount * 60 : amount;
    found = true;
  }
  if (!found) {
    const bare = /^\s*(\d+)\s*$/.exec(text);
    if (!bare) return null;
    total = Number(bare[1]);
  }
  const minutes = Math.round(total);
  // A hundred hours is a whole project; past that it is a typo, and the kind's default is better.
  return minutes >= 1 && minutes <= 6_000 ? minutes : null;
}

/** Quiz or test from the item's own name, the first of "quiz", "test" or "exam" it says. */
function kindFromTitle(title: string): "quiz" | "test" | null {
  const quiz = /\bquiz(?:zes)?\b/i.exec(title);
  const test = /\b(?:tests?|exams?)\b/i.exec(title);
  if (quiz && (!test || quiz.index < test.index)) return "quiz";
  return test ? "test" : null;
}

function kindOf(type: NoticeType, title: string | null): AssignmentKind {
  if (type === "New quiz") return "quiz";
  if (type === "New test") return "test";
  if (type === "Announcement") return "announcement";
  if (type === "Material") return "material";
  return (title && kindFromTitle(title)) || "assignment";
}

/** How long work of this kind usually takes, when the teacher did not say. */
export function defaultMinutes(kind: AssignmentKind, title: string): number {
  if (kind === "test") return 90;
  if (kind === "quiz") return 60;
  if (kind === "announcement" || kind === "material") return 0;
  if (/\b(?:essays?|papers?)\b/i.test(title)) return 120;
  if (/\b(?:reports?|labs?)\b/i.test(title)) return 90;
  if (/\bprojects?\b/i.test(title)) return 120;
  return 45;
}

/** A short, stable hash, for names with no letters a slug can keep. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** "AP US History" → "ap-us-history". Accents fold away; a name with no letters left is hashed. */
export function slugOf(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || `x${hashOf(text)}`;
}

/** The course and item a Classroom link names: /c/<course>/<a|p|m>/<item>. */
function linkOf(
  url: string,
): { link: string; courseId: string; itemId: string | null } | null {
  const match =
    /^https:\/\/classroom\.google\.com\/(?:u\/\d+\/)?c\/([A-Za-z0-9_-]{1,100})(?:\/(?:a|p|m|sa|mc)\/([A-Za-z0-9_-]{1,100}))?/.exec(
      url,
    );
  if (!match) return null;
  return {
    link: cut(url, MAX.link),
    courseId: match[1],
    itemId: match[2] ?? null,
  };
}

/**
 * One Classroom email as a notice, or null for mail that is not one: from anybody but
 * classroom.google.com, or without a class line and a notice type to read.
 *
 * Due times are read in the student's time zone, so "11:59 PM" is 11:59 PM where they are.
 */
export function parseClassroomNotice(
  message: ClassroomMessage,
  context: { timeZone: string },
): ParsedNotice | null {
  if (!isClassroomSender(message.from)) return null;
  const lines = linesOf(message.body);
  const filled = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line !== "");
  const first = filled[0];
  if (!first) return null;
  const classLine = classLineOf(first.line);
  if (!classLine) return null;

  // The type is the line after the class line; a notice that leaves it out has its subject say it.
  const second = filled[1];
  const bodyType = second ? typeOf(second.line) : null;
  const type = bodyType ?? subjectType(message.subject);
  if (!type) return null;
  let position = bodyType ? 2 : 1;

  // The item's title, unless the next line is a field, the link, or (for an announcement) a
  // paragraph of its own after a blank line, which is the announcement's text rather than a title.
  let title: string | null = null;
  const candidate = filled[position];
  const typeIndex = bodyType && second ? second.index : first.index;
  if (
    candidate &&
    !FIELD.test(candidate.line) &&
    !OPEN.test(candidate.line) &&
    !(type === "Announcement" && candidate.index > typeIndex + 1)
  ) {
    title = cut(candidate.line, MAX.title);
    position++;
  }
  title ??= subjectTitle(message.subject);
  if (title) title = cut(title, MAX.title);

  // The field lines follow, until the first line that is not one; then the teacher's text.
  const fields = new Map<Field, string>();
  for (; position < filled.length; position++) {
    const field = fieldOf(filled[position].line);
    if (!field) break;
    if (!fields.has(field.name)) fields.set(field.name, field.value);
  }
  let found: ReturnType<typeof linkOf> = null;
  const text: string[] = [];
  for (const { line } of filled.slice(position)) {
    const open = OPEN.exec(line);
    if (open) found ??= linkOf(open[1]);
    else text.push(line);
  }
  // A link written anywhere else in the notice still names the course.
  found ??= linkOf(
    /https:\/\/classroom\.google\.com\/\S+/.exec(lines.join("\n"))?.[0] ?? "",
  );

  const receivedAt = Number.isFinite(Date.parse(message.date))
    ? new Date(Date.parse(message.date)).toISOString()
    : "";
  const dueLine = fields.get("due");
  const dueParts = dueLine ? dueFrom(dueLine, receivedAt) : null;
  let due: string | null = null;
  if (dueParts) {
    try {
      due = zonedInstant(
        dueParts.date,
        dueParts.time,
        context.timeZone,
      ).toISOString();
    } catch {
      due = null;
    }
  }
  const kind = kindOf(type, title);
  const statedMinutes = minutesFrom(fields.get("estimated time") ?? "");
  const pointsText = /^\d+(?:\.\d+)?/.exec(fields.get("points") ?? "")?.[0];
  const help = fields.get("ai help");
  const grade = fields.get("grade")?.trim();

  const courseId = found?.courseId ?? null;
  const itemId = found?.itemId ?? null;
  const classId = courseId ?? slugOf(classLine.name);
  const assignmentId = title
    ? courseId && itemId
      ? `${courseId}-${itemId}`
      : slugOf(`${classLine.name} ${title}`)
    : null;

  return {
    noticeId: message.id,
    receivedAt,
    type,
    className: classLine.name,
    teacher: classLine.teacher ?? senderName(message.from),
    period: classLine.period,
    courseId,
    classId,
    itemId,
    title,
    assignmentId,
    kind,
    status:
      type === "Missing"
        ? "missing"
        : type === "Returned"
          ? "returned"
          : "open",
    due: dueParts && due ? due : null,
    dueDate: dueParts && due ? dueParts.date : null,
    dueTime: dueParts && due ? dueParts.time : null,
    points: pointsText === undefined ? null : Number(pointsText),
    grade: grade ? cut(grade, MAX.grade) : null,
    help: help === undefined ? null : parseHelpLevel(help),
    statedMinutes,
    minutes: statedMinutes ?? defaultMinutes(kind, title ?? ""),
    link: found?.link ?? null,
    text: cut(text.join("\n"), MAX.text),
  };
}

/** How specific a kind is: a notice that says quiz or test is never overruled by a vaguer one. */
const KIND_RANK: Record<AssignmentKind, number> = {
  announcement: 0,
  material: 1,
  assignment: 2,
  quiz: 3,
  test: 3,
};

const nameKey = (name: string) =>
  name.toLowerCase().replace(/\s+/g, " ").trim();

/** When a notice arrived; one that did not say comes before every other. */
function arrivedAt(notice: ParsedNotice): number {
  const at = Date.parse(notice.receivedAt);
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
}

/** Oldest first, the notice id breaking a tie, so the newest notice is read last. */
function oldestFirst(notices: readonly ParsedNotice[]): ParsedNotice[] {
  return [...notices].sort(
    (a, b) =>
      arrivedAt(a) - arrivedAt(b) ||
      (a.noticeId < b.noticeId ? -1 : a.noticeId > b.noticeId ? 1 : 0),
  );
}

/**
 * The class and the item each notice is about, with every notice read together, oldest first.
 *
 * A notice without a link names its class by name only. When another notice for a class of that
 * name carried the course id, it is the same class, so it takes the same id; and an item it names
 * by title takes the id a linked notice gave the same title there.
 */
function filing(ordered: readonly ParsedNotice[]) {
  const courseByName = new Map<string, string>();
  for (const notice of ordered)
    if (notice.courseId && !courseByName.has(nameKey(notice.className)))
      courseByName.set(nameKey(notice.className), notice.courseId);
  const classIdOf = (notice: ParsedNotice) =>
    notice.courseId ??
    courseByName.get(nameKey(notice.className)) ??
    notice.classId;
  const itemByTitle = new Map<string, string>();
  for (const notice of ordered)
    if (notice.courseId && notice.itemId && notice.title && notice.assignmentId)
      itemByTitle.set(
        `${classIdOf(notice)}\n${nameKey(notice.title)}`,
        notice.assignmentId,
      );
  const assignmentIdOf = (notice: ParsedNotice) =>
    notice.title && !(notice.courseId && notice.itemId)
      ? (itemByTitle.get(`${classIdOf(notice)}\n${nameKey(notice.title)}`) ??
        notice.assignmentId)
      : notice.assignmentId;
  return { classIdOf, assignmentIdOf };
}

/**
 * The notices folded into the student's classes and assignments.
 *
 * Read oldest first, so a newer notice overrides an older one: the newest notice that gives a due
 * date, a grade, an AI help level or an estimate wins for it, and a notice that gives none leaves the
 * older one standing (a reminder does not repeat the teacher's rule, and must not erase it). Two
 * exceptions. Returned work stays returned, whatever reminder arrives about it. And an open
 * assignment whose due date passed more than a day before the sync is missing, Classroom's notice or
 * not; a quiz or a test is taken in class, so one whose time has passed is not.
 *
 * Each class keeps one colour everywhere: the classes sorted by name take CLASS_COLORS in turn.
 * The result does not depend on the order the notices come in.
 */
export function buildSnapshot(
  notices: ParsedNotice[],
  meta: { timeZone: string; syncedAt: string; couldNotRead: string[] },
): SchoolSnapshot {
  const ordered = oldestFirst(notices);
  const { classIdOf, assignmentIdOf } = filing(ordered);

  const classes = new Map<string, Omit<SchoolClass, "color">>();
  type Draft = Omit<SchoolAssignment, "minutes"> & {
    statedMinutes: number | null;
  };
  const assignments = new Map<string, Draft>();

  for (const notice of ordered) {
    const classId = classIdOf(notice);
    const known = classes.get(classId);
    classes.set(classId, {
      id: classId,
      name: notice.className,
      teacher: notice.teacher ?? known?.teacher ?? null,
      period: notice.period ?? known?.period ?? null,
    });

    const id = assignmentIdOf(notice);
    if (!id || !notice.title) continue;
    const draft = assignments.get(id);
    if (!draft) {
      assignments.set(id, {
        id,
        classId,
        title: notice.title,
        kind: notice.kind,
        status: notice.status,
        due: notice.due,
        dueDate: notice.dueDate,
        dueTime: notice.dueTime,
        points: notice.points,
        grade: notice.grade,
        help: notice.help,
        statedMinutes: notice.statedMinutes,
        link: notice.link,
        noticeId: notice.noticeId,
      });
      continue;
    }
    draft.classId = classId;
    draft.title = notice.title;
    if (KIND_RANK[notice.kind] >= KIND_RANK[draft.kind])
      draft.kind = notice.kind;
    if (draft.status !== "returned" || notice.status === "returned")
      draft.status = notice.status;
    if (notice.due) {
      draft.due = notice.due;
      draft.dueDate = notice.dueDate;
      draft.dueTime = notice.dueTime;
    }
    if (notice.points !== null) draft.points = notice.points;
    if (notice.grade !== null) draft.grade = notice.grade;
    if (notice.help !== null) draft.help = notice.help;
    if (notice.statedMinutes !== null)
      draft.statedMinutes = notice.statedMinutes;
    if (notice.link !== null) draft.link = notice.link;
    draft.noticeId = notice.noticeId;
  }

  const syncedAt = Date.parse(meta.syncedAt);
  const lower = (text: string) => text.toLowerCase();
  const byName = [...classes.values()].sort((a, b) =>
    lower(a.name) < lower(b.name)
      ? -1
      : lower(a.name) > lower(b.name)
        ? 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  );
  const schoolClasses: SchoolClass[] = byName.map((entry, index) => ({
    ...entry,
    color: CLASS_COLORS[index % CLASS_COLORS.length],
  }));
  const classNames = new Map(
    schoolClasses.map((entry) => [entry.id, entry.name]),
  );

  const schoolAssignments: SchoolAssignment[] = [...assignments.values()]
    .map(({ statedMinutes, ...draft }) => {
      // Only an assignment is missing once its day has passed. A quiz or a test happens in class, so
      // one whose time has passed stays open until its email ages out; it was sat, not missed.
      const overdue =
        draft.status === "open" &&
        draft.kind === "assignment" &&
        draft.due !== null &&
        Number.isFinite(syncedAt) &&
        Date.parse(draft.due) < syncedAt - DAY_MS;
      return {
        ...draft,
        status: overdue ? "missing" : draft.status,
        minutes: statedMinutes ?? defaultMinutes(draft.kind, draft.title),
      };
    })
    .sort((a, b) => {
      // Soonest due first and undated last: an ISO instant sorts as text, and nothing sorts after
      // U+FFFF. Then by class and title, and the id last, so equal entries still have one order.
      const keys = (entry: SchoolAssignment) => [
        entry.due ?? "￿",
        lower(classNames.get(entry.classId) ?? ""),
        lower(entry.title),
        entry.id,
      ];
      const [left, right] = [keys(a), keys(b)];
      for (let index = 0; index < left.length; index++)
        if (left[index] !== right[index])
          return left[index] < right[index] ? -1 : 1;
      return 0;
    });

  return {
    syncedAt: meta.syncedAt,
    timeZone: meta.timeZone,
    classes: schoolClasses,
    assignments: schoolAssignments,
    couldNotRead: [...meta.couldNotRead],
  };
}

/** How long past its due date an item's notices outlast their emails. */
const CARRIED_PAST_DUE_MS = 2 * DAY_MS;

/** How long an undated item's notices outlast their emails, from the newest of them. */
const CARRIED_UNDATED_MS = 30 * DAY_MS;

/**
 * Of the notices read before whose emails a sync no longer lists (deleted, older than the search, or
 * pushed out by newer mail), the ones that still stand, so a teacher's rule does not vanish with its
 * email. A notice stands while its item is still listed, or is still to do with every notice of it
 * read together: not returned, and due in the future or less than two days ago, or undated with a
 * notice that arrived in the last thirty days. Newest first, at most `limit` of them.
 *
 * They are folded in with the listed notices, oldest first as always, so a newer notice about the
 * same item still replaces what they say, and a Returned one still ends it.
 */
export function carriedNotices(
  listed: readonly ParsedNotice[],
  unlisted: readonly ParsedNotice[],
  options: { at: Date; limit: number },
): ParsedNotice[] {
  const all = [...listed, ...unlisted];
  const { assignmentIdOf } = filing(oldestFirst(all));
  const at = options.at.getTime();
  const items = new Map(
    buildSnapshot(all, {
      timeZone: "UTC",
      syncedAt: options.at.toISOString(),
      couldNotRead: [],
    }).assignments.map((item) => [item.id, item]),
  );
  const newest = new Map<string, number>();
  for (const notice of all) {
    const id = assignmentIdOf(notice);
    if (id !== null)
      newest.set(
        id,
        Math.max(newest.get(id) ?? Number.NEGATIVE_INFINITY, arrivedAt(notice)),
      );
  }
  const stillListed = new Set(listed.map(assignmentIdOf));
  const stands = (id: string): boolean => {
    if (stillListed.has(id)) return true;
    const item = items.get(id);
    if (!item || item.status === "returned") return false;
    return item.due !== null
      ? Date.parse(item.due) >= at - CARRIED_PAST_DUE_MS
      : (newest.get(id) ?? Number.NEGATIVE_INFINITY) >= at - CARRIED_UNDATED_MS;
  };
  return oldestFirst(
    unlisted.filter((notice) => {
      const id = assignmentIdOf(notice);
      return id !== null && stands(id);
    }),
  )
    .reverse()
    .slice(0, Math.max(0, options.limit));
}
