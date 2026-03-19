/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  restoreWorkerForTests,
  installWorkerBackedRuntime,
} from "./game-solve-worker-browser-helpers.ts";
import {
  currentSolveState,
  flushUi,
  readPersisted,
  renderGameScreen,
  seedSinglePurplePlacement,
  waitFor,
} from "./game-solve-browser-helpers.tsx";

describe("game screen offline relaunch solve acceptance", () => {
  let firstRoot: ReturnType<typeof renderGameScreen>["root"] | null = null;
  let secondRoot: ReturnType<typeof renderGameScreen>["root"] | null = null;
  let firstContainer: HTMLDivElement | null = null;
  let secondContainer: HTMLDivElement | null = null;

  afterEach(async () => {
    restoreWorkerForTests();
    if (firstRoot) {
      firstRoot.unmount();
      firstRoot = null;
    }
    if (secondRoot) {
      secondRoot.unmount();
      secondRoot = null;
    }
    firstContainer?.remove();
    secondContainer?.remove();
    firstContainer = null;
    secondContainer = null;
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    await flushUi();
  });

  it("restores a partial board after relaunch and solves from the restored locked state", async () => {
    seedSinglePurplePlacement();
    const worker = installWorkerBackedRuntime();

    ({ container: firstContainer, root: firstRoot } = renderGameScreen());
    await flushUi();
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 1);

    firstRoot.unmount();
    firstRoot = null;
    firstContainer.remove();
    firstContainer = null;

    ({ container: secondContainer, root: secondRoot } = renderGameScreen());
    await flushUi();
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 1);

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    await waitFor(() => worker.control.requests.length === 1);
    expect(worker.control.requests[0]?.request.lockedPlacements.length).toBe(1);
    worker.control.respond({
      type: "solve-result",
      requestId: worker.control.requests[0]?.requestId ?? 0,
      result: {
        status: "solved",
        placements: [
          {
            pieceId: "purple-2-1",
            transform: { rotation: 0, flipped: false },
            position: { x: 1, y: 1 },
          },
          {
            pieceId: "red-2-2",
            transform: { rotation: 0, flipped: false },
            position: { x: 4, y: 4 },
          },
        ],
        nodeExpansions: 5,
        elapsedMs: 2,
        interestingnessScore: 0.4,
        selectedSignature: "offline-relaunch",
      },
    });

    await waitFor(() => currentSolveState(secondContainer) === "solved-applied");
    expect(readPersisted()?.board.placedPieces.length).toBe(2);
  });
});
