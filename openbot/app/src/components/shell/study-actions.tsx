import { text } from "prompt-area/helpers";
import {
  COMMAND_TRIGGER,
  type CommandOption,
  type ComposerDraft,
} from "@/components/channels/composer";
import { toDraft } from "@/components/channels/composer/draft";
import { DuetIcon, type DuetIconName } from "@/components/duet/icons";
import { cn } from "@/lib/utils";

/**
 * The study loop a student can start in one tap. Each row is a skill the Bot already holds.
 * The message is what they would have typed. The slug attaches that skill when it is granted.
 */
export const STUDY_ACTIONS: readonly {
  slug: string;
  label: string;
  detail: string;
  message: string;
  icon: DuetIconName;
}[] = [
  {
    slug: "work-on-now",
    label: "What to work on",
    detail: "The next assignment, and the first ten minutes",
    message: "What should I work on now?",
    icon: "bolt",
  },
  {
    slug: "plan-assignments",
    label: "Plan my week",
    detail: "Turn what's due into tasks",
    message: "Turn my open assignments into tasks.",
    icon: "tasks",
  },
  {
    slug: "quiz-me",
    label: "Quiz me",
    detail: "Practice the nearest test",
    message: "Quiz me on my nearest test.",
    icon: "question",
  },
  {
    slug: "flashcards",
    label: "Flashcards",
    detail: "A deck for the next unit",
    message: "Make flashcards for my nearest test.",
    icon: "page",
  },
  {
    slug: "explain",
    label: "Explain it",
    detail: "A concept from class, in plain words",
    message: "Explain a concept from class in plain words.",
    icon: "bulb",
  },
];

export type StudyAction = (typeof STUDY_ACTIONS)[number];

/** The primary action, and the rest, in menu order. */
export const STUDY_PRIMARY = STUDY_ACTIONS[0];
export const STUDY_REST = STUDY_ACTIONS.slice(1);

/**
 * A tap as a composer draft. A granted skill goes in as a `/` chip so its instructions lead the
 * run. Without that grant, the words still go, and the Bot answers from what it already holds.
 */
export function studyDraft(
  action: StudyAction,
  commands: readonly CommandOption[] | undefined,
): ComposerDraft {
  const command = commands?.find((entry) => entry.id === action.slug);
  const segments = command
    ? [
        {
          type: "chip" as const,
          trigger: COMMAND_TRIGGER,
          value: command.id,
          displayText: command.name,
        },
        text(` ${action.message}`),
      ]
    : [text(action.message)];
  return toDraft(segments);
}

const PILL =
  "inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-left font-semibold text-[14px] transition-[transform,opacity,filter] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 active:scale-[0.98] disabled:opacity-50";

/**
 * One row of study actions, for a conversation that already has messages. It sits above the
 * composer, where a thumb already is.
 */
export function StudyStrip({
  disabled = false,
  onPick,
}: {
  disabled?: boolean;
  onPick: (action: StudyAction) => void;
}) {
  return (
    <nav
      aria-label="Study"
      className="mb-2.5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {STUDY_ACTIONS.map((action, index) => (
        <button
          className={cn(
            PILL,
            index === 0
              ? "bg-duet-black text-duet-on-black hover:brightness-125"
              : "duet-glass text-duet-ink shadow-duet-glass",
          )}
          disabled={disabled}
          key={action.slug}
          onClick={() => onPick(action)}
          type="button"
        >
          <DuetIcon name={action.icon} size={16} stroke={2} />
          {action.label}
        </button>
      ))}
    </nav>
  );
}

/**
 * The empty Chat: what to work on, then the rest of the study loop, and the rule the coach follows.
 */
export function StudyHome({
  disabled = false,
  onPick,
}: {
  disabled?: boolean;
  onPick: (action: StudyAction) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[380px] flex-col">
      <p className="type-label font-semibold text-duet-accent">Study</p>
      <h2 className="type-title mt-1 font-semibold text-duet-ink">
        What should we work on?
      </h2>
      <button
        className="mt-4 flex min-h-16 w-full items-center gap-3 rounded-[22px] bg-duet-black px-4 py-3 text-left text-duet-on-black transition-[filter,transform] hover:brightness-125 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 active:scale-[0.99] disabled:opacity-50"
        disabled={disabled}
        onClick={() => onPick(STUDY_PRIMARY)}
        type="button"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-duet-on-black/10">
          <DuetIcon name={STUDY_PRIMARY.icon} size={20} stroke={2} />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-[16px] leading-5">
            {STUDY_PRIMARY.label}
          </span>
          <span className="mt-0.5 block text-[13px] leading-4 text-duet-on-black/70">
            {STUDY_PRIMARY.detail}
          </span>
        </span>
      </button>
      <ul className="mt-2.5 grid grid-cols-2 gap-2">
        {STUDY_REST.map((action) => (
          <li key={action.slug}>
            <button
              className="flex min-h-[72px] w-full flex-col items-start justify-center gap-1 rounded-[20px] bg-duet-card px-3.5 py-3 text-left shadow-duet-card transition-transform focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 active:scale-[0.98] disabled:opacity-50"
              disabled={disabled}
              onClick={() => onPick(action)}
              type="button"
            >
              <span className="flex items-center gap-1.5 font-semibold text-[14px] text-duet-ink">
                <DuetIcon name={action.icon} size={16} stroke={2} />
                {action.label}
              </span>
              <span className="text-[12px] leading-4 text-duet-ink-2">
                {action.detail}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="type-label mt-4 text-duet-ink-3">
        Your teachers set the AI help. Full help, hints only, or no help. I'll
        follow that.
      </p>
    </div>
  );
}
