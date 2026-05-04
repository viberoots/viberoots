/** @vitest-environment jsdom */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameScreen } from "../src/ui/game-screen";
import { centeredOffset, flushUi, parsePx } from "./game-drag-browser-helpers";

describe("game drag browser small viewport visibility", () => {
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

  it("keeps every tray piece fully visible within the small-mode viewport", async () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      root.render(<GameScreen url="/games/pleomino" />);
      await flushUi();
      window.dispatchEvent(new Event("resize"));
      await flushUi();

      const boardCell = document.querySelector(
        '[data-testid="pleomino-board-cell"]',
      ) as HTMLElement | null;
      if (!boardCell) {
        throw new Error("expected board cell");
      }
      const cellSize = parsePx(boardCell.style.width);
      const trayRows = Array.from(
        document.querySelectorAll('[data-testid^="pleomino-piece-tray-row-"]'),
      ) as HTMLElement[];
      expect(trayRows.length).toBe(2);
      const trayCard = document.querySelector('[data-testid="pleomino-piece-tray-grid"]')
        ?.parentElement as HTMLElement | null;
      if (!trayCard) {
        throw new Error("expected tray card");
      }

      const trayWidth = parsePx(trayCard.style.width);
      const trayInnerWidth = trayWidth - 8;
      const columnGap = 8;
      const rowGap = 14;
      const trayVerticalPadding = 4;
      const pagePadding = 2;
      const boardPadding = 6;
      const boardBorder = 1;
      const layoutGap = 4;
      const viewportInnerWidth = window.innerWidth - pagePadding * 2;
      const boardHeight = cellSize * 15 + (boardPadding + boardBorder) * 2;
      const boardCardWidth = cellSize * 10 + (boardPadding + boardBorder) * 2;
      const boardLeft = pagePadding + centeredOffset(viewportInnerWidth, boardCardWidth);
      const boardTop = pagePadding;
      expect(boardLeft + boardCardWidth).toBeLessThanOrEqual(window.innerWidth);
      expect(boardTop + boardHeight).toBeLessThanOrEqual(window.innerHeight);

      const trayLeft = pagePadding + centeredOffset(viewportInnerWidth, trayWidth);
      const trayTop = boardTop + boardHeight + layoutGap;
      let trayRowsHeight = 0;
      let currentRowTop = trayTop + 2;
      for (const row of trayRows) {
        const pieceViews = Array.from(
          row.querySelectorAll('[data-testid="pleomino-piece-view"]'),
        ) as HTMLElement[];
        expect(pieceViews.length).toBe(4);
        const spriteSizes = pieceViews.map((pieceView) => {
          const sprite = pieceView.firstElementChild as HTMLElement | null;
          if (!sprite) {
            throw new Error("expected piece sprite");
          }
          return { width: parsePx(sprite.style.width), height: parsePx(sprite.style.height) };
        });
        const rowWidth =
          spriteSizes.reduce((total, size) => total + size.width, 0) +
          Math.max(0, spriteSizes.length - 1) * columnGap;
        const rowHeight = spriteSizes.reduce((max, size) => Math.max(max, size.height), 0);
        expect(rowWidth).toBeLessThanOrEqual(trayInnerWidth);
        let currentPieceLeft = trayLeft + 4 + centeredOffset(trayInnerWidth, rowWidth);
        for (const size of spriteSizes) {
          expect(currentPieceLeft).toBeGreaterThanOrEqual(0);
          expect(currentPieceLeft + size.width).toBeLessThanOrEqual(window.innerWidth);
          expect(currentRowTop + size.height).toBeLessThanOrEqual(window.innerHeight);
          currentPieceLeft += size.width + columnGap;
        }
        trayRowsHeight += rowHeight;
        currentRowTop += rowHeight + rowGap;
      }
      const trayHeight =
        trayVerticalPadding + trayRowsHeight + Math.max(0, trayRows.length - 1) * rowGap;
      expect(2 * 2 + boardHeight + 4 + trayHeight).toBeLessThanOrEqual(window.innerHeight);
      expect(trayWidth).toBeLessThanOrEqual(window.innerWidth - 2 * 2);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });
    }
  });
});
