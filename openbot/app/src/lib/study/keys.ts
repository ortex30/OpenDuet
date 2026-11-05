/*
 * The query keys for Academic OS's study features (/api/openduet/study), under one root so a change
 * can refresh exactly what it touched. A calendar range is keyed under `calendarAll`, so applying a
 * plan invalidates that one prefix and every range on screen reloads with the new blocks.
 */
export const studyKeys = {
  all: ["openduet-study"] as const,
  quiz: (id: string) => ["openduet-study", "quiz", id] as const,
  deck: (id: string) => ["openduet-study", "deck", id] as const,
  /** One class's practice history, or every class's (null) under "all". */
  progress: (classId: string | null) =>
    ["openduet-study", "progress", classId ?? "all"] as const,
  plan: (id: string) => ["openduet-study", "plan", id] as const,
  /** The prefix of every calendar range: invalidate it after anything that adds or moves a block. */
  calendarAll: ["openduet-study", "calendar"] as const,
  /** One range, `from` and `to` inclusive, each "YYYY-MM-DD". */
  calendar: (from: string, to: string) =>
    ["openduet-study", "calendar", from, to] as const,
  rules: ["openduet-study", "rules"] as const,
  school: ["openduet-study", "school"] as const,
} as const;
