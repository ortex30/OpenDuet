import { createFileRoute } from "@tanstack/react-router";
import { LearnScreen } from "@/components/learn/learn-screen";

/** Learn: what the student knows from their study memory, what to review today, and mistakes to fix. */
export const Route = createFileRoute("/_authed/_app/learn")({
  component: LearnScreen,
});
