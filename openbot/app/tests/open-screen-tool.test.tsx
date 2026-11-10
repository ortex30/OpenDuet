import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { ScreenCard, screenAddress } from "@/lib/copilot/open-screen-tool";
import { settleReactWork } from "./settle-react-work";

/**
 * The coach opens Tasks, the calendar and the rest beside the chat when the student asks, and the
 * call leaves a card in the conversation that opens the same screen again.
 */

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:3010" }));
afterEach(cleanup);
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

function draw(ui: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router as never} />);
}

test("each screen opens at its own address", () => {
  expect(screenAddress({ screen: "tasks" })).toEqual({
    to: "/tasks",
    search: {},
  });
  expect(screenAddress({ screen: "coach" })).toEqual({
    to: "/coach",
    search: {},
  });
  expect(screenAddress({ screen: "learn" })).toEqual({
    to: "/learn",
    search: {},
  });
  expect(screenAddress({ screen: "made" })).toEqual({
    to: "/make",
    search: {},
  });
  expect(screenAddress({ screen: "calendar" })).toEqual({
    to: "/calendar",
    search: {},
  });
});

test("the calendar opens on the day and view asked for, and drops a day it cannot read", () => {
  expect(
    screenAddress({ screen: "calendar", date: "2026-11-09", view: "week" }),
  ).toEqual({ to: "/calendar", search: { date: "2026-11-09", view: "week" } });
  expect(
    screenAddress({ screen: "calendar", date: "next tuesday", view: "day" }),
  ).toEqual({ to: "/calendar", search: {} });
  // A day and a view mean nothing to the other screens.
  expect(
    screenAddress({ screen: "tasks", date: "2026-11-09", view: "week" }),
  ).toEqual({ to: "/tasks", search: {} });
});

test("the card left in the chat names the screen and opens it again", async () => {
  const view = draw(
    <ScreenCard input={{ screen: "calendar", view: "week" }} />,
  );
  const card = await view.findByRole("link", { name: /Your calendar/ });
  expect(card.getAttribute("href")).toBe("/calendar?view=week");
  expect(card.textContent).toContain("Classes, practices and study time");
});

test("while the screen is opening, the card says so", async () => {
  const view = draw(<ScreenCard input={{ screen: "tasks" }} opening />);
  const card = await view.findByRole("link", { name: /Your tasks/ });
  expect(card.getAttribute("href")).toBe("/tasks");
  expect(card.textContent).toContain("Opening…");
});
