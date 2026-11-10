import type { ReactNode } from "react";

/**
 * A screen's scrolling body. `--screen-top` is where it starts: under the bar of the panel the
 * coach opens it in (app-shell.tsx), or, with no panel, under a floating header as the film has it.
 */
export function ScreenScroll({
  children,
  overlay,
}: {
  children: ReactNode;
  /** What floats over the screen and does not scroll with it, such as Tasks' + button. */
  overlay?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-[var(--screen-top,100px)] pb-[calc(var(--duet-tab-space,0px)+32px)] lg:px-8">
        {children}
      </div>
      {overlay}
    </div>
  );
}

/**
 * The tab's name and one line on what it holds. The name is for screen readers only: the bar over
 * the screen (app-shell.tsx) already shows one, and two different names stacked read as clutter.
 */
export function ScreenTitle({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header>
      <h1 className="sr-only">{title}</h1>
      {children ? (
        <p className="type-sub mb-4 px-1 text-duet-ink-2">{children}</p>
      ) : null}
    </header>
  );
}
