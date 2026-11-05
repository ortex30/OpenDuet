import { useSyncExternalStore } from "react";
import type { OrbColour } from "@/components/duet/mic-orb-draw";
import { ORB_COLOURS } from "@/components/duet/mic-orb-draw";

/*
 * The colour the student picked for their coach's orb, kept in this browser. It is a look, not a
 * fact about the account, so it lives in localStorage like the theme does.
 */
const KEY = "academic-os:avatar";
const DEFAULT: OrbColour = "ocean";
const listeners = new Set<() => void>();

export const ORB_COLOUR_LABEL: Record<OrbColour, string> = {
  ocean: "Ocean",
  ember: "Ember",
  lime: "Lime",
  graphite: "Graphite",
  berry: "Berry",
  sunset: "Sunset",
  mint: "Mint",
  gold: "Gold",
};

function isColour(value: unknown): value is OrbColour {
  return typeof value === "string" && (ORB_COLOURS as string[]).includes(value);
}

export function readAvatarColour(): OrbColour {
  try {
    const stored = localStorage.getItem(KEY);
    return isColour(stored) ? stored : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setAvatarColour(colour: OrbColour) {
  try {
    localStorage.setItem(KEY, colour);
  } catch {
    // A private window keeps nothing; the choice still applies until the tab closes.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The chosen colour, live across tabs. */
export function useAvatarColour(): OrbColour {
  return useSyncExternalStore(subscribe, readAvatarColour, () => DEFAULT);
}
