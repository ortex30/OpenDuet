import type { FlashcardDeck as Deck } from "@openbot/shared/study";
import { motion } from "motion/react";
import {
  type ComponentProps,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { SmallPill } from "@/components/shell/suggestion-card";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { useReducedMotionPreference } from "@/lib/reduced-motion";
import { cn } from "@/lib/utils";
import { BuildIn } from "../build-in";
import { DuetIcon, type DuetIconName } from "../icons";
import { DuetCard } from "../kit";
import { shuffled } from "./format";

type Mark = "got" | "again";

const MARK_WORD: Record<Mark, string> = { got: "Got it", again: "Again" };

/** How far a side's words travel as they swap in, in pixels: the brief's swap (morning-brief-card). */
const SWAP_RISE = 4;

/** A prompt up to this long is drawn at the display size; a longer one at the nav size. */
const PROMPT_DISPLAY_CHARS = 60;

/** One pass through the deck, or through the cards marked Again in the pass before. */
type Round = {
  /** The cards in this round, as indexes into the deck, in the order they are shown. */
  cards: number[];
  /** Where in `cards` the person is. */
  at: number;
  flipped: boolean;
  /** How each card was marked in this round, by its index in the deck. */
  marks: (Mark | null)[];
};

function freshRound(count: number, cards?: number[]): Round {
  return {
    cards: cards ?? Array.from({ length: count }, (_, index) => index),
    at: 0,
    flipped: false,
    marks: Array.from({ length: count }, () => null),
  };
}

/**
 * A deck of flashcards in the chat, one card at a time.
 *
 * The card is the button: a tap, Enter or Space turns it over, and the new side's words swap in
 * (a cross-fade only, with reduced motion). Once it shows the answer the person marks it Got it or
 * Again and the next unmarked card comes up; when every card in the round is marked, a summary says
 * how it went and offers the Again cards on their own. The arrows step through the deck either way
 * and wrap around, as do ← and → while the card or an arrow has focus.
 *
 * Nothing is saved: flashcards are for recall, and only a quiz counts as practice. Props only, so
 * the tool renderer decides whether "Quiz me on these" can be sent.
 */
export function FlashcardDeck({
  deck,
  onQuizMe = null,
}: {
  deck: Deck;
  onQuizMe?: (() => void) | null;
}) {
  return (
    <BuildIn order={0}>
      <DuetCard aria-label={`Flashcards: ${deck.title}`} role="region">
        <BuildIn className="px-4 pt-[18px]" order={0}>
          <span className="type-caption inline-flex h-6 items-center rounded-full bg-duet-accent-soft px-2.5 font-semibold text-duet-accent [overflow-wrap:anywhere]">
            {deck.className}
          </span>
          <p className="type-row mt-2 font-semibold [overflow-wrap:anywhere]">
            {deck.title}
          </p>
        </BuildIn>
        {deck.cards.length === 0 ? (
          <p className="type-sub px-4 pt-2 pb-4 text-duet-ink-2">
            This deck has no cards.
          </p>
        ) : (
          <DeckBody
            deck={deck}
            // A different deck starts from its own first card.
            key={`${deck.id}:${deck.cards.length}`}
            onQuizMe={onQuizMe}
          />
        )}
      </DuetCard>
    </BuildIn>
  );
}

function DeckBody({
  deck,
  onQuizMe,
}: {
  deck: Deck;
  onQuizMe: (() => void) | null;
}) {
  const count = deck.cards.length;
  const [round, setRound] = useState<Round>(() => freshRound(count));
  // Drawn still until something changes it, so a deck read back from history doesn't animate.
  const [touched, setTouched] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [focusOn, setFocusOn] = useState<"face" | "summary" | null>(null);
  const [flipping, setFlipping] = useState(false);
  const face = useRef<HTMLButtonElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const reduced = useReducedMotionPreference();
  /*
   * Marking a card takes its buttons away, and the summary takes the card away, so focus is put
   * back where the person's next press is: on the next card, or on the summary.
   */
  useEffect(() => {
    if (focusOn === null) return;
    (focusOn === "face" ? face.current : summary.current)?.focus();
    setFocusOn(null);
  }, [focusOn]);

  const done =
    round.cards.length > 0 &&
    round.cards.every((card) => round.marks[card] != null);
  const current = round.cards[round.at] ?? 0;
  const card = deck.cards[current] ?? { front: "", back: "" };
  const side = round.flipped ? "Answer" : "Term";
  const text = round.flipped ? card.back : card.front;
  const marked = round.marks[current] ?? null;

  const show = (
    next: Round,
    words: string | null,
    focus: "face" | "summary" | null = null,
  ) => {
    setRound(next);
    setTouched(true);
    // A screen reader hears the new side or card here; where focus moves, it hears that instead.
    if (words !== null) setAnnouncement(words);
    if (focus) setFocusOn(focus);
  };
  const cardWords = (next: Round) =>
    `Card ${next.at + 1} of ${next.cards.length}. ${deck.cards[next.cards[next.at] ?? 0]?.front ?? ""}`;
  const flip = () => {
    const next = { ...round, flipped: !round.flipped };
    if (!reduced) {
      setFlipping(false);
      window.requestAnimationFrame(() => setFlipping(true));
    }
    show(next, next.flipped ? `Answer: ${card.back}` : `Prompt: ${card.front}`);
  };
  const move = (step: number) => {
    const total = round.cards.length;
    if (total < 2) return;
    const next = {
      ...round,
      at: (round.at + step + total) % total,
      flipped: false,
    };
    show(next, cardWords(next));
  };
  const mark = (value: Mark) => {
    const marks = round.marks.map((was, index) =>
      index === current ? value : was,
    );
    const total = round.cards.length;
    // On to the next card still unmarked, wrapping; none left means the round is over.
    for (let step = 1; step <= total; step++) {
      const at = (round.at + step) % total;
      if (marks[round.cards[at] ?? 0] == null) {
        show({ ...round, marks, at, flipped: false }, null, "face");
        return;
      }
    }
    show({ ...round, marks, flipped: false }, null, "summary");
  };
  const shuffle = () => {
    const next = {
      ...round,
      cards: shuffled(round.cards),
      at: 0,
      flipped: false,
    };
    show(next, `Shuffled. ${cardWords(next)}`);
  };
  const arrows = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    move(event.key === "ArrowLeft" ? -1 : 1);
  };

  if (done) {
    const got = round.cards.filter((index) => round.marks[index] === "got");
    const again = round.cards.filter((index) => round.marks[index] === "again");
    return (
      <div className="px-4 pt-3 pb-4">
        <div className="rounded-[18px] bg-duet-tile px-5 py-5">
          <p
            className="type-nav font-semibold tabular-nums outline-none"
            data-deck-summary
            ref={summary}
            tabIndex={-1}
          >
            {`${got.length} got it · ${again.length} to review`}
          </p>
          <p className="type-sub mt-1 text-duet-ink-2">
            {again.length > 0
              ? "Run the Again ones once more."
              : "You knew them all."}
          </p>
        </div>
        {/* One above the other, the next step first, as the quiz's results end. */}
        <div className="mt-3 flex flex-col gap-2">
          {again.length > 0 ? (
            <SmallPill
              onClick={() => show(freshRound(count, again), null, "face")}
              primary
            >
              {`Review ${again.length}`}
            </SmallPill>
          ) : null}
          <SmallPill
            onClick={() => show(freshRound(count), null, "face")}
            primary={again.length === 0}
          >
            Start over
          </SmallPill>
        </div>
        <QuizMe onQuizMe={onQuizMe} />
      </div>
    );
  }

  return (
    <div className="px-4 pt-3 pb-4">
      <button
        aria-label={`${side}: ${text}${marked ? ` (marked ${MARK_WORD[marked]})` : ""}`}
        className={cn(
          "flex min-h-[176px] w-full flex-col rounded-[18px] px-5 pt-4 pb-3 text-left transition-[background-color,box-shadow,transform] duration-[var(--duet-dur-swap)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 active:scale-[0.99] motion-reduce:active:scale-100",
          flipping && "study-flip",
          // The answer side lifts onto the card's own white, so the two sides read as two faces.
          round.flipped
            ? "bg-duet-pop-b-soft shadow-[inset_0_0_0_2px_var(--duet-pop-b)]"
            : "bg-[image:var(--duet-face-gradient)] text-white",
        )}
        data-side={round.flipped ? "answer" : "prompt"}
        onAnimationEnd={() => setFlipping(false)}
        onClick={flip}
        onKeyDown={arrows}
        ref={face}
        type="button"
      >
        <span className="flex min-h-6 items-center justify-between gap-3">
          <span
            className={cn(
              "type-caption font-medium",
              round.flipped ? "text-duet-pop-b" : "text-white/80",
            )}
          >
            {side}
          </span>
          {marked ? (
            <span
              className={cn(
                "type-caption inline-flex h-6 items-center rounded-full px-2 font-medium",
                marked === "got"
                  ? "bg-duet-status-done-soft text-duet-status-done"
                  : "bg-duet-status-needs-soft text-duet-status-needs",
              )}
            >
              {MARK_WORD[marked]}
            </span>
          ) : null}
        </span>
        <motion.span
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          className={cn(
            // Centred in the face between its label and its hint, as words on a card are.
            "my-auto block py-3 [overflow-wrap:anywhere]",
            round.flipped
              ? "type-body"
              : // A term reads large; a whole question steps down so it still fits the face.
                text.length > PROMPT_DISPLAY_CHARS
                ? "type-nav font-semibold"
                : "type-display font-semibold",
          )}
          data-card-text
          initial={
            touched
              ? reduced
                ? { opacity: 0 }
                : { opacity: 0, y: SWAP_RISE, filter: "blur(2px)" }
              : false
          }
          // A new side or a new card is a new piece of text, so it swaps in rather than retyping.
          key={`${current}-${side}`}
          transition={{ duration: DURATION.swap, ease: EASE_OUT }}
        >
          {text}
        </motion.span>
        <span
          aria-hidden
          className={cn(
            "type-caption text-right",
            round.flipped ? "text-duet-ink-3" : "text-white/70",
          )}
        >
          Tap to flip
        </span>
      </button>
      {/* Its buttons stand in the hint's place, so the row never changes height under a thumb. */}
      <div className="mt-3 flex min-h-11 gap-2">
        {round.flipped ? (
          <>
            <SmallPill onClick={() => mark("again")}>Again</SmallPill>
            <SmallPill onClick={() => mark("got")} primary>
              Got it
            </SmallPill>
          </>
        ) : (
          <p className="type-sub flex flex-1 items-center justify-center text-center text-duet-ink-3">
            Know it? Flip to check.
          </p>
        )}
      </div>
      <div className="mt-1 flex items-center">
        <ArrowButton
          disabled={round.cards.length < 2}
          icon="chevronLeft"
          label="Previous card"
          onClick={() => move(-1)}
          onKeyDown={arrows}
        />
        <p className="type-sub min-w-[4.5rem] text-center font-medium text-duet-ink-2 tabular-nums">
          {`${round.at + 1} of ${round.cards.length}`}
        </p>
        <ArrowButton
          disabled={round.cards.length < 2}
          icon="chevronRight"
          label="Next card"
          onClick={() => move(1)}
          onKeyDown={arrows}
        />
        <button
          className="type-sub ml-auto inline-flex h-11 items-center rounded-full px-3 font-medium text-duet-ink-2 transition-colors hover:bg-duet-tile hover:text-duet-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 active:bg-duet-tile disabled:opacity-40"
          disabled={round.cards.length < 2}
          onClick={shuffle}
          type="button"
        >
          Shuffle
        </button>
      </div>
      <QuizMe onQuizMe={onQuizMe} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function ArrowButton({
  icon,
  label,
  ...props
}: { icon: DuetIconName; label: string } & Omit<
  ComponentProps<"button">,
  "children" | "type"
>) {
  return (
    <button
      aria-label={label}
      className="grid size-11 shrink-0 place-items-center rounded-full text-duet-ink transition-colors hover:bg-duet-tile focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-duet-accent/40 active:bg-duet-tile disabled:opacity-40"
      type="button"
      {...props}
    >
      <DuetIcon name={icon} size={20} stroke={2} />
    </button>
  );
}

function QuizMe({ onQuizMe }: { onQuizMe: (() => void) | null }) {
  if (!onQuizMe) return null;
  return (
    <div className="mt-2 flex">
      <SmallPill onClick={onQuizMe}>Quiz me on these</SmallPill>
    </div>
  );
}
