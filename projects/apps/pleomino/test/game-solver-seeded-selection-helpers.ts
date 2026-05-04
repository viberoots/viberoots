import type { SolverRankedCandidate, SolverRequest } from "../src/game/solver/solver-types";

export const UNIT_PIECES = [
  { pieceId: "a", color: "#101010", baseCells: [{ x: 0, y: 0 }] },
  { pieceId: "b", color: "#101010", baseCells: [{ x: 0, y: 0 }] },
  { pieceId: "c", color: "#101010", baseCells: [{ x: 0, y: 0 }] },
  { pieceId: "d", color: "#101010", baseCells: [{ x: 0, y: 0 }] },
] as const;

export function makeSeededRequest(seed: number): SolverRequest {
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

function objectiveVector(score: number) {
  return {
    symmetry: score,
    repetition: score,
    rhythm: score,
    edgeAesthetic: score,
    colorDistribution: score,
    globalMotif: score,
    intentionalContrast: score,
    composition: score,
    structuralNovelty: score,
  };
}

export function makeRankedCandidate(
  signature: string,
  placements: Array<{ pieceId: string; x: number; y: number }>,
  score: number,
  structuralBucket = "bucket-a",
): SolverRankedCandidate {
  return {
    signature,
    interestingnessScore: score,
    foundAtNode: 1,
    paretoFront: 0,
    structuralBucket,
    objectives: objectiveVector(score),
    placements: placements.map((placement) => ({
      pieceId: placement.pieceId,
      position: { x: placement.x, y: placement.y },
      transform: { rotation: 0, flipped: false },
    })),
  };
}
