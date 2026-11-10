import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MicOrb } from "@/components/duet/mic-orb";
import {
  drawMicOrb,
  type OrbColour,
  palette,
} from "@/components/duet/mic-orb-draw";
import { useAvatarColour } from "@/lib/avatar-preference";
import { appConfig } from "@/lib/generated/application-config";
import { useReducedMotionPreference } from "@/lib/reduced-motion";
import { cn } from "@/lib/utils";
import { INTRO_BEATS, introPose } from "./startup-intro-pose";
import type { ShellTab } from "./tab-bar";

/*
 * The app's hello, once a session: the coach's orb wakes up in the middle of the screen. Asleep at
 * first, it grows, opens its eyes and looks up at you, lands with a glow and a ping, and smiles,
 * while the product's name inks in under it letter by letter. Then both fly into the places they
 * live in the real app (the desktop bar's orb and name, or the phone header's orb) while the screen
 * behind them dissolves into Chat. About two seconds.
 *
 * It is decoration over an app that is already there and working: aria-hidden, never a dialog, and
 * it never takes focus. A tap or any key skips it. Asked for less motion, it is a short fade.
 * `/?intro=1` plays it again, for a demo.
 */

/** sessionStorage: set once it has played, so it plays once a tab, not on every page. */
export const INTRO_PLAYED_KEY = "academic-os:intro-played";

/** The orb in the middle: the desktop bar's 40px orb at 2.8×, so its flight is one scale. */
export const INTRO_ORB_PX = 112;
/** How long the orb wakes in the middle before it flies (`INTRO_BEATS.fly`). */
export const INTRO_ENTER_MS = Math.round(INTRO_BEATS.fly * 1000);
/** The flight into the header, while the screen behind dissolves. */
export const INTRO_FLY_MS = 440;
/** The orb in the header takes over, and the flown one fades off it. */
export const INTRO_LAND_MS = 120;
/** Skipped with a tap or a key: a quick fade. */
export const INTRO_SKIP_MS = 120;
/** Less motion: the orb and the name, still, for a moment, then a fade. */
export const INTRO_STILL_MS = 400;
export const INTRO_STILL_FADE_MS = 200;
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
/**
 * Only the page's first shell decides. One that did not play (Settings opened first, say) leaves
 * the session unmarked, so a later page load can still play it, but never this one.
 */
let decidedThisPage = false;

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

/** Wide enough that a screen opens beside the chat, so the chat and the bar stay in view. */
const wide = () => window.matchMedia?.("(min-width: 64rem)")?.matches === true;

/** `?intro=1`: play it again, whatever the session says. */
function forced(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("intro") === "1";
  } catch {
    return false;
  }
}

/**
 * Whether to play now: the tab is in front, where it can be seen; the page is the chat, or a
 * screen beside it on a wide screen (not Settings, and not a phone's screen covering the chat);
 * not a browser driven by a test; and not played this session.
 */
function shouldPlay(tab: ShellTab | null): boolean {
  if (typeof document === "undefined" || decidedThisPage) return false;
  if (document.visibilityState === "hidden") return false;
  if (tab === null || (tab !== "chat" && !wide())) return false;
  if (forced()) return true;
  if (navigator.webdriver) return false;
  return !playedThisSession();
}

/** Not on this page: onboarding has just ended on the orb's own finish, so one orb moment is enough. */
export function skipStartupIntro() {
  decidedThisPage = true;
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

/** For tests: forget that it played, or was decided, on this page. */
export function resetStartupIntroForTests() {
  playedOnThisPage = false;
  decidedThisPage = false;
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

/**
 * The waking orb: the header orb's own drawing (`drawMicOrb`) on the same canvas geometry as
 * `MicOrb`, posed by `introPose` frame by frame. Its time counts from its first frame, so it keeps
 * step with the CSS around it, and its own clock from the shell's first render, as the header orb's
 * does, so the two match when one lands on the other.
 */
function IntroOrb({
  colour,
  mountedAt,
}: {
  colour: OrbColour;
  mountedAt: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Kept across a re-run (a colour change, StrictMode), so the wake does not start over.
  const first = useRef<number | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const box = INTRO_ORB_PX * 2;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(box * dpr);
    canvas.height = Math.round(box * dpr);
    let frame = requestAnimationFrame(function paint(now) {
      first.current ??= now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, box, box);
      ctx.translate(box / 2, box / 2);
      drawMicOrb(
        ctx,
        INTRO_ORB_PX,
        introPose((now - first.current) / 1000, (now - mountedAt) / 1000),
        { dark: canvas.closest(".dark") !== null, colour },
      );
      frame = requestAnimationFrame(paint);
    });
    return () => cancelAnimationFrame(frame);
  }, [colour, mountedAt]);
  return (
    <span
      aria-hidden
      className="pointer-events-none relative inline-block shrink-0"
      data-intro-orb=""
      style={{ width: INTRO_ORB_PX, height: INTRO_ORB_PX }}
    >
      <canvas
        className="absolute"
        ref={ref}
        style={{
          left: -INTRO_ORB_PX / 2,
          top: -INTRO_ORB_PX / 2,
          width: INTRO_ORB_PX * 2,
          height: INTRO_ORB_PX * 2,
        }}
      />
    </span>
  );
}

export function StartupIntro({ tab }: { tab: ShellTab | null }) {
  const [phase, setPhase] = useState<Phase>(() =>
    shouldPlay(tab) ? "enter" : "gone",
  );
  const reduced = useReducedMotionPreference();
  const colour = useAvatarColour();
  const mountedAt = useRef(performance.now()).current;
  const orb = useRef<HTMLDivElement>(null);
  const name = useRef<HTMLDivElement>(null);
  const playing = phase !== "gone";

  // The page's first shell has decided, whether or not it plays. An effect rather than the state's
  // initializer, so StrictMode's second render gets the same answer as the first.
  useEffect(() => {
    decidedThisPage = true;
  }, []);

  // Played is kept the moment it starts, so a shell that remounts under it does not play it again.
  useEffect(() => {
    if (playing) markPlayed();
  }, [playing]);

  // Asked for less motion while it plays: straight to the end.
  const startedReduced = useRef(reduced);
  useEffect(() => {
    if (
      reduced &&
      !startedReduced.current &&
      (phase === "enter" || phase === "fly")
    )
      setPhase("leave");
  }, [reduced, phase]);

  // The header's own orb and name hide while it plays, until the flown ones land on them.
  const hiding = phase === "enter" || phase === "fly";
  useLayoutEffect(() => {
    if (!hiding) return;
    document.documentElement.setAttribute(PLAYING, "");
    return () => document.documentElement.removeAttribute(PLAYING);
  }, [hiding]);

  // Each phase ends on a timer, so nothing waits on an animation that a hidden tab or a test never
  // runs, and it is always gone within two seconds; within three, whatever happens.
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
  const { blue, violet } = palette(1, 0, colour);
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
          "--intro-blue": `rgb(${blue[0]} ${blue[1]} ${blue[2]})`,
          "--intro-violet": `rgb(${violet[0]} ${violet[1]} ${violet[2]})`,
          "--intro-fly": `${INTRO_FLY_MS}ms`,
          "--intro-land": `${INTRO_LAND_MS}ms`,
          "--intro-skip": `${reduced ? INTRO_STILL_FADE_MS : INTRO_SKIP_MS}ms`,
          "--intro-flight-ease": FLIGHT_EASE,
        } as CSSProperties
      }
    >
      <div className="startup-intro-backdrop absolute inset-0 bg-duet-surface" />
      {/* A column at every width: each piece flies to its own place, so the layout here is free. */}
      <div className="startup-intro-lockup relative flex h-full flex-col items-center justify-center gap-5 lg:gap-6">
        <div className="startup-intro-flight" ref={orb}>
          <div className="startup-intro-orb relative grid">
            <span className="startup-intro-bloom" />
            <span className="startup-intro-ripple" />
            {reduced ? (
              <MicOrb colour={colour} size={INTRO_ORB_PX} still />
            ) : (
              <IntroOrb colour={colour} mountedAt={mountedAt} />
            )}
          </div>
        </div>
        <div className="startup-intro-flight" ref={name}>
          {/* At lg, 2.8 times the bar's name (type-nav), as the orb is 2.8 times the bar's orb. */}
          <p className="startup-intro-name whitespace-nowrap font-semibold text-[1.875rem] text-duet-ink leading-[2.25rem] tracking-[-0.018em] lg:text-[3.15rem] lg:leading-[3.85rem] lg:tracking-[-0.011em]">
            {Array.from(appConfig.brand.productName).map((letter, i) => (
              <span
                className="startup-intro-letter"
                // The letters never move or change: the index is the letter's place in the name.
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed string's letters, in order.
                key={i}
                style={{ "--i": i } as CSSProperties}
              >
                {letter}
              </span>
            ))}
          </p>
        </div>
      </div>
    </div>
  );
}
