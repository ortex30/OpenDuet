import { createFileRoute } from "@tanstack/react-router";
import { CoachScreen } from "@/components/coach/coach-screen";

/** Coach: the student's planning home: what to do next, the week's load, focus, streaks and badges. */
export const Route = createFileRoute("/_authed/_app/coach")({
  component: CoachScreen,
});
