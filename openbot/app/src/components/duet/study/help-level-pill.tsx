import { HELP_LEVEL_LABEL, type HelpLevel } from "@openbot/shared/study";
import { cn } from "@/lib/utils";
import { DuetIcon, type DuetIconName } from "../icons";

/*
 * Colour only as status (kit.tsx): "No help" stops the study tools, so it takes the problem tone;
 * "Hints only" changes how the Bot answers, so it takes the needs tone; "Full help" asks nothing of
 * the student and stays grey. The glyph says the same thing for anyone who cannot tell the colours.
 */
const TONE: Record<HelpLevel, string> = {
  none: "bg-duet-status-problem-soft text-duet-status-problem",
  hints: "bg-duet-status-needs-soft text-duet-status-needs",
  full: "bg-duet-tile text-duet-ink-2",
};

const ICON: Record<HelpLevel, DuetIconName | null> = {
  none: "lock",
  hints: "bulb",
  full: null,
};

/** A teacher's AI-help level in the words the Classroom notice uses: Full help, Hints only, No help. */
export function HelpLevelPill({ level }: { level: HelpLevel }) {
  const icon = ICON[level];
  return (
    <span
      className={cn(
        // OutcomePill's shape, so a rule sits beside an outcome as one kind of thing.
        "type-sub inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-[11px] font-medium",
        TONE[level],
      )}
      data-help-level={level}
    >
      {icon ? <DuetIcon name={icon} size={14} stroke={2.4} /> : null}
      {HELP_LEVEL_LABEL[level]}
    </span>
  );
}
