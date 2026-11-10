import { commitmentsForDate } from "./calendar-occurrences";
import { timeToMin } from "./helpers";
import type { Commitment, OneOff, Profile } from "./types";

/** A day-specific reset window after a class or work commitment. It is a soft
 * scheduling preference: normal planning and recovery protect it, while a hard
 * deadline may use it as a last resort rather than dropping required work. */
export interface PostCommitmentRecoveryWindow {
  startMin: number;
  endMin: number;
  title: string;
}

/** Normalize old/malformed persisted profiles without ever creating an
 * unbounded interval. Quiz and assistant writes are already stricter; this is
 * the defensive read boundary for pre-field data. */
export function postCommitmentBufferMin(profile: Profile): number {
  const raw = profile.postCommitmentBufferMin;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(180, Math.max(0, Math.round(raw / 5) * 5));
}

function earnsRecovery(kind: Commitment["kind"] | undefined): boolean {
  return kind === "class" || kind === "work";
}

/** Recovery windows that apply on one date. Activities and generic one-offs do
 * not inherit the class/work rule: students can block those explicitly, while
 * the quiz wording promises a reset specifically after classes or work. */
export function postCommitmentRecoveryWindows(
  profile: Profile,
  commitments: Commitment[],
  oneOffs: OneOff[],
  date: string,
): PostCommitmentRecoveryWindow[] {
  const buffer = postCommitmentBufferMin(profile);
  if (buffer === 0) return [];

  const out: PostCommitmentRecoveryWindow[] = [];
  const add = (title: string, end: string) => {
    const startMin = timeToMin(end);
    const endMin = Math.min(24 * 60, startMin + buffer);
    if (endMin > startMin) out.push({ startMin, endMin, title });
  };

  for (const commitment of commitmentsForDate(commitments, date)) {
    if (earnsRecovery(commitment.kind)) {
      add(commitment.title, commitment.end);
    }
  }
  for (const oneOff of oneOffs) {
    if (oneOff.date === date && earnsRecovery(oneOff.kind)) {
      add(oneOff.title, oneOff.end);
    }
  }
  return out;
}
