import { expect, test } from "bun:test";
import { friendlyCoachLine } from "@/lib/friendly-line";

test("a school-pack source line is the app's default, not a teacher rule", () => {
  expect(
    friendlyCoachLine("Calc BC is Hints only. Source: your school pack."),
  ).toBe("Calc BC is Hints only. That's the app's default.");
});

test("a source line in parentheses is rewritten too", () => {
  expect(friendlyCoachLine("Hints only (Source: the school pack).")).toBe(
    "Hints only. That's the app's default.",
  );
});
