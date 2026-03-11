/** @vitest-environment jsdom */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPersistedGameStateFromHash,
  savePersistedGameStateToHash,
} from "../src/game/persistence.ts";
import * as solverModule from "../src/game/solver/solver.ts";
import { createInitialGameState } from "../src/game/state.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";

vi.mock("../src/game/solver/solver.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/game/solver/solver.ts")>(
    "../src/game/solver/solver.ts",
  );
  return {
    ...actual,
    solveBoardWithWasm: vi.fn(),
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

function readPersisted() {
  return loadPersistedGameStateFromHash(window.location, createInitialGameState());
}

function currentSolveStatusLabel(container: HTMLDivElement): string {
  const status = container.querySelector('[data-testid="pleomino-solve-state"]');
  if (!(status instanceof HTMLElement)) {
    throw new Error("expected solve status element");
  }
  return (status.textContent ?? "").trim();
}

describe("game screen solve cancellation", () => {
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

  it("cancels stale solve results when board state changes during solving", async () => {
    const seeded = createInitialGameState();
    seeded.board.placedPieces = [
      {
        instanceId: "purple-2-1#1",
        pieceId: "purple-2-1",
        transform: { rotation: 0, flipped: false },
        position: { x: 1, y: 1 },
        isPlaced: true,
      },
    ];
    seeded.nextPlacedInstanceId = 2;
    savePersistedGameStateToHash(window.history, window.location, seeded);
    let resolveSolve:
      | ((value: Awaited<ReturnType<typeof solverModule.solveBoardWithWasm>>) => void)
      | null = null;
    const solveBoardWithWasm = vi.mocked(solverModule.solveBoardWithWasm);
    solveBoardWithWasm.mockImplementation(
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

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => container !== null && currentSolveStatusLabel(container) === "Solving");

    const resetButton = document.querySelector('[data-testid="pleomino-action-reset"]');
    if (!(resetButton instanceof HTMLElement)) {
      throw new Error("expected reset button");
    }
    resetButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? -1) === 0);

    resolveSolve?.({
      status: "solved",
      placements: [
        {
          pieceId: "red-2-2",
          transform: { rotation: 0, flipped: false },
          position: { x: 5, y: 5 },
        },
      ],
      nodeExpansions: 2,
      elapsedMs: 1,
      interestingnessScore: 1,
      selectedSignature: "stale",
    });

    await waitFor(() => container !== null && currentSolveStatusLabel(container) === "Idle");
    expect(readPersisted()?.board.placedPieces.length).toBe(0);
  });
});
