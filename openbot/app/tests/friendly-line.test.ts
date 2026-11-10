import { expect, test } from "bun:test";
import { friendlyCoachLine } from "@/lib/friendly-line";

test("a school-pack source line becomes the teacher's rule", () => {
  expect(
    friendlyCoachLine("Calc BC is Hints only. Source: your school pack."),
  ).toBe("Calc BC is Hints only. That's how your teacher set it.");
});

test("a source line in parentheses is rewritten too", () => {
  expect(friendlyCoachLine("Hints only (Source: the school pack).")).toBe(
    "Hints only. That's how your teacher set it.",
  );
});
