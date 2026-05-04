/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as solverRuntime from "../src/game/solver/solver-runtime";
import {
  currentSolveState,
  flushUi,
  readPersisted,
  renderGameScreen,
  seedSinglePurplePlacement,
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

describe("game screen solve cancellation", () => {
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

  it("cancels stale solve results when board state changes during solving", async () => {
    seedSinglePurplePlacement();
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
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 1);

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => container !== null && currentSolveState(container) === "solving");
    await waitFor(() => solveBoardWithRuntime.mock.calls.length === 1 && resolveSolve !== null);

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

    await waitFor(() => container !== null && currentSolveState(container) === "idle");
    expect(readPersisted()?.board.placedPieces.length).toBe(0);
  });
});
