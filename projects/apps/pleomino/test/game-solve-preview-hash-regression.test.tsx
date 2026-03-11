/** @vitest-environment jsdom */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPersistedGameStateFromHash } from "../src/game/persistence.ts";
import * as solverRuntime from "../src/game/solver/solver-runtime.ts";
import { createInitialGameHistoryState, createInitialGameState } from "../src/game/state.ts";
import { pleominoGameReducer } from "../src/game/reducer.ts";
import { selectGameViewModel } from "../src/game/selectors.ts";
import type { GameHistoryState, GameState } from "../src/game/types.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";

vi.mock("../src/game/solver/solver-runtime.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/game/solver/solver-runtime.ts")>(
    "../src/game/solver/solver-runtime.ts",
  );
  return {
    ...actual,
    solveBoardWithRuntime: vi.fn(),
  };
});

function flushUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(assertion: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }
    await flushUi();
  }
  throw new Error("timed out waiting for condition");
}

function readPersisted(): GameState | null {
  return loadPersistedGameStateFromHash(window.location, createInitialGameState());
}

function currentSolveStatusLabel(container: HTMLDivElement): string {
  const status = container.querySelector('[data-testid="pleomino-solve-state"]');
  if (!(status instanceof HTMLElement)) {
    throw new Error("expected solve status element");
  }
  return (status.textContent ?? "").trim();
}

function hasPreviewGhost(state: GameState | null): boolean {
  if (!state) {
    return false;
  }
  return Object.values(state.previewByPieceId).some((preview) => preview !== null);
}

function hasBoardPreviewGhost(state: GameState): boolean {
  return selectGameViewModel(state).board.cells.some((cell) => cell.state === "preview");
}

function reduce(state: GameHistoryState, action: Parameters<typeof pleominoGameReducer>[1]) {
  return pleominoGameReducer(state, action);
}

describe("game screen solve preview/hash regressions", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    vi.clearAllMocks();
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

  it("clears preview ghost cells across solve apply, undo, and redo", () => {
    const initial = createInitialGameHistoryState();
    const previewed = reduce(initial, {
      type: "piece/preview",
      pieceId: "purple-2-1",
      position: { x: 0, y: 0 },
    });
    expect(hasBoardPreviewGhost(previewed.present)).toBe(true);

    const solved = reduce(previewed, {
      type: "solve/apply",
      placements: [
        {
          pieceId: "purple-2-1",
          transform: { rotation: 0, flipped: false },
          position: { x: 2, y: 2 },
        },
      ],
    });
    expect(hasPreviewGhost(solved.present)).toBe(false);
    expect(hasBoardPreviewGhost(solved.present)).toBe(false);

    const undone = reduce(solved, { type: "history/undo" });
    expect(hasPreviewGhost(undone.present)).toBe(false);
    expect(hasBoardPreviewGhost(undone.present)).toBe(false);

    const redone = reduce(undone, { type: "history/redo" });
    expect(hasPreviewGhost(redone.present)).toBe(false);
    expect(hasBoardPreviewGhost(redone.present)).toBe(false);
  });

  it("keeps hash unchanged while solving and updates only after solve apply commit", async () => {
    let resolveSolve:
      | ((value: Awaited<ReturnType<typeof solverRuntime.solveBoardWithRuntime>>) => void)
      | null = null;
    const solveBoardWithRuntime = vi.mocked(solverRuntime.solveBoardWithRuntime);
    solveBoardWithRuntime.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSolve = resolve;
        }),
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<GameScreen url="/games/pleomino" />);
    await flushUi();
    await waitFor(() => window.location.hash.length > 0);

    const initialHash = window.location.hash;
    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => container !== null && currentSolveStatusLabel(container) === "Solving");
    expect(window.location.hash).toBe(initialHash);

    resolveSolve?.({
      status: "solved",
      placements: [
        {
          pieceId: "purple-2-1",
          transform: { rotation: 0, flipped: false },
          position: { x: 0, y: 0 },
        },
      ],
      nodeExpansions: 1,
      elapsedMs: 1,
      interestingnessScore: 0.2,
      selectedSignature: "solve-hash-regression",
    });

    await waitFor(() => window.location.hash !== initialHash);
    await waitFor(() => container !== null && currentSolveStatusLabel(container) === "Solved");
  });
});
