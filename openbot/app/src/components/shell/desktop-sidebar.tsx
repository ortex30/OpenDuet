import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DuetIcon } from "@/components/duet/icons";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { appConfig } from "@/lib/generated/application-config";
import { cn } from "@/lib/utils";
import { ChatOrb, ChatStep, initialOf } from "./header";
import { type ShellTab, TABS, useWaitingCount } from "./tab-bar";

const ROW =
  "type-row flex h-11 items-center gap-3 rounded-2xl px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40";

/**
 * The desktop navigation: a fixed column on the left of a wide screen, in place of the phone's
 * floating header and tab bar. The coach orb sits at its top (back to Chat, and thinking while the
 * Bot works), the tabs run down it, and the person's settings sit at its foot. Hidden below `lg`,
 * where the phone chrome takes over.
 */
export function DesktopSidebar({
  current,
  menuOpen,
  onMenu,
}: {
  current: ShellTab | null;
  menuOpen: boolean;
  onMenu: () => void;
}) {
  const waiting = useWaitingCount();
  const { data: user } = useQuery(currentUserQueryOptions());
  return (
    <aside className="duet-face hidden w-64 shrink-0 flex-col border-duet-hair-2 border-r bg-duet-card/70 px-3 pt-5 pb-4 text-duet-ink lg:flex">
      <Link
        aria-label={`${appConfig.brand.productName} chat`}
        className="flex items-center gap-3 rounded-2xl px-2 py-1 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
        to="/"
      >
        <ChatOrb size={44} />
        <span className="type-nav min-w-0 truncate font-semibold">
          {appConfig.brand.productName}
        </span>
      </Link>
      <div className="mt-1 min-h-6 px-2">
        <ChatStep />
      </div>

      <nav aria-label="Sections" className="mt-3 flex flex-col gap-0.5">
        {TABS.map((tab) => {
          const on = tab.id === current;
          const badge = tab.id === "tasks" && waiting > 0 ? waiting : 0;
          return (
            <Link
              activeOptions={{ exact: tab.id === "chat" }}
              aria-current={on ? "page" : undefined}
              aria-label={badge ? `${tab.label}, ${badge} waiting` : undefined}
              className={cn(
                ROW,
                on
                  ? "bg-duet-tile font-semibold text-duet-ink"
                  : "text-duet-ink-2 hover:bg-duet-tile/60 hover:text-duet-ink",
              )}
              key={tab.id}
              to={tab.to}
            >
              <DuetIcon name={tab.icon} size={20} stroke={on ? 2.1 : 1.9} />
              <span className="min-w-0 flex-1 truncate">{tab.label}</span>
              {badge ? (
                <span className="type-caption grid h-5 min-w-5 place-items-center rounded-full bg-duet-accent px-1.5 font-semibold text-duet-on-accent tabular-nums">
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 border-duet-hair-2 border-t pt-4">
        <button
          aria-expanded={menuOpen}
          className={cn(
            ROW,
            "w-full text-left text-duet-ink-2 hover:bg-duet-tile/60 hover:text-duet-ink",
          )}
          onClick={onMenu}
          type="button"
        >
          <DuetIcon name="menu" size={20} />
          <span className="min-w-0 flex-1 truncate">More</span>
        </button>
      </div>

      <div className="mt-auto">
        <Link
          className={cn(ROW, "h-14 w-full text-duet-ink hover:bg-duet-tile/60")}
          to="/settings"
        >
          <span className="duet-glass type-nav grid size-9 shrink-0 place-items-center rounded-full font-semibold shadow-duet-glass">
            {user ? initialOf(user) : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate font-semibold">
              {user?.name || user?.email}
            </span>
            <span className="type-caption truncate text-duet-ink-2">
              Settings
            </span>
          </span>
          <DuetIcon className="text-duet-ink-3" name="settings" size={18} />
        </Link>
      </div>
    </aside>
  );
}
