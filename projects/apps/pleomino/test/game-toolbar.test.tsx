/** @vitest-environment jsdom */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadPersistedGameStateFromHash,
  savePersistedGameStateToHash,
} from "../src/game/persistence.ts";
import { createInitialGameState } from "../src/game/state.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";
import { GameToolbar } from "../src/ui/game-toolbar.tsx";

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForValue(
  read: () => number,
  accept: (value: number) => boolean,
  timeoutMs = 3000,
): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (accept(value)) return value;
    await flushUi();
  }
  throw new Error(`timed out waiting for expected value`);
}

describe("game toolbar", () => {
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
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    await flushUi();
  });

  it("renders all action controls in desktop and stacked modes", () => {
    const desktop = renderToStaticMarkup(
      <GameToolbar
        isStacked={false}
        canUndo={true}
        canRedo={true}
        canSolve={true}
        solveState="idle"
        onReset={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
        onSolve={() => {}}
      />,
    );
    const stacked = renderToStaticMarkup(
      <GameToolbar
        isStacked={true}
        canUndo={true}
        canRedo={true}
        canSolve={true}
        solveState="idle"
        onReset={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
        onSolve={() => {}}
      />,
    );
    for (const html of [desktop, stacked]) {
      expect(html).toContain('data-testid="pleomino-action-reset"');
      expect(html).toContain('data-testid="pleomino-action-undo"');
      expect(html).toContain('data-testid="pleomino-action-redo"');
      expect(html).toContain('data-testid="pleomino-action-solve"');
    }
  });

  it("toolbar reset dispatches board reset path in game screen", async () => {
    const seeded = createInitialGameState();
    seeded.board.placedPieces = [
      {
        instanceId: "purple-2-1#1",
        pieceId: "purple-2-1",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 0 },
        isPlaced: true,
      },
    ];
    seeded.selectedPieceId = "purple-2-1";
    seeded.selectedInstanceId = "purple-2-1#1";
    seeded.nextPlacedInstanceId = 2;
    savePersistedGameStateToHash(window.history, window.location, seeded);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<GameScreen url="/games/pleomino" />);
    await flushUi();

    await waitForValue(
      () =>
        loadPersistedGameStateFromHash(window.location, createInitialGameState())?.board
          .placedPieces.length ?? 0,
      (count) => count === 1,
    );

    const reset = document.querySelector('[data-testid="pleomino-action-reset"]');
    if (!(reset instanceof HTMLElement)) {
      throw new Error("expected reset action");
    }
    reset.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitForValue(
      () =>
        loadPersistedGameStateFromHash(window.location, createInitialGameState())?.board
          .placedPieces.length ?? 0,
      (count) => count === 0,
    );
  });

  it("undo/redo controls dispatch when enabled", async () => {
    let undoCalls = 0;
    let redoCalls = 0;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(
      <GameToolbar
        isStacked={false}
        canUndo={true}
        canRedo={true}
        canSolve={true}
        solveState="idle"
        onReset={() => {}}
        onUndo={() => {
          undoCalls += 1;
        }}
        onRedo={() => {
          redoCalls += 1;
        }}
        onSolve={() => {}}
      />,
    );
    await flushUi();

    const undo = document.querySelector('[data-testid="pleomino-action-undo"]');
    if (!(undo instanceof HTMLElement)) {
      throw new Error("expected undo action");
    }
    undo.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const redo = document.querySelector('[data-testid="pleomino-action-redo"]');
    if (!(redo instanceof HTMLElement)) {
      throw new Error("expected redo action");
    }
    redo.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(undoCalls).toBe(1);
    expect(redoCalls).toBe(1);
  });

  it("action controls expose accessibility labels and keyboard focus", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(
      <GameToolbar
        isStacked={false}
        canUndo={true}
        canRedo={true}
        canSolve={true}
        solveState="idle"
        onReset={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
        onSolve={() => {}}
      />,
    );
    await flushUi();

    const expected: Array<[string, string]> = [
      ["pleomino-action-reset", "Reset board"],
      ["pleomino-action-undo", "Undo"],
      ["pleomino-action-redo", "Redo"],
      ["pleomino-action-solve", "Solve"],
    ];
    for (const [testId, label] of expected) {
      const action = document.querySelector(`[data-testid="${testId}"]`);
      if (!(action instanceof HTMLElement)) {
        throw new Error(`missing action ${testId}`);
      }
      expect(action.getAttribute("aria-label")).toBe(label);
      action.focus();
      expect(document.activeElement).toBe(action);
    }
  });

  it("does not render the interestingness control or solve-state chip", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(
      <GameToolbar
        isStacked={false}
        canUndo={true}
        canRedo={true}
        canSolve={true}
        solveState="idle"
        onReset={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
        onSolve={() => {}}
      />,
    );
    await flushUi();

    expect(document.querySelector('[data-testid="pleomino-interestingness-slider"]')).toBeNull();
    expect(document.querySelector('[data-testid="pleomino-solve-state"]')).toBeNull();
  });
});
