import { describe, expect, it } from "vitest";
import { solveBoardWithWasm } from "../src/game/solver/solver.ts";
import type { SolverRequest } from "../src/game/solver/solver-types.ts";

const SQUARE = {
  pieceId: "square",
  color: "#f0f0f0",
  baseCells: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
};

const DOMINO = {
  pieceId: "domino",
  color: "#111111",
  baseCells: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
};

function makeRequest(overrides: Partial<SolverRequest>): SolverRequest {
  return {
    boardSize: { columns: 2, rows: 2 },
    pieceCatalog: [SQUARE],
    lockedPlacements: [],
    remainingInventory: { square: 1 },
    maxNodeExpansions: 1000,
    maxWallClockMs: 1000,
    ...overrides,
  };
}

describe("solver wasm search", () => {
  it("finds a known solvable fixture", async () => {
    const result = await solveBoardWithWasm(makeRequest({}));
    expect(result.status).toBe("solved");
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]).toEqual({
      pieceId: "square",
      transform: { rotation: 0, flipped: false },
      position: { x: 0, y: 0 },
    });
    expect(result.interestingnessScore).toBeGreaterThanOrEqual(0);
    expect(result.selectedSignature.length).toBeGreaterThan(0);
    expect(result.nodeExpansions).toBeGreaterThanOrEqual(1);
  });

  it("returns unsolved on contradictory inventory", async () => {
    const result = await solveBoardWithWasm(
      makeRequest({
        pieceCatalog: [DOMINO],
        remainingInventory: { domino: 1 },
      }),
    );
    expect(result.status).toBe("unsolved");
    expect(result.placements).toEqual([]);
    expect(result.interestingnessScore).toBe(0);
    expect(result.selectedSignature).toBe("");
  });

  it("is deterministic across repeated runs", async () => {
    const request = makeRequest({});
    const first = await solveBoardWithWasm(request);
    const second = await solveBoardWithWasm(request);
    expect(second.status).toBe(first.status);
    expect(second.placements).toEqual(first.placements);
    expect(second.nodeExpansions).toBe(first.nodeExpansions);
    expect(second.interestingnessScore).toBe(first.interestingnessScore);
    expect(second.selectedSignature).toBe(first.selectedSignature);
  });

  it("completes the benchmark fixture within the test budget", async () => {
    const benchmarkRequest = makeRequest({
      boardSize: { columns: 4, rows: 3 },
      pieceCatalog: [DOMINO],
      remainingInventory: { domino: 6 },
      maxNodeExpansions: 100000,
      maxWallClockMs: 200,
    });

    const result = await solveBoardWithWasm(benchmarkRequest);
    expect(result.status).toBe("solved");
    expect(result.elapsedMs).toBeLessThan(500);
  });

  it("respects deterministic ranking across a multi-solution pool", async () => {
    const request = makeRequest({
      boardSize: { columns: 2, rows: 2 },
      pieceCatalog: [
        { pieceId: "alpha", color: "#aa1111", baseCells: [{ x: 0, y: 0 }] },
        { pieceId: "beta", color: "#1111aa", baseCells: [{ x: 0, y: 0 }] },
      ],
      remainingInventory: { alpha: 2, beta: 2 },
      solutionPoolSize: 8,
    });
    const first = await solveBoardWithWasm(request);
    const second = await solveBoardWithWasm(request);
    expect(first.status).toBe("solved");
    expect(first.interestingnessScore).toBeGreaterThan(0);
    expect(second.selectedSignature).toBe(first.selectedSignature);
    expect(second.interestingnessScore).toBe(first.interestingnessScore);
  });
});
