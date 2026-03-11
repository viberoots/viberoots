/** @vitest-environment jsdom */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadPersistedGameStateFromHash,
  savePersistedGameStateToHash,
} from "../src/game/persistence.ts";
import {
  resetSolverRuntimeForTests,
  setSolverWorkerFactoryForTests,
} from "../src/game/solver/solver-runtime.ts";
import type { SolverResult } from "../src/game/solver/solver-types.ts";
import { createInitialGameState } from "../src/game/state.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";

type SolveRequestMessage = {
  type: "solve-request";
  requestId: number;
};

type SolveResponseMessage = {
  type: "solve-result";
  requestId: number;
  result: SolverResult;
};

type FakeWorkerControl = {
  requests: SolveRequestMessage[];
  respond: (message: SolveResponseMessage) => void;
};

const initialWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");

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

function installWorkerBackedRuntime(): { control: FakeWorkerControl } {
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: class WorkerShim {},
  });

  const requests: SolveRequestMessage[] = [];
  let onmessage: ((event: MessageEvent<SolveResponseMessage>) => void) | null = null;
  setSolverWorkerFactoryForTests(() => {
    return {
      get onmessage() {
        return onmessage;
      },
      set onmessage(value) {
        onmessage = value as ((event: MessageEvent<SolveResponseMessage>) => void) | null;
      },
      onerror: null,
      postMessage(message: SolveRequestMessage) {
        requests.push(message);
      },
      terminate() {},
    } as unknown as Worker;
  });

  return {
    control: {
      requests,
      respond(message) {
        onmessage?.({ data: message } as MessageEvent<SolveResponseMessage>);
      },
    },
  };
}

describe("game screen worker solve integration", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    resetSolverRuntimeForTests();
    if (initialWorkerDescriptor) {
      Object.defineProperty(globalThis, "Worker", initialWorkerDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "Worker");
    }
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

  it("applies solved placements from worker response path", async () => {
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

    const worker = installWorkerBackedRuntime();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<GameScreen url="/games/pleomino" />);
    await flushUi();
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 1);

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => worker.control.requests.length === 1);
    const firstRequestId = worker.control.requests[0]?.requestId;
    if (typeof firstRequestId !== "number") {
      throw new Error("expected worker request id");
    }

    worker.control.respond({
      type: "solve-result",
      requestId: firstRequestId,
      result: {
        status: "solved",
        placements: [
          {
            pieceId: "red-2-2",
            transform: { rotation: 0, flipped: false },
            position: { x: 4, y: 4 },
          },
        ],
        nodeExpansions: 5,
        elapsedMs: 2,
        interestingnessScore: 0.4,
        selectedSignature: "worker-resolved",
      },
    });

    await waitFor(() => container !== null && currentSolveStatusLabel(container) === "Solved");
    expect(readPersisted()?.board.placedPieces.length).toBe(1);
    expect(readPersisted()?.board.placedPieces[0]?.pieceId).toBe("red-2-2");
  });

  it("ignores stale worker response after board mutation", async () => {
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

    const worker = installWorkerBackedRuntime();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(<GameScreen url="/games/pleomino" />);
    await flushUi();
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? 0) === 1);

    const solveButton = document.querySelector('[data-testid="pleomino-action-solve"]');
    if (!(solveButton instanceof HTMLElement)) {
      throw new Error("expected solve button");
    }
    solveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => worker.control.requests.length === 1);
    const firstRequestId = worker.control.requests[0]?.requestId;
    if (typeof firstRequestId !== "number") {
      throw new Error("expected worker request id");
    }

    const resetButton = document.querySelector('[data-testid="pleomino-action-reset"]');
    if (!(resetButton instanceof HTMLElement)) {
      throw new Error("expected reset button");
    }
    resetButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => (readPersisted()?.board.placedPieces.length ?? -1) === 0);

    worker.control.respond({
      type: "solve-result",
      requestId: firstRequestId,
      result: {
        status: "solved",
        placements: [
          {
            pieceId: "red-2-2",
            transform: { rotation: 0, flipped: false },
            position: { x: 8, y: 8 },
          },
        ],
        nodeExpansions: 9,
        elapsedMs: 4,
        interestingnessScore: 0.1,
        selectedSignature: "stale-worker",
      },
    });

    await waitFor(() => container !== null && currentSolveStatusLabel(container) === "Idle");
    expect(readPersisted()?.board.placedPieces.length).toBe(0);
  });
});
