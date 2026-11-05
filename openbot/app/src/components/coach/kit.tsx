import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ComponentProps, ReactNode } from "react";
import { DuetIcon } from "@/components/duet/icons";
import type { ClassColor } from "@/lib/coach/model";
import { cn } from "@/lib/utils";

/** Class colours as literal Tailwind classes, so the build keeps them. */
export const SOFT: Record<ClassColor | string, string> = {
  violet: "bg-duet-violet-soft text-duet-violet",
  blue: "bg-duet-blue-soft text-duet-blue",
  green: "bg-duet-green-soft text-duet-green",
  amber: "bg-duet-amber-soft text-duet-amber",
  red: "bg-duet-red-soft text-duet-red",
  accent: "bg-duet-accent-soft text-duet-accent",
};

export const SOLID: Record<ClassColor | string, string> = {
  violet: "bg-duet-violet",
  blue: "bg-duet-blue",
  green: "bg-duet-green",
  amber: "bg-duet-amber",
  red: "bg-duet-red",
  accent: "bg-duet-accent",
};

/** A rounded card on the tab's surface. */
export function Card({
  children,
  className,
  ...props
}: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "mb-3 rounded-[24px] bg-duet-card p-4 shadow-duet-card",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardTitle({
  children,
  action,
  id,
}: {
  children: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2
        className="type-label font-semibold text-duet-ink-2 uppercase tracking-wide"
        id={id}
      >
        {children}
      </h2>
      {action}
    </div>
  );
}

/** The class a thing belongs to, as a small coloured pill. */
export function ClassPill({ name, color }: { name: string; color: string }) {
  return (
    <span
      className={cn(
        "type-caption inline-flex items-center rounded-full px-2 py-0.5 font-semibold",
        SOFT[color] ?? SOFT.accent,
      )}
    >
      {name}
    </span>
  );
}

/** A small rounded button, filled or outlined. */
export function CoachButton({
  children,
  primary = false,
  className,
  ...props
}: ComponentProps<"button"> & { primary?: boolean }) {
  return (
    <button
      className={cn(
        "type-row inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 py-2 font-semibold transition-[filter,transform,background-color] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-violet/40 active:scale-[0.98] disabled:opacity-50",
        primary
          ? "bg-duet-black text-duet-on-black hover:brightness-125"
          : "text-duet-ink shadow-[inset_0_0_0_1px_var(--duet-hair)] hover:bg-duet-tile",
        className,
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

/** A choice among a few, drawn as tappable chips. */
export function ChipChoice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="mb-3">
      <legend className="type-sub mb-1.5 font-medium text-duet-ink-2">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            aria-pressed={value === o.value}
            className={cn(
              "type-row min-h-10 rounded-full px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-violet/40",
              value === o.value
                ? "bg-duet-black text-duet-on-black"
                : "bg-duet-tile text-duet-ink hover:brightness-95",
            )}
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            type="button"
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** A progress ring: `value` of `max`, with whatever sits in the middle. */
export function Ring({
  value,
  max,
  size = 76,
  stroke = 8,
  children,
  label,
  track = "var(--duet-tile)",
}: {
  track?: string;
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div
      aria-label={label}
      aria-valuemax={max}
      aria-valuemin={0}
      aria-valuenow={Math.round(value)}
      className="relative grid shrink-0 place-items-center"
      role="progressbar"
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden
        className="-rotate-90 absolute inset-0"
        height={size}
        width={size}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={r}
          stroke={track}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={r}
          stroke={share >= 1 ? "var(--duet-green)" : "var(--duet-accent)"}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
          strokeLinecap="round"
          strokeWidth={stroke}
          style={{ transition: "stroke-dashoffset 600ms ease-out" }}
        />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

/** A bottom sheet in the app's glass, for the tab's forms and its report. */
export function CoachSheet({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open={open}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="duet-veil fixed inset-0 z-50 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="duet-face fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] w-full max-w-[430px] overflow-y-auto overscroll-contain px-2.5 pb-[max(env(safe-area-inset-bottom),12px)] text-duet-ink outline-none transition-[opacity,translate] motion-safe:data-ending-style:translate-y-full motion-safe:data-starting-style:translate-y-full">
          <div className="duet-glass rounded-[28px] p-4 shadow-duet-glass">
            <div className="mb-3 flex items-start justify-between gap-3">
              <DialogPrimitive.Title className="type-title min-w-0 flex-1 pt-1.5 pl-1 font-semibold">
                {title}
              </DialogPrimitive.Title>
              <button
                aria-label="Close"
                className="grid size-11 shrink-0 place-items-center rounded-full text-duet-ink-2 outline-none transition-colors hover:bg-duet-tile focus-visible:ring-3 focus-visible:ring-duet-violet/40"
                onClick={onClose}
                type="button"
              >
                <DuetIcon name="x" size={20} stroke={2.1} />
              </button>
            </div>
            {children}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const FIELD =
  "type-body w-full rounded-[16px] bg-duet-card px-3.5 py-2.5 text-duet-ink shadow-[inset_0_0_0_1px_var(--duet-hair)] outline-none placeholder:text-duet-ink-3 focus-visible:ring-3 focus-visible:ring-duet-violet/25";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child.
    <label className="mb-3 block">
      <span className="type-sub mb-1 block font-medium text-duet-ink-2">
        {label}
      </span>
      {children}
    </label>
  );
}
