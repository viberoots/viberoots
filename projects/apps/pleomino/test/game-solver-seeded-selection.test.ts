import { describe, expect, it } from "vitest";
import { createSolverRequestFromGameState, solveBoardWithWasm } from "../src/game/solver/solver";
import { selectSeededRankedCandidate } from "../src/game/solver/seeded-selection";
import { STATIC_INTERESTING_SOLUTIONS } from "../src/game/solver/static-interesting-solutions";
import { createInitialGameState } from "../src/game/state";
import type { SolverRankedCandidate } from "../src/game/solver/solver-types";
import { makeRankedCandidate, makeSeededRequest } from "./game-solver-seeded-selection-helpers";

describe("solver seeded selection", () => {
  it("uses diversity ordering inside the seeded selection window", () => {
    const ranked: SolverRankedCandidate[] = [
      makeRankedCandidate(
        "top",
        [
          { pieceId: "a", x: 0, y: 0 },
          { pieceId: "b", x: 1, y: 0 },
        ],
        1,
      ),
      makeRankedCandidate(
        "near-1",
        [
          { pieceId: "a", x: 0, y: 0 },
          { pieceId: "b", x: 2, y: 0 },
        ],
        0.99,
      ),
      makeRankedCandidate(
        "near-2",
        [
          { pieceId: "a", x: 0, y: 0 },
          { pieceId: "b", x: 3, y: 0 },
        ],
        0.98,
      ),
      makeRankedCandidate(
        "far",
        [
          { pieceId: "c", x: 8, y: 8 },
          { pieceId: "d", x: 9, y: 8 },
        ],
        0.97,
      ),
    ];

    const selected = selectSeededRankedCandidate(ranked, {
      boardSize: { columns: 10, rows: 10 },
      pieceCatalog: [],
      lockedPlacements: [],
      remainingInventory: {},
      maxNodeExpansions: 1,
      maxWallClockMs: 1,
      randomSeed: 4,
      selectionWindowSize: 4,
    });

    expect(selected?.signature).toBe("far");
  });

  it("does not collapse sequential seeds to one index for small selection windows", () => {
    const candidates: SolverRankedCandidate[] = [
      {
        placements: [],
        interestingnessScore: 1,
        foundAtNode: 1,
        signature: "a",
        paretoFront: 0,
        structuralBucket: "a",
        objectives: {
          symmetry: 1,
          repetition: 1,
          rhythm: 1,
          edgeAesthetic: 1,
          colorDistribution: 1,
          globalMotif: 1,
          intentionalContrast: 1,
          composition: 1,
          structuralNovelty: 1,
        },
      },
      {
        placements: [],
        interestingnessScore: 0.9,
        foundAtNode: 2,
        signature: "b",
        paretoFront: 1,
        structuralBucket: "b",
        objectives: {
          symmetry: 0.9,
          repetition: 0.9,
          rhythm: 0.9,
          edgeAesthetic: 0.9,
          colorDistribution: 0.9,
          globalMotif: 0.9,
          intentionalContrast: 0.9,
          composition: 0.9,
          structuralNovelty: 0.9,
        },
      },
      {
        placements: [],
        interestingnessScore: 0.8,
        foundAtNode: 3,
        signature: "c",
        paretoFront: 2,
        structuralBucket: "c",
        objectives: {
          symmetry: 0.8,
          repetition: 0.8,
          rhythm: 0.8,
          edgeAesthetic: 0.8,
          colorDistribution: 0.8,
          globalMotif: 0.8,
          intentionalContrast: 0.8,
          composition: 0.8,
          structuralNovelty: 0.8,
        },
      },
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
    const blackPlacementPatterns = new Set<string>();
    for (let seed = 1; seed <= 6; seed += 1) {
      const request = createSolverRequestFromGameState(state, 300_000, 1_200, {
        randomSeed: seed,
        solutionPoolSize: 96,
        selectionWindowSize: 32,
      });
      const result = await solveBoardWithWasm(request);
      expect(result.status).toBe("solved");
      signatures.add(result.selectedSignature);
      const blackPlacements = result.placements
        .filter((placement) => placement.pieceId === "black-1-1-1-1")
        .map((placement) => `${placement.position.x},${placement.position.y}`)
        .sort()
        .join("|");
      blackPlacementPatterns.add(blackPlacements);
    }
    expect(signatures.size).toBeGreaterThan(1);
    expect(blackPlacementPatterns.size).toBeGreaterThan(1);
  });

  it("uses the static interesting-solution set for max interestingness requests", async () => {
    const state = createInitialGameState();
    const request = createSolverRequestFromGameState(state, 300_000, 1_200, {
      randomSeed: 5,
      interestingnessThreshold: 1,
    });
    const result = await solveBoardWithWasm(request);
    expect(result.status).toBe("solved");
    expect(result.nodeExpansions).toBe(0);
    expect(result.interestingnessScore).toBe(1);
    expect(
      STATIC_INTERESTING_SOLUTIONS.some(
        (candidate) => candidate.signature === result.selectedSignature,
      ),
    ).toBe(true);
  });

  it("varies static max-interestingness picks across seeds", async () => {
    const state = createInitialGameState();
    const signatures = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const request = createSolverRequestFromGameState(state, 300_000, 1_200, {
        randomSeed: seed,
        interestingnessThreshold: 1,
      });
      const result = await solveBoardWithWasm(request);
      expect(result.status).toBe("solved");
      signatures.add(result.selectedSignature);
    }
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("normalizes solved interestingness scores into [0,1] for thresholding", async () => {
    const result = await solveBoardWithWasm(makeSeededRequest(5));
    expect(result.status).toBe("solved");
    expect(result.interestingnessScore).toBeGreaterThan(0);
    expect(result.interestingnessScore).toBeLessThanOrEqual(1);
  });
});
