/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { GameScreen } from "../src/ui/game-screen.tsx";

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

  it("drags from tray, moves placed piece, and drags placed piece back to tray", async () => {
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

      const piece = document.querySelector('[data-testid="tangram-piece-view"]');
      if (!piece) {
        throw new Error("expected at least one piece element");
      }

      piece.dispatchEvent(
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

      expect(document.querySelectorAll('[data-testid="tangram-board-cell-preview"]').length).toBe(
        0,
      );
      expect(document.querySelector('[data-testid="tangram-drag-ghost"]')).not.toBeNull();
      expect(
        document.querySelectorAll('[data-testid="tangram-board-cell-snap-target"]').length,
      ).toBeGreaterThan(0);

      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 100 + 32 * 3 + 10,
          clientY: 200 + 32 * 4 + 10,
        }),
      );
      await flushUi();

      expect(document.querySelector('[data-testid="tangram-drag-ghost"]')).toBeNull();
      expect(
        document.querySelectorAll('[data-testid="tangram-board-cell-snap-target"]').length,
      ).toBe(0);
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

      const movedCell = document.querySelector(
        '[data-testid="tangram-board-cell"][style*="background-color"]',
      );
      if (!movedCell) {
        throw new Error("expected at least one placed board cell after move");
      }

      movedCell.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 100 + 32 * 5 + 16,
          clientY: 200 + 32 * 6 + 16,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 40,
          clientY: 40,
        }),
      );
      await flushUi();
      expect(document.querySelector('[data-testid="tangram-piece-return-target"]')).not.toBeNull();
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 40,
          clientY: 40,
        }),
      );
      await flushUi();

      expect(document.querySelector('[data-testid="tangram-piece-return-target"]')).toBeNull();
      expect(document.body.textContent ?? "").toContain("Placed pieces: 0");
      expect(document.body.textContent ?? "").toContain("5 left");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});
