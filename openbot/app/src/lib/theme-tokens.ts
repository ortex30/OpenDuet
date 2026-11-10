/**
 * OpenDuet's colour tokens as data, for what cannot read the stylesheet: the interface a Bot writes
 * runs in a sandboxed frame with no access to `styles.css`, so the prompt that tells it how to look
 * (`lib/copilot/generative-ui.ts`) is built from these.
 *
 * The values are the stylesheet's own. `tests/visual-system.test.ts` reads `src/styles.css` and
 * fails when any value here differs from the `--duet-<name>` it stands for, so the two cannot drift.
 */
export type ThemeTokens = {
  surface: string;
  card: string;
  bubble: string;
  tile: string;
  ink: string;
  "ink-2": string;
  "ink-3": string;
  hair: string;
  accent: string;
  "accent-soft": string;
  "on-accent": string;
  "status-done": string;
  "status-needs": string;
  "status-working": string;
  "status-problem": string;
  black: string;
  "on-black": string;
};

export const LIGHT_TOKENS: ThemeTokens = {
  surface: "#f6f1e7",
  card: "#fffcf6",
  bubble: "#e9e0d2",
  tile: "#efe6d6",
  ink: "#1c1917",
  "ink-2": "#44403c",
  "ink-3": "#57534e",
  hair: "rgb(28 25 23 / 10%)",
  accent: "#9a3412",
  "accent-soft": "#fde8d4",
  "on-accent": "#ffffff",
  "status-done": "#146c34",
  "status-needs": "#9a3412",
  "status-working": "#1d4ed8",
  "status-problem": "#b91c1c",
  black: "#1c1917",
  "on-black": "#fffcf6",
};

export const DARK_TOKENS: ThemeTokens = {
  surface: "#1c1714",
  card: "#29221c",
  bubble: "#342c24",
  tile: "#342c24",
  ink: "#f7f3ec",
  "ink-2": "#d4cdc3",
  "ink-3": "#c4b8aa",
  hair: "rgb(255 255 255 / 10%)",
  accent: "#f6c48a",
  "accent-soft": "#3d2a1c",
  "on-accent": "#3b220c",
  "status-done": "#4ade80",
  "status-needs": "#fbbf24",
  "status-working": "#93c5fd",
  "status-problem": "#fca5a5",
  black: "#f7f3ec",
  "on-black": "#1c1714",
};

/** The type scale in px (parity-spec 2.3), the sizes the app's `type-*` utilities draw at 16px. */
export const TYPE_SCALE = {
  display: { size: 24, line: 28, weight: 600 },
  nav: { size: 18, line: 22, weight: 500 },
  body: { size: 17, line: 23, weight: 400 },
  sub: { size: 15, line: 20, weight: 400 },
  caption: { size: 13, line: 16, weight: 400 },
} as const;

/** The radii (parity-spec 2.4), in px. Pills, chips and buttons are fully round. */
export const RADII = { bubble: 20, card: 20, field: 22, tile: 10 } as const;

/** The declarations for one theme, as `--duet-<name>: <value>;` lines. */
export function tokenDeclarations(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .map(([name, value]) => `--duet-${name}: ${value};`)
    .join(" ");
}
