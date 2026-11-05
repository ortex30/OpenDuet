import { createFileRoute } from "@tanstack/react-router";
import {
  type CalendarSearch,
  CalendarScreen,
} from "@/components/shell/calendar-screen";
import { searchTextEntry } from "@/lib/search-text";

/**
 * Calendar: the student's Google Calendar and the study blocks they applied, a day or a week at a
 * time. `?date=YYYY-MM-DD` picks the day, `?view=week` the week around it, and `?plan=<id>` lays a
 * proposed plan over it, as the plan card links it. Each is optional, and read as the text it was in
 * the address: the router would hand `?date=20261105` over as a number.
 */
export const Route = createFileRoute("/_authed/_app/calendar")({
  validateSearch: (search: Record<string, unknown>): CalendarSearch => ({
    ...searchTextEntry("date", search.date),
    ...searchTextEntry("plan", search.plan),
    ...searchTextEntry("view", search.view),
  }),
  component: CalendarRoute,
});

function CalendarRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CalendarScreen
      // Moving through days replaces the entry, so Back leaves the tab rather than retracing them.
      onSearch={(next) => void navigate({ search: next, replace: true })}
      search={search}
    />
  );
}
