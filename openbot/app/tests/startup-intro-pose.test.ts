import { describe, expect, test } from "bun:test";
import { drawMicOrb, type OrbPose } from "@/components/duet/mic-orb-draw";
import { INTRO_ENTER_MS } from "@/components/shell/startup-intro";
import { INTRO_BEATS, introPose } from "@/components/shell/startup-intro-pose";

/**
 * The startup intro's orb waking up, moment by moment: asleep, then its eyes open and it looks up
 * at you, it lands with a glow, smiles, blinks once, and by the time it reaches the header it is
 * the resting orb that lives there.
 */

/** Just enough of a 2D context to run the drawing and count its strokes (as in mic-orb.test). */
function fakeContext() {
  const gradient = { addColorStop: () => {} };
  const ctx = {
    strokes: 0,
    stroke() {
      this.strokes++;
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  return new Proxy(ctx, {
    get: (target, key) =>
      key in target ? target[key as keyof typeof target] : () => {},
    set: (target, key, value) => {
      (target as Record<string | symbol, unknown>)[key] = value;
      return true;
    },
  });
}

const strokesOf = (pose: OrbPose, dark = false) => {
  const ctx = fakeContext();
  drawMicOrb(ctx as unknown as CanvasRenderingContext2D, 112, pose, { dark });
  return ctx.strokes;
};

/** The header's orb at rest, as MicOrb poses it when idle. */
const REST: OrbPose = {
  ta: 1.6,
  listen: 0,
  think: 0,
  done: 0,
  smile: 0,
  tilt: 0,
  ax: 0,
  ay: 0.04,
  blink: 0,
  nod: 0,
  key: 0,
  doneAge: -1,
  noticeAge: -1,
  finishAge: -1,
  breath: 0,
};

describe("the waking orb", () => {
  test("starts asleep: eyes shut, head bowed and rolled, no glow", () => {
    const pose = introPose(0.2, 0.2);
    expect(pose.blink).toBe(1);
    expect(pose.ay).toBeCloseTo(0.45, 5);
    expect(pose.tilt).toBeCloseTo(0.22, 5);
    expect(pose.done).toBe(0);
    expect(pose.smile).toBe(0);
    expect(pose.doneAge).toBe(-1);
  });

  test("opens its eyes and looks up at you", () => {
    const pose = introPose(0.8, 0.8);
    expect(pose.blink).toBe(0);
    expect(pose.ay).toBeLessThan(0.2);
  });

  test("lands with a glow and its ping, then smiles", () => {
    const landed = introPose(0.9, 0.9);
    expect(landed.done).toBeGreaterThan(0.5);
    expect(landed.doneAge).toBeCloseTo(0.18, 5);
    expect(introPose(1.3, 1.3).smile).toBeCloseTo(1, 2);
  });

  test("blinks once, quickly", () => {
    expect(introPose(0.93, 0.93).blink).toBeGreaterThan(0.9);
    expect(introPose(1.12, 1.12).blink).toBe(0);
  });

  test("arrives in the header as the resting orb that lives there", () => {
    const t = INTRO_BEATS.fly + 0.46;
    const pose = introPose(t, t);
    expect(pose.done).toBeLessThan(0.03);
    expect(pose.smile).toBeLessThan(0.03);
    expect(Math.abs(pose.ay - REST.ay)).toBeLessThan(0.01);
    expect(Math.abs(pose.tilt)).toBeLessThan(0.01);
    expect(pose.blink).toBe(0);
    expect(pose.finishAge).toBe(-1);
  });

  test("its beats come in order, and the intro holds until the last", () => {
    const B = INTRO_BEATS;
    expect(B.wake).toBeLessThan(B.open);
    expect(B.open).toBeLessThan(B.land);
    expect(B.land).toBeLessThan(B.smile);
    expect(B.smile).toBeLessThanOrEqual(B.name);
    expect(B.name).toBeLessThan(B.blink);
    expect(B.blink).toBeLessThan(B.fly);
    expect(INTRO_ENTER_MS).toBe(B.fly * 1000);
  });

  test("draws every moment, light and dark, and asleep it is the resting orb's drawing", () => {
    for (let i = 0; i <= 40; i++) {
      const t = i * 0.05;
      expect(() => strokesOf(introPose(t, t))).not.toThrow();
      expect(() => strokesOf(introPose(t, t), true)).not.toThrow();
    }
    expect(strokesOf(introPose(0.2, 0.2))).toBe(strokesOf(REST));
  });
});
