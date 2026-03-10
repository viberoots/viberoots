/** @vitest-environment jsdom */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOARD_CELL_SIZE } from "../src/game/board.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";
import {
  cardByPieceId,
  flushUi,
  persistedState,
  snapTargetKeys,
  tapCard,
  wait,
} from "./game-drag-browser-helpers.ts";

describe("game drag browser flow", () => {
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
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    await flushUi();
  });

  it("tray taps rotate/flip pieces and drag still moves pieces", async () => {
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
      root.render(<GameScreen url="/games/pleomino" />);
      await flushUi();

      const blackPieceId = "black-1-1-1-1";
      tapCard(cardByPieceId(blackPieceId), { x: 108, y: 208 });
      await wait(260);
      await flushUi();
      expect(persistedState().transformByPieceId[blackPieceId].rotation).toBe(270);

      const orangePieceId = "orange-2-1-2";
      const orangeCard = cardByPieceId(orangePieceId);
      tapCard(orangeCard, { x: 108, y: 208 });
      await wait(170);
      tapCard(orangeCard, { x: 108, y: 208 });
      await wait(80);
      await flushUi();
      expect(persistedState().transformByPieceId[orangePieceId].flipped).toBe(true);

      const firstPiece = document.querySelector('[data-testid="pleomino-piece-view"]');
      if (!firstPiece) {
        throw new Error("expected at least one piece element");
      }
      firstPiece.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 108, clientY: 208 }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 3 + 10,
          clientY: 200 + BOARD_CELL_SIZE * 4 + 10,
        }),
      );
      await flushUi();

      expect(document.querySelector('[data-testid="pleomino-drag-ghost"]')).not.toBeNull();
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 3 + 10,
          clientY: 200 + BOARD_CELL_SIZE * 4 + 10,
        }),
      );
      await flushUi();
      expect(document.querySelector('[data-testid="pleomino-drag-ghost"]')).toBeNull();
      expect(persistedState().board.placedPieces.length).toBe(1);
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

  it("uses nearest valid drop target when pointer moves to an invalid in-board position", async () => {
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
      root.render(<GameScreen url="/games/pleomino" />);
      await flushUi();

      const firstPiece = document.querySelector('[data-testid="pleomino-piece-view"]');
      if (!firstPiece) {
        throw new Error("expected at least one piece element");
      }
      const draggedPieceLabel = firstPiece.getAttribute("aria-label") ?? "";
      const draggedPieceId = draggedPieceLabel.split(",")[0]?.replace(/^Piece\s+/, "");
      if (!draggedPieceId) {
        throw new Error("expected dragged piece id");
      }
      firstPiece.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 108, clientY: 208 }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 3 + 10,
          clientY: 200 + BOARD_CELL_SIZE * 4 + 10,
        }),
      );
      await flushUi();
      expect(snapTargetKeys().length).toBeGreaterThan(0);

      window.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 102, clientY: 206 }),
      );
      await flushUi();
      expect(snapTargetKeys().length).toBeGreaterThan(0);

      window.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 102, clientY: 206 }),
      );
      await flushUi();
      const afterDrop = persistedState();
      expect(afterDrop.board.placedPieces.length).toBe(1);
      expect(afterDrop.board.placedPieces[0]?.pieceId).toBe(draggedPieceId);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});
