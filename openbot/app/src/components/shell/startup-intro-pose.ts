import {
  blinkCurve,
  clamp,
  nodCurve,
  type OrbPose,
  type Track,
  track,
} from "@/components/duet/mic-orb-draw";

/*
 * The startup intro's orb, frame by frame: it wakes up. Asleep at first (eyes shut, head bowed and
 * rolled), it opens its eyes and looks up at you, lands with its own glow and ping, smiles, nods,
 * blinks once, and by the time it reaches the header it is the resting orb that lives there.
 *
 * Pure, so a test can read any moment of it; `IntroOrb` (startup-intro.tsx) only draws it.
 */

/** When each thing happens, in seconds from the intro's first frame. */
export const INTRO_BEATS = {
  wake: 0.26,
  open: 0.58,
  land: 0.72,
  smile: 0.8,
  name: 0.82,
  blink: 0.86,
  fly: 1.4,
} as const;

const B = INTRO_BEATS;
const EYES: Track = { from: 1, keys: [{ at: B.open, to: 0, ease: 0.16 }] };
const LOOK_Y: Track = {
  from: 0.45,
  keys: [{ at: B.open, to: 0.04, spring: [12, 0.8] }],
};
const TILT: Track = {
  from: 0.22,
  keys: [{ at: B.open, to: 0, spring: [10, 0.7] }],
};
const GLOW: Track = {
  from: 0,
  keys: [
    { at: B.land, to: 1, spring: [11, 0.42] },
    { at: B.fly, to: 0, ease: 0.45 },
  ],
};
const SMILE: Track = {
  from: 0,
  keys: [
    { at: B.smile, to: 1, ease: 0.4 },
    { at: B.fly, to: 0, ease: 0.45 },
  ],
};

/**
 * The orb `t` seconds into the intro. `ta` is its own clock, which drifts the colours and breathes:
 * counted from the shell's first render, as the header's orb counts it, so the two agree when the
 * flown one lands on it.
 */
export function introPose(t: number, ta: number): OrbPose {
  return {
    ta,
    listen: 0,
    think: 0,
    key: 0,
    ax: 0,
    ay: track(LOOK_Y, t),
    tilt: track(TILT, t),
    blink: Math.max(track(EYES, t), blinkCurve(t - B.blink)),
    done: Math.max(0, track(GLOW, t)),
    doneAge: t >= B.land ? t - B.land : -1,
    smile: clamp(track(SMILE, t)),
    nod: nodCurve(t - (B.land + 0.1)),
    noticeAge: -1,
    finishAge: -1,
    breath: Math.sin((2 * Math.PI * ta) / 5.5),
  };
}
