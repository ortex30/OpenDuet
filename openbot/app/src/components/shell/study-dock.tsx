/**
 * The daily tools, opened from chat. Chat stays the home; each one is a screen
 * beside it. Plain links, so a conversation drawn without the app router
 * (tests, a channel on its own page) still renders.
 */
const TOOLS = [
  { label: "Tonight", to: "/coach" },
  { label: "Study", to: "/learn" },
  { label: "Calendar", to: "/calendar" },
  { label: "Tasks", to: "/tasks" },
  { label: "Rules", to: "/settings/teacher-rules" },
] as const;

export function StudyDock() {
  return (
    <nav
      aria-label="Study tools"
      className="mb-2 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TOOLS.map((tool) => (
        <a
          className="type-caption shrink-0 rounded-full bg-duet-tile px-3 py-2 font-semibold text-duet-ink transition-colors hover:bg-duet-ink hover:text-duet-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
          href={tool.to}
          key={tool.to}
        >
          {tool.label}
        </a>
      ))}
    </nav>
  );
}
