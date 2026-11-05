// Screenshot-only page: the chat's study cards, drawn from real records, without a live model.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ConversationSendContext } from "@/components/channels/conversation-send";
import { ProgressCard, TeacherRuleNotice } from "@/components/duet/study";
import { TypingDots } from "@/components/duet/kit";
import { DeckToolCard } from "@/lib/copilot/flashcards-card-tool";
import { readBrief, StartableBrief } from "@/lib/copilot/morning-brief-tool";
import { QuizToolCard } from "@/lib/copilot/quiz-card-tool";
import { ProposedPlanCard } from "@/lib/copilot/study-plan-card-tool";
import { progressQueryOptions } from "@/lib/study/quizzes";
import briefJson from "@/lib/demo-brief.json";

export const Route = createFileRoute("/_authed/_app/demo-cards")({
  validateSearch: (s: Record<string, unknown>) => ({
    card: String(s.card ?? "brief"),
    id: s.id ? String(s.id) : "",
  }),
  component: DemoCards,
});

const send = { send: () => true, isLatestTurn: () => true };

function Turn({ ask, say, children }: { ask: string; say: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pt-28 pb-40">
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-2xl bg-foreground/[0.07] px-4 py-2.5 text-[15px]">{ask}</p>
      </div>
      <p className="text-[15px]">{say}</p>
      {children}
    </div>
  );
}

function Progress() {
  const q = useQuery(progressQueryOptions(null));
  return q.data ? <ProgressCard summary={q.data} /> : <p>Loading…</p>;
}

function DemoCards() {
  const { card, id } = Route.useSearch();
  let body: ReactNode = null;
  if (card === "brief")
    body = (
      <Turn ask="Good morning" say="Morning, Jordan. Precalc homework is late, so start there.">
        <StartableBrief brief={readBrief(JSON.stringify(briefJson))!} />
      </Turn>
    );
  if (card === "quiz")
    body = (
      <Turn ask="Quiz me for my trig identities quiz tomorrow" say="Here's a 5-question quiz on trig identities.">
        <QuizToolCard made={{ kind: "quiz", id, title: "Trig identities warm-up", className: "Precalculus", count: 5 } as never} />
      </Turn>
    );
  if (card === "deck")
    body = (
      <Turn ask="Make me flashcards for my Spanish vocab test" say="Here are 10 cards for Unidad 5.">
        <DeckToolCard made={{ kind: "deck", id, title: "Unidad 5: La comida y la salud", className: "Spanish III", count: 10 } as never} />
      </Turn>
    );
  if (card === "plan")
    body = (
      <Turn ask="I have 3 hours tonight and tomorrow. Plan it?" say="Here's tonight and tomorrow: Precalc first, then the lab report. The Gatsby essay didn't fit.">
        <ProposedPlanCard proposed={{ kind: "plan", id, startDate: "2026-11-05", blocks: 5, totalMinutes: 180, remainingMinutes: 345, warnings: ["Precalculus: Section 4.3 homework is scheduled after its deadline (Wed, Nov 4 at 11:59 PM). The deadline has not changed."] } as never} />
      </Turn>
    );
  if (card === "progress")
    body = (
      <Turn ask="How am I doing?" say="Pythagorean identities look solid. Double-angle is where you're missing points.">
        <Progress />
      </Turn>
    );
  if (card === "thinking")
    body = (
      <Turn ask="Can you explain the double-angle identity?" say="">
        <TypingDots />
      </Turn>
    );
  if (card === "rule")
    body = (
      <Turn ask="Quiz me on the causes of the Civil War for my DBQ" say="Mr. Grant set the DBQ to no AI help, so I can't quiz you on it. Want me to plan your time for it instead?">
        <TeacherRuleNotice block={{ classId: "apush1", className: "AP US History", level: "none", assignment: "DBQ essay: Causes of the Civil War", teacher: "Mr. Grant", source: "notice" }} what="Quiz" />
      </Turn>
    );
  return (
    <ConversationSendContext.Provider value={send}>
      <div className="h-full overflow-y-auto">{body}</div>
    </ConversationSendContext.Provider>
  );
}
