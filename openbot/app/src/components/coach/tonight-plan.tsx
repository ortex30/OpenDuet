import { useEffect, useState } from "react";
import { DuetIcon } from "@/components/duet/icons";

type Block = {
  id: string;
  assignmentId: string | null;
  title: string;
  start: string;
  end: string;
};

type Left = {
  assignmentId: string;
  title: string;
  minutes: number;
};

type TonightBody = {
  planId?: string | null;
  plan?: {
    summary?: string;
    warnings?: string[];
    blocks?: Block[];
    remaining?: Left[];
  };
  error?: string;
};

const STORE = "academic-os.tonight";

type Saved = {
  rows: Row[];
  summary: string;
  warnings: string[];
  remaining: Left[];
  planId: string | null;
  skip: string[];
  minutes: number;
  hidden: boolean;
};

type Row = {
  id: string;
  title: string;
  start: string;
  end: string;
  minutes: number;
};

function readSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return {
      rows: parsed.rows,
      summary: parsed.summary ?? "",
      warnings: parsed.warnings ?? [],
      remaining: parsed.remaining ?? [],
      planId: parsed.planId ?? null,
      skip: parsed.skip ?? [],
      minutes: parsed.minutes ?? 120,
      hidden: parsed.hidden === true,
    };
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
 * Tonight's plan from what's due. The same plan chat makes. Checking an item
 * off asks for a new plan without that work, and replaces the calendar copy.
 */
export function TonightPlan() {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<Left[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [skip, setSkip] = useState<string[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(120);
  const [asked, setAsked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = readSaved();
    if (saved) {
      setRows(saved.rows);
      setSummary(saved.summary);
      setWarnings(saved.warnings);
      setRemaining(saved.remaining);
      setPlanId(saved.planId);
      setSkip(saved.skip);
      setMinutes(saved.minutes);
      setAsked(saved.rows.length > 0 || saved.summary.length > 0);
      setHidden(saved.hidden);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const next: Saved = {
      rows,
      summary,
      warnings,
      remaining,
      planId,
      skip,
      minutes,
      hidden,
    };
    window.localStorage.setItem(STORE, JSON.stringify(next));
  }, [ready, rows, summary, warnings, remaining, planId, skip, minutes, hidden]);

  async function load(
    nextSkip: string[],
    save: boolean,
    nextMinutes = minutes,
  ) {
    setBusy(save ? "save" : "plan");
    setError("");
    try {
      const response = await fetch("/api/openduet/study/workshop/tonight", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          skip: nextSkip,
          minutes: nextMinutes,
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
      setRemaining((body.plan?.remaining ?? []).slice(0, 4));
      setAsked(true);
      setHidden(false);
      if (body.planId) setPlanId(body.planId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Try again.");
    } finally {
      setBusy("");
    }
  }

  function checkOff(id: string) {
    const next = skip.includes(id) ? skip : [...skip, id];
    setSkip(next);
    void load(next, Boolean(planId));
  }

  function startOver() {
    setSkip([]);
    void load([], Boolean(planId));
  }

  if (hidden) {
    return (
      <section
        aria-label="Tonight"
        className="mb-3 rounded-[20px] bg-duet-card px-4 py-3 shadow-duet-card"
      >
        <button
          className="type-sub font-semibold text-duet-ink"
          onClick={() => setHidden(false)}
          type="button"
        >
          Show tonight's plan
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="Tonight"
      className="mb-3 rounded-[20px] bg-duet-card px-4 py-4 shadow-duet-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="type-sub font-semibold">Tonight</h2>
          <p className="type-caption mt-0.5 text-duet-ink-2 [overflow-wrap:anywhere]">
            {summary || "A short plan from what's actually due."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="type-caption text-duet-ink-2">
            <span className="sr-only">Minutes</span>
            <input
              className="w-16 rounded-full bg-duet-tile px-2 py-2 text-center text-duet-ink"
              min={15}
              max={600}
              type="number"
              value={minutes}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                setMinutes(next);
                if (asked) void load(skip, Boolean(planId), next);
              }}
            />
          </label>
          <button
            className="type-caption min-h-11 rounded-full bg-duet-ink px-4 font-semibold text-duet-surface disabled:opacity-50"
            disabled={busy !== ""}
            onClick={() => void load(skip, false)}
            type="button"
          >
            {busy === "plan" ? "Planning…" : asked ? "Replan" : "Plan tonight"}
          </button>
        </div>
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
                  checked={false}
                  type="checkbox"
                  onChange={() => checkOff(row.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="type-caption font-semibold text-duet-ink-2">
                    {index + 1}. {row.start}–{row.end}
                    {row.minutes > 0 ? ` · ${row.minutes} min` : ""}
                  </span>
                  <span className="type-sub block text-duet-ink [overflow-wrap:anywhere]">
                    {row.title}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {remaining.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1">
          <li className="type-caption font-semibold text-duet-ink-2">
            Didn't fit
          </li>
          {remaining.map((item) => (
            <li
              className="type-caption text-duet-ink-2 [overflow-wrap:anywhere]"
              key={item.assignmentId}
            >
              {item.minutes} min of {item.title}
            </li>
          ))}
        </ul>
      ) : null}
      {warnings.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {warnings.slice(0, 3).map((warning) => (
            <li
              className="type-caption text-duet-ink-2 [overflow-wrap:anywhere]"
              key={warning}
            >
              {warning}
            </li>
          ))}
        </ul>
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
          <button
            className="type-caption min-h-11 rounded-full px-3 font-semibold text-duet-ink-2"
            onClick={() => setHidden(true)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </section>
  );
}
