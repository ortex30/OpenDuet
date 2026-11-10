/**
 * A help-level answer used to end with "Source: your school pack."
 * The student should hear it as the teacher's rule.
 */
const SOURCE_LINE =
  /\s*(?:[([]\s*)?source:\s*(?:your|the)\s+school pack\.?\s*(?:[)\]]\s*\.?)?/gi;

export function friendlyCoachLine(text: string): string {
  const next = text.replace(
    SOURCE_LINE,
    (_match, offset: number, whole: string) => {
      const before = whole.slice(0, offset).trimEnd();
      const lead = before.length === 0 || before.endsWith(".") ? " " : ". ";
      return `${lead}That's how your teacher set it.`;
    },
  );
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\.\.+/g, ".")
    .replace(/^\s+/, "")
    .trim();
}
