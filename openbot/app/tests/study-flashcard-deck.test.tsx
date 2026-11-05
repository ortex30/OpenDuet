import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FlashcardDeck as Deck } from "@openbot/shared/study";
import { FlashcardDeck } from "@/components/duet/study";
import { settleReactWork } from "./settle-react-work";

/*
 * A deck of flashcards on its own: the card is a button that turns over, the arrows wrap around,
 * Got it and Again mark a card and move on, and the round ends in a summary that can send the Again
 * cards round once more.
 */

let matchMedia: typeof window.matchMedia;
beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
  matchMedia = window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.matchMedia = matchMedia;
});
afterAll(async () => {
  await settleReactWork();
  GlobalRegistrator.unregister();
});

function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const deck: Deck = {
  id: "deck-1",
  title: "Cell organelles",
  classId: "bio",
  className: "AP Biology",
  assignmentId: null,
  createdAt: "2026-11-04T15:00:00.000Z",
  cards: [
    { front: "Mitochondria", back: "Makes ATP through cellular respiration." },
    { front: "Ribosome", back: "Builds proteins from mRNA." },
    { front: "Golgi apparatus", back: "Packages and ships proteins." },
    { front: "Lysosome", back: "Breaks down waste with enzymes." },
  ],
};
const fronts = deck.cards.map((card) => card.front);

function drawDeck(onQuizMe: (() => void) | null = null) {
  return render(<FlashcardDeck deck={deck} onQuizMe={onQuizMe} />);
}

type View = ReturnType<typeof render>;
const face = (view: View) =>
  view.container.querySelector<HTMLButtonElement>("[data-side]")!;
const shown = (view: View) =>
  view.container.querySelector("[data-card-text]")?.textContent ?? null;
const counter = (view: View) => view.getByText(/^\d+ of \d+$/).textContent;
const announced = (view: View) =>
  view.container.querySelector("[aria-live]")?.textContent ?? null;
const press = (view: View, name: string) =>
  fireEvent.click(view.getByRole("button", { name }));

describe("turning a card over", () => {
  test("one card at a time, the prompt first; a tap turns it over and back", () => {
    const view = drawDeck();

    expect(
      view.getByRole("region", { name: "Flashcards: Cell organelles" }),
    ).toBeTruthy();
    expect(view.getByText("AP Biology")).toBeTruthy();
    expect(counter(view)).toBe("1 of 4");
    expect(face(view).getAttribute("aria-label")).toBe("Prompt: Mitochondria");
    expect(shown(view)).toBe("Mitochondria");

    fireEvent.click(face(view));
    expect(face(view).getAttribute("data-side")).toBe("answer");
    expect(face(view).getAttribute("aria-label")).toBe(
      "Answer: Makes ATP through cellular respiration.",
    );
    expect(shown(view)).toBe("Makes ATP through cellular respiration.");

    fireEvent.click(face(view));
    expect(face(view).getAttribute("data-side")).toBe("prompt");
    expect(shown(view)).toBe("Mitochondria");
  });

  test("Enter and Space turn it over, since the card is a button", async () => {
    const user = userEvent.setup({ document });
    const view = drawDeck();
    face(view).focus();

    await user.keyboard("{Enter}");
    expect(face(view).getAttribute("data-side")).toBe("answer");
    await user.keyboard(" ");
    expect(face(view).getAttribute("data-side")).toBe("prompt");
  });

  test("the new side is said aloud through a live region; nothing is said on arrival", () => {
    const view = drawDeck();
    const live = view.container.querySelector("[aria-live]");

    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(announced(view)).toBe("");
    fireEvent.click(face(view));
    expect(announced(view)).toBe(
      "Answer: Makes ATP through cellular respiration.",
    );
    press(view, "Next card");
    expect(announced(view)).toBe("Card 2 of 4. Ribosome");
  });

  test("the first side is drawn still, a new side swaps in out of a blur", () => {
    reducedMotion(false);
    const view = drawDeck();
    const text = () =>
      view.container.querySelector<HTMLElement>("[data-card-text]")!;

    expect(text().style.opacity ?? "").not.toBe("0");
    fireEvent.click(face(view));
    expect(text().style.opacity).toBe("0");
    expect(text().style.filter).toBe("blur(2px)");
    expect(text().style.transform).toContain("translateY(4px)");
  });

  test("with reduced motion a new side only cross-fades", () => {
    reducedMotion(true);
    const view = drawDeck();
    fireEvent.click(face(view));
    const text = view.container.querySelector<HTMLElement>("[data-card-text]")!;

    expect(text.style.opacity).toBe("0");
    expect(text.style.filter ?? "").toBe("");
    expect(text.style.transform ?? "").toBe("");
  });
});

describe("moving through the deck", () => {
  test("previous and next wrap around, and turn the card back to its prompt", () => {
    const view = drawDeck();

    press(view, "Previous card");
    expect(counter(view)).toBe("4 of 4");
    expect(shown(view)).toBe("Lysosome");
    press(view, "Next card");
    expect(counter(view)).toBe("1 of 4");

    fireEvent.click(face(view));
    press(view, "Next card");
    expect(counter(view)).toBe("2 of 4");
    expect(face(view).getAttribute("data-side")).toBe("prompt");
  });

  test("the arrow keys move while the card or an arrow has focus, and wrap", () => {
    const view = drawDeck();

    fireEvent.keyDown(face(view), { key: "ArrowRight" });
    expect(counter(view)).toBe("2 of 4");
    fireEvent.keyDown(face(view), { key: "ArrowLeft" });
    fireEvent.keyDown(face(view), { key: "ArrowLeft" });
    expect(counter(view)).toBe("4 of 4");
    fireEvent.keyDown(view.getByRole("button", { name: "Next card" }), {
      key: "ArrowRight",
    });
    expect(counter(view)).toBe("1 of 4");
    // Alt+← is the browser's Back, not ours.
    fireEvent.keyDown(face(view), { key: "ArrowLeft", altKey: true });
    expect(counter(view)).toBe("1 of 4");
  });

  test("Shuffle keeps every card, in a new order, from the first", () => {
    const view = drawDeck();
    press(view, "Next card");

    press(view, "Shuffle");
    expect(counter(view)).toBe("1 of 4");
    const order: (string | null)[] = [];
    for (let step = 0; step < deck.cards.length; step++) {
      order.push(shown(view));
      press(view, "Next card");
    }

    expect([...order].sort()).toEqual([...fronts].sort());
    expect(order).not.toEqual(fronts);
    expect(counter(view)).toBe("1 of 4");
  });
});

describe("marking cards", () => {
  test("Got it and Again come only after the card is turned over", () => {
    const view = drawDeck();

    expect(view.queryByRole("button", { name: "Got it" })).toBeNull();
    expect(view.queryByRole("button", { name: "Again" })).toBeNull();
    expect(
      view.getByText("Think of the answer, then flip the card."),
    ).toBeTruthy();
    fireEvent.click(face(view));
    expect(view.getByRole("button", { name: "Got it" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Again" })).toBeTruthy();
  });

  test("marking moves on to the next card, its prompt up and focused", () => {
    const view = drawDeck();

    fireEvent.click(face(view));
    press(view, "Got it");

    expect(counter(view)).toBe("2 of 4");
    expect(face(view).getAttribute("data-side")).toBe("prompt");
    expect(document.activeElement).toBe(face(view));

    // Back on the marked card, it says how it was marked.
    press(view, "Previous card");
    expect(view.getByText("Got it")).toBeTruthy();
    expect(face(view).getAttribute("aria-label")).toBe(
      "Prompt: Mitochondria (marked Got it)",
    );
  });

  test("when every card is marked, a summary counts them and takes focus", () => {
    const view = drawDeck();
    for (const markAs of ["Got it", "Again", "Got it", "Again"]) {
      fireEvent.click(face(view));
      press(view, markAs);
    }

    const summary = view.getByText("2 got it · 2 to review");
    expect(document.activeElement).toBe(summary);
    expect(view.container.querySelector("[data-side]")).toBeNull();
    expect(
      view.getByRole("button", { name: "Review the 2 again" }),
    ).toBeTruthy();
    expect(view.getByRole("button", { name: "Start over" })).toBeTruthy();
  });

  test("Review again runs only the Again cards; Start over runs them all", () => {
    const view = drawDeck();
    for (const markAs of ["Got it", "Again", "Got it", "Again"]) {
      fireEvent.click(face(view));
      press(view, markAs);
    }

    press(view, "Review the 2 again");
    expect(counter(view)).toBe("1 of 2");
    expect(shown(view)).toBe("Ribosome");
    expect(document.activeElement).toBe(face(view));
    press(view, "Next card");
    expect(shown(view)).toBe("Lysosome");
    press(view, "Next card");
    expect(shown(view)).toBe("Ribosome");

    fireEvent.click(face(view));
    press(view, "Got it");
    fireEvent.click(face(view));
    press(view, "Again");
    expect(view.getByText("1 got it · 1 to review")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Review that one again" }),
    ).toBeTruthy();

    press(view, "Start over");
    expect(counter(view)).toBe("1 of 4");
    expect(shown(view)).toBe("Mitochondria");
    expect(view.queryByText("Got it")).toBeNull();
  });

  test("with every card known, only Start over is offered", () => {
    const view = drawDeck();
    for (let card = 0; card < deck.cards.length; card++) {
      fireEvent.click(face(view));
      press(view, "Got it");
    }

    expect(view.getByText("4 got it · 0 to review")).toBeTruthy();
    expect(view.getByText("You knew every card in this round.")).toBeTruthy();
    expect(view.queryByRole("button", { name: /^Review/ })).toBeNull();
    expect(
      view.getByRole("button", { name: "Start over" }).className,
    ).toContain("bg-duet-black");
  });
});

test("Quiz me on these is there only when it can be sent, and calls back", () => {
  const quizMe = mock(() => {});
  const view = drawDeck(quizMe);

  press(view, "Quiz me on these");
  expect(quizMe).toHaveBeenCalledTimes(1);
  cleanup();

  const without = drawDeck();
  expect(
    without.queryByRole("button", { name: "Quiz me on these" }),
  ).toBeNull();
});

test("a deck of one has nowhere to move and nothing to shuffle", () => {
  const view = render(
    <FlashcardDeck deck={{ ...deck, cards: deck.cards.slice(0, 1) }} />,
  );

  expect(counter(view)).toBe("1 of 1");
  for (const name of ["Previous card", "Next card", "Shuffle"])
    expect(
      (view.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(true);
});
