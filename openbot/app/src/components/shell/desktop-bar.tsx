import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DuetIcon } from "@/components/duet/icons";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { appConfig } from "@/lib/generated/application-config";
import { cn } from "@/lib/utils";
import { ChatOrb, ChatStep, initialOf } from "./header";
import { type ShellTab, TABS, useWaitingCount } from "./tab-bar";

/**
 * The desktop's one bar across the top. The coach is the app: its orb and name on the left, then
 * the screens it can open beside the chat (Tasks, Calendar, Coach, Learn, Make), and the person's
 * settings on the right. Pressing the open screen again closes it, back to the chat alone.
 * Hidden below `lg`, where the phone's header and tab bar take over.
 */
export function DesktopBar({ current }: { current: ShellTab | null }) {
  const waiting = useWaitingCount();
  const { data: user } = useQuery(currentUserQueryOptions());
  return (
    <header className="duet-face hidden h-16 shrink-0 items-center gap-4 border-duet-hair-2 border-b bg-duet-surface px-5 text-duet-ink lg:flex">
      <Link
        aria-label={`${appConfig.brand.productName} chat`}
        className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-full pr-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
        to="/"
      >
        <ChatOrb size={40} />
        <span className="type-nav font-semibold">
          {appConfig.brand.productName}
        </span>
      </Link>
      <div className="w-56 shrink-0">
        <ChatStep />
      </div>
      <nav
        aria-label="Open beside the chat"
        className="mx-auto flex items-center gap-1"
      >
        {TABS.filter((tab) => tab.id !== "chat").map((tab) => {
          const on = tab.id === current;
          const badge = tab.id === "tasks" && waiting > 0 ? waiting : 0;
          return (
            <Link
              aria-current={on ? "page" : undefined}
              aria-label={
                on
                  ? `Close ${tab.label}`
                  : badge
                    ? `${tab.label}, ${badge} waiting`
                    : undefined
              }
              className={cn(
                "type-sub flex h-10 items-center gap-2 rounded-full px-4 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40",
                on
                  ? "bg-duet-black text-duet-on-black"
                  : "text-duet-ink-2 hover:bg-duet-tile hover:text-duet-ink",
              )}
              key={tab.id}
              to={on ? "/" : tab.to}
            >
              <DuetIcon name={tab.icon} size={18} stroke={2} />
              {tab.label}
              {badge ? (
                <span className="type-caption grid h-5 min-w-5 place-items-center rounded-full bg-duet-accent px-1.5 text-duet-on-accent tabular-nums">
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="flex w-56 shrink-0 justify-end">
        <Link
          aria-label="Your settings"
          className="duet-glass type-nav grid size-10 place-items-center rounded-full font-semibold shadow-duet-glass focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
          to="/settings"
        >
          {user ? initialOf(user) : null}
        </Link>
      </div>
    </header>
  );
}
