import { useState } from "react";
import {
  CLASS_COLORS,
  type CoachClass,
  type CoachState,
  formatMinutes,
} from "@/lib/coach/model";
import { reportText, weeklyReport } from "@/lib/coach/progress";
import { restartWithDemo, saveProfile, startFresh } from "@/lib/coach/store";
import { newId } from "@/lib/new-id";
import { cn } from "@/lib/utils";
import {
  ChipChoice,
  CoachButton,
  CoachSheet,
  FIELD,
  Field,
  SOLID,
} from "./kit";

/**
 * The weekly review: minutes a day, time by class, what got done, and a summary the student can
 * share with a parent, advisor or teacher. Mood and sleep stay out of it unless they say so.
 */
export function WeeklyReportSheet({
  state,
  now,
  onClose,
}: {
  state: CoachState;
  now: Date;
  onClose: () => void;
}) {
  const report = weeklyReport(state, now);
  const [wellbeing, setWellbeing] = useState(false);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const text = reportText(state, report, wellbeing);
  const top = Math.max(
    state.profile.dailyGoalMin,
    ...report.daily.map((d) => d.minutes),
  );
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${state.profile.name}'s week`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <CoachSheet onClose={onClose} open title="Your week">
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        {[
          [formatMinutes(report.totalMin), "focused"],
          [`${report.completed.length}`, "finished"],
          [`${report.streakDays}🔥`, "day streak"],
        ].map(([big, small]) => (
          <div className="rounded-[18px] bg-duet-card px-2 py-3" key={small}>
            <p className="type-title font-semibold tabular-nums">{big}</p>
            <p className="type-caption text-duet-ink-2">{small}</p>
          </div>
        ))}
      </div>
      <p className="type-label mb-1 font-semibold text-duet-ink-2 uppercase">
        Minutes a day
      </p>
      <ul
        aria-label="Focus minutes per day"
        className="mb-4 flex h-28 items-end gap-1.5"
      >
        {report.daily.map((d) => (
          <li
            className="flex h-full flex-1 flex-col items-center justify-end"
            key={d.date.toISOString()}
          >
            <span className="type-caption text-duet-ink-2 tabular-nums">
              {d.minutes || ""}
            </span>
            <span
              className={cn(
                "w-full rounded-t-[6px]",
                d.minutes >= state.profile.dailyGoalMin
                  ? "bg-duet-green"
                  : "bg-duet-accent",
              )}
              style={{
                height: `${(d.minutes / top) * 80}%`,
                minHeight: d.minutes ? 4 : 0,
              }}
            />
            <span className="type-caption mt-1 text-duet-ink-2">
              {d.date.toLocaleDateString("en-US", { weekday: "narrow" })}
            </span>
          </li>
        ))}
      </ul>
      {report.byClass.length ? (
        <>
          <p className="type-label mb-1 font-semibold text-duet-ink-2 uppercase">
            By class
          </p>
          <ul className="mb-4 space-y-1.5">
            {report.byClass.map((c) => (
              <li className="flex items-center gap-2" key={c.name}>
                <span className={cn("size-2.5 rounded-full", SOLID[c.color])} />
                <span className="type-row flex-1">{c.name}</span>
                <span className="type-sub text-duet-ink-2 tabular-nums">
                  {formatMinutes(c.minutes)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="type-label mb-1 font-semibold text-duet-ink-2 uppercase">
        Share with a parent or advisor
      </p>
      <pre
        className="type-sub mb-2 whitespace-pre-wrap rounded-[16px] bg-duet-card p-3 font-sans"
        data-testid="report-text"
      >
        {text}
      </pre>
      <label className="type-sub mb-3 flex items-center gap-2">
        <input
          checked={wellbeing}
          onChange={(e) => setWellbeing(e.target.checked)}
          type="checkbox"
        />
        Include my sleep and mood check-ins
      </label>
      <CoachButton className="w-full" onClick={share} primary>
        Share or copy
      </CoachButton>
      {copied ? (
        <p
          className="type-caption mt-2 text-center text-duet-ink-2"
          role="status"
        >
          {copied === "copied"
            ? "Copied. Paste it into a text or email."
            : "Couldn't copy. Select the text above instead."}
        </p>
      ) : null}
    </CoachSheet>
  );
}

const GOALS = [30, 45, 60, 90, 120].map((v) => ({ value: v, label: `${v}m` }));
const CAPACITY = [60, 90, 120, 180, 240].map((v) => ({
  value: v,
  label: formatMinutes(v),
}));

/**
 * Setting up the coach: the student's name, their classes and colours, a daily goal, how much they
 * can study on a school day, and bedtime. Shown on first open, and from the gear afterwards.
 */
export function SetupSheet({
  state,
  onClose,
}: {
  state: CoachState;
  onClose: () => void;
}) {
  const [name, setName] = useState(state.profile.name);
  const [goal, setGoal] = useState(state.profile.dailyGoalMin);
  const [capacity, setCapacity] = useState(state.profile.dailyCapacityMin);
  const [bedtime, setBedtime] = useState(state.profile.bedtime);
  const [classes, setClasses] = useState<CoachClass[]>(state.classes);
  const [newClass, setNewClass] = useState("");
  const addClass = () => {
    const n = newClass.trim();
    if (!n) return;
    setClasses([
      ...classes,
      {
        id: newId(),
        name: n,
        teacher: "",
        color: CLASS_COLORS[classes.length % CLASS_COLORS.length] ?? "accent",
      },
    ]);
    setNewClass("");
  };
  return (
    <CoachSheet
      onClose={onClose}
      open
      title={state.profile.setupDone ? "Coach settings" : "Set up your coach"}
    >
      <Field label="Your first name">
        <input
          className={FIELD}
          onChange={(e) => setName(e.target.value)}
          value={name}
        />
      </Field>
      <p className="type-sub mb-1.5 font-medium text-duet-ink-2">
        Your classes
      </p>
      <ul className="mb-2 space-y-1.5">
        {classes.map((c) => (
          <li className="flex items-center gap-2" key={c.id}>
            <button
              aria-label={`Change ${c.name} colour`}
              className={cn("size-6 shrink-0 rounded-full", SOLID[c.color])}
              onClick={() =>
                setClasses(
                  classes.map((x) =>
                    x.id === c.id
                      ? {
                          ...x,
                          color:
                            CLASS_COLORS[
                              (CLASS_COLORS.indexOf(x.color) + 1) %
                                CLASS_COLORS.length
                            ] ?? "accent",
                        }
                      : x,
                  ),
                )
              }
              type="button"
            />
            <span className="type-row flex-1">{c.name}</span>
            <span className="type-caption text-duet-ink-2">{c.teacher}</span>
            <button
              aria-label={`Remove ${c.name}`}
              className="type-caption px-1 text-duet-ink-3 hover:text-duet-red"
              onClick={() => setClasses(classes.filter((x) => x.id !== c.id))}
              type="button"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mb-3 flex gap-2">
        <input
          aria-label="New class name"
          className={FIELD}
          onChange={(e) => setNewClass(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addClass();
            }
          }}
          placeholder="Add a class"
          value={newClass}
        />
        <CoachButton onClick={addClass}>Add</CoachButton>
      </div>
      <ChipChoice
        label="Daily focus goal"
        onChange={setGoal}
        options={GOALS}
        value={goal}
      />
      <ChipChoice
        label="Time you can study on a school day"
        onChange={setCapacity}
        options={CAPACITY}
        value={capacity}
      />
      <Field label="Bedtime">
        <input
          className={FIELD}
          onChange={(e) => setBedtime(e.target.value)}
          type="time"
          value={bedtime}
        />
      </Field>
      <CoachButton
        className="w-full"
        disabled={!name.trim()}
        onClick={() => {
          saveProfile(
            {
              name: name.trim(),
              dailyGoalMin: goal,
              dailyCapacityMin: capacity,
              bedtime,
              setupDone: true,
            },
            classes,
          );
          onClose();
        }}
        primary
      >
        {state.profile.setupDone ? "Save" : "Let's go"}
      </CoachButton>
      <div className="mt-4 flex justify-center gap-4">
        <button
          className="type-caption font-semibold text-duet-ink-2 hover:text-duet-ink"
          onClick={() => {
            restartWithDemo();
            onClose();
          }}
          type="button"
        >
          Reload the sample week
        </button>
        <button
          className="type-caption font-semibold text-duet-ink-2 hover:text-duet-red"
          onClick={() => {
            startFresh(name.trim() || "Viren");
            onClose();
          }}
          type="button"
        >
          Start empty
        </button>
      </div>
    </CoachSheet>
  );
}
