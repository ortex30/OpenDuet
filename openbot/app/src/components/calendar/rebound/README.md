# Rebound calendar, vendored read-only

The Calendar tab draws its hours with the week and day timeline from **Rebound**, the owner's
own study-planning app. It is copied here with the owner's permission. Rebound's source carries
no open-source licence of its own, so treat this folder as the owner's code that they chose to
include, not as a third-party package.

## What is Rebound's and what is ours

| Path | Whose | What |
| --- | --- | --- |
| `components/calendar-timeline.tsx` | Rebound | The timeline renderer |
| `lib/*.ts` except `store.ts` | Rebound | What the timeline imports: layout, placement, drag, helpers, types |
| `lib/store.ts` | Academic OS | A typed stand-in for Rebound's store: reads only, every write throws |
| `calendar-data.ts` | Academic OS | Turns `CalendarView` (shared/study.ts) into the timeline's shapes |
| `AcademicCalendar.tsx` | Academic OS | Renders the timeline over that data, read-only |
| `calendar.css` | Both | Rebound's calendar rules (its `app/globals.css`, lines 361 to 607), scoped to `.academic-calendar`, plus its tokens mapped onto OpenDuet's, the dashed look of a proposed block, and the hours column kept over the days when a week scrolls sideways |

## What was changed in Rebound's files

- Imports `@/lib/x` became relative (`../lib/x`, `./x`): `@/` means `app/src` here.
- `lib/calendar-context.ts` declares `DeadlineVerdict` itself instead of importing Rebound's
  `lib/feasibility.ts`, which would have pulled in about twenty more files and `ts-fsrs`.
- The icons are `@tabler/icons-react` (the app's set) instead of `lucide-react`, at the same sizes
  and classes: Check, CircleDashed, CirclePlus, Lock, Repeat2, RotateCcw, TriangleAlert and X became
  IconCheck, IconCircleDashed, IconCirclePlus, IconLock, IconRepeat, IconRotate, IconAlertTriangle
  and IconX, and the `LucideIcon` type became Tabler's `Icon`.
- The `"use client"` line is gone: Vite has no server components.
- **Read-only:** `movable` needs a move handler
  (`Boolean(onMoveTask && block && block.status === "todo")`), so with none given nothing can be
  dragged or resized.
- The jump to now runs once for each set of days and grid size, not each time the now line moves
  or the page re-renders, so a ticking clock never pulls the timeline back while it is read.
- Formatted with Biome; `lib/quiz.ts` took Biome's literal-key, ternary and optional-chain fixes.
  Six diagnostics in the timeline are suppressed where they stand, each with its reason: the
  scrollport's focusable `role="region"`, the day grid's click and drop surface, and two drag-only
  guide lists keyed in fixed order.
- An end at midnight (`"24:00"`, minute 1440) is written "12 AM" (`formatEnd`): on the busy wash's
  label, aria-label and title, a card's time line, aria-label and title, and the hours column's
  last mark. Rebound's `formatTime` read it as "12 PM", and `minToTime` stopped at 11:59 PM.
- `provisional`: a jump to now made while the items stand in for a range that is still loading runs
  once more when the real range lands.

## Read-only, three ways

1. `AcademicCalendar` passes no `onMoveTask`, `onCreateAt` or `onDoubleClickBlock`.
2. `movable` is false without `onMoveTask`, which also removes every resize handle.
3. `lib/store.ts`'s `usePace.getState()` throws, so a write path reached some other way fails
   loudly instead of changing anything.

Study blocks change only when a plan is applied in Chat. Never set the drag type
`application/x-pace-task` anywhere in the app: the day grid still listens for it.

## Not copied

Rebound's `calendar-clone-shell.module.css` (a dark, full-screen shell with a sidebar, and 68 Biome
errors) and the Outfit font: the calendar is set in Inter, the app's font.
