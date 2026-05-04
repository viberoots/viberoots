import { afterEach, describe, expect, it, vi } from "vitest";
import type { SolverRequest } from "../src/game/solver/solver-types";

const runSolverSearchInWasm = vi.fn();

vi.mock("../src/game/solver/wasm-runtime.ts", () => ({
  runSolverSearchInWasm,
}));

describe("solver partial-board retries", async () => {
  const { solveBoardWithWasm } = await import("../src/game/solver/solver");

  afterEach(() => {
    runSolverSearchInWasm.mockReset();
  });

  it("retries alternate seeds for partial boards before returning unsolved", async () => {
    runSolverSearchInWasm
      .mockResolvedValueOnce({
        statusCode: 0,
        nodeExpansions: 100,
        solutions: [],
      })
      .mockResolvedValueOnce({
        statusCode: 1,
        nodeExpansions: 42,
        solutions: [
          {
            foundAtNode: 42,
            candidateIndices: new Int32Array([0]),
          },
        ],
      });

    const request: SolverRequest = {
      boardSize: { columns: 2, rows: 1 },
      pieceCatalog: [
        {
          pieceId: "alpha",
          color: "#111111",
          baseCells: [{ x: 0, y: 0 }],
        },
        {
          pieceId: "beta",
          color: "#eeeeee",
          baseCells: [{ x: 0, y: 0 }],
        },
      ],
      lockedPlacements: [
        {
          pieceId: "alpha",
          transform: { rotation: 0, flipped: false },
          position: { x: 0, y: 0 },
        },
      ],
      remainingInventory: {
        alpha: 0,
        beta: 1,
      },
      maxNodeExpansions: 150_000,
      maxWallClockMs: 1_200,
      interestingnessThreshold: 1,
      randomSeed: 1,
    };

    const result = await solveBoardWithWasm(request);

    expect(result.status).toBe("solved");
    expect(result.placements).toContainEqual({
      pieceId: "alpha",
      transform: { rotation: 0, flipped: false },
      position: { x: 0, y: 0 },
    });
    expect(result.placements).toContainEqual({
      pieceId: "beta",
      transform: { rotation: 0, flipped: false },
      position: { x: 1, y: 0 },
    });
    expect(runSolverSearchInWasm).toHaveBeenCalledTimes(2);
    expect(runSolverSearchInWasm.mock.calls[0]?.[1]).toBe(150_000);
  });
});
