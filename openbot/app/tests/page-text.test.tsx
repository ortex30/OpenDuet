import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { PageText } from "@/components/duet/page-text";

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:3010" }));
afterEach(() => cleanup());
afterAll(() => GlobalRegistrator.unregister());

test("math is drawn and a plain sentence stays readable", () => {
  const view = render(
    <PageText text={"The integral $\\int_a^b f(x)\\,dx$ is the net change."} />,
  );
  expect(view.container.querySelector(".katex")).toBeTruthy();
  expect(view.container.textContent).toContain("The integral");
  expect(view.container.textContent).toContain("is the net change.");
  expect(view.container.textContent).not.toContain("int _a^b");
});

test("a link stays a link", () => {
  const view = render(
    <PageText text="See https://example.com/notes for the map." />,
  );
  const link = view.getByRole("link", { name: "https://example.com/notes" });
  expect(link.getAttribute("href")).toBe("https://example.com/notes");
});
