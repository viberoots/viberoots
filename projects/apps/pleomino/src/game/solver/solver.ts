import { BOARD_CELL_COUNT, PIECE_TYPE_INITIAL_SUPPLY } from "../board";
import { transformCells, translateCells } from "../geometry";
import { cellKey } from "../placement";
import type { GameState, PieceDefinition } from "../types";
import { buildSolverPreparedInput } from "./candidate-generation";
import { canonicalPlacementSignature } from "./interestingness";
import { dedupeRankedCandidatesBySignature, selectSeededRankedCandidate } from "./seeded-selection";
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
import { rankSolvedCandidates } from "./solver-ranking";
import {
  buildPartialBoardRetrySeeds,
  clampInterestingnessThreshold,
  clampSolutionPoolSize,
  countSetBits,
  coversRequiredArea,
  normalizeInterestingnessScores,
  validateLockedPlacements,
} from "./solver-request-utils";
import { runSolverSearchInWasm } from "./wasm-runtime";

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
  const fallbackRequests: SolverRequest[] = [];
  if (request.randomSeed !== undefined && request.lockedPlacements.length > 0) {
    for (const retrySeed of buildPartialBoardRetrySeeds(request.randomSeed)) {
      fallbackRequests.push({ ...request, randomSeed: retrySeed });
    }
  }
  if (request.randomSeed !== undefined) {
    fallbackRequests.push({ ...request, randomSeed: undefined });
  }

  const primaryAttempt = await solveAttempt(request, prepared);
  let resolvedWasmResult = primaryAttempt.wasmResult;
  let resolvedRankedSolutions = primaryAttempt.rankedSolutions;
  for (const fallbackRequest of fallbackRequests) {
    if (resolvedRankedSolutions.length > 0) {
      break;
    }
    if (resolvedWasmResult.statusCode !== 0 && resolvedWasmResult.statusCode !== 2) {
      break;
    }
    const fallbackAttempt = await solveAttempt(fallbackRequest);
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
