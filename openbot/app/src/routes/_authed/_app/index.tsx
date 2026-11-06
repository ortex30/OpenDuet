import { createFileRoute } from "@tanstack/react-router";

/**
 * Chat: the person's one ongoing conversation with the product's own Bot.
 *
 * Drawn by the shell (`ChatWithScreen` in components/shell/app-shell.tsx), not here, so it stays on
 * screen, and keeps everything in it, while the coach opens Tasks, Calendar and the rest beside it.
 */
export const Route = createFileRoute("/_authed/_app/")({
  component: () => null,
});
