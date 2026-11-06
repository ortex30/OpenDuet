import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, render } from "@testing-library/react";
import {
  INTRO_ENTER_MS,
  INTRO_FLY_MS,
  INTRO_LAND_MS,
  INTRO_LIMIT_MS,
  INTRO_NAME_TARGET,
  INTRO_ORB_TARGET,
  INTRO_PLAYED_KEY,
  INTRO_SKIP_MS,
  INTRO_STILL_FADE_MS,
  INTRO_STILL_MS,
  resetStartupIntroForTests,
  StartupIntro,
  skipStartupIntro,
} from "@/components/shell/startup-intro";
import { appConfig } from "@/lib/generated/application-config";
import { settleReactWork } from "./settle-react-work";

/**
 * The app's hello: the coach's orb wakes up in the middle, the name inks in, and both fly into the
 * header while the screen behind dissolves into Chat. Once a tab, never in the way: decoration over
 * an app that is already there, skipped by a tap or a key, and a plain fade for less motion.
 */

let originalMatchMedia: typeof window.matchMedia;
beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost:3010" });
  originalMatchMedia = window.matchMedia;
});
beforeEach(() => {
  jest.useFakeTimers();
  sessionStorage.clear();
  resetStartupIntroForTests();
  // happy-dom says it is a driven browser, as Playwright's do; the person's browser is not.
  driven(false);
});
afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  try {
    await settleReactWork();
  } finally {
    window.matchMedia = originalMatchMedia;
    Reflect.deleteProperty(document, "visibilityState");
    Reflect.deleteProperty(navigator, "webdriver");
    history.replaceState(null, "", "/");
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-startup-intro");
  }
});
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

const intro = () => document.querySelector<HTMLElement>(".startup-intro");
const phase = () => intro()?.dataset.phase;
const headerHidden = () =>
  document.documentElement.hasAttribute("data-startup-intro");
const wait = (ms: number) => act(() => jest.advanceTimersByTime(ms));

/**
 * The person's screen, as media queries see it: whether they asked their system for less motion
 * (which can change while the page is open), and whether it is a wide screen (64rem and up).
 */
function screen({ reduce = false, wide = false }) {
  const changed = new Set<() => void>();
  const state = { reduce, wide };
  window.matchMedia = ((query: string) => ({
    get matches() {
      if (query.includes("prefers-reduced-motion")) return state.reduce;
      if (query.includes("min-width")) return state.wide;
      return false;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: () => void) =>
      changed.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      changed.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return {
    /** Ask for less motion now, as a system setting changed while the page is open would. */
    reduceMotion() {
      state.reduce = true;
      act(() => {
        for (const listener of changed) listener();
      });
    },
  };
}

/** Ask for less motion, or not, as the person's system would. */
const reducedMotion = (reduce: boolean) => screen({ reduce });

/** Driven by a test harness or an eval, as Playwright drives a browser. */
function driven(yes = true) {
  Object.defineProperty(navigator, "webdriver", {
    configurable: true,
    get: () => yes,
  });
}

/** Lays an element out at a box, since happy-dom lays nothing out. */
function placeAt(
  element: Element,
  box: { left: number; top: number; width: number; height: number },
) {
  element.getBoundingClientRect = () =>
    DOMRect.fromRect({
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
    });
}

/** The header's orb and name, as the shell draws them: one header on screen and one hidden. */
function header({ name }: { name: boolean }) {
  const hidden = document.createElement("span");
  hidden.className = INTRO_ORB_TARGET;
  const orb = document.createElement("span");
  orb.className = INTRO_ORB_TARGET;
  placeAt(orb, { left: 20, top: 12, width: 40, height: 40 });
  document.body.append(hidden, orb);
  if (name) {
    const label = document.createElement("span");
    label.className = INTRO_NAME_TARGET;
    placeAt(label, { left: 70, top: 21, width: 100, height: 22 });
    document.body.append(label);
  }
}

describe("the startup intro", () => {
  test("plays through to the app once, and not again in the same tab", () => {
    const first = render(<StartupIntro tab="chat" />);
    expect(phase()).toBe("enter");
    expect(headerHidden()).toBe(true);
    expect(sessionStorage.getItem(INTRO_PLAYED_KEY)).toBe("1");

    wait(INTRO_ENTER_MS);
    expect(phase()).toBe("fly");
    expect(headerHidden()).toBe(true);

    wait(INTRO_FLY_MS);
    // The header's own orb and name take over as the flown ones fade off them.
    expect(phase()).toBe("land");
    expect(headerHidden()).toBe(false);

    wait(INTRO_LAND_MS);
    expect(intro()).toBeNull();

    // The shell remounts between Chat and Settings; that is not a new start.
    first.unmount();
    render(<StartupIntro tab="chat" />);
    expect(intro()).toBeNull();
    expect(headerHidden()).toBe(false);
  });

  test("is decoration: hidden from assistive tech, never a dialog, never takes focus", () => {
    const before = document.activeElement;
    render(<StartupIntro tab="chat" />);
    const overlay = intro();
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(
      overlay?.querySelector("a, button, input, textarea, [tabindex]"),
    ).toBeNull();
    expect(document.activeElement).toBe(before);
    // It takes a tap only while it covers the app, to skip; after that the app has the pointer.
    expect(overlay?.className).toContain("pointer-events-auto");
    wait(INTRO_ENTER_MS);
    expect(intro()?.className).toContain("pointer-events-none");
  });

  test("a key skips it straight to the app", () => {
    render(<StartupIntro tab="chat" />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(phase()).toBe("leave");
    expect(headerHidden()).toBe(false);
    wait(INTRO_SKIP_MS);
    expect(intro()).toBeNull();
  });

  test("a tap skips it too", () => {
    render(<StartupIntro tab="chat" />);
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(phase()).toBe("leave");
    wait(INTRO_SKIP_MS);
    expect(intro()).toBeNull();
  });

  test("the click of a tap that skips it presses nothing hidden under it", () => {
    const start = document.createElement("button");
    let pressed = 0;
    start.addEventListener("click", () => {
      pressed += 1;
    });
    document.body.append(start);
    render(<StartupIntro tab="chat" />);
    act(() => {
      start.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    act(() => {
      start.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(pressed).toBe(0);
    // Only that one click: the next is the student's.
    act(() => {
      start.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(pressed).toBe(1);
  });

  test("a tap while it flies ends it at once, and the tap still reaches the app", () => {
    render(<StartupIntro tab="chat" />);
    wait(INTRO_ENTER_MS);
    expect(phase()).toBe("fly");
    const tap = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(tap);
    });
    expect(tap.defaultPrevented).toBe(false);
    expect(phase()).toBe("leave");
    expect(headerHidden()).toBe(false);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
  });

  test("scrolling skips it", () => {
    render(<StartupIntro tab="chat" />);
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: 40 }));
    });
    expect(phase()).toBe("leave");
  });

  test("an Escape that skips it does not also close a screen under it", () => {
    render(<StartupIntro tab="chat" />);
    const escapeKey = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(escapeKey);
    });
    // The shell closes a screen on Escape only when nothing used it first (app-shell.tsx).
    expect(escapeKey.defaultPrevented).toBe(true);
    expect(phase()).toBe("leave");
  });

  test("flies the orb and the name onto the header's, the one on screen", () => {
    header({ name: true });
    render(<StartupIntro tab="chat" />);
    const [orbBox, nameBox] = document.querySelectorAll<HTMLElement>(
      ".startup-intro-flight",
    );
    if (!orbBox || !nameBox)
      throw new Error("the intro draws its orb and name");
    placeAt(orbBox, { left: 500, top: 344, width: 112, height: 112 });
    placeAt(nameBox, { left: 640, top: 369.2, width: 280, height: 61.6 });

    wait(INTRO_ENTER_MS);
    // Left middles meet, at the header's size: 40 / 112 and 22 / 61.6 are both 1 / 2.8.
    expect(orbBox.style.transform).toBe(
      `translate(-480px, -368px) scale(${40 / 112})`,
    );
    expect(nameBox.style.transform).toBe(
      `translate(-570px, -368px) scale(${22 / 61.6})`,
    );
    expect(nameBox.hasAttribute("data-stranded")).toBe(false);
  });

  test("on a phone the name has nowhere to land, so it fades up and away while the orb flies", () => {
    header({ name: false });
    render(<StartupIntro tab="chat" />);
    const [orbBox, nameBox] = document.querySelectorAll<HTMLElement>(
      ".startup-intro-flight",
    );
    if (!orbBox || !nameBox)
      throw new Error("the intro draws its orb and name");
    placeAt(orbBox, { left: 139, top: 300, width: 112, height: 112 });

    wait(INTRO_ENTER_MS);
    expect(orbBox.style.transform).toContain("translate(");
    expect(nameBox.style.transform).toBe("");
    expect(nameBox.hasAttribute("data-stranded")).toBe(true);
  });

  test("an orb under an open screen is no place to land, so it fades where it is", () => {
    header({ name: false });
    const screen = document.createElement("aside");
    document.body.append(screen);
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => screen;
    try {
      render(<StartupIntro tab="chat" />);
      const [orbBox] = document.querySelectorAll<HTMLElement>(
        ".startup-intro-flight",
      );
      wait(INTRO_ENTER_MS);
      expect(orbBox?.style.transform).toBe("");
      expect(orbBox?.hasAttribute("data-stranded")).toBe(true);
    } finally {
      document.elementFromPoint = elementFromPoint;
    }
  });

  test("the orb that wakes is drawn frame by frame; with less motion it is the resting orb, still", () => {
    render(<StartupIntro tab="chat" />);
    expect(intro()?.querySelector("[data-intro-orb] canvas")).not.toBeNull();
    // Nothing in it reads as the coach's presence, which the app finds by `data-state`.
    expect(intro()?.querySelector("[data-state]")).toBeNull();
    cleanup();

    resetStartupIntroForTests();
    sessionStorage.clear();
    reducedMotion(true);
    render(<StartupIntro tab="chat" />);
    expect(intro()?.querySelector("[data-intro-orb]")).toBeNull();
    expect(
      intro()?.querySelector("[data-state]")?.getAttribute("data-state"),
    ).toBe("idle");
  });

  test("the name inks in letter by letter, and still reads as the name", () => {
    render(<StartupIntro tab="chat" />);
    const name = intro()?.querySelector(".startup-intro-name");
    const letters = [
      ...(intro()?.querySelectorAll<HTMLElement>(".startup-intro-letter") ??
        []),
    ];
    expect(name?.textContent).toBe(appConfig.brand.productName);
    expect(letters).toHaveLength(
      Array.from(appConfig.brand.productName).length,
    );
    letters.forEach((letter, i) => {
      expect(letter.style.getPropertyValue("--i")).toBe(String(i));
    });
  });

  test("it is short: through to the app in under two seconds, and never past the limit", () => {
    expect(INTRO_ENTER_MS + INTRO_FLY_MS + INTRO_LAND_MS).toBe(1960);
    expect(INTRO_ENTER_MS + INTRO_FLY_MS + INTRO_LAND_MS).toBeGreaterThan(1200);
    expect(INTRO_ENTER_MS + INTRO_FLY_MS + INTRO_LAND_MS).toBeLessThan(2200);
    render(<StartupIntro tab="chat" />);
    wait(INTRO_LIMIT_MS);
    expect(intro()).toBeNull();
  });

  test("with less motion it is a still moment and a fade, with no flight", () => {
    expect(INTRO_STILL_MS).toBe(400);
    expect(INTRO_STILL_FADE_MS).toBe(200);
    reducedMotion(true);
    header({ name: true });
    render(<StartupIntro tab="chat" />);
    expect(intro()?.hasAttribute("data-reduced")).toBe(true);

    wait(INTRO_STILL_MS);
    expect(phase()).toBe("leave");
    expect(headerHidden()).toBe(false);
    for (const box of document.querySelectorAll<HTMLElement>(
      ".startup-intro-flight",
    ))
      expect(box.style.transform).toBe("");

    wait(INTRO_STILL_FADE_MS);
    expect(intro()).toBeNull();
  });

  test("a tab opened in the background does not play it", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    render(<StartupIntro tab="chat" />);
    expect(intro()).toBeNull();
    expect(headerHidden()).toBe(false);
  });

  test("a browser that keeps no session storage still plays it once a page", () => {
    const storage = Object.getPrototypeOf(sessionStorage) as Storage;
    const { getItem, setItem } = storage;
    storage.getItem = () => {
      throw new Error("blocked");
    };
    storage.setItem = () => {
      throw new Error("blocked");
    };
    try {
      const first = render(<StartupIntro tab="chat" />);
      expect(phase()).toBe("enter");
      first.unmount();
      render(<StartupIntro tab="chat" />);
      expect(intro()).toBeNull();
    } finally {
      storage.getItem = getItem;
      storage.setItem = setItem;
    }
  });

  test("asked for less motion while it plays, it ends there", () => {
    const person = screen({});
    render(<StartupIntro tab="chat" />);
    wait(200);
    expect(phase()).toBe("enter");
    person.reduceMotion();
    expect(phase()).toBe("leave");
    expect(headerHidden()).toBe(false);
    wait(INTRO_STILL_FADE_MS);
    expect(intro()).toBeNull();
  });

  test("a first page that is not the chat (Settings, say) does not play it, and does not use it up", () => {
    const settings = render(<StartupIntro tab={null} />);
    expect(intro()).toBeNull();
    // The shell remounts for Chat on the same page: still not this page.
    settings.unmount();
    render(<StartupIntro tab="chat" />);
    expect(intro()).toBeNull();
    // A later page load can still play it.
    expect(sessionStorage.getItem(INTRO_PLAYED_KEY)).toBeNull();
  });

  test("a screen opened first plays it on a wide screen, beside the chat, but not over it on a phone", () => {
    screen({ wide: false });
    render(<StartupIntro tab="calendar" />);
    expect(intro()).toBeNull();
    cleanup();

    resetStartupIntroForTests();
    screen({ wide: true });
    render(<StartupIntro tab="calendar" />);
    expect(phase()).toBe("enter");
  });

  test("?intro=1 plays it again, even after it played, and even in a driven browser", () => {
    sessionStorage.setItem(INTRO_PLAYED_KEY, "1");
    driven();
    history.replaceState(null, "", "/?intro=1");
    render(<StartupIntro tab="chat" />);
    expect(phase()).toBe("enter");
  });

  test("a browser driven by a test does not play it", () => {
    driven();
    render(<StartupIntro tab="chat" />);
    expect(intro()).toBeNull();
    expect(headerHidden()).toBe(false);
  });

  test("onboarding's own ending stands in for it on that page", () => {
    skipStartupIntro();
    render(<StartupIntro tab="chat" />);
    expect(intro()).toBeNull();
    expect(sessionStorage.getItem(INTRO_PLAYED_KEY)).toBeNull();
  });

  test("leaving while it plays gives the header its orb back", () => {
    const view = render(<StartupIntro tab="chat" />);
    expect(headerHidden()).toBe(true);
    view.unmount();
    expect(headerHidden()).toBe(false);
  });
});
