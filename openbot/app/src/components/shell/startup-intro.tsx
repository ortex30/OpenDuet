import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MicOrb } from "@/components/duet/mic-orb";
import { palette } from "@/components/duet/mic-orb-draw";
import { useAvatarColour } from "@/lib/avatar-preference";
import { appConfig } from "@/lib/generated/application-config";
import { useReducedMotionPreference } from "@/lib/reduced-motion";
import { cn } from "@/lib/utils";

/*
 * The app's hello, once a session: the coach's orb wakes in the middle of the screen with a glow
 * and a ping, the product's name writes itself in beside it, and then both fly into the places they
 * live in the real app (the desktop bar's orb and name, or the phone header's orb) while the screen
 * behind them dissolves into Chat. About 1.8 seconds.
 *
 * It is decoration over an app that is already there and working: aria-hidden, never a dialog, and
 * it never takes focus. A tap or any key skips it. Asked for less motion, it is a short fade.
 */

/** sessionStorage: set once it has played, so it plays once a tab, not on every page. */
export const INTRO_PLAYED_KEY = "academic-os:intro-played";

/** The orb in the middle: the desktop bar's 40px orb at 2.8×, so its flight is one scale. */
export const INTRO_ORB_PX = 112;
/** How long the orb and the name hold in the middle before they fly. */
export const INTRO_ENTER_MS = 1150;
/** The flight into the header, while the screen behind dissolves. */
export const INTRO_FLY_MS = 520;
/** The orb in the header takes over, and the flown one fades off it. */
export const INTRO_LAND_MS = 160;
/** Skipped with a tap or a key: a quick fade. */
export const INTRO_SKIP_MS = 180;
/** Less motion: the orb and the name, still, for a moment, then a fade. */
export const INTRO_STILL_MS = 450;
export const INTRO_STILL_FADE_MS = 250;
/** Whatever happens, it is gone by now. */
export const INTRO_LIMIT_MS = 3000;

/** On <html> while it plays: the header's orb and name hide, so the flown ones land in their place. */
const PLAYING = "data-startup-intro";
/** The header's orb (`ChatOrb`) and the desktop bar's name carry these, so the intro can find them. */
export const INTRO_ORB_TARGET = "startup-target-orb";
export const INTRO_NAME_TARGET = "startup-target-name";

/** The flight's curve, the sheet's (page-morph.tsx): quick away, long settle. */
const FLIGHT_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

type Phase = "enter" | "fly" | "land" | "leave" | "gone";

/** Where the gate is kept when sessionStorage is not there to keep it (a locked-down browser). */
let playedOnThisPage = false;

function playedThisSession(): boolean {
  if (playedOnThisPage) return true;
  try {
    return sessionStorage.getItem(INTRO_PLAYED_KEY) !== null;
  } catch {
    return false;
  }
}

function markPlayed() {
  playedOnThisPage = true;
  try {
    sessionStorage.setItem(INTRO_PLAYED_KEY, "1");
  } catch {
    // Kept for this page alone, which is enough: the shell remounts, the page does not reload.
  }
}

/** Whether to play now: not played this session, and the tab is in front, where it can be seen. */
function shouldPlay(): boolean {
  if (typeof document === "undefined") return false;
  if (document.visibilityState === "hidden") return false;
  return !playedThisSession();
}

/** The click that follows a tap, used up before anything under the intro hears it. */
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    stop();
  };
  const stop = () => {
    window.removeEventListener("click", swallow, true);
    window.clearTimeout(timer);
  };
  window.addEventListener("click", swallow, true);
  // A tap's click follows within a moment; a press held longer than this was not a tap.
  const timer = window.setTimeout(stop, 800);
}

/** For tests: forget that it played on this page. */
export function resetStartupIntroForTests() {
  playedOnThisPage = false;
}

/**
 * The first of `className`'s elements that can be seen: laid out (the other header is
 * display:none) and not under something else, as the phone's header is under an open screen.
 */
function visible(className: string): HTMLElement | null {
  for (const element of document.getElementsByClassName(className)) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const top = document.elementFromPoint?.(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    // The orb itself lets the pointer through, so what is on top there is its link.
    const owner = element.closest("a") ?? element;
    if (top && !owner.contains(top)) continue;
    return element as HTMLElement;
  }
  return null;
}

/**
 * The transform that lays `from` over `to`: their left edges and middles meet, at `to`'s height.
 * The flown element scales from its left middle, so that is the point that has to land.
 */
function flight(from: DOMRect, to: DOMRect): string {
  const scale = to.height / from.height;
  const dx = to.left - from.left;
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

export function StartupIntro() {
  const [phase, setPhase] = useState<Phase>(() =>
    shouldPlay() ? "enter" : "gone",
  );
  const reduced = useReducedMotionPreference();
  const colour = useAvatarColour();
  const orb = useRef<HTMLDivElement>(null);
  const name = useRef<HTMLDivElement>(null);
  const playing = phase !== "gone";

  // Played is kept the moment it starts, so a shell that remounts under it does not play it again.
  useEffect(() => {
    if (playing) markPlayed();
  }, [playing]);

  // The header's own orb and name hide while it plays, until the flown ones land on them.
  const hiding = phase === "enter" || phase === "fly";
  useLayoutEffect(() => {
    if (!hiding) return;
    document.documentElement.setAttribute(PLAYING, "");
    return () => document.documentElement.removeAttribute(PLAYING);
  }, [hiding]);

  // Each phase ends on a timer, so nothing waits on an animation that a hidden tab or a test never
  // runs, and it is always gone within about two seconds; within three, whatever happens.
  useEffect(() => {
    if (!playing) return;
    const limit = window.setTimeout(() => setPhase("gone"), INTRO_LIMIT_MS);
    return () => window.clearTimeout(limit);
  }, [playing]);
  useEffect(() => {
    if (phase === "gone") return;
    const [next, ms]: [Phase, number] =
      phase === "enter"
        ? reduced
          ? ["leave", INTRO_STILL_MS]
          : ["fly", INTRO_ENTER_MS]
        : phase === "fly"
          ? ["land", INTRO_FLY_MS]
          : phase === "land"
            ? ["gone", INTRO_LAND_MS]
            : ["gone", reduced ? INTRO_STILL_FADE_MS : INTRO_SKIP_MS];
    const timer = window.setTimeout(() => setPhase(next), ms);
    return () => window.clearTimeout(timer);
  }, [phase, reduced]);

  // A tap, a scroll or any key: straight to the app. While it covers the app the tap is its own,
  // click and all, so it cannot press something the student could not see (a phone sends the click
  // to whatever is under the finger by then). Once the app shows through, the tap goes on to what
  // it was meant for. Escape is used up, so it does not also close a screen that is open under the
  // intro (app-shell.tsx).
  useEffect(() => {
    if (phase !== "enter" && phase !== "fly") return;
    const covering = phase === "enter";
    const skip = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape")
        event.preventDefault();
      if (covering && event.type === "pointerdown") swallowNextClick();
      setPhase("leave");
    };
    window.addEventListener("keydown", skip, true);
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("wheel", skip, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("pointerdown", skip, true);
      window.removeEventListener("wheel", skip, true);
    };
  }, [phase]);

  // The flight: measured as it starts, so a banner that arrived meanwhile is allowed for. What has
  // nowhere to land (the name on a phone, whose header has only the orb) fades up and away at once,
  // before the screen behind shows through it.
  useLayoutEffect(() => {
    if (phase !== "fly") return;
    const fly = (box: HTMLDivElement | null, target: string) => {
      if (!box) return;
      const to = visible(target);
      if (to)
        box.style.transform = flight(
          box.getBoundingClientRect(),
          to.getBoundingClientRect(),
        );
      else box.dataset.stranded = "";
    };
    fly(orb.current, INTRO_ORB_TARGET);
    fly(name.current, INTRO_NAME_TARGET);
  }, [phase]);

  if (phase === "gone") return null;
  const bloom = palette(1, 0, colour).violet;
  return (
    <div
      aria-hidden
      className={cn(
        "startup-intro duet-face fixed inset-0 z-[100] select-none",
        // It takes a tap only while it covers the app, to skip; the app's own controls take the rest.
        phase === "enter" ? "pointer-events-auto" : "pointer-events-none",
      )}
      data-phase={phase}
      data-reduced={reduced ? "" : undefined}
      style={
        {
          "--intro-bloom": `rgb(${bloom[0]} ${bloom[1]} ${bloom[2]})`,
          "--intro-fly": `${INTRO_FLY_MS}ms`,
          "--intro-land": `${INTRO_LAND_MS}ms`,
          "--intro-skip": `${reduced ? INTRO_STILL_FADE_MS : INTRO_SKIP_MS}ms`,
          "--intro-flight-ease": FLIGHT_EASE,
        } as CSSProperties
      }
    >
      <div className="startup-intro-backdrop absolute inset-0 bg-duet-surface" />
      <div className="startup-intro-lockup relative flex h-full flex-col items-center justify-center gap-5 lg:flex-row lg:gap-7">
        <div className="startup-intro-flight" ref={orb}>
          <div className="startup-intro-orb relative grid">
            <span className="startup-intro-bloom" />
            <span className="startup-intro-ripple" />
            {/* It lands as it wakes, then calms on its way up, to match the orb it lands on. */}
            <MicOrb
              colour={colour}
              size={INTRO_ORB_PX}
              state={phase === "enter" ? "done" : "idle"}
            />
          </div>
        </div>
        <div className="startup-intro-flight" ref={name}>
          <p className="startup-intro-name whitespace-nowrap font-semibold text-[1.875rem] text-duet-ink leading-[2.25rem] tracking-[-0.018em] lg:text-[3.15rem] lg:leading-[3.85rem] lg:tracking-[-0.011em]">
            {appConfig.brand.productName}
          </p>
        </div>
      </div>
    </div>
  );
}
