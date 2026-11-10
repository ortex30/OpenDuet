import { cn } from "@/lib/utils";

/**
 * A small desk lamp, the coach's mark. It sits beside a greeting or an empty
 * state. It is a picture, not a character with a name.
 */
export function DeskMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("size-8 shrink-0", className)}
      viewBox="0 0 48 48"
    >
      <ellipse cx="24" cy="42" fill="var(--duet-tile)" rx="12" ry="2.5" />
      <path
        d="M24 40V24"
        fill="none"
        stroke="var(--duet-ink)"
        strokeLinecap="round"
        strokeWidth="2.2"
      />
      <path d="M13 24h22l-3.2 8H16.2z" fill="var(--duet-accent)" />
      <path
        d="M16 20c1.6-6 14.4-6 16 0"
        fill="none"
        stroke="var(--duet-accent)"
        strokeLinecap="round"
        strokeWidth="2.2"
      />
      <circle cx="24" cy="13" fill="var(--duet-status-needs)" r="2.2" />
    </svg>
  );
}
