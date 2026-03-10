/** @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { BOARD_CELL_SIZE } from "../src/game/board.ts";
import { loadPersistedGameStateFromHash } from "../src/game/persistence.ts";
import { createInitialGameState } from "../src/game/state.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";

type Pointer = { x: number; y: number };

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function persistedState() {
  const restored = loadPersistedGameStateFromHash(window.location, createInitialGameState());
  if (!restored) {
    throw new Error("expected persisted state");
  }
  return restored;
}

function snapTargetKeys(): string[] {
  return Array.from(document.querySelectorAll('[data-testid="tangram-board-cell-snap-target"]'))
    .map((cell) => `${cell.getAttribute("data-cell-x")},${cell.getAttribute("data-cell-y")}`)
    .sort();
}

function parsePx(value: string): number {
  const parsed = Number.parseFloat(value.replace("px", ""));
  if (!Number.isFinite(parsed)) {
    throw new Error(`expected pixel value, got: ${value}`);
  }
  return parsed;
}

function centeredOffset(containerSize: number, contentSize: number): number {
  return Math.max(0, (containerSize - contentSize) / 2);
}

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
      root.render(<GameScreen url="/games/tangram" />);
      await flushUi();

      const blackPieceId = "black-1-1-1-1";
      const blackCard = cardByPieceId(blackPieceId);
      tapCard(blackCard, { x: 108, y: 208 });
      await wait(260);
      await flushUi();
      const afterLeftTap = persistedState();
      expect(afterLeftTap.transformByPieceId[blackPieceId].rotation).toBe(270);

      const orangePieceId = "orange-2-1-2";
      const orangeCard = cardByPieceId(orangePieceId);
      tapCard(orangeCard, { x: 108, y: 208 });
      await wait(170);
      tapCard(orangeCard, { x: 108, y: 208 });
      await wait(80);
      await flushUi();
      const afterDoubleTap = persistedState();
      expect(afterDoubleTap.transformByPieceId[orangePieceId].flipped).toBe(true);

      const firstPiece = document.querySelector('[data-testid="tangram-piece-view"]');
      if (!firstPiece) {
        throw new Error("expected at least one piece element");
      }
      const draggedPieceLabel = firstPiece.getAttribute("aria-label") ?? "";
      const draggedPieceId = draggedPieceLabel.split(",")[0]?.replace(/^Piece\s+/, "");
      if (!draggedPieceId) {
        throw new Error("expected dragged piece id");
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
          clientX: 100 + BOARD_CELL_SIZE * 3 + 10,
          clientY: 200 + BOARD_CELL_SIZE * 4 + 10,
        }),
      );
      await flushUi();

      expect(document.querySelector('[data-testid="tangram-drag-ghost"]')).not.toBeNull();
      expect(
        document.querySelectorAll('[data-testid="tangram-board-cell-snap-target"]').length,
      ).toBeGreaterThan(0);
      const dragGhostCell = document.querySelector('[data-testid="tangram-drag-ghost"] > div');
      expect(dragGhostCell).not.toBeNull();
      expect((dragGhostCell as HTMLElement).style.top).toBe(`${200 + BOARD_CELL_SIZE * 4 + 2}px`);
      expect((dragGhostCell as HTMLElement).style.left).toBe(`${100 + BOARD_CELL_SIZE * 3 + 2}px`);

      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 3 + 10,
          clientY: 200 + BOARD_CELL_SIZE * 4 + 10,
        }),
      );
      await flushUi();

      expect(document.querySelector('[data-testid="tangram-drag-ghost"]')).toBeNull();
      const afterPlace = persistedState();
      expect(afterPlace.board.placedPieces.length).toBe(1);

      const placedStartCell = document.querySelector(
        '[data-testid="tangram-board-cell"][style*="background-color"]',
      );
      if (!placedStartCell) {
        throw new Error("expected at least one placed board cell");
      }

      placedStartCell.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 3 + 16,
          clientY: 200 + BOARD_CELL_SIZE * 4 + 16,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 5 + 16,
          clientY: 200 + BOARD_CELL_SIZE * 6 + 16,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 100 + BOARD_CELL_SIZE * 5 + 16,
          clientY: 200 + BOARD_CELL_SIZE * 6 + 16,
        }),
      );
      await flushUi();

      const afterMovePlaced = persistedState();
      expect(afterMovePlaced.board.placedPieces.length).toBe(1);
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
      root.render(<GameScreen url="/games/tangram" />);
      await flushUi();

      const firstPiece = document.querySelector('[data-testid="tangram-piece-view"]');
      if (!firstPiece) {
        throw new Error("expected at least one piece element");
      }
      const draggedPieceLabel = firstPiece.getAttribute("aria-label") ?? "";
      const draggedPieceId = draggedPieceLabel.split(",")[0]?.replace(/^Piece\s+/, "");
      if (!draggedPieceId) {
        throw new Error("expected dragged piece id");
      }

      firstPiece.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 108,
          clientY: 208,
        }),
      );

      const validDropPointer = {
        x: 100 + BOARD_CELL_SIZE * 3 + 10,
        y: 200 + BOARD_CELL_SIZE * 4 + 10,
      };
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: validDropPointer.x,
          clientY: validDropPointer.y,
        }),
      );
      await flushUi();
      const targetAtValidPointer = snapTargetKeys();
      expect(targetAtValidPointer.length).toBeGreaterThan(0);

      const invalidInBoardPointer = {
        x: 102,
        y: 206,
      };
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: invalidInBoardPointer.x,
          clientY: invalidInBoardPointer.y,
        }),
      );
      await flushUi();
      const targetAtInvalidPointer = snapTargetKeys();
      expect(targetAtInvalidPointer.length).toBeGreaterThan(0);

      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: invalidInBoardPointer.x,
          clientY: invalidInBoardPointer.y,
        }),
      );
      await flushUi();

      const afterDrop = persistedState();
      expect(afterDrop.board.placedPieces.length).toBe(1);
      expect(afterDrop.board.placedPieces[0]?.pieceId).toBe(draggedPieceId);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
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
      root.render(<GameScreen url="/games/tangram" />);
      await flushUi();

      const blueCard = cardByPieceId("blue-3-1");
      blueCard.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 108,
          clientY: 208,
        }),
      );
      const blueDropPointer = {
        x: 100 + BOARD_CELL_SIZE * 3 + 10,
        y: 200 + BOARD_CELL_SIZE * 4 + 10,
      };
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: blueDropPointer.x,
          clientY: blueDropPointer.y,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: blueDropPointer.x,
          clientY: blueDropPointer.y,
        }),
      );
      await flushUi();

      const afterBluePlace = persistedState();
      expect(afterBluePlace.board.placedPieces.length).toBe(1);

      const whiteCard = cardByPieceId("white-1-1");
      whiteCard.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 108,
          clientY: 208,
        }),
      );
      const whiteDropPointer = {
        x: 100 + BOARD_CELL_SIZE * 3 + 10,
        y: 200 + BOARD_CELL_SIZE * 5 + 10,
      };
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: whiteDropPointer.x,
          clientY: whiteDropPointer.y,
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
          clientX: whiteDropPointer.x,
          clientY: whiteDropPointer.y,
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
      root.render(<GameScreen url="/games/tangram" />);
      await flushUi();

      const purpleCard = cardByPieceId("purple-2-1");
      purpleCard.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 108,
          clientY: 208,
        }),
      );
      const boardDropPointer = {
        x: 100 + BOARD_CELL_SIZE * 3 + 10,
        y: 200 + BOARD_CELL_SIZE * 4 + 10,
      };
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: boardDropPointer.x,
          clientY: boardDropPointer.y,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: boardDropPointer.x,
          clientY: boardDropPointer.y,
        }),
      );
      await flushUi();

      const afterPlace = persistedState();
      expect(afterPlace.board.placedPieces.length).toBe(1);
      const placedPiece = afterPlace.board.placedPieces[0];
      if (!placedPiece) {
        throw new Error("expected placed piece");
      }

      const placedStartCell = document.querySelector(
        '[data-testid="tangram-board-cell"][style*="background-color"]',
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
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 560,
          clientY: 220,
        }),
      );
      await flushUi();

      const afterDropOutside = persistedState();
      expect(afterDropOutside.board.placedPieces.length).toBe(0);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
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
      root.render(<GameScreen url="/games/tangram" />);
      await flushUi();

      const boardCell = document.querySelector(
        '[data-testid="tangram-board-cell"]',
      ) as HTMLElement | null;
      if (!boardCell) {
        throw new Error("expected board cell");
      }
      const cellSize = parsePx(boardCell.style.width);

      const trayRows = Array.from(
        document.querySelectorAll('[data-testid^="tangram-piece-tray-row-"]'),
      ) as HTMLElement[];
      expect(trayRows.length).toBe(2);

      const trayCard = document.querySelector('[data-testid="tangram-piece-tray-grid"]')
        ?.parentElement as HTMLElement | null;
      if (!trayCard) {
        throw new Error("expected tray card");
      }
      const trayWidth = parsePx(trayCard.style.width);
      const trayInnerWidth = trayWidth - 8; // stacked horizontal padding (4 + 4)
      const columnGap = 8;
      const rowGap = 14;
      const resetButtonHeight = 28;
      const trayVerticalPadding = 4; // stacked vertical padding (2 + 2)
      const trayHeaderGap = 10; // trayCard gap in small mode

      const pagePadding = 2;
      const boardPadding = 6;
      const boardBorder = 1;
      const layoutGap = 4;
      const viewportInnerWidth = window.innerWidth - pagePadding * 2;
      const boardHeight = cellSize * 15 + (boardPadding + boardBorder) * 2;
      const boardCardWidth = cellSize * 10 + (boardPadding + boardBorder) * 2;
      const boardLeft = pagePadding + centeredOffset(viewportInnerWidth, boardCardWidth);
      const boardTop = pagePadding;
      expect(boardLeft).toBeGreaterThanOrEqual(0);
      expect(boardTop).toBeGreaterThanOrEqual(0);
      expect(boardLeft + boardCardWidth).toBeLessThanOrEqual(window.innerWidth);
      expect(boardTop + boardHeight).toBeLessThanOrEqual(window.innerHeight);

      const trayLeft = pagePadding + centeredOffset(viewportInnerWidth, trayWidth);
      const trayTop = boardTop + boardHeight + layoutGap;

      let trayRowsHeight = 0;
      let currentRowTop = trayTop + 2 + resetButtonHeight + trayHeaderGap;
      for (const row of trayRows) {
        const pieceViews = Array.from(
          row.querySelectorAll('[data-testid="tangram-piece-view"]'),
        ) as HTMLElement[];
        expect(pieceViews.length).toBe(4);
        const spriteSizes = pieceViews.map((pieceView) => {
          const sprite = pieceView.firstElementChild as HTMLElement | null;
          if (!sprite) {
            throw new Error("expected piece sprite");
          }
          return {
            width: parsePx(sprite.style.width),
            height: parsePx(sprite.style.height),
          };
        });
        const rowWidth =
          spriteSizes.reduce((total, size) => total + size.width, 0) +
          Math.max(0, spriteSizes.length - 1) * columnGap;
        const rowHeight = spriteSizes.reduce((max, size) => Math.max(max, size.height), 0);
        expect(rowWidth).toBeLessThanOrEqual(trayInnerWidth);

        let currentPieceLeft = trayLeft + 4 + centeredOffset(trayInnerWidth, rowWidth);
        for (const size of spriteSizes) {
          const pieceLeft = currentPieceLeft;
          const pieceTop = currentRowTop;
          const pieceRight = pieceLeft + size.width;
          const pieceBottom = pieceTop + size.height;
          expect(pieceLeft).toBeGreaterThanOrEqual(0);
          expect(pieceTop).toBeGreaterThanOrEqual(0);
          expect(pieceRight).toBeLessThanOrEqual(window.innerWidth);
          expect(pieceBottom).toBeLessThanOrEqual(window.innerHeight);
          currentPieceLeft += size.width + columnGap;
        }

        trayRowsHeight += rowHeight;
        currentRowTop += rowHeight + rowGap;
      }

      const trayHeight =
        trayVerticalPadding +
        resetButtonHeight +
        trayHeaderGap +
        trayRowsHeight +
        Math.max(0, trayRows.length - 1) * rowGap;

      const totalPageHeight = 2 * 2 + boardHeight + 4 + trayHeight; // page padding + layout gap
      expect(totalPageHeight).toBeLessThanOrEqual(window.innerHeight);
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
