import { describe, expect, it } from "vitest";
import { createSolverRequestFromGameState, solveBoardWithWasm } from "../src/game/solver/solver.ts";
import { selectSeededRankedCandidate } from "../src/game/solver/seeded-selection.ts";
import { createInitialGameState } from "../src/game/state.ts";
import type { SolverRankedCandidate, SolverRequest } from "../src/game/solver/solver-types.ts";

const UNIT_PIECES = [
  { pieceId: "a", color: "#101010", baseCells: [{ x: 0, y: 0 }] },
  { pieceId: "b", color: "#101010", baseCells: [{ x: 0, y: 0 }] },
  { pieceId: "c", color: "#101010", baseCells: [{ x: 0, y: 0 }] },
  { pieceId: "d", color: "#101010", baseCells: [{ x: 0, y: 0 }] },
] as const;

function makeSeededRequest(seed: number): SolverRequest {
  return {
    boardSize: { columns: 2, rows: 2 },
    pieceCatalog: UNIT_PIECES,
    lockedPlacements: [],
    remainingInventory: { a: 1, b: 1, c: 1, d: 1 },
    maxNodeExpansions: 10_000,
    maxWallClockMs: 1_000,
    solutionPoolSize: 24,
    selectionWindowSize: 3,
    randomSeed: seed,
  };
}

describe("solver seeded selection", () => {
  it("does not collapse sequential seeds to one index for small selection windows", () => {
    const candidates: SolverRankedCandidate[] = [
      { placements: [], interestingnessScore: 1, foundAtNode: 1, signature: "a" },
      { placements: [], interestingnessScore: 0.9, foundAtNode: 2, signature: "b" },
      { placements: [], interestingnessScore: 0.8, foundAtNode: 3, signature: "c" },
    ];
    const signatures = new Set<string>();
    for (let seed = 1; seed <= 16; seed += 1) {
      const selected = selectSeededRankedCandidate(candidates, {
        boardSize: { columns: 2, rows: 2 },
        pieceCatalog: [],
        lockedPlacements: [],
        remainingInventory: {},
        maxNodeExpansions: 1,
        maxWallClockMs: 1,
        randomSeed: seed,
        selectionWindowSize: 3,
      });
      signatures.add(selected?.signature ?? "");
    }
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("returns a stable selected signature for the same seed", async () => {
    const request = makeSeededRequest(7);
    const first = await solveBoardWithWasm(request);
    const second = await solveBoardWithWasm(request);
    expect(first.status).toBe("solved");
    expect(second.status).toBe("solved");
    expect(second.selectedSignature).toBe(first.selectedSignature);
  });

  it("can vary selected signatures across different seeds", async () => {
    const signatures = new Set<string>();
    for (let seed = 1; seed <= 8; seed += 1) {
      const result = await solveBoardWithWasm(makeSeededRequest(seed));
      expect(result.status).toBe("solved");
      signatures.add(result.selectedSignature);
    }
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("solves an empty-board request on a known solvable fixture", async () => {
    const result = await solveBoardWithWasm({
      boardSize: { columns: 2, rows: 2 },
      pieceCatalog: [
        {
          pieceId: "square",
          color: "#f0f0f0",
          baseCells: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
        },
      ],
      lockedPlacements: [],
      remainingInventory: { square: 1 },
      maxNodeExpansions: 5_000,
      maxWallClockMs: 500,
      randomSeed: 1,
      selectionWindowSize: 1,
      solutionPoolSize: 1,
    });
    expect(result.status).toBe("solved");
    expect(result.placements).toHaveLength(1);
    expect(result.selectedSignature.length).toBeGreaterThan(0);
  });

  it("can produce varied seeded solutions for the empty-board pleomino request", async () => {
    const state = createInitialGameState();
    const signatures = new Set<string>();
    for (let seed = 1; seed <= 6; seed += 1) {
      const request = createSolverRequestFromGameState(state, 300_000, 1_200, {
        randomSeed: seed,
        solutionPoolSize: 32,
        selectionWindowSize: 12,
      });
      const result = await solveBoardWithWasm(request);
      expect(result.status).toBe("solved");
      signatures.add(result.selectedSignature);
    }
    expect(signatures.size).toBeGreaterThan(1);
  });
});
