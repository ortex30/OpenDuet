import { weekday } from "./helpers";
import type { Commitment } from "./types";

/** Imported series have explicit dates/times; manual commitments stay weekly. */
export function commitmentsForDate(
  commitments: Commitment[],
  date: string,
): Commitment[] {
  return commitments.flatMap((commitment) =>
    commitment.calendarOccurrences
      ? commitment.calendarOccurrences
          .filter((o) => o.date === date)
          .map((o, index) => ({
            ...commitment,
            id:
              index === 0 ? commitment.id : `${commitment.id}:${date}:${index}`,
            start: o.start,
            end: o.end,
          }))
      : commitment.days.includes(weekday(date))
        ? [commitment]
        : [],
  );
}
