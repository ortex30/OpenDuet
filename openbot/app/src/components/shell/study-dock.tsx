import { type MouseEvent, useEffect, useState } from "react";

/**
 * The daily tools, opened from chat. Chat stays the home; each one is a screen
 * beside it. Plain links, so a conversation drawn without the app router
 * (tests, a channel on its own page) still renders. A normal click asks the
 * shell to open the screen without reloading the chat.
 */
const TOOLS = [
  { label: "Tonight", to: "/coach" },
  { label: "Study", to: "/learn" },
  { label: "Calendar", to: "/calendar" },
  { label: "Tasks", to: "/tasks" },
  { label: "Rules", to: "/settings/teacher-rules" },
  { label: "Made", to: "/make" },
] as const;

function here(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function openTool(event: MouseEvent<HTMLAnchorElement>, to: string) {
  if (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  ) {
    return;
  }
  event.preventDefault();
  window.dispatchEvent(new CustomEvent("academic-os-open", { detail: to }));
}

function usePath(): string {
  const [path, setPath] = useState(here);
  useEffect(() => {
    const fromClick = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string") {
        setPath(detail.replace(/\/+$/, "") || "/");
      }
    };
    const fromBar = () => setPath(here());
    window.addEventListener("academic-os-open", fromClick);
    window.addEventListener("academic-os-navigated", fromBar);
    window.addEventListener("popstate", fromBar);
    return () => {
      window.removeEventListener("academic-os-open", fromClick);
      window.removeEventListener("academic-os-navigated", fromBar);
      window.removeEventListener("popstate", fromBar);
    };
  }, []);
  return path;
}

export function StudyDock() {
  const path = usePath();
  return (
    <nav
      aria-label="Study tools"
      className="mb-2 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TOOLS.map((tool) => {
        const current = path === tool.to || path.startsWith(`${tool.to}/`);
        return (
          <a
            aria-current={current ? "page" : undefined}
            className={
              current
                ? "type-caption inline-flex min-h-11 shrink-0 items-center rounded-full bg-duet-ink px-3.5 font-semibold text-duet-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
                : "type-caption inline-flex min-h-11 shrink-0 items-center rounded-full bg-duet-tile px-3.5 font-semibold text-duet-ink transition-colors hover:bg-duet-ink hover:text-duet-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
            }
            href={tool.to}
            key={tool.to}
            onClick={(event) => openTool(event, tool.to)}
          >
            {tool.label}
          </a>
        );
      })}
    </nav>
  );
}
