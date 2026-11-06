import { cn } from "@/lib/utils";
import { MicOrb } from "@/components/duet/mic-orb";
import { ORB_COLOURS } from "@/components/duet/mic-orb-draw";
import { ORB_COLOUR_LABEL, setAvatarColour, useAvatarColour } from "@/lib/avatar-preference";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  type LinkOptions,
} from "@tanstack/react-router";
import { DuetIcon, type DuetIconName } from "@/components/duet/icons";
import { Row, Segmented } from "@/components/duet/kit";
import { PageSection, PageShell } from "@/components/layout/page-shell";
import { StandingInstructions } from "@/components/settings/standing-instructions";
import { useTheme } from "@/components/theme-provider";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { appConfig } from "@/lib/generated/application-config";
import type { ThemePreference } from "@/lib/theme";

export const Route = createFileRoute("/_authed/settings/")({
  component: RouteComponent,
});

const APPEARANCE: readonly { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Automatic" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

type Place = {
  label: string;
  icon: DuetIconName;
  to: LinkOptions["to"];
  adminOnly?: boolean;
};

/** What a student sets up here, one row each. */
const PLACES: readonly Place[] = [
  // Named as the page it opens is, and as every "Open Connections" elsewhere in the app names it.
  { label: "Connections", icon: "plug", to: "/connections" },
  { label: "Teacher rules", icon: "shield", to: "/settings/teacher-rules" },
];

/**
 * The platform's own pages. A student never needs them, so they wait folded under Advanced at the
 * foot of the page; each is still a row here and still reachable by its address.
 */
const ADVANCED: readonly Place[] = [
  { label: "Bots", icon: "bolt", to: "/bots" },
  { label: "Capabilities", icon: "box", to: "/capabilities" },
  { label: "Routines", icon: "repeat", to: "/routines" },
  { label: "Approval rules", icon: "shieldCheck", to: "/settings/approvals" },
  { label: "Notifications", icon: "bell", to: "/settings/notifications" },
  { label: "Passwords", icon: "key", to: "/settings/passwords" },
  { label: "Admin", icon: "shieldLock", to: "/admin", adminOnly: true },
];

/**
 * Settings, as one page of rows (parity-spec 1.2 and 2.9): the coach's colour, what the coach should
 * know about the student, how the app looks, the two places a student sets something up, and the
 * platform's pages folded under Advanced. It opens from the avatar disc, under the app's page chrome.
 *
 * What a student never needed is gone: the components gallery and the message list's emphasis in the
 * old sidebar were developer surfaces, and the only keyboard shortcut opened a new conversation in an
 * app that is one chat.
 */
function AvatarPicker() {
  const chosen = useAvatarColour();
  return (
    <div
      aria-label="Coach colour"
      className="mt-3 grid grid-cols-4 gap-2"
      role="radiogroup"
    >
      {ORB_COLOURS.map((colour) => {
        const on = colour === chosen;
        return (
          <button
            aria-checked={on}
            aria-label={ORB_COLOUR_LABEL[colour]}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-[18px] px-2 py-3 transition-[background-color,box-shadow,transform] active:scale-[0.97]",
              on
                ? "bg-duet-accent-soft shadow-[inset_0_0_0_2px_var(--duet-accent)]"
                : "bg-duet-card shadow-duet-card hover:bg-duet-tile",
            )}
            key={colour}
            onClick={() => setAvatarColour(colour)}
            role="radio"
            type="button"
          >
            <MicOrb colour={colour} size={44} still />
            <span className="type-caption font-medium">{ORB_COLOUR_LABEL[colour]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A list of places, one row each, with what only an admin may open left out for everybody else. */
function Places({
  label,
  places,
  className,
}: {
  label: string;
  places: readonly Place[];
  className?: string;
}) {
  const { data: user } = useQuery(currentUserQueryOptions());
  return (
    <nav aria-label={label} className={cn("flex flex-col gap-0.5", className)}>
      {places
        .filter((place) => !place.adminOnly || user?.role === "admin")
        .map((place) => (
          <Row
            chevron
            key={place.label}
            leading={<DuetIcon name={place.icon} size={22} />}
            link={({ className, children }) => (
              <Link className={className} to={place.to}>
                {children}
              </Link>
            )}
            size="nav"
            title={place.label}
          />
        ))}
    </nav>
  );
}

function RouteComponent() {
  const { preference, setPreference } = useTheme();
  const product = appConfig.brand.productName;

  return (
    <PageShell
      description={`How ${product} looks and works for you.`}
      title="Settings"
    >
      <PageSection title="Your coach">
        <p className="type-sub mt-1 text-duet-ink-2">Pick a colour for your coach's orb.</p>
        <AvatarPicker />
      </PageSection>
      <StandingInstructions />
      <PageSection title="Appearance">
        <div className="mt-3">
          <Segmented
            label="Appearance"
            onChange={setPreference}
            options={APPEARANCE}
            value={preference}
          />
        </div>
      </PageSection>
      <Places className="mt-8" label="Settings" places={PLACES} />
      {/* Closed every time the page opens: it is for whoever runs the app, not for a student. */}
      <details className="group mt-12">
        <summary className="type-sub inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-full font-medium text-muted-foreground transition-colors hover:text-duet-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 [&::-webkit-details-marker]:hidden">
          Advanced
          <DuetIcon
            className="transition-transform group-open:rotate-90 motion-reduce:transition-none"
            name="chevronRight"
            size={16}
          />
        </summary>
        <Places className="mt-2" label="Advanced settings" places={ADVANCED} />
      </details>
    </PageShell>
  );
}
