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

describe("game screen solve integration", () => {
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

  it("applies solved placements and supports undo/redo snapshot recovery", async () => {
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
    const solveBoardWithWasm = vi.mocked(solverModule.solveBoardWithWasm);
    solveBoardWithWasm.mockResolvedValue({
      status: "solved",
      placements: [
        {
          pieceId: "purple-2-1",
          transform: { rotation: 0, flipped: false },
          position: { x: 0, y: 0 },
        },
        {
          pieceId: "red-2-2",
          transform: { rotation: 90, flipped: false },
          position: { x: 4, y: 0 },
        },
      ],
      nodeExpansions: 11,
      elapsedMs: 3,
      interestingnessScore: 0.5,
      selectedSignature: "x",
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<GameScreen url="/games/pleomino" />);
    await flushUi();
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 1);
    const preSolveSnapshot = readPersisted();

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(() => container !== null && currentSolveStatusLabel(container) === "Solved");
    const solvedState = readPersisted();
    expect(solvedState?.board.placedPieces.length).toBe(2);
    expect(solvedState?.previewByPieceId["purple-2-1"]).toBeNull();

    const undoButton = document.querySelector('[data-testid="pleomino-action-undo"]');
    if (!(undoButton instanceof HTMLElement)) {
      throw new Error("expected undo button");
    }
    undoButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 1);
    expect(readPersisted()).toEqual(preSolveSnapshot);

    const redoButton = document.querySelector('[data-testid="pleomino-action-redo"]');
    if (!(redoButton instanceof HTMLElement)) {
      throw new Error("expected redo button");
    }
    redoButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 2);
  });

  it("keeps hash unchanged while solving and updates only after solve apply commit", async () => {
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
      selectedSignature: "resolved",
    });

    await waitFor(() => window.location.hash !== initialHash);
    await waitFor(() => container !== null && currentSolveStatusLabel(container) === "Solved");
  });

  it("shows unsolved status and preserves board when solve fails", async () => {
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
    const solveBoardWithWasm = vi.mocked(solverModule.solveBoardWithWasm);
    solveBoardWithWasm.mockResolvedValue({
      status: "unsolved",
      placements: [],
      nodeExpansions: 100,
      elapsedMs: 10,
      interestingnessScore: 0,
      selectedSignature: "",
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<GameScreen url="/games/pleomino" />);
    await flushUi();
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 1);
    const preSolveSnapshot = readPersisted();

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(() => container !== null && currentSolveStatusLabel(container) === "Unsolved");
    expect(readPersisted()).toEqual(preSolveSnapshot);
  });
});
