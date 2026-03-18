import { transformCells, translateCells } from "../geometry";
import { cellKey } from "../placement";
import { mixSeed32, normalizeSeed } from "./seeded-random";
import type { SolverRankedCandidate, SolverRequest } from "./solver-types";

const DEFAULT_SOLUTION_POOL_SIZE = 8;
const PARTIAL_BOARD_RETRY_SEED_COUNT = 2;

function countLockedByPieceId(
  lockedPlacements: SolverRequest["lockedPlacements"],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const placement of lockedPlacements) {
    counts.set(placement.pieceId, (counts.get(placement.pieceId) ?? 0) + 1);
  }
  return counts;
}

export function validateLockedPlacements(request: SolverRequest): boolean {
  const pieceById = new Map(request.pieceCatalog.map((piece) => [piece.pieceId, piece]));
  const occupied = new Set<string>();
  for (const placement of request.lockedPlacements) {
    const definition = pieceById.get(placement.pieceId);
    if (!definition) {
      return false;
    }
    const cells = translateCells(
      transformCells(definition.baseCells, placement.transform),
      placement.position,
    );
    for (const cell of cells) {
      if (
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= request.boardSize.columns ||
        cell.y >= request.boardSize.rows ||
        occupied.has(cellKey(cell))
      ) {
        return false;
      }
      occupied.add(cellKey(cell));
    }
  }
  return true;
}

export function coversRequiredArea(request: SolverRequest): boolean {
  const lockedByPieceId = countLockedByPieceId(request.lockedPlacements);
  let totalArea = 0;
  for (const piece of request.pieceCatalog) {
    const lockedCount = lockedByPieceId.get(piece.pieceId) ?? 0;
    const remaining = Math.max(0, Math.trunc(request.remainingInventory[piece.pieceId] ?? 0));
    totalArea += (lockedCount + remaining) * piece.baseCells.length;
  }
  return totalArea >= request.boardSize.columns * request.boardSize.rows;
}

export function clampSolutionPoolSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SOLUTION_POOL_SIZE;
  }
  return Math.max(1, Math.min(1024, Math.trunc(value)));
}

export function clampInterestingnessThreshold(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function buildPartialBoardRetrySeeds(seed: number): number[] {
  const retrySeeds: number[] = [];
  let nextSeed = normalizeSeed(seed);
  for (let index = 0; index < PARTIAL_BOARD_RETRY_SEED_COUNT; index += 1) {
    nextSeed = mixSeed32((nextSeed + 0x9e3779b9) >>> 0);
    retrySeeds.push(Math.max(1, nextSeed));
  }
  return retrySeeds;
}

export function countSetBits(mask: Uint32Array): number {
  let count = 0;
  for (const word of mask) {
    let value = word >>> 0;
    while (value !== 0) {
      value &= value - 1;
      count += 1;
    }
  }
  return count;
}

export function normalizeInterestingnessScores(
  candidates: readonly SolverRankedCandidate[],
): SolverRankedCandidate[] {
  let maxScore = 0;
  for (const candidate of candidates) {
    maxScore = Math.max(maxScore, candidate.interestingnessScore);
  }
  if (maxScore <= 0) {
    return candidates.map((candidate) => ({ ...candidate, interestingnessScore: 0 }));
  }
  return candidates.map((candidate) => ({
    ...candidate,
    interestingnessScore:
      Math.round((candidate.interestingnessScore / maxScore) * 1_000_000) / 1_000_000,
  }));
}
