import { BOARD_CELL_COUNT, PIECE_TYPE_INITIAL_SUPPLY } from "../board";
import { transformCells, translateCells } from "../geometry";
import { cellKey } from "../placement";
import type { GameState, PieceDefinition } from "../types";
import { buildSolverPreparedInput } from "./candidate-generation";
import {
  canonicalPlacementSignature,
  rankSolutionsByInterestingness,
  scoreInterestingness,
} from "./interestingness";
import { dedupeRankedCandidatesBySignature, selectSeededRankedCandidate } from "./seeded-selection";
import { mixSeed32, normalizeSeed } from "./seeded-random";
import {
  selectStaticInterestingSolution,
  shouldUseStaticInterestingPool,
} from "./static-interesting-solution-pool";
import type {
  SolverPlacement,
  SolverRankedCandidate,
  SolverRequest,
  SolverResult,
} from "./solver-types";
import { runSolverSearchInWasm } from "./wasm-runtime";

const DEFAULT_SOLUTION_POOL_SIZE = 8;

function countLockedByPieceId(
  lockedPlacements: SolverRequest["lockedPlacements"],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const placement of lockedPlacements) {
    counts.set(placement.pieceId, (counts.get(placement.pieceId) ?? 0) + 1);
  }
  return counts;
}

function validateLockedPlacements(request: SolverRequest): boolean {
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

function coversRequiredArea(request: SolverRequest): boolean {
  const lockedByPieceId = countLockedByPieceId(request.lockedPlacements);
  let totalArea = 0;
  for (const piece of request.pieceCatalog) {
    const lockedCount = lockedByPieceId.get(piece.pieceId) ?? 0;
    const remaining = Math.max(0, Math.trunc(request.remainingInventory[piece.pieceId] ?? 0));
    totalArea += (lockedCount + remaining) * piece.baseCells.length;
  }
  return totalArea >= request.boardSize.columns * request.boardSize.rows;
}

function mapCandidatesToPlacements(
  candidateIndices: Int32Array,
  candidates: ReturnType<typeof buildSolverPreparedInput>["candidates"],
): SolverPlacement[] {
  const placements: SolverPlacement[] = [];
  for (const candidateIndex of candidateIndices) {
    const candidate = candidates[candidateIndex];
    if (!candidate) {
      continue;
    }
    placements.push({
      pieceId: candidate.pieceId,
      transform: candidate.transform,
      position: candidate.position,
    });
  }
  return placements;
}

function clampSolutionPoolSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SOLUTION_POOL_SIZE;
  }
  return Math.max(1, Math.min(1024, Math.trunc(value)));
}

function clampInterestingnessThreshold(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function rankSolvedCandidates(args: {
  request: SolverRequest;
  lockedPlacements: readonly SolverPlacement[];
  preparedCandidates: ReturnType<typeof buildSolverPreparedInput>["candidates"];
  wasmSolutions: readonly { foundAtNode: number; candidateIndices: Int32Array }[];
}): SolverRankedCandidate[] {
  type RawCandidate = {
    placements: readonly SolverPlacement[];
    foundAtNode: number;
    signature: string;
    structuralBucket: string;
  };
  const rawCandidates: RawCandidate[] = [];
  for (const wasmSolution of args.wasmSolutions) {
    const solvedPlacements = mapCandidatesToPlacements(
      wasmSolution.candidateIndices,
      args.preparedCandidates,
    );
    const placements = [...args.lockedPlacements, ...solvedPlacements];
    rawCandidates.push({
      placements,
      foundAtNode: wasmSolution.foundAtNode,
      signature: canonicalPlacementSignature(placements),
      structuralBucket: structuralBucketKey(
        placements,
        args.request.boardSize.columns,
        args.request.boardSize.rows,
      ),
    });
  }
  const diversified = diversifyRawCandidatesByStructure(rawCandidates, args.request.randomSeed);
  const bucketCounts = new Map<string, number>();
  for (const candidate of diversified) {
    bucketCounts.set(
      candidate.structuralBucket,
      (bucketCounts.get(candidate.structuralBucket) ?? 0) + 1,
    );
  }
  const maxBucketCount = Math.max(1, ...bucketCounts.values());
  const rankedCandidates: SolverRankedCandidate[] = [];
  for (const candidate of diversified) {
    const baseScore = scoreInterestingness({
      boardColumns: args.request.boardSize.columns,
      boardRows: args.request.boardSize.rows,
      pieceCatalog: args.request.pieceCatalog,
      placements: candidate.placements,
    });
    const bucketSize = bucketCounts.get(candidate.structuralBucket) ?? maxBucketCount;
    const structuralNovelty = 1 - (bucketSize - 1) / maxBucketCount;
    const score =
      Math.round((0.9 * baseScore.score + 0.1 * structuralNovelty) * 1_000_000) / 1_000_000;
    rankedCandidates.push({
      placements: candidate.placements,
      foundAtNode: candidate.foundAtNode,
      interestingnessScore: score,
      signature: candidate.signature,
      paretoFront: 0,
      structuralBucket: candidate.structuralBucket,
      objectives: {
        ...baseScore.objectives,
        structuralNovelty,
      },
    });
  }
  return rankSolutionsByInterestingness(rankedCandidates);
}

function quantizeToThirds(value: number, span: number): 0 | 1 | 2 {
  if (span <= 1) {
    return 1;
  }
  const normalized = value / (span - 1);
  if (normalized < 1 / 3) {
    return 0;
  }
  if (normalized < 2 / 3) {
    return 1;
  }
  return 2;
}

function structuralBucketKey(
  placements: readonly SolverPlacement[],
  boardColumns: number,
  boardRows: number,
): string {
  if (placements.length === 0) {
    return "empty";
  }
  let sumX = 0;
  let sumY = 0;
  let flippedCount = 0;
  const rotationCounts = [0, 0, 0, 0];
  const blackPlacements: Array<{ x: number; y: number }> = [];
  for (const placement of placements) {
    sumX += placement.position.x;
    sumY += placement.position.y;
    if (placement.transform.flipped) {
      flippedCount += 1;
    }
    const rotationIndex = placement.transform.rotation / 90;
    rotationCounts[rotationIndex] = (rotationCounts[rotationIndex] ?? 0) + 1;
    if (placement.pieceId.startsWith("black")) {
      blackPlacements.push(placement.position);
    }
  }
  const meanX = sumX / placements.length;
  const meanY = sumY / placements.length;
  const centroidX = quantizeToThirds(meanX, boardColumns);
  const centroidY = quantizeToThirds(meanY, boardRows);
  let dominantRotationIndex = 0;
  for (let index = 1; index < rotationCounts.length; index += 1) {
    if ((rotationCounts[index] ?? 0) > (rotationCounts[dominantRotationIndex] ?? 0)) {
      dominantRotationIndex = index;
    }
  }
  const flippedBin = flippedCount / placements.length >= 0.5 ? 1 : 0;
  if (blackPlacements.length === 0) {
    return `${centroidX}${centroidY}|r${dominantRotationIndex}|f${flippedBin}|b--`;
  }
  const blackMeanX =
    blackPlacements.reduce((sum, point) => sum + point.x, 0) / blackPlacements.length;
  const blackMeanY =
    blackPlacements.reduce((sum, point) => sum + point.y, 0) / blackPlacements.length;
  const blackX = quantizeToThirds(blackMeanX, boardColumns);
  const blackY = quantizeToThirds(blackMeanY, boardRows);
  return `${centroidX}${centroidY}|r${dominantRotationIndex}|f${flippedBin}|b${blackX}${blackY}`;
}

function diversifyRawCandidatesByStructure(
  candidates: readonly {
    placements: readonly SolverPlacement[];
    foundAtNode: number;
    signature: string;
    structuralBucket: string;
  }[],
  randomSeed: number | undefined,
): Array<{
  placements: readonly SolverPlacement[];
  foundAtNode: number;
  signature: string;
  structuralBucket: string;
}> {
  const bucketOrder = new Map<string, number>();
  const byBucket = new Map<string, Array<(typeof candidates)[number]>>();
  for (const candidate of candidates) {
    if (!bucketOrder.has(candidate.structuralBucket)) {
      bucketOrder.set(candidate.structuralBucket, bucketOrder.size);
      byBucket.set(candidate.structuralBucket, []);
    }
    byBucket.get(candidate.structuralBucket)?.push(candidate);
  }
  const buckets = [...byBucket.keys()].sort((left, right) => {
    const leftIndex = bucketOrder.get(left) ?? 0;
    const rightIndex = bucketOrder.get(right) ?? 0;
    return leftIndex - rightIndex;
  });
  if (randomSeed !== undefined && buckets.length > 1) {
    const startOffset = mixSeed32(normalizeSeed(randomSeed)) % buckets.length;
    const rotated = buckets.slice(startOffset).concat(buckets.slice(0, startOffset));
    buckets.splice(0, buckets.length, ...rotated);
  }
  const result: Array<(typeof candidates)[number]> = [];
  let remaining = candidates.length;
  let bucketCursor = 0;
  while (remaining > 0 && buckets.length > 0) {
    const bucketKey = buckets[bucketCursor % buckets.length];
    const queue = byBucket.get(bucketKey);
    const next = queue?.shift();
    if (next) {
      result.push(next);
      remaining -= 1;
    }
    if (!queue || queue.length === 0) {
      byBucket.delete(bucketKey);
      const removeAt = buckets.indexOf(bucketKey);
      if (removeAt >= 0) {
        buckets.splice(removeAt, 1);
      }
      continue;
    }
    bucketCursor += 1;
  }
  return result;
}

function countSetBits(mask: Uint32Array): number {
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

function normalizeInterestingnessScores(
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

export async function solveBoardWithWasm(request: SolverRequest): Promise<SolverResult> {
  const start = Date.now();
  const solutionPoolSize = clampSolutionPoolSize(request.solutionPoolSize);
  const interestingnessThreshold = clampInterestingnessThreshold(request.interestingnessThreshold);
  if (shouldUseStaticInterestingPool(request, interestingnessThreshold)) {
    const selected = selectStaticInterestingSolution(request);
    if (selected) {
      return {
        status: "solved",
        placements: selected.placements.map((placement) => ({
          pieceId: placement.pieceId,
          transform: placement.transform,
          position: placement.position,
        })),
        nodeExpansions: 0,
        elapsedMs: Date.now() - start,
        interestingnessScore: 1,
        selectedSignature: selected.signature,
      };
    }
  }
  if (!validateLockedPlacements(request) || !coversRequiredArea(request)) {
    return {
      status: "unsolved",
      placements: request.lockedPlacements.map((placement) => ({
        pieceId: placement.pieceId,
        transform: placement.transform,
        position: placement.position,
      })),
      nodeExpansions: 0,
      elapsedMs: Date.now() - start,
      interestingnessScore: 0,
      selectedSignature: "",
    };
  }

  const lockedPlacements = request.lockedPlacements.map((placement) => ({
    pieceId: placement.pieceId,
    transform: placement.transform,
    position: placement.position,
  }));
  const solveAttempt = async (
    attemptRequest: SolverRequest,
    preparedInput?: ReturnType<typeof buildSolverPreparedInput>,
  ) => {
    const prepared = preparedInput ?? buildSolverPreparedInput(attemptRequest);
    const wasmResult = await runSolverSearchInWasm(
      prepared,
      attemptRequest.maxNodeExpansions,
      attemptRequest.maxWallClockMs,
      solutionPoolSize,
    );
    const rankedSolutions = normalizeInterestingnessScores(
      dedupeRankedCandidatesBySignature(
        rankSolvedCandidates({
          request: attemptRequest,
          lockedPlacements,
          preparedCandidates: prepared.candidates,
          wasmSolutions: wasmResult.solutions,
        }),
      ),
    ).filter((candidate) => candidate.interestingnessScore >= interestingnessThreshold);
    return {
      prepared,
      wasmResult,
      rankedSolutions,
    };
  };

  const prepared = buildSolverPreparedInput(request);
  if (countSetBits(prepared.lockedMask) === prepared.boardCellCount) {
    return {
      status: "solved",
      placements: lockedPlacements,
      nodeExpansions: 0,
      elapsedMs: Date.now() - start,
      interestingnessScore: 1,
      selectedSignature: canonicalPlacementSignature(lockedPlacements),
    };
  }
  if (prepared.candidates.length === 0) {
    return {
      status: "unsolved",
      placements: lockedPlacements,
      nodeExpansions: 0,
      elapsedMs: Date.now() - start,
      interestingnessScore: 0,
      selectedSignature: "",
    };
  }
  const primaryAttempt = await solveAttempt(request, prepared);

  let resolvedWasmResult = primaryAttempt.wasmResult;
  let resolvedRankedSolutions = primaryAttempt.rankedSolutions;
  if (
    resolvedRankedSolutions.length === 0 &&
    request.randomSeed !== undefined &&
    (resolvedWasmResult.statusCode === 0 || resolvedWasmResult.statusCode === 2)
  ) {
    const fallbackAttempt = await solveAttempt({ ...request, randomSeed: undefined });
    resolvedWasmResult = fallbackAttempt.wasmResult;
    resolvedRankedSolutions = fallbackAttempt.rankedSolutions;
  }

  const selected = selectSeededRankedCandidate(resolvedRankedSolutions, request);
  return {
    status: resolvedWasmResult.statusCode === 1 && selected ? "solved" : "unsolved",
    placements: selected ? selected.placements : lockedPlacements,
    nodeExpansions: resolvedWasmResult.nodeExpansions,
    elapsedMs: Date.now() - start,
    interestingnessScore: selected?.interestingnessScore ?? 0,
    selectedSignature: selected?.signature ?? "",
  };
}

function pieceCatalogById(state: GameState): Map<string, PieceDefinition> {
  return new Map(state.pieceCatalog.map((piece) => [piece.pieceId, piece]));
}

export function createSolverRequestFromGameState(
  state: GameState,
  maxNodeExpansions: number,
  maxWallClockMs: number,
  options?: {
    randomSeed?: number;
    solutionPoolSize?: number;
    selectionWindowSize?: number;
    interestingnessThreshold?: number;
  },
): SolverRequest {
  const lockedCounts = new Map<string, number>();
  for (const placement of state.board.placedPieces) {
    lockedCounts.set(placement.pieceId, (lockedCounts.get(placement.pieceId) ?? 0) + 1);
  }

  const remainingInventory: Record<string, number> = {};
  for (const piece of state.pieceCatalog) {
    const locked = lockedCounts.get(piece.pieceId) ?? 0;
    remainingInventory[piece.pieceId] = Math.max(0, PIECE_TYPE_INITIAL_SUPPLY - locked);
  }

  return {
    boardSize: state.board.size,
    pieceCatalog: state.pieceCatalog,
    lockedPlacements: state.board.placedPieces,
    remainingInventory,
    maxNodeExpansions: Math.max(1, Math.trunc(maxNodeExpansions)),
    maxWallClockMs: Math.max(1, Math.trunc(maxWallClockMs)),
    solutionPoolSize: options?.solutionPoolSize,
    selectionWindowSize: options?.selectionWindowSize,
    interestingnessThreshold: options?.interestingnessThreshold,
    randomSeed:
      options?.randomSeed === undefined
        ? undefined
        : Math.max(1, Math.trunc(Math.abs(options.randomSeed))),
  };
}

export function computePlacementCoverage(
  boardColumns: number,
  pieceCatalog: readonly PieceDefinition[],
  placements: readonly SolverPlacement[],
): number {
  const pieceById = new Map(pieceCatalog.map((piece) => [piece.pieceId, piece]));
  let covered = 0;
  for (const placement of placements) {
    const piece = pieceById.get(placement.pieceId);
    if (!piece) {
      continue;
    }
    covered += transformCells(piece.baseCells, placement.transform).length;
  }
  return covered / Math.max(1, boardColumns);
}

export function expectedBoardCellCount(state: GameState): number {
  return state.board.size.columns * state.board.size.rows || BOARD_CELL_COUNT;
}
