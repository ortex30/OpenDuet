import { createContext, useContext } from "react";
import type {
  Block,
  Commitment,
  DayAvailabilityOverride,
  LearnedNote,
  OneOff,
  Profile,
  QuizAnswers,
  Routine,
  Task,
} from "./types";

/** What CalendarTimeline's usePace selectors read. Supplied by the adapter, never persisted. */
export interface CalendarStoreState {
  profile: Profile | null;
  quizAnswers: QuizAnswers;
  commitments: Commitment[];
  oneOffs: OneOff[];
  blocks: Block[];
  tasks: Task[];
  routines: Routine[];
  availabilityOverrides: DayAvailabilityOverride[];
  learnedNotes: LearnedNote[];
  assistantOpen: boolean;
}
type MoveResult = { ok: boolean; error?: string };
/** Write API that calendar-drag.ts and the placement warning type against; unreachable read-only. */
interface CalendarStoreWrites extends CalendarStoreState {
  moveBlock(
    id: string,
    date: string,
    start: string,
    override?: boolean,
  ): MoveResult;
  resizeBlock(id: string, end: string, override?: boolean): MoveResult;
  unlockBlock(id: string): void;
  scheduleTaskBlock(
    taskId: string,
    date: string,
    start: string,
    durationMin?: number,
    override?: boolean,
  ): MoveResult & { block?: Block; receiptAt?: string };
  recordRecoveryMoves(input: {
    source: string;
    summary: string;
    moves: { before: Block; after: Block; reason: string }[];
  }): { at: string } | null;
  dismissHealNote(at: string): void;
}
export const CalendarStoreContext = createContext<CalendarStoreState | null>(
  null,
);
export function usePace<T>(selector: (state: CalendarStoreState) => T): T {
  const state = useContext(CalendarStoreContext);
  if (!state)
    throw new Error("CalendarTimeline must be inside CalendarStoreContext.");
  return selector(state);
}
usePace.getState = (): CalendarStoreWrites => {
  throw new Error("The calendar is read-only; plans change through Apply.");
};
