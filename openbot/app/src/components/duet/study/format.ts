import type { ClassColor } from "@openbot/shared/study";

/*
 * The words and numbers the study cards print, kept out of the components so each card says a time,
 * a length or a day the same way, and so they can be checked without drawing anything.
 *
 * NO-BREAK SPACES. A card is 430px at most and the type follows the person's text size, so a line
 * can break anywhere a space is. "4:50" on one line and "PM" on the next, or "2" and "h", reads as
 * a mistake, so the spaces that hold a number to its unit are U+00A0. Testing Library's matcher
 * folds them into plain spaces, so a test can still look for "4:05 – 4:50 PM".
 */

const NBSP = " ";

/** "1 session", "3 sessions". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "45 min", "1 h", "2 h 30 min". Negative or broken input reads as "0 min". */
export function formatMinutes(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}${NBSP}min`;
  return rest === 0 ? `${hours}${NBSP}h` : `${hours}${NBSP}h ${rest}${NBSP}min`;
}

/** Minutes since midnight for "HH:mm" (up to "24:00"), or null when it is not a time. */
export function clockMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

/** How long a block is, in minutes; 0 when either end is unreadable or the end is not later. */
export function blockMinutes(start: string, end: string): number {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  return from === null || to === null ? 0 : Math.max(0, to - from);
}

function clock(total: number): { text: string; meridiem: "AM" | "PM" } {
  const hours = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  return {
    text: `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes).padStart(2, "0")}`,
    meridiem: hours < 12 ? "AM" : "PM",
  };
}

/**
 * "4:05 – 4:50 PM", naming AM or PM once when both ends share it, and "11:30 AM – 12:15 PM" when
 * they do not. A time it cannot read is printed as it came rather than guessed at.
 */
export function formatTimeRange(start: string, end: string): string {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null) return `${start}${NBSP}– ${end}`;
  const a = clock(from);
  const b = clock(to);
  return a.meridiem === b.meridiem
    ? `${a.text}${NBSP}– ${b.text}${NBSP}${b.meridiem}`
    : `${a.text}${NBSP}${a.meridiem}${NBSP}– ${b.text}${NBSP}${b.meridiem}`;
}

/** Days since 1970 for "YYYY-MM-DD", read as a calendar day so no time zone can move it. */
function dayNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const time = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isFinite(time) ? Math.round(time / 86_400_000) : null;
}

/*
 * The student's day, not the browser's: a plan's dates are already the student's own days, so they
 * are formatted as UTC, which leaves them exactly as written. US English, like the rest of the
 * cards' words ("Today", "Didn't fit").
 */
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * "Today" and "Tomorrow" when the student's today is known, otherwise "Thu, Nov 6". Without a today
 * the card never guesses one: a plan read back from history next week would call its days wrong.
 */
export function dayLabel(date: string, today?: string | null): string {
  const day = dayNumber(date);
  if (day === null) return date;
  const now = today ? dayNumber(today) : null;
  if (now !== null && day === now) return "Today";
  if (now !== null && day === now + 1) return "Tomorrow";
  return DAY_FORMAT.format(new Date(day * 86_400_000));
}

/*
 * A class's colour as a token. The contract's names are Rebound's course colours (Google Calendar's
 * classic palette); each takes the channel colour closest in hue, which already has a dark value and
 * clears 3:1 as a mark on both themes. Decorative only: the class's name is always written beside it.
 */
const CLASS_COLOR_TOKEN: Record<ClassColor, string> = {
  sky: "--duet-ch-blue",
  violet: "--duet-ch-lavender",
  teal: "--duet-ch-green",
  amber: "--duet-ch-amber",
  rose: "--duet-ch-blush",
  lime: "--duet-ch-sage",
  orange: "--duet-ch-peach",
  slate: "--duet-ink-3",
};

/** `var(--duet-ch-…)` for a class colour, for an inline `backgroundColor` or `color`. */
export function classColorVar(color: ClassColor): string {
  return `var(${CLASS_COLOR_TOKEN[color] ?? "--duet-ink-3"})`;
}

/**
 * A copy of `items` in a random order (Fisher-Yates). With more than one item it never hands back
 * the order it was given: a Shuffle that lands where it started reads as a button that did nothing.
 */
export function shuffled<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    const held = copy[index];
    copy[index] = copy[other];
    copy[other] = held;
  }
  if (copy.length > 1 && copy.every((item, index) => item === items[index]))
    return [...copy.slice(1), copy[0]];
  return copy;
}
