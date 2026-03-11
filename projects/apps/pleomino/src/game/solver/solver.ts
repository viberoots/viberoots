import { BOARD_CELL_COUNT, PIECE_TYPE_INITIAL_SUPPLY } from "../board";
import { transformCells, translateCells } from "../geometry";
import { cellKey } from "../placement";
import type { GameState, PieceDefinition } from "../types";
import { buildSolverPreparedInput } from "./candidate-generation";
import type { SolverPlacement, SolverRequest, SolverResult } from "./solver-types";
import { runSolverSearchInWasm } from "./wasm-runtime";

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

export async function solveBoardWithWasm(request: SolverRequest): Promise<SolverResult> {
  const start = Date.now();
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
    };
  }

  const prepared = buildSolverPreparedInput(request);
  const lockedPlacements = request.lockedPlacements.map((placement) => ({
    pieceId: placement.pieceId,
    transform: placement.transform,
    position: placement.position,
  }));
  if (countSetBits(prepared.lockedMask) === prepared.boardCellCount) {
    return {
      status: "solved",
      placements: lockedPlacements,
      nodeExpansions: 0,
      elapsedMs: Date.now() - start,
    };
  }
  if (prepared.candidates.length === 0) {
    return {
      status: "unsolved",
      placements: lockedPlacements,
      nodeExpansions: 0,
      elapsedMs: Date.now() - start,
    };
  }

  const wasmResult = await runSolverSearchInWasm(
    prepared,
    request.maxNodeExpansions,
    request.maxWallClockMs,
  );
  const solvedPlacements = mapCandidatesToPlacements(
    wasmResult.candidateIndices,
    prepared.candidates,
  );
  return {
    status: wasmResult.statusCode === 1 ? "solved" : "unsolved",
    placements:
      wasmResult.statusCode === 1 ? [...lockedPlacements, ...solvedPlacements] : lockedPlacements,
    nodeExpansions: wasmResult.nodeExpansions,
    elapsedMs: Date.now() - start,
  };
}

function pieceCatalogById(state: GameState): Map<string, PieceDefinition> {
  return new Map(state.pieceCatalog.map((piece) => [piece.pieceId, piece]));
}

export function createSolverRequestFromGameState(
  state: GameState,
  maxNodeExpansions: number,
  maxWallClockMs: number,
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
