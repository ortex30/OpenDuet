import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { appConfig } from "@/lib/generated/application-config";
import { ChatOrb, ChatStep, initialOf } from "./header";
import { INTRO_NAME_TARGET } from "./startup-intro";

/**
 * The desktop's one bar across the top, kept as plain as School Chat's: the coach's orb and name on
 * the left, what it is doing while it works, and the person's settings on the right. There are no
 * buttons for screens; the coach opens them when asked. Hidden below `lg`, where the phone's
 * header over the chat stands in for it.
 */
export function DesktopBar() {
  const { data: user } = useQuery(currentUserQueryOptions());
  return (
    <header className="duet-face hidden h-16 shrink-0 items-center gap-4 border-duet-hair-2 border-b bg-duet-surface px-5 text-duet-ink lg:flex">
      <Link
        aria-label={`${appConfig.brand.productName} chat`}
        className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-full pr-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
        to="/"
      >
        <ChatOrb size={40} />
        <span
          className={`${INTRO_NAME_TARGET} study-display type-nav font-semibold`}
        >
          {appConfig.brand.productName}
        </span>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="w-fit max-w-full">
          <ChatStep />
        </div>
      </div>
      <Link
        aria-label="Your settings"
        className="duet-glass type-nav grid size-10 shrink-0 place-items-center rounded-full font-semibold shadow-duet-glass transition-colors hover:bg-duet-tile focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40"
        title="Settings"
        to="/settings"
      >
        {user ? initialOf(user) : null}
      </Link>
    </header>
  );
}
