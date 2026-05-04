import { describe, expect, it } from "vitest";
import {
  canonicalPlacementSignature,
  rankSolutionsByInterestingness,
  scoreInterestingness,
} from "../src/game/solver/interestingness";
import type { SolverPlacement } from "../src/game/solver/solver-types";

const MONOMINO_CATALOG = [
  { pieceId: "alpha", color: "#aa1111", baseCells: [{ x: 0, y: 0 }] },
  { pieceId: "beta", color: "#1111aa", baseCells: [{ x: 0, y: 0 }] },
] as const;

function score(placements: readonly SolverPlacement[]): number {
  return scoreInterestingness({
    boardColumns: 2,
    boardRows: 2,
    pieceCatalog: MONOMINO_CATALOG,
    placements,
  }).score;
}

describe("solver interestingness scoring", () => {
  it("prefers balanced checkerboard-like color rhythm over stripes", () => {
    const checkerboard: SolverPlacement[] = [
      { pieceId: "alpha", transform: { rotation: 0, flipped: false }, position: { x: 0, y: 0 } },
      { pieceId: "beta", transform: { rotation: 0, flipped: false }, position: { x: 1, y: 0 } },
      { pieceId: "beta", transform: { rotation: 0, flipped: false }, position: { x: 0, y: 1 } },
      { pieceId: "alpha", transform: { rotation: 0, flipped: false }, position: { x: 1, y: 1 } },
    ];
    const stripes: SolverPlacement[] = [
      { pieceId: "alpha", transform: { rotation: 0, flipped: false }, position: { x: 0, y: 0 } },
      { pieceId: "alpha", transform: { rotation: 0, flipped: false }, position: { x: 1, y: 0 } },
      { pieceId: "beta", transform: { rotation: 0, flipped: false }, position: { x: 0, y: 1 } },
      { pieceId: "beta", transform: { rotation: 0, flipped: false }, position: { x: 1, y: 1 } },
    ];

    expect(score(checkerboard)).toBeGreaterThan(score(stripes));
  });

  it("uses deterministic tie-breakers: score, then nodes, then signature", () => {
    const basePlacements: SolverPlacement[] = [
      { pieceId: "alpha", transform: { rotation: 0, flipped: false }, position: { x: 0, y: 0 } },
      { pieceId: "beta", transform: { rotation: 0, flipped: false }, position: { x: 1, y: 0 } },
      { pieceId: "alpha", transform: { rotation: 0, flipped: false }, position: { x: 0, y: 1 } },
      { pieceId: "beta", transform: { rotation: 0, flipped: false }, position: { x: 1, y: 1 } },
    ];
    const signatureA = canonicalPlacementSignature(basePlacements);

    const ranked = rankSolutionsByInterestingness([
      {
        placements: basePlacements,
        interestingnessScore: 0.8,
        foundAtNode: 6,
        signature: "z-last",
        paretoFront: 0,
        structuralBucket: "a",
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
      {
        placements: basePlacements,
        interestingnessScore: 0.8,
        foundAtNode: 3,
        signature: signatureA,
        paretoFront: 0,
        structuralBucket: "a",
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
      {
        placements: basePlacements,
        interestingnessScore: 0.8,
        foundAtNode: 3,
        signature: "a-first",
        paretoFront: 0,
        structuralBucket: "a",
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
    ]);

    expect(ranked[0]?.foundAtNode).toBe(3);
    expect(ranked[0]?.signature).toBe("a-first");
  });
});
