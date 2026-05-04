/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { solveBoardWithWasm } from "../src/game/solver/solver";
import {
  resetSolverRuntimeForTests,
  setSolverWorkerFactoryForTests,
  solveBoardWithRuntime,
} from "../src/game/solver/solver-runtime";
import type { SolverRequest, SolverResult } from "../src/game/solver/solver-types";

vi.mock("../src/game/solver/solver.ts", () => {
  return {
    solveBoardWithWasm: vi.fn(async (request: SolverRequest): Promise<SolverResult> => {
      const pieceCount = Object.keys(request.remainingInventory).length;
      return {
        status: "solved",
        placements: [],
        nodeExpansions: pieceCount,
        elapsedMs: 1,
        interestingnessScore: pieceCount / 10,
        selectedSignature: `mock-${pieceCount}`,
      };
    }),
  };
});

type SolveWorkerRequest = {
  type: "solve-request";
  requestId: number;
  request: SolverRequest;
};

type SolveWorkerResponse = {
  type: "solve-result";
  requestId: number;
  result: SolverResult;
};

const initialWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");

function makeRequest(overrides: Partial<SolverRequest>): SolverRequest {
  return {
    boardSize: { columns: 2, rows: 2 },
    pieceCatalog: [],
    lockedPlacements: [],
    remainingInventory: { alpha: 1, beta: 1 },
    maxNodeExpansions: 1000,
    maxWallClockMs: 1000,
    randomSeed: 1,
    selectionWindowSize: 2,
    ...overrides,
  };
}

function installWorkerGlobal(): () => void {
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: class WorkerShim {},
  });
  return () => {
    if (initialWorkerDescriptor) {
      Object.defineProperty(globalThis, "Worker", initialWorkerDescriptor);
      return;
    }
    Reflect.deleteProperty(globalThis, "Worker");
  };
}

afterEach(() => {
  resetSolverRuntimeForTests();
  vi.clearAllMocks();
  if (initialWorkerDescriptor) {
    Object.defineProperty(globalThis, "Worker", initialWorkerDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, "Worker");
});

describe("solver runtime path", () => {
  it("matches fallback output when worker runtime is available", async () => {
    const restoreWorker = installWorkerGlobal();
    try {
      setSolverWorkerFactoryForTests(() => {
        const workerLike = {
          onmessage: null as ((event: MessageEvent<SolveWorkerResponse>) => void) | null,
          onerror: null as ((event: Event) => void) | null,
          postMessage(payload: SolveWorkerRequest) {
            void solveBoardWithWasm(payload.request).then((result) => {
              this.onmessage?.({
                data: {
                  type: "solve-result",
                  requestId: payload.requestId,
                  result,
                },
              } as MessageEvent<SolveWorkerResponse>);
            });
          },
          terminate() {},
        };
        return workerLike as unknown as Worker;
      });

      const request = makeRequest({});
      const fromWorkerRuntime = await solveBoardWithRuntime(request);
      const fromFallback = await solveBoardWithWasm(request);
      expect(fromWorkerRuntime).toEqual(fromFallback);
    } finally {
      restoreWorker();
    }
  });

  it("falls back to direct solver when workers are unavailable", async () => {
    Reflect.deleteProperty(globalThis, "Worker");
    const request = makeRequest({ remainingInventory: { gamma: 1 } });
    const fromRuntime = await solveBoardWithRuntime(request);
    const direct = await solveBoardWithWasm(request);
    expect(fromRuntime).toEqual(direct);
  });

  it("falls back to direct solver when the worker returns unsolved for a partial board", async () => {
    const restoreWorker = installWorkerGlobal();
    const solverMock = vi.mocked(solveBoardWithWasm);
    solverMock.mockResolvedValueOnce({
      status: "solved",
      placements: [
        {
          pieceId: "fallback",
          transform: { rotation: 0, flipped: false },
          position: { x: 0, y: 0 },
        },
      ],
      nodeExpansions: 7,
      elapsedMs: 1,
      interestingnessScore: 0.7,
      selectedSignature: "fallback-solved",
    });
    try {
      setSolverWorkerFactoryForTests(() => {
        return {
          onmessage: null as ((event: MessageEvent<SolveWorkerResponse>) => void) | null,
          onerror: null as ((event: Event) => void) | null,
          postMessage(payload: SolveWorkerRequest) {
            this.onmessage?.({
              data: {
                type: "solve-result",
                requestId: payload.requestId,
                result: {
                  status: "unsolved",
                  placements: [],
                  nodeExpansions: 0,
                  elapsedMs: 1,
                  interestingnessScore: 0,
                  selectedSignature: "",
                },
              },
            } as MessageEvent<SolveWorkerResponse>);
          },
          terminate() {},
        } as unknown as Worker;
      });

      const request = makeRequest({
        lockedPlacements: [
          {
            pieceId: "alpha",
            transform: { rotation: 0, flipped: false },
            position: { x: 0, y: 0 },
          },
        ],
      });
      const result = await solveBoardWithRuntime(request);
      expect(result.status).toBe("solved");
      expect(result.selectedSignature).toBe("fallback-solved");
    } finally {
      restoreWorker();
    }
  });
});
