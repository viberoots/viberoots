import { PIECE_TYPE_INITIAL_SUPPLY } from "./board";
import { transformCells, translateCells } from "./geometry";
import { isPlacementValid } from "./placement";
import { DEFAULT_PIECE_TRANSFORM } from "./piece-transform";
import { reduceRevertPiece } from "./reducer-actions";
import type { GameState, PieceDefinition, PlacedPiece } from "./types";

function findPieceDefinition(state: GameState, pieceId: string): PieceDefinition | undefined {
  return state.pieceCatalog.find((piece) => piece.pieceId === pieceId);
}

function findPlacedInstance(state: GameState, instanceId: string): PlacedPiece | undefined {
  return state.board.placedPieces.find((piece) => piece.instanceId === instanceId);
}

function countPlacedPiecesOfType(state: GameState, pieceId: string): number {
  return state.board.placedPieces.filter((piece) => piece.pieceId === pieceId).length;
}

function collectOccupiedCells(state: GameState, excludedInstanceId?: string | null): Set<string> {
  const occupied = new Set<string>();
  const pieceById = new Map(state.pieceCatalog.map((piece) => [piece.pieceId, piece]));
  for (const placed of state.board.placedPieces) {
    if (excludedInstanceId && placed.instanceId === excludedInstanceId) {
      continue;
    }
    const definition = pieceById.get(placed.pieceId);
    if (!definition) {
      continue;
    }
    const placedCells = translateCells(
      transformCells(definition.baseCells, placed.transform),
      placed.position,
    );
    for (const cell of placedCells) {
      occupied.add(`${cell.x},${cell.y}`);
    }
  }
  return occupied;
}

export function reduceCommitPiece(
  state: GameState,
  pieceId: string,
  sourceInstanceId?: string | null,
  dropOutside?: boolean,
): GameState {
  const definition = findPieceDefinition(state, pieceId);
  if (!definition) {
    return state;
  }
  if (dropOutside && sourceInstanceId) {
    const nextPlacedPieces = state.board.placedPieces.filter(
      (piece) => piece.instanceId !== sourceInstanceId,
    );
    const removedSelected = state.selectedInstanceId === sourceInstanceId;
    return {
      ...state,
      board: { ...state.board, placedPieces: nextPlacedPieces },
      selectedInstanceId: removedSelected ? null : state.selectedInstanceId,
      previewByPieceId: { ...state.previewByPieceId, [pieceId]: null },
    };
  }

  const previewPosition = state.previewByPieceId[pieceId] ?? null;
  if (!previewPosition) {
    return state;
  }
  const sourceInstance = sourceInstanceId ? findPlacedInstance(state, sourceInstanceId) : undefined;
  if (!sourceInstance) {
    const remainingSupply = PIECE_TYPE_INITIAL_SUPPLY - countPlacedPiecesOfType(state, pieceId);
    if (remainingSupply <= 0) {
      return reduceRevertPiece(state, pieceId);
    }
  }
  const transform =
    sourceInstance?.transform ?? state.transformByPieceId[pieceId] ?? DEFAULT_PIECE_TRANSFORM;
  const candidateCells = translateCells(
    transformCells(definition.baseCells, transform),
    previewPosition,
  );
  const occupiedCells = collectOccupiedCells(state, sourceInstanceId ?? null);
  if (!isPlacementValid(state.board.size, occupiedCells, candidateCells)) {
    return reduceRevertPiece(state, pieceId);
  }

  const nextPlacement = sourceInstance
    ? { ...sourceInstance, position: previewPosition }
    : {
        instanceId: `${pieceId}#${state.nextPlacedInstanceId}`,
        pieceId,
        transform,
        position: previewPosition,
        isPlaced: true,
      };
  const nextPlacedPieces = sourceInstance
    ? state.board.placedPieces.map((piece) =>
        piece.instanceId === sourceInstance.instanceId ? nextPlacement : piece,
      )
    : [...state.board.placedPieces, nextPlacement];

  return {
    ...state,
    board: { ...state.board, placedPieces: nextPlacedPieces },
    previewByPieceId: { ...state.previewByPieceId, [pieceId]: null },
    nextPlacedInstanceId: sourceInstance
      ? state.nextPlacedInstanceId
      : state.nextPlacedInstanceId + 1,
    selectedInstanceId: sourceInstance ? sourceInstance.instanceId : state.selectedInstanceId,
  };
}
