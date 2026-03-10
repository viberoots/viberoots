/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
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
  const countLabel = document.querySelector(`[data-testid="tangram-piece-count-${pieceId}"]`);
  const card =
    countLabel?.closest('[data-testid="tangram-piece-view"]') ?? countLabel?.parentElement;
  if (!card) {
    throw new Error(`expected piece card ${pieceId}`);
  }
  return card;
}

describe("game keyboard flow", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

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
      expect(document.body.textContent ?? "").toContain("Transform: 90deg, flipped=no");

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushUi();

      expect(document.body.textContent ?? "").toContain("Placed pieces: 1");

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
      await flushUi();
      expect(document.body.textContent ?? "").toContain("Transform: 180deg, flipped=no");

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
      await flushUi();
      expect(document.body.textContent ?? "").toContain("Transform: 180deg, flipped=yes");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});
