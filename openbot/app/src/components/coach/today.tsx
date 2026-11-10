import { useState } from "react";
import { DuetIcon } from "@/components/duet/icons";
import { type CoachState, formatMinutes, isOverdue } from "@/lib/coach/model";
import {
  type Achievement,
  bedtimeNudge,
  minutesOn,
  type Pacing,
  streak,
  todaysCheckIn,
} from "@/lib/coach/progress";
import {
  catchUpPlan,
  type Ranked,
  rankAssignments,
  whyFirst,
} from "@/lib/coach/plan";
import { saveCheckIn } from "@/lib/coach/store";
import { classOf } from "@/lib/coach/model";
import { cn } from "@/lib/utils";
import { startFocus } from "./focus-timer";
import {
  Card,
  CardTitle,
  ChipChoice,
  ClassPill,
  CoachButton,
  Ring,
} from "./kit";

function tomorrowLine(state: CoachState, now: Date): string | null {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const next = start.getTime() + 86_400_000;
  const end = next + 86_400_000;
  const items = state.assignments.filter((item) => {
    if (item.status === "done") return false;
    const due = new Date(item.dueAt).getTime();
    return (
      due >= next &&
      due < end &&
      /quest|exam|\bleq\b|in-class|\bquiz\b/i.test(item.title)
    );
  });
  if (items.length === 0) return null;
  const names = items.map(
    (item) => item.title.split(" - ").at(-1)?.trim() || item.title,
  );
  return `Tomorrow: ${names.join(", ")}.`;
}

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** The top of the tab: hello, today's goal ring, the streak, and the bedtime nudge. */
export function TodayHero({
  state,
  now,
  pace,
}: {
  state: CoachState;
  now: Date;
  pace: Pacing;
}) {
  const today = minutesOn(state, now);
  const { days, todayDone } = streak(state, now);
  const nudge = bedtimeNudge(state, now);
  const met = today >= pace.goalMin;
  return (
    <>
      <Card className="flex items-center gap-4">
        <Ring label="Today's focus goal" max={pace.goalMin} value={today}>
          <span className="type-row block font-semibold tabular-nums">
            {Math.round(today)}
          </span>
          <span className="type-caption block text-duet-ink-2">
            /{pace.goalMin}m
          </span>
        </Ring>
        <div className="min-w-0 flex-1">
          <p className="type-title font-semibold">
            {greeting(now)}
            {state.profile.name ? `, ${state.profile.name}` : ""}.
          </p>
          {tomorrowLine(state, now) ? (
            <p className="type-sub mt-1 text-duet-ink [overflow-wrap:anywhere]">
              {tomorrowLine(state, now)}
            </p>
          ) : null}
          <p className="type-sub text-duet-ink-2">
            {met
              ? "Goal met today. Anything more is a bonus."
              : `${formatMinutes(Math.max(0, pace.goalMin - today))} to go today.`}
          </p>
          <p
            className={cn(
              "type-sub mt-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-semibold",
              days > 0
                ? "bg-duet-amber-soft text-duet-amber"
                : "bg-duet-tile text-duet-ink-2",
            )}
            data-testid="streak"
          >
            <span aria-hidden>🔥</span>
            {days}-day streak
          </p>
          {days > 0 && !todayDone ? (
            <p className="type-caption mt-1 text-duet-ink-2">
              15 min keeps the streak.
            </p>
          ) : null}
        </div>
      </Card>
      {nudge ? (
        <div
          className={cn(
            "type-sub mb-3 flex items-start gap-2 rounded-[20px] px-4 py-3 font-medium",
            nudge.tone === "past"
              ? "bg-duet-violet-soft text-duet-violet"
              : "bg-duet-amber-soft text-duet-amber",
          )}
          role="status"
        >
          <DuetIcon name="moon" size={18} />
          <span>{nudge.text}</span>
        </div>
      ) : null}
    </>
  );
}

const MOODS = [
  { value: 1, label: "😞" },
  { value: 2, label: "😕" },
  { value: 3, label: "😐" },
  { value: 4, label: "🙂" },
  { value: 5, label: "😄" },
];
const ENERGY = [
  { value: 1, label: "Empty" },
  { value: 2, label: "Low" },
  { value: 3, label: "OK" },
  { value: 4, label: "Good" },
  { value: 5, label: "Charged" },
];
const SLEEP = [
  { value: 5, label: "<6h" },
  { value: 6.5, label: "6-7h" },
  { value: 7.5, label: "7-8h" },
  { value: 9, label: "8h+" },
];

/** The daily check-in: three taps, and the day's pacing follows from it. */
export function CheckInCard({
  state,
  now,
  pace,
  onEarned,
}: {
  state: CoachState;
  now: Date;
  pace: Pacing;
  onEarned: (earned: Achievement[]) => void;
}) {
  const done = todaysCheckIn(state, now);
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  if (done && !editing)
    return (
      <Card aria-label="Today's check-in">
        <CardTitle
          action={
            <button
              className="type-caption font-semibold text-duet-ink-2 hover:text-duet-ink"
              onClick={() => setEditing(true)}
              type="button"
            >
              Redo
            </button>
          }
        >
          Today's pace
        </CardTitle>
        <p className="type-body">{pace.message}</p>
        <p className="type-sub mt-1 text-duet-ink-2">
          {pace.focusMin}-minute sessions, {pace.breakMin}-minute breaks, goal{" "}
          {pace.goalMin} min.
        </p>
        {pace.support ? (
          <p className="type-sub mt-2 rounded-[16px] bg-duet-violet-soft px-3 py-2 text-duet-violet">
            If it's more than a rough day, talk to someone you trust, like your
            school counselor. In the US you can call or text 988 any time.
          </p>
        ) : null}
      </Card>
    );
  return (
    <Card aria-label="Daily check-in">
      <CardTitle>How are you today?</CardTitle>
      <ChipChoice
        label="Mood"
        onChange={setMood}
        options={MOODS}
        value={mood}
      />
      {mood === null ? null : (
        <>
          <ChipChoice
            label="Energy"
            onChange={setEnergy}
            options={ENERGY}
            value={energy}
          />
          <ChipChoice
            label="Sleep last night"
            onChange={setSleep}
            options={SLEEP}
            value={sleep}
          />
          <CoachButton
            disabled={mood === null || energy === null || sleep === null}
            onClick={() => {
              if (mood === null || energy === null || sleep === null) return;
              onEarned(saveCheckIn({ mood, energy, sleepHours: sleep }));
              setEditing(false);
            }}
            primary
          >
            Set my pace
          </CoachButton>
        </>
      )}
    </Card>
  );
}

/** The one thing to do now, why, and a button that starts it. */
export function DoNextCard({
  state,
  now,
  pace,
  onHandOff,
}: {
  state: CoachState;
  now: Date;
  pace: Pacing;
  onHandOff: (ranked: Ranked) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const ranked = rankAssignments(state, now);
  const top = ranked[0];
  if (!top)
    return (
      <Card>
        <CardTitle>Do next</CardTitle>
        <p className="type-body">
          Nothing open. Add an assignment below, or enjoy the free time.
        </p>
        <CoachButton
          className="mt-3"
          onClick={() => startFocus(null, pace.focusMin)}
        >
          Free study session
        </CoachButton>
      </Card>
    );
  const cls = classOf(state, top.assignment);
  return (
    <Card aria-labelledby="do-next" className="relative overflow-hidden">
      <CardTitle id="do-next">Do next</CardTitle>
      <ClassPill color={cls.color} name={cls.name} />
      <p
        className="type-title mt-1.5 font-semibold"
        data-testid="do-next-title"
      >
        {top.assignment.title}
      </p>
      <p className="type-sub mt-1 text-duet-ink-2">
        {whyFirst(state, top, now)}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {top.reasons.map((r) => (
          <span
            className="type-caption rounded-full bg-duet-tile px-2 py-0.5 font-medium"
            key={r}
          >
            {r}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <CoachButton
          onClick={() => startFocus(top.assignment.id, pace.focusMin)}
          primary
        >
          <DuetIcon name="clock" size={18} /> Focus {pace.focusMin} min
        </CoachButton>
        <CoachButton onClick={() => onHandOff(top)}>
          <DuetIcon name="sparkle" size={18} />
          {top.assignment.helpLevel === "none" ? "Plan my time" : "Coach me"}
        </CoachButton>
      </div>
      {ranked.length > 1 ? (
        <div className="mt-3 border-duet-hair border-t pt-2">
          <button
            aria-expanded={showAll}
            className="type-sub flex w-full items-center justify-between py-1 font-semibold text-duet-ink-2"
            onClick={() => setShowAll(!showAll)}
            type="button"
          >
            Then {ranked.length - 1} more, in order
            <DuetIcon name="chevronRight" size={16} />
          </button>
          {showAll ? (
            <ol className="mt-1 space-y-1.5">
              {ranked.slice(1).map((r, i) => (
                <li className="flex items-center gap-2" key={r.assignment.id}>
                  <span className="type-caption w-4 text-duet-ink-3 tabular-nums">
                    {i + 2}
                  </span>
                  <span className="type-row min-w-0 flex-1 truncate">
                    {r.assignment.title}
                  </span>
                  <span className="type-caption shrink-0 text-duet-ink-2">
                    {r.reasons[0]}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** Shown only when something is late: what can still be won back, and a way to get help. */
export function CatchUpCard({
  state,
  now,
  onPlan,
}: {
  state: CoachState;
  now: Date;
  onPlan: () => void;
}) {
  const late = state.assignments.filter((a) => isOverdue(a, now));
  if (!late.length) return null;
  const plan = catchUpPlan(state, now);
  return (
    <Card aria-label="Catch-up mode" className="bg-duet-red-soft shadow-none">
      <CardTitle>Catch-up mode</CardTitle>
      <p className="type-body font-semibold text-duet-ink">
        {late.length} late · {Math.round(plan.totalRecoverable)} points still on
        the table
      </p>
      <ul className="mt-2 space-y-1">
        {plan.doNow.map((item) => (
          <li className="type-sub" key={item.assignment.id}>
            <span className="font-semibold">{item.assignment.title}</span>:
            worth {Math.round(item.recoverable)} pts now, about{" "}
            {Math.round(item.perHour)} pts per hour of work.
          </li>
        ))}
        {plan.askAbout.map((a) => (
          <li className="type-sub" key={a.id}>
            <span className="font-semibold">{a.title}</span>: no late credit.
            Worth asking the teacher.
          </li>
        ))}
      </ul>
      <CoachButton className="mt-3" onClick={onPlan} primary>
        <DuetIcon name="sparkle" size={18} /> Make me a catch-up plan
      </CoachButton>
    </Card>
  );
}
