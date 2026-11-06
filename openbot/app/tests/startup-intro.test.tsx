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
} from "@/components/shell/startup-intro";
import { settleReactWork } from "./settle-react-work";

/**
 * The app's hello: the coach's orb wakes in the middle, the name writes in, and both fly into the
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
});
afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  try {
    await settleReactWork();
  } finally {
    window.matchMedia = originalMatchMedia;
    Reflect.deleteProperty(document, "visibilityState");
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

/** Ask for less motion, or not, as the person's system would. */
function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
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
    const first = render(<StartupIntro />);
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
    render(<StartupIntro />);
    expect(intro()).toBeNull();
    expect(headerHidden()).toBe(false);
  });

  test("is decoration: hidden from assistive tech, never a dialog, never takes focus", () => {
    const before = document.activeElement;
    render(<StartupIntro />);
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
    render(<StartupIntro />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(phase()).toBe("leave");
    expect(headerHidden()).toBe(false);
    wait(INTRO_SKIP_MS);
    expect(intro()).toBeNull();
  });

  test("a tap skips it too", () => {
    render(<StartupIntro />);
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
    render(<StartupIntro />);
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
    render(<StartupIntro />);
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
    render(<StartupIntro />);
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { deltaY: 40 }));
    });
    expect(phase()).toBe("leave");
  });

  test("an Escape that skips it does not also close a screen under it", () => {
    render(<StartupIntro />);
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
    render(<StartupIntro />);
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
    render(<StartupIntro />);
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
      render(<StartupIntro />);
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

  test("the orb lands as it wakes, then calms on its way up to match the header's", () => {
    render(<StartupIntro />);
    const orbState = () =>
      intro()?.querySelector("[data-state]")?.getAttribute("data-state");
    expect(orbState()).toBe("done");
    wait(INTRO_ENTER_MS);
    expect(orbState()).toBe("idle");
  });

  test("it is short: through to the app in about two seconds, and never past the limit", () => {
    expect(INTRO_ENTER_MS + INTRO_FLY_MS + INTRO_LAND_MS).toBeGreaterThan(1200);
    expect(INTRO_ENTER_MS + INTRO_FLY_MS + INTRO_LAND_MS).toBeLessThan(2200);
    render(<StartupIntro />);
    wait(INTRO_LIMIT_MS);
    expect(intro()).toBeNull();
  });

  test("with less motion it is a still moment and a fade, with no flight", () => {
    reducedMotion(true);
    header({ name: true });
    render(<StartupIntro />);
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
    render(<StartupIntro />);
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
      const first = render(<StartupIntro />);
      expect(phase()).toBe("enter");
      first.unmount();
      render(<StartupIntro />);
      expect(intro()).toBeNull();
    } finally {
      storage.getItem = getItem;
      storage.setItem = setItem;
    }
  });

  test("leaving while it plays gives the header its orb back", () => {
    const view = render(<StartupIntro />);
    expect(headerHidden()).toBe(true);
    view.unmount();
    expect(headerHidden()).toBe(false);
  });
});
