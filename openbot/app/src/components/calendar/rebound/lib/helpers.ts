// Small shared utilities. Date math works on "YYYY-MM-DD" / "HH:mm" strings
// in the user's local timezone; construct Dates only inside these helpers.

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** Days from a to b (b - a), negative if b is earlier. */
export function daysBetween(a: string, b: string): number {
  const ms = parseDateStr(b).getTime() - parseDateStr(a).getTime();
  return Math.round(ms / 86400000);
}

/** 0=Sun … 6=Sat */
export function weekday(dateStr: string): number {
  return parseDateStr(dateStr).getDay();
}

export function isWeekend(dateStr: string): boolean {
  const w = weekday(dateStr);
  return w === 0 || w === 6;
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minToTime(min: number): string {
  const clamped = Math.max(0, Math.min(min, 24 * 60 - 1));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function nowTimeStr(): string {
  const d = new Date();
  return minToTime(d.getHours() * 60 + d.getMinutes());
}

/** "14:30" -> "2:30 PM" */
export function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0
    ? `${hour} ${suffix}`
    : `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "2026-07-21" -> "Tue, Jul 21" */
export function formatDate(dateStr: string): string {
  return parseDateStr(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Chip colors every view shares. `bg`/`fg` are the saturated (upcoming)
 *  intensity; `bgWashed`/`fgMuted` are the washed same-hue pair for past,
 *  done, and missed chips (Reclaim's two-intensity pattern), so timeline and
 *  month view share one formula. */
export type ChipColors = {
  bg: string;
  bgWashed: string;
  fg: string;
  fgMuted: string;
  dot: string;
};

/** Derive chip colors from one hue anchor. `bg`/`fg` are the saturated tier:
 *  a solid pastel fill (dot mixed into the card token so dark mode stays
 *  coherent) carrying hue-tinted ink text via --chip-ink (near-black in light,
 *  pale in dark). `bgWashed`/`fgMuted` are the washed same-hue tier for time
 *  already behind the student. */
function tint(dot: string): ChipColors {
  return {
    dot,
    bg: `color-mix(in oklab, ${dot} 44%, var(--card))`,
    bgWashed: `color-mix(in oklab, ${dot} 18%, var(--card))`,
    fg: `color-mix(in oklab, ${dot} 16%, var(--chip-ink))`,
    fgMuted: `color-mix(in oklab, ${dot} 20%, var(--muted-foreground))`,
  };
}

/** Course color palette: key -> theme-aware chip colors anchored on Google
 *  Calendar's classic palette (Sage, Banana, Grape, Flamingo, Peacock, Basil,
 *  Tangerine, Graphite). Keys are stored in user data — never rename them,
 *  only retune the hues. */
export const COURSE_COLORS: Record<string, ChipColors> = {
  teal: tint("#33b679"),
  amber: tint("#f6bf26"),
  violet: tint("#8e24aa"),
  rose: tint("#e67c73"),
  sky: tint("#039be5"),
  lime: tint("#0b8043"),
  orange: tint("#f4511e"),
  slate: tint("#616161"),
};

export const COURSE_COLOR_KEYS = Object.keys(COURSE_COLORS);

export function nextCourseColor(usedColors: string[]): string {
  const counts = new Map(COURSE_COLOR_KEYS.map((k) => [k, 0]));
  for (const c of usedColors) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best = COURSE_COLOR_KEYS[0];
  let bestCount = Infinity;
  for (const k of COURSE_COLOR_KEYS) {
    const n = counts.get(k) ?? 0;
    if (n < bestCount) {
      best = k;
      bestCount = n;
    }
  }
  return best;
}

/** Vibrant palette keys (everything except the neutral slate). Used to give
 *  course-less items a real color instead of gray. */
export const VIVID_COLOR_KEYS = COURSE_COLOR_KEYS.filter((k) => k !== "slate");

/** Semantic colors keep the schedule readable at a glance: study is teal,
 * task work is sky, and routines are amber. Course colors remain available to
 * chips, progress, and other places where the class identity is the point. */
export type ScheduleColorRole = "task" | "study" | "routine" | "event";

export const SCHEDULE_COLORS: Record<ScheduleColorRole, ChipColors> = {
  task: tint("#3f51b5"),
  study: tint("#33b679"),
  routine: tint("#f6bf26"),
  event: tint("#8e24aa"),
};

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * The color every view should paint a schedule item with. Uses the course's
 * assigned color when there is one; otherwise derives a stable vibrant color
 * from `seed` (e.g. the block's refId or title) so course-less tasks and
 * routines still read in color rather than gray.
 */
export function blockColors(
  courseColorKey: string | undefined,
  seed: string,
  role?: ScheduleColorRole,
): ChipColors {
  // Google-Calendar rule: the course (calendar) owns the color; role colors
  // only cover items with no course, so the schedule shows real variety.
  if (courseColorKey && COURSE_COLORS[courseColorKey]) {
    return COURSE_COLORS[courseColorKey];
  }
  if (role) return SCHEDULE_COLORS[role];
  const key = VIVID_COLOR_KEYS[hashSeed(seed) % VIVID_COLOR_KEYS.length];
  return COURSE_COLORS[key];
}
