import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { type AuthenticatedUser, authKeys } from "@/lib/auth/queries";
import { settingsKeys } from "@/lib/settings/queries";
import { Route as SettingsRoute } from "@/routes/_authed/settings/index";
import { settleReactWork } from "./settle-react-work";

/**
 * Settings as a student meets it: the coach, what the coach knows about them, how the app looks, and
 * two places to set things up. The platform's own pages wait under a closed Advanced at the foot of
 * the page, Admin among them only for an admin, and there is no list of keyboard shortcuts.
 */

beforeAll(() => GlobalRegistrator.register({ url: "http://localhost:3010" }));
afterEach(cleanup);
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

/** The real route's page, with who is asking and their saved instructions already read. */
function drawSettings(role: AuthenticatedUser["role"]) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  client.setQueryData(authKeys.currentUser(), {
    id: "student-1",
    email: "dana@example.com",
    role,
    onboarding: null,
  } satisfies AuthenticatedUser);
  client.setQueryData(settingsKeys.instructions(), "");
  const Page = SettingsRoute.options.component as ComponentType;
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <Page /> }),
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router as never} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** Each row of a list of places, as its name and where it goes. */
const places = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole("link", { hidden: true })
    .map((link) => [link.textContent, link.getAttribute("href")]);

test("a student gets two places to set things up, and the platform's pages folded under Advanced", async () => {
  const view = drawSettings("user");

  const main = await view.findByRole("navigation", { name: "Settings" });
  expect(places(main)).toEqual([
    ["School accounts", "/connections"],
    ["Teacher rules", "/settings/teacher-rules"],
  ]);

  // Closed, and the last thing on the page.
  const advanced = view.getByText("Advanced").closest("details");
  if (!advanced) throw new Error("Advanced is not a disclosure");
  expect(advanced.open).toBe(false);
  expect(advanced.nextElementSibling).toBeNull();
  expect(
    places(
      within(advanced).getByRole("navigation", {
        hidden: true,
        name: "Advanced settings",
      }),
    ),
  ).toEqual([
    ["Bots", "/bots"],
    ["Capabilities", "/capabilities"],
    ["Routines", "/routines"],
    ["Approval rules", "/settings/approvals"],
    ["Notifications", "/settings/notifications"],
    ["Passwords", "/settings/passwords"],
  ]);
});

test("an admin also finds Admin, last under Advanced", async () => {
  const view = drawSettings("admin");
  const advanced = await view.findByRole("navigation", {
    hidden: true,
    name: "Advanced settings",
  });
  expect(places(advanced).at(-1)).toEqual(["Admin", "/admin"]);
});

test("the coach's box is about the student, the theme follows the device, and no shortcuts are listed", async () => {
  const view = drawSettings("user");

  expect(await view.findByRole("textbox", { name: "About you" })).toBeTruthy();
  const appearance = view.getByRole("radiogroup", { name: "Appearance" });
  expect(
    within(appearance)
      .getAllByRole("radio")
      .map((radio) => radio.textContent),
  ).toEqual(["Automatic", "Light", "Dark"]);
  expect(view.queryByText("Keyboard shortcuts")).toBeNull();
  expect(document.body.textContent).not.toContain("Bot's role");
});
