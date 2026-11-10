/**
 * A help-level answer used to end with "Source: your school pack."
 * That source is the app's default unless the sentence already names a teacher rule.
 */
const SOURCE_LINE =
  /\s*(?:[([]\s*)?source:\s*(?:your|the)\s+school pack\.?\s*(?:[)\]]\s*\.?)?/gi;

export function friendlyCoachLine(text: string): string {
  const next = text.replace(
    SOURCE_LINE,
    (_match, offset: number, whole: string) => {
      const before = whole.slice(0, offset).trimEnd();
      if (/teacher set it|teacher rules screen/i.test(before)) return "";
      const lead = before.length === 0 || before.endsWith(".") ? " " : ". ";
      return `${lead}That's the app's default.`;
    },
  );
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\.\.+/g, ".")
    .replace(/^\s+/, "")
    .trim();
}
