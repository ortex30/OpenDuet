const COLORS = ["#9a3412", "#f5a524", "#146c34", "#1d4ed8", "#be123c"];

/** A short burst when a block is finished or a quiz comes back clean. */
export function ConfettiBurst() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-visible"
    >
      {COLORS.map((color, index) => (
        <span
          className="coach-confetti absolute top-1/2 left-6 size-1.5 rounded-[2px]"
          key={color}
          style={{
            background: color,
            ["--dx" as string]: `${Math.cos((index / COLORS.length) * Math.PI * 2) * 36}px`,
            ["--dy" as string]: `${Math.sin((index / COLORS.length) * Math.PI * 2) * 28}px`,
          }}
        />
      ))}
    </span>
  );
}

const CHEERS = [
  "That's one down.",
  "Nice. Keep the lamp on.",
  "Checked off.",
  "You showed up for that one.",
];

/** A steady line for a finished block, from the id so it does not jump around. */
export function cheerFor(id: string): string {
  let n = 0;
  for (const ch of id) n = (n + ch.charCodeAt(0)) % CHEERS.length;
  return CHEERS[n] ?? "That's one down.";
}
