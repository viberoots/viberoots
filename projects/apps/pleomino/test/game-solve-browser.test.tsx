/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as solverRuntime from "../src/game/solver/solver-runtime";
import {
  currentSolveState,
  flushUi,
  readPersisted,
  renderGameScreen,
  seedSinglePurplePlacement,
  unsolvedResult,
  waitFor,
} from "./game-solve-browser-helpers";

vi.mock("../src/game/solver/solver-runtime.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/game/solver/solver-runtime")>(
    "../src/game/solver/solver-runtime.ts",
  );
  return {
    ...actual,
    solveBoardWithRuntime: vi.fn(),
  };
});

describe("game screen solve integration", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof renderGameScreen>["root"] | null = null;

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
    seedSinglePurplePlacement();
    const solveBoardWithRuntime = vi.mocked(solverRuntime.solveBoardWithRuntime);
    solveBoardWithRuntime.mockResolvedValue({
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

    ({ container, root } = renderGameScreen());
    await flushUi();
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 1);
    const preSolveSnapshot = readPersisted();

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(() => container !== null && currentSolveState(container) === "solved-applied");
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

  it("shows unsolved status and preserves board when solve fails", async () => {
    seedSinglePurplePlacement();
    const solveBoardWithRuntime = vi.mocked(solverRuntime.solveBoardWithRuntime);
    solveBoardWithRuntime.mockResolvedValue({
      status: "unsolved",
      placements: [],
      nodeExpansions: 100,
      elapsedMs: 10,
      interestingnessScore: 0,
      selectedSignature: "",
    });

    ({ container, root } = renderGameScreen());
    await flushUi();
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 1);
    const preSolveSnapshot = readPersisted();

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(() => container !== null && currentSolveState(container) === "unsolved");
    const failedSolveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(failedSolveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    expect(failedSolveButton.textContent).toContain("✕");
    await waitFor(
      () => document.querySelector('[data-testid="pleomino-board-failure-flash"]') !== null,
    );
    expect(readPersisted()).toEqual(preSolveSnapshot);
    await waitFor(() => container !== null && currentSolveState(container) === "idle");
  });

  it("passes max interestingness and explicit request-scoped solve seeds to runtime", async () => {
    const solveBoardWithRuntime = vi.mocked(solverRuntime.solveBoardWithRuntime);
    solveBoardWithRuntime.mockResolvedValue({
      status: "unsolved",
      placements: [],
      nodeExpansions: 10,
      elapsedMs: 1,
      interestingnessScore: 0,
      selectedSignature: "",
    });

    ({ container, root } = renderGameScreen());
    await flushUi();

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }

    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => container !== null && currentSolveState(container) === "unsolved");
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => solveBoardWithRuntime.mock.calls.length === 2);

    const firstSeed = solveBoardWithRuntime.mock.calls[0]?.[0]?.randomSeed;
    const secondSeed = solveBoardWithRuntime.mock.calls[1]?.[0]?.randomSeed;
    expect(typeof firstSeed).toBe("number");
    expect(typeof secondSeed).toBe("number");
    expect(secondSeed).toBeGreaterThan(firstSeed ?? 0);
    expect(solveBoardWithRuntime.mock.calls[0]?.[0]?.maxNodeExpansions).toBe(300000);
    expect(solveBoardWithRuntime.mock.calls[0]?.[0]?.solutionPoolSize).toBe(96);
    expect(solveBoardWithRuntime.mock.calls[0]?.[0]?.selectionWindowSize).toBe(32);
    expect(solveBoardWithRuntime.mock.calls[0]?.[0]?.interestingnessThreshold).toBe(1);
  });

  it("shows a board overlay while solve is running", async () => {
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

    ({ container, root } = renderGameScreen());
    await flushUi();

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }

    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(
      () =>
        container?.querySelector('[data-testid="pleomino-solve-overlay"]') instanceof HTMLElement,
    );

    resolveSolve?.({
      status: "unsolved",
      placements: [],
      nodeExpansions: 10,
      elapsedMs: 1,
      interestingnessScore: 0,
      selectedSignature: "",
    });

    await waitFor(
      () => container?.querySelector('[data-testid="pleomino-solve-overlay"]') === null,
    );
  });
});
