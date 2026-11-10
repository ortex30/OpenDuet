/**
 * Turn note math into `$...$` so every screen can draw it.
 *
 * Notes and model replies sometimes leave a formula as `\int_a^b` or `int _a^b`.
 * A renderer that only knows dollar math then shows the underscores. Display
 * style inside a single-dollar formula is also flattened: a tall integral in
 * the middle of a multiple-choice line collides with the words beside it.
 */

const HELD = /\uE000(\d+)\uE000/g;

export function prepareReadableMath(text: string): string {
  const held: string[] = [];
  const hold = (chunk: string) => {
    held.push(chunk);
    return `\uE000${held.length - 1}\uE000`;
  };
  let value = text
    .replace(/\$\$[\s\S]+?\$\$/g, hold)
    .replace(/\\\[[\s\S]+?\\\]/g, hold)
    .replace(/\\\([\s\S]+?\\\)/g, hold)
    .replace(/\$[^$\n]+\$/g, hold);

  value = value.replace(
    /\\(?:displaystyle\s*)?(?:int|iint|oint|frac|dfrac|tfrac|sqrt|sum|prod|lim)(?:\{[^{}]*\}|\[[^\]]*\]|[_^]\{?[^{}\s]+\}?|\\[a-zA-Z]+|[A-Za-z0-9+\-=(),.|]|\\,|\s){1,160}/g,
    (tex) =>
      hold(
        `$${tex
          .replace(/\\displaystyle\s*/g, "")
          .replace(/\s+/g, " ")
          .trim()}$`,
      ),
  );
  value = value.replace(
    /\bint\s+_\{?([A-Za-z0-9]+)\}?\^\{?([A-Za-z0-9]+)\}?/gi,
    (_match, lower: string, upper: string) =>
      hold(`$\\int_{${lower}}^{${upper}}$`),
  );

  return value.replace(HELD, (_match, index: string) => {
    const chunk = held[Number(index)] ?? "";
    if (
      chunk.startsWith("$$") ||
      chunk.startsWith("\\[") ||
      chunk.startsWith("\\(")
    ) {
      return chunk;
    }
    if (chunk.startsWith("$") && chunk.endsWith("$")) {
      const inner = chunk
        .slice(1, -1)
        .replace(/\\displaystyle\s*/g, "")
        .trim();
      return `$${inner}$`;
    }
    return chunk;
  });
}
