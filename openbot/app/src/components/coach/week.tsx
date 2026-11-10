import { useState } from "react";
import { DuetIcon } from "@/components/duet/icons";
import {
  type Assignment,
  type CoachState,
  classOf,
  formatDue,
  formatMinutes,
  HELP_LABEL,
  type HelpLevel,
  isOverdue,
  remainingMin,
} from "@/lib/coach/model";
import { workload, workloadAdvice } from "@/lib/coach/plan";
import { ACHIEVEMENTS, type Achievement } from "@/lib/coach/progress";
import { removeAssignment, saveAssignment, setDone } from "@/lib/coach/store";
import { cn } from "@/lib/utils";
import {
  Card,
  CardTitle,
  ChipChoice,
  ClassPill,
  CoachButton,
  CoachSheet,
  FIELD,
  Field,
  SOLID,
} from "./kit";

/** Seven days of work as bars: the even spread solid, the last-minute cram as a ghost behind it. */
export function WorkloadRadar({
  state,
  now,
}: {
  state: CoachState;
  now: Date;
}) {
  const days = workload(state, now);
  const advice = workloadAdvice(state, days);
  const cap = state.profile.dailyCapacityMin;
  const top = Math.max(
    cap * 1.25,
    ...days.map((d) => Math.max(d.crammedMin, d.spreadMin)),
  );
  const H = 112;
  return (
    <Card aria-label="Workload radar">
      <CardTitle>This week's load</CardTitle>
      <div className="relative" style={{ height: H + 34 }}>
        <div
          aria-hidden
          className="absolute inset-x-0 border-duet-red/60 border-t border-dashed"
          style={{ top: H - (cap / top) * H }}
        >
          <span className="type-caption -top-4 absolute right-0 bg-duet-card px-1 text-duet-red">
            your {formatMinutes(cap)}
          </span>
        </div>
        <ul className="absolute inset-0 flex items-end gap-1.5">
          {days.map((d, i) => {
            const label =
              i === 0
                ? "Today"
                : d.date.toLocaleDateString("en-US", { weekday: "short" });
            return (
              <li
                aria-label={`${label}: ${formatMinutes(d.spreadMin)} planned, ${d.due.length} due`}
                className="flex h-full flex-1 flex-col items-center justify-end"
                key={d.date.toISOString()}
              >
                <div className="relative w-full" style={{ height: H }}>
                  <div
                    className="absolute inset-x-1 bottom-0 rounded-t-[6px] bg-duet-tile"
                    style={{ height: (d.crammedMin / top) * H }}
                    title={`If left to the last night: ${formatMinutes(d.crammedMin)}`}
                  />
                  <div
                    className={cn(
                      "absolute inset-x-2.5 bottom-0 rounded-t-[6px] transition-[height]",
                      d.over ? "bg-duet-red" : "bg-duet-accent",
                    )}
                    style={{ height: (d.spreadMin / top) * H }}
                  />
                </div>
                <span
                  className={cn(
                    "type-caption mt-1",
                    i === 0 ? "font-semibold" : "text-duet-ink-2",
                  )}
                >
                  {label}
                </span>
                <span className="flex h-3 gap-0.5" aria-hidden>
                  {d.due.slice(0, 3).map((a) => (
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        SOLID[classOf(state, a).color],
                      )}
                      key={a.id}
                    />
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="type-caption mt-1 text-duet-ink-3">
        Solid: a little each day. Grey: everything the night before. Dots:
        what's due.
      </p>
      {advice ? (
        <p
          className="type-sub mt-2 rounded-[16px] bg-duet-amber-soft px-3 py-2 font-medium text-duet-amber"
          data-testid="workload-advice"
        >
          {advice}
        </p>
      ) : (
        <p className="type-sub mt-2 text-duet-green">
          Your week looks manageable.
        </p>
      )}
    </Card>
  );
}

/** Every assignment, open ones by due date, with done toggles and an editor. */
export function AssignmentsCard({
  state,
  now,
  onEarned,
}: {
  state: CoachState;
  now: Date;
  onEarned: (earned: Achievement[]) => void;
}) {
  const [editing, setEditing] = useState<Assignment | "new" | null>(null);
  const [showDone, setShowDone] = useState(false);
  const open = state.assignments
    .filter((a) => a.status !== "done")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const done = state.assignments.filter((a) => a.status === "done");
  const row = (a: Assignment) => {
    const cls = classOf(state, a);
    const late = isOverdue(a, now);
    const progress = a.estimateMin
      ? Math.min(1, a.spentMin / a.estimateMin)
      : 0;
    return (
      <li className="flex items-center gap-2 py-2" key={a.id}>
        <button
          aria-label={
            a.status === "done"
              ? `Mark ${a.title} not done`
              : `Mark ${a.title} done`
          }
          aria-pressed={a.status === "done"}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
            a.status === "done"
              ? "bg-duet-green text-white"
              : "shadow-[inset_0_0_0_2px_var(--duet-hair-2)] hover:bg-duet-tile",
          )}
          onClick={() =>
            onEarned(setDone(a.id, a.status !== "done", new Date()))
          }
          type="button"
        >
          {a.status === "done" ? (
            <DuetIcon name="check" size={16} stroke={2.6} />
          ) : null}
        </button>
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => setEditing(a)}
          type="button"
        >
          <span
            className={cn(
              "type-row block truncate font-medium",
              a.status === "done" && "text-duet-ink-3 line-through",
            )}
          >
            {a.title}
          </span>
          <span className="type-caption flex items-center gap-1.5 text-duet-ink-2">
            <ClassPill color={cls.color} name={cls.name} />
            <span className={late ? "font-semibold text-duet-red" : ""}>
              {a.status === "done" ? "Done" : `Due ${formatDue(a.dueAt, now)}`}
            </span>
            {a.status !== "done" ? (
              <span>· {HELP_LABEL[a.helpLevel]}</span>
            ) : null}
          </span>
          {a.status !== "done" ? (
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-duet-tile">
              <span
                className={cn("block h-full rounded-full", SOLID[cls.color])}
                style={{ width: `${progress * 100}%` }}
              />
            </span>
          ) : null}
        </button>
      </li>
    );
  };
  return (
    <Card aria-label="Assignments">
      <CardTitle
        action={
          <CoachButton
            className="min-h-9 px-3"
            onClick={() => setEditing("new")}
          >
            <DuetIcon name="plus" size={16} /> Add
          </CoachButton>
        }
      >
        Assignments
      </CardTitle>
      <ul className="divide-y divide-duet-hair">{open.map(row)}</ul>
      {done.length ? (
        <>
          <button
            aria-expanded={showDone}
            className="type-sub mt-1 font-semibold text-duet-ink-2"
            onClick={() => setShowDone(!showDone)}
            type="button"
          >
            {showDone ? "Hide" : "Show"} {done.length} done
          </button>
          {showDone ? (
            <ul className="divide-y divide-duet-hair">{done.map(row)}</ul>
          ) : null}
        </>
      ) : null}
      {editing ? (
        <AssignmentSheet
          assignment={editing === "new" ? null : editing}
          now={now}
          onClose={() => setEditing(null)}
          onEarned={onEarned}
          state={state}
        />
      ) : null}
    </Card>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AssignmentSheet({
  assignment,
  state,
  now,
  onClose,
  onEarned,
}: {
  assignment: Assignment | null;
  state: CoachState;
  now: Date;
  onClose: () => void;
  onEarned: (earned: Achievement[]) => void;
}) {
  const tomorrow = new Date(now.getTime() + 86_400_000);
  tomorrow.setHours(23, 59, 0, 0);
  const [title, setTitle] = useState(assignment?.title ?? "");
  const [classId, setClassId] = useState(
    assignment?.classId ?? state.classes[0]?.id ?? "other",
  );
  const [due, setDue] = useState(
    toLocalInput(assignment?.dueAt ?? tomorrow.toISOString()),
  );
  const [estimate, setEstimate] = useState(assignment?.estimateMin ?? 60);
  const [points, setPoints] = useState(assignment?.points ?? 20);
  const [help, setHelp] = useState<HelpLevel>(assignment?.helpLevel ?? "hints");
  const [late, setLate] = useState<number | null>(
    assignment ? assignment.lateCredit : null,
  );
  const valid = title.trim() && !Number.isNaN(new Date(due).getTime());
  return (
    <CoachSheet
      onClose={onClose}
      open
      title={assignment ? "Edit assignment" : "New assignment"}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onEarned(
            saveAssignment({
              id: assignment?.id,
              title: title.trim(),
              classId,
              dueAt: new Date(due).toISOString(),
              estimateMin: estimate,
              points,
              helpLevel: help,
              lateCredit: late,
              source: assignment?.source ?? null,
            }),
          );
          onClose();
        }}
      >
        <Field label="What is it?">
          <input
            className={FIELD}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Chapter 7 reading notes"
            value={title}
          />
        </Field>
        <Field label="Class">
          <select
            className={FIELD}
            onChange={(e) => setClassId(e.target.value)}
            value={classId}
          >
            {state.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Due">
          <input
            className={FIELD}
            onChange={(e) => setDue(e.target.value)}
            type="datetime-local"
            value={due}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Your estimate (min)">
            <input
              className={FIELD}
              min={5}
              onChange={(e) => setEstimate(Number(e.target.value) || 0)}
              step={5}
              type="number"
              value={estimate}
            />
          </Field>
          <Field label="Points">
            <input
              className={FIELD}
              min={0}
              onChange={(e) => setPoints(Number(e.target.value) || 0)}
              type="number"
              value={points}
            />
          </Field>
        </div>
        <ChipChoice
          label="Teacher's AI rule"
          onChange={setHelp}
          options={(["full", "hints", "none"] as HelpLevel[]).map((v) => ({
            value: v,
            label: HELP_LABEL[v],
          }))}
          value={help}
        />
        <ChipChoice
          label="Late work"
          onChange={(v) => setLate(v === -1 ? null : v)}
          options={[
            { value: -1, label: "Not accepted" },
            { value: 0.5, label: "50%" },
            { value: 0.7, label: "70%" },
            { value: 0.9, label: "90%" },
          ]}
          value={late === null ? -1 : late}
        />
        {assignment ? (
          <p className="type-caption mb-3 text-duet-ink-2">
            {formatMinutes(assignment.spentMin)} logged · about{" "}
            {formatMinutes(remainingMin(assignment))} left
          </p>
        ) : null}
        <div className="flex gap-2">
          {assignment ? (
            <CoachButton
              className="text-duet-red"
              onClick={() => {
                removeAssignment(assignment.id);
                onClose();
              }}
            >
              Delete
            </CoachButton>
          ) : null}
          <CoachButton
            className="flex-1"
            disabled={!valid}
            primary
            type="submit"
          >
            Save
          </CoachButton>
        </div>
      </form>
    </CoachSheet>
  );
}

/** The badges: earned ones in colour, the rest waiting with how to get them. */
export function AchievementsCard({ state }: { state: CoachState }) {
  const earned = ACHIEVEMENTS.filter((a) => state.unlocked[a.id]).length;
  return (
    <Card aria-label="Achievements">
      <CardTitle>
        Badges · {earned}/{ACHIEVEMENTS.length}
      </CardTitle>
      <ul className="grid grid-cols-5 gap-2">
        {ACHIEVEMENTS.map((a) => {
          const on = Boolean(state.unlocked[a.id]);
          return (
            <li
              aria-label={`${a.title}: ${on ? "earned" : a.description}`}
              className="flex flex-col items-center text-center"
              key={a.id}
              title={`${a.title}: ${a.description}`}
            >
              <span
                className={cn(
                  "grid size-12 place-items-center rounded-full text-2xl",
                  on
                    ? "bg-duet-amber-soft"
                    : "bg-duet-tile opacity-40 grayscale",
                )}
              >
                {a.emoji}
              </span>
              <span
                className={cn(
                  "type-caption mt-1 leading-tight",
                  on ? "font-semibold" : "text-duet-ink-3",
                )}
              >
                {a.title}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** A badge just earned: a moment of celebration, then it goes. */
export function Celebration({
  achievements,
  onDone,
}: {
  achievements: Achievement[];
  onDone: () => void;
}) {
  const first = achievements[0];
  if (!first) return null;
  return (
    <div
      className="fixed inset-x-0 top-24 z-[55] mx-auto flex w-[calc(100%-32px)] max-w-[398px] items-center gap-3 rounded-[24px] bg-duet-black p-4 text-duet-on-black shadow-duet-raised"
      data-testid="celebration"
      role="status"
    >
      <span className="coach-pop text-4xl" aria-hidden>
        {first.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-label font-semibold uppercase tracking-wide opacity-70">
          Badge earned
        </p>
        <p className="type-title font-semibold">{first.title}</p>
        <p className="type-sub opacity-80">
          {first.description}
          {achievements.length > 1 ? ` (+${achievements.length - 1} more)` : ""}
        </p>
      </div>
      <button
        className="type-sub font-semibold opacity-80 hover:opacity-100"
        onClick={onDone}
        type="button"
      >
        Nice
      </button>
      <Confetti />
    </div>
  );
}

const CONFETTI_COLORS = ["#9a3412", "#f5a524", "#146c34", "#1d4ed8", "#be123c"];

function Confetti() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-visible"
    >
      {Array.from({ length: 18 }, (_, i) => (
        <span
          className="coach-confetti absolute top-1/2 left-8 size-2 rounded-[2px]"
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed decoration.
          key={i}
          style={{
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            ["--dx" as string]: `${Math.cos((i / 18) * Math.PI * 2) * (60 + (i % 3) * 30)}px`,
            ["--dy" as string]: `${Math.sin((i / 18) * Math.PI * 2) * (50 + (i % 4) * 20)}px`,
            animationDelay: `${(i % 5) * 20}ms`,
          }}
        />
      ))}
    </span>
  );
}
