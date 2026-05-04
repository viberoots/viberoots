/** @vitest-environment jsdom */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOARD_CELL_SIZE } from "../src/game/board";
import { GameScreen } from "../src/ui/game-screen";
import {
  cardByPieceId,
  flushUi,
  persistedState,
  snapTargetKeys,
} from "./game-drag-browser-helpers";

describe("game drag browser placement", () => {
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

  it("places white on a nearby empty target instead of stale-overlap cells", async () => {
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

      const blueCard = cardByPieceId("blue-3-1");
      blueCard.dispatchEvent(
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
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 3 + 10,
          clientY: 200 + BOARD_CELL_SIZE * 4 + 10,
        }),
      );
      await flushUi();
      expect(persistedState().board.placedPieces.length).toBe(1);

      const whiteCard = cardByPieceId("white-1-1");
      whiteCard.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 108, clientY: 208 }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 3 + 10,
          clientY: 200 + BOARD_CELL_SIZE * 5 + 10,
        }),
      );
      await flushUi();

      const whiteTarget = snapTargetKeys();
      expect(whiteTarget.length).toBeGreaterThan(0);
      const blueOccupied = new Set(["3,4", "3,5", "3,6", "4,6"]);
      expect(whiteTarget.some((key) => blueOccupied.has(key))).toBe(false);

      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 3 + 10,
          clientY: 200 + BOARD_CELL_SIZE * 5 + 10,
        }),
      );
      await flushUi();

      const afterWhitePlace = persistedState();
      expect(afterWhitePlace.board.placedPieces.length).toBe(2);
      expect(
        afterWhitePlace.board.placedPieces.some((piece) => piece.pieceId === "white-1-1"),
      ).toBe(true);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it("treats far mouseup as drag end even when mousemove events are skipped", async () => {
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

      const purpleCard = cardByPieceId("purple-2-1");
      purpleCard.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 108, clientY: 208 }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 3 + 10,
          clientY: 200 + BOARD_CELL_SIZE * 4 + 10,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 3 + 10,
          clientY: 200 + BOARD_CELL_SIZE * 4 + 10,
        }),
      );
      await flushUi();
      const placedPiece = persistedState().board.placedPieces[0];
      if (!placedPiece) {
        throw new Error("expected placed piece");
      }
      const placedStartCell = document.querySelector(
        '[data-testid="pleomino-board-cell"][style*="background-color"]',
      );
      if (!placedStartCell) {
        throw new Error("expected at least one placed board cell");
      }
      placedStartCell.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * placedPiece.position.x + 16,
          clientY: 200 + BOARD_CELL_SIZE * placedPiece.position.y + 16,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 560, clientY: 220 }),
      );
      await flushUi();
      expect(persistedState().board.placedPieces.length).toBe(0);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});
