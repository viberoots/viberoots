import type { PieceDefinition } from "../types";
import type { SolverPlacement, SolverRankedCandidate } from "./solver-types";
import {
  INTERESTINGNESS_WEIGHTS,
  buildColorBoard,
  colorDistributionScore,
  edgeAestheticScore,
  patternRepetitionScore,
  rhythmScore,
  symmetryScore,
} from "./interestingness-metrics";

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function scoreInterestingness(args: {
  boardColumns: number;
  boardRows: number;
  pieceCatalog: readonly PieceDefinition[];
  placements: readonly SolverPlacement[];
}): number {
  const board = buildColorBoard(args);
  const weighted =
    symmetryScore(board, args.boardColumns, args.boardRows) * INTERESTINGNESS_WEIGHTS.symmetry +
    patternRepetitionScore(board, args.boardColumns, args.boardRows) *
      INTERESTINGNESS_WEIGHTS.repetition +
    rhythmScore(board, args.boardColumns, args.boardRows) * INTERESTINGNESS_WEIGHTS.rhythm +
    edgeAestheticScore(board, args.boardColumns, args.boardRows) *
      INTERESTINGNESS_WEIGHTS.edgeAesthetic +
    colorDistributionScore(board, args.boardColumns, args.boardRows) *
      INTERESTINGNESS_WEIGHTS.colorDistribution;
  return roundScore(weighted);
}

export function canonicalPlacementSignature(placements: readonly SolverPlacement[]): string {
  const parts = placements
    .map((placement) => {
      const flipped = placement.transform.flipped ? "1" : "0";
      return `${placement.pieceId}@${placement.position.x},${placement.position.y},${placement.transform.rotation},${flipped}`;
    })
    .sort();
  return parts.join("|");
}

export function rankSolutionsByInterestingness(
  candidates: readonly SolverRankedCandidate[],
): SolverRankedCandidate[] {
  return [...candidates].sort((left, right) => {
    if (right.interestingnessScore !== left.interestingnessScore) {
      return right.interestingnessScore - left.interestingnessScore;
    }
    if (left.foundAtNode !== right.foundAtNode) {
      return left.foundAtNode - right.foundAtNode;
    }
    return left.signature.localeCompare(right.signature);
  });
}
