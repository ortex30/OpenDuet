import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TeacherRulesView } from "@/components/duet/study";
import { PageShell } from "@/components/layout/page-shell";
import {
  changeRulesMutationOptions,
  rulesChangeKey,
  rulesQueryOptions,
  syncSchoolMutationOptions,
} from "@/lib/study/rules";
import { rulesChangeSchema } from "@/lib/study/schemas";

export const Route = createFileRoute("/_authed/settings/teacher-rules")({
  component: TeacherRulesPage,
});

/**
 * Teacher rules: how much AI help each class allows, from the student's Classroom notices, and the
 * overrides set here. The page is the reads and writes; TeacherRulesView draws it.
 */
function TeacherRulesPage() {
  const queryClient = useQueryClient();
  const rules = useQuery(rulesQueryOptions());
  const change = useMutation(changeRulesMutationOptions(queryClient));
  const sync = useMutation(syncSchoolMutationOptions(queryClient));
  // Every change still waiting, not just this hook's latest: changes queue one behind another.
  const saving = useMutationState({
    filters: { mutationKey: rulesChangeKey, status: "pending" },
    select: (mutation) =>
      rulesChangeSchema.safeParse(mutation.state.variables).data ?? {},
  });

  return (
    <PageShell
      description="How much AI help each class allows."
      // Named as the Settings row that opens it.
      title="Teacher rules"
    >
      <TeacherRulesView
        connections={({ className, children }) => (
          <Link className={className} to="/connections">
            {children}
          </Link>
        )}
        failed={
          change.isError
            ? { change: change.variables, message: change.error.message }
            : null
        }
        loadError={rules.error?.message ?? null}
        onChange={(next) => change.mutate(next)}
        onRefresh={() => sync.mutate()}
        onReload={() => void rules.refetch()}
        refreshError={sync.error?.message ?? null}
        refreshing={sync.isPending}
        rules={rules.data ?? null}
        saving={saving}
        // Due dates in the student's own zone, as the Calendar tab shows them, not this device's.
        timeZone={rules.data?.timeZone}
      />
    </PageShell>
  );
}
