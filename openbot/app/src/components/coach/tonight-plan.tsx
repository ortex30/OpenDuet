import { useState } from "react";
import { DuetIcon } from "@/components/duet/icons";

type Block = {
  id: string;
  assignmentId: string | null;
  title: string;
  start: string;
  end: string;
};

type TonightBody = {
  planId?: string | null;
  plan?: {
    summary?: string;
    warnings?: string[];
    blocks?: Block[];
  };
  error?: string;
};

const SKIP_KEY = "academic-os.tonight-skip";
const PLAN_KEY = "academic-os.tonight-plan";

/** Work the student already checked off, kept for this browser tab. */
function readSkip(): string[] {
  try {
    const raw = window.sessionStorage.getItem(SKIP_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function readPlanId(): string | null {
  try {
    return window.sessionStorage.getItem(PLAN_KEY);
  } catch {
    return null;
  }
}

function clockSpan(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (
    !Number.isFinite(sh) ||
    !Number.isFinite(sm) ||
    !Number.isFinite(eh) ||
    !Number.isFinite(em)
  ) {
    return 0;
  }
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

type Row = {
  id: string;
  title: string;
  start: string;
  end: string;
  minutes: number;
};

/** One row per assignment, from the first block to the last. */
function rowsOf(blocks: Block[]): Row[] {
  const rows: Row[] = [];
  for (const block of blocks) {
    const id = block.assignmentId ?? block.id;
    const minutes = clockSpan(block.start, block.end);
    const existing = rows.find((row) => row.id === id);
    if (!existing) {
      rows.push({
        id,
        title: block.title,
        start: block.start,
        end: block.end,
        minutes,
      });
      continue;
    }
    existing.end = block.end;
    existing.minutes += minutes;
  }
  return rows;
}

/**
 * Tonight's plan from what's due. Checking an item off asks for a new plan
 * without that work. Once it's on the calendar, later checks update that plan.
 */
export function TonightPlan() {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [skip, setSkip] = useState<string[]>(readSkip);
  const [planId, setPlanId] = useState<string | null>(readPlanId);
  const [asked, setAsked] = useState(false);

  async function load(nextSkip: string[], save: boolean) {
    setBusy(save ? "save" : "plan");
    setError("");
    try {
      const response = await fetch("/api/openduet/study/workshop/tonight", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          skip: nextSkip,
          ...(save || planId ? { save: true, planId } : {}),
        }),
      });
      const body = (await response.json()) as TonightBody;
      if (!response.ok) throw new Error(body.error || "No plan yet.");
      const blocks = body.plan?.blocks ?? [];
      setRows(rowsOf(blocks));
      setSummary(body.plan?.summary ?? "");
      setWarnings(
        (body.plan?.warnings ?? []).filter((warning) => warning.trim()),
      );
      setAsked(true);
      if (body.planId) {
        setPlanId(body.planId);
        window.sessionStorage.setItem(PLAN_KEY, body.planId);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Try again.");
    } finally {
      setBusy("");
    }
  }

  function checkOff(id: string) {
    const next = skip.includes(id) ? skip : [...skip, id];
    setSkip(next);
    window.sessionStorage.setItem(SKIP_KEY, JSON.stringify(next));
    void load(next, Boolean(planId));
  }

  function startOver() {
    setSkip([]);
    window.sessionStorage.removeItem(SKIP_KEY);
    void load([], Boolean(planId));
  }

  return (
    <section
      aria-label="Tonight"
      className="mb-3 rounded-[20px] bg-duet-card px-4 py-4 shadow-duet-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="type-sub font-semibold">Tonight</h2>
          <p className="type-caption mt-0.5 text-duet-ink-2">
            {summary || "A short plan from what's actually due."}
          </p>
        </div>
        <button
          className="type-caption min-h-11 shrink-0 rounded-full bg-duet-ink px-4 font-semibold text-duet-surface disabled:opacity-50"
          disabled={busy !== ""}
          onClick={() => void load(skip, false)}
          type="button"
        >
          {busy === "plan" ? "Planning…" : asked ? "Replan" : "Plan tonight"}
        </button>
      </div>
      {error ? (
        <p className="type-sub mt-3 text-duet-red" role="alert">
          {error}{" "}
          <button
            className="font-semibold underline underline-offset-2"
            onClick={() => void load(skip, false)}
            type="button"
          >
            Try again
          </button>
        </p>
      ) : null}
      {asked && rows.length === 0 && !error ? (
        <p className="type-sub mt-3 text-duet-ink-2">
          You're clear for tonight and tomorrow.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={row.id}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-duet-tile px-3 py-2.5">
                <input
                  className="mt-1 size-4 shrink-0"
                  type="checkbox"
                  onChange={() => checkOff(row.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="type-caption font-semibold text-duet-ink-2">
                    {index + 1}. {row.start}–{row.end}
                    {row.minutes > 0 ? ` · ${row.minutes} min` : ""}
                  </span>
                  <span className="type-sub block text-duet-ink">
                    {row.title}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {warnings.length > 0 ? (
        <p className="type-caption mt-3 text-duet-ink-2">{warnings[0]}</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="type-caption inline-flex min-h-11 items-center gap-1.5 rounded-full bg-duet-accent-soft px-4 font-semibold text-duet-accent disabled:opacity-50"
            disabled={busy !== ""}
            onClick={() => void load(skip, true)}
            type="button"
          >
            <DuetIcon name="calendar" size={16} />
            {busy === "save"
              ? "Saving…"
              : planId
                ? "Update calendar"
                : "Put on my calendar"}
          </button>
          {planId ? (
            <a
              className="type-caption inline-flex min-h-11 items-center rounded-full px-3 font-semibold text-duet-ink"
              href="/calendar"
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                window.dispatchEvent(
                  new CustomEvent("academic-os-open", { detail: "/calendar" }),
                );
              }}
            >
              See calendar
            </a>
          ) : null}
          {skip.length > 0 ? (
            <button
              className="type-caption min-h-11 rounded-full px-3 font-semibold text-duet-ink-2"
              onClick={startOver}
              type="button"
            >
              Start over
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
