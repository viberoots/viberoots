/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { TANGRAM_PIECE_CATALOG } from "../src/game/piece-catalog.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";

type Pointer = { x: number; y: number };

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cardByPieceId(pieceId: string): Element {
  const pieceIndex = TANGRAM_PIECE_CATALOG.findIndex((piece) => piece.pieceId === pieceId);
  const card = document.querySelectorAll('[data-testid="tangram-piece-view"]')[pieceIndex];
  if (!card) {
    throw new Error(`expected piece card ${pieceId}`);
  }
  return card;
}

function tapCard(card: Element, pointer: Pointer) {
  card.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: pointer.x,
      clientY: pointer.y,
    }),
  );
  card.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: pointer.x,
      clientY: pointer.y,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: pointer.x,
      clientY: pointer.y,
    }),
  );
}

function rightClickCard(card: Element, pointer: Pointer) {
  card.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 2,
      clientX: pointer.x,
      clientY: pointer.y,
    }),
  );
  card.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 2,
      clientX: pointer.x,
      clientY: pointer.y,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      button: 2,
      clientX: pointer.x,
      clientY: pointer.y,
    }),
  );
}

describe("game drag browser flow", () => {
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

  it("single tap rotates, double tap flips, and drag still moves pieces", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const scrollXDescriptor = Object.getOwnPropertyDescriptor(window, "scrollX");
    const scrollYDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
    Object.defineProperty(window, "scrollX", { configurable: true, value: 64 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 96 });
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

      const blackPieceId = "black-1-1-1-1";
      const blackCard = cardByPieceId(blackPieceId);
      tapCard(blackCard, { x: 108, y: 208 });
      await wait(260);
      await flushUi();
      expect(document.body.textContent ?? "").toContain("Transform: 90deg, flipped=no");

      rightClickCard(blackCard, { x: 108, y: 208 });
      await wait(260);
      await flushUi();
      expect(document.body.textContent ?? "").toContain("Transform: 0deg, flipped=no");

      const orangePieceId = "orange-2-1-2";
      const orangeCard = cardByPieceId(orangePieceId);
      tapCard(orangeCard, { x: 108, y: 208 });
      tapCard(orangeCard, { x: 108, y: 208 });
      await wait(80);
      await flushUi();
      expect(document.body.textContent ?? "").toContain("Transform: 0deg, flipped=yes");

      const firstPiece = document.querySelector('[data-testid="tangram-piece-view"]');
      if (!firstPiece) {
        throw new Error("expected at least one piece element");
      }

      firstPiece.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 108,
          clientY: 208,
        }),
      );

      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100 + 32 * 3 + 10,
          clientY: 200 + 32 * 4 + 10,
        }),
      );
      await flushUi();

      expect(document.querySelector('[data-testid="tangram-drag-ghost"]')).not.toBeNull();
      expect(
        document.querySelectorAll('[data-testid="tangram-board-cell-snap-target"]').length,
      ).toBeGreaterThan(0);
      const dragGhostCell = document.querySelector('[data-testid="tangram-drag-ghost"] > div');
      expect(dragGhostCell).not.toBeNull();
      expect((dragGhostCell as HTMLElement).style.top).toBe("330px");
      expect((dragGhostCell as HTMLElement).style.left).toBe("198px");

      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 100 + 32 * 3 + 10,
          clientY: 200 + 32 * 4 + 10,
        }),
      );
      await flushUi();

      expect(document.querySelector('[data-testid="tangram-drag-ghost"]')).toBeNull();
      expect(document.body.textContent ?? "").toContain("Placed pieces: 1");
      expect(document.body.textContent ?? "").toContain("4 left");

      const placedStartCell = document.querySelector(
        '[data-testid="tangram-board-cell"][style*="background-color"]',
      );
      if (!placedStartCell) {
        throw new Error("expected at least one placed board cell");
      }

      placedStartCell.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 100 + 32 * 3 + 16,
          clientY: 200 + 32 * 4 + 16,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100 + 32 * 5 + 16,
          clientY: 200 + 32 * 6 + 16,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 100 + 32 * 5 + 16,
          clientY: 200 + 32 * 6 + 16,
        }),
      );
      await flushUi();

      expect(document.body.textContent ?? "").toContain("Placed pieces: 1");
      expect(document.body.textContent ?? "").toContain("4 left");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      if (scrollXDescriptor) {
        Object.defineProperty(window, "scrollX", scrollXDescriptor);
      } else {
        delete (window as Partial<Window>).scrollX;
      }
      if (scrollYDescriptor) {
        Object.defineProperty(window, "scrollY", scrollYDescriptor);
      } else {
        delete (window as Partial<Window>).scrollY;
      }
    }
  });
});
