import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** How wide a screen's content grows on a desktop: a reading column, or the whole room. */
const WIDTH = {
  narrow: "lg:max-w-3xl",
  wide: "lg:max-w-6xl",
  full: "lg:max-w-none",
} as const;

/**
 * A tab's scrolling body: it runs under the floating header, starting where the film's thread does,
 * and on under the frosted tab bar, ending far enough below it that the last row can scroll clear.
 */
export function ScreenScroll({
  children,
  overlay,
  width = "wide",
}: {
  children: ReactNode;
  /** The content's width on a desktop. On a phone it is always the screen's. */
  width?: keyof typeof WIDTH;
  /** What floats over the screen and does not scroll with it, such as Tasks' + button. */
  overlay?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-[100px] pb-[calc(var(--duet-tab-space,0px)+32px)] lg:px-10 lg:pt-10">
        <div
          className={cn(
            "mx-auto flex min-h-full w-full flex-col",
            WIDTH[width],
          )}
        >
          {children}
        </div>
      </div>
      {overlay}
    </div>
  );
}

/** The tab's name and one line on what it holds. */
export function ScreenTitle({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-4 px-1">
      <h1 className="type-display font-semibold text-duet-ink lg:text-[34px] lg:leading-[40px]">
        {title}
      </h1>
      {children ? (
        <p className="type-sub mt-0.5 text-duet-ink-2">{children}</p>
      ) : null}
    </header>
  );
}
