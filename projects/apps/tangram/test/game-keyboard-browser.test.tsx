/** @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { loadPersistedGameStateFromHash } from "../src/game/persistence.ts";
import { createInitialGameState } from "../src/game/state.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leftClickCard(card: Element, x = 108, y = 208) {
  card.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
  card.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
}

function cardByPieceId(pieceId: string): Element {
  const cards = Array.from(document.querySelectorAll('[data-testid="tangram-piece-view"]'));
  const card = cards.find((candidate) => {
    const label = candidate.getAttribute("aria-label");
    return typeof label === "string" && label.startsWith(`Piece ${pieceId},`);
  });
  if (!card) {
    throw new Error(`expected piece card ${pieceId}`);
  }
  return card;
}

function persistedState() {
  const restored = loadPersistedGameStateFromHash(window.location, createInitialGameState());
  if (!restored) {
    throw new Error("expected persisted state");
  }
  return restored;
}

describe("game keyboard flow", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
  });

  afterEach(async () => {
    if (root) {
      root.unmount();
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    await flushUi();
  });

  it("supports keyboard movement, commit, rotate, and flip for selected piece", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.tagName.toLowerCase() === "div") {
        return {
          left: 100,
          top: 200,
          width: 320,
          height: 480,
          right: 420,
          bottom: 680,
          x: 100,
          y: 200,
          toJSON() {
            return this;
          },
        } as DOMRect;
      }
      return originalRect.call(this);
    };

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      root.render(<GameScreen url="/games/tangram" />);
      await flushUi();

      const pieceId = "purple-2-1";
      leftClickCard(cardByPieceId(pieceId));
      await wait(260);
      await flushUi();
      const afterTap = persistedState();
      expect(afterTap.transformByPieceId[pieceId].rotation).toBe(270);
      expect(afterTap.transformByPieceId[pieceId].flipped).toBe(false);

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushUi();

      const afterCommit = persistedState();
      expect(afterCommit.board.placedPieces.length).toBe(1);

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
      await flushUi();
      const afterRotate = persistedState();
      const rotatedPlacement = afterRotate.board.placedPieces[0];
      expect(rotatedPlacement?.transform.rotation).toBe(270);
      expect(rotatedPlacement?.transform.flipped).toBe(false);

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
      await flushUi();
      const afterFlip = persistedState();
      const flippedPlacement = afterFlip.board.placedPieces[0];
      expect(flippedPlacement?.transform.rotation).toBe(270);
      expect(flippedPlacement?.transform.flipped).toBe(false);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});
