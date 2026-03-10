import { transformCells, translateCells } from "./geometry";
import { cellKey, isPlacementValid } from "./placement";
import { createInitialGameState } from "./state";
import type { Cell, GameState, PieceDefinition, PieceTransform, PlacedPiece } from "./types";

export const DEFAULT_PIECE_TRANSFORM: PieceTransform = {
  rotation: 0,
  flipped: false,
};

export type GameAction =
  | { type: "piece/select"; pieceId: string }
  | { type: "piece/preview"; pieceId: string; position: Cell | null }
  | { type: "piece/commit"; pieceId: string }
  | { type: "piece/revert"; pieceId: string }
  | { type: "board/reset" };

function findPieceDefinition(state: GameState, pieceId: string): PieceDefinition | undefined {
  return state.pieceCatalog.find((piece) => piece.pieceId === pieceId);
}

function findPlacedPiece(state: GameState, pieceId: string): PlacedPiece | undefined {
  return state.board.placedPieces.find((piece) => piece.pieceId === pieceId);
}

function normalizePreviewPosition(position: Cell | null): Cell | null {
  if (position === null) {
    return null;
  }
  return {
    x: Math.trunc(position.x),
    y: Math.trunc(position.y),
  };
}

function collectOccupiedCellsExcept(state: GameState, excludedPieceId: string): Set<string> {
  const occupied = new Set<string>();
  const pieceById = new Map(state.pieceCatalog.map((piece) => [piece.pieceId, piece]));

  for (const placed of state.board.placedPieces) {
    if (placed.pieceId === excludedPieceId) {
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
      occupied.add(cellKey(cell));
    }
  }

  return occupied;
}

function upsertPlacedPiece(
  placedPieces: readonly PlacedPiece[],
  nextPiece: PlacedPiece,
): PlacedPiece[] {
  const currentIndex = placedPieces.findIndex((piece) => piece.pieceId === nextPiece.pieceId);
  if (currentIndex === -1) {
    return [...placedPieces, nextPiece];
  }

  const nextPlacedPieces = [...placedPieces];
  nextPlacedPieces[currentIndex] = nextPiece;
  return nextPlacedPieces;
}

function reduceSelectPiece(state: GameState, pieceId: string): GameState {
  if (!findPieceDefinition(state, pieceId)) {
    return state;
  }
  if (state.selectedPieceId === pieceId) {
    return state;
  }

  return {
    ...state,
    selectedPieceId: pieceId,
  };
}

function reducePreviewPiece(state: GameState, pieceId: string, position: Cell | null): GameState {
  if (!findPieceDefinition(state, pieceId)) {
    return state;
  }

  const nextPosition = normalizePreviewPosition(position);
  const currentPosition = state.previewByPieceId[pieceId] ?? null;
  if (
    currentPosition?.x === nextPosition?.x &&
    currentPosition?.y === nextPosition?.y &&
    currentPosition !== null
  ) {
    return state;
  }
  if (currentPosition === null && nextPosition === null) {
    return state;
  }

  return {
    ...state,
    previewByPieceId: {
      ...state.previewByPieceId,
      [pieceId]: nextPosition,
    },
  };
}

function reduceRevertPiece(state: GameState, pieceId: string): GameState {
  if (!findPieceDefinition(state, pieceId)) {
    return state;
  }

  const placedPiece = findPlacedPiece(state, pieceId);
  const nextPreview = placedPiece ? placedPiece.position : null;
  return {
    ...state,
    previewByPieceId: {
      ...state.previewByPieceId,
      [pieceId]: nextPreview,
    },
  };
}

function reduceCommitPiece(state: GameState, pieceId: string): GameState {
  const definition = findPieceDefinition(state, pieceId);
  if (!definition) {
    return state;
  }

  const previewPosition = state.previewByPieceId[pieceId] ?? null;
  if (!previewPosition) {
    return state;
  }

  const currentPlacement = findPlacedPiece(state, pieceId);
  const transform = currentPlacement?.transform ?? DEFAULT_PIECE_TRANSFORM;
  const candidateCells = translateCells(
    transformCells(definition.baseCells, transform),
    previewPosition,
  );
  const occupiedWithoutSelected = collectOccupiedCellsExcept(state, pieceId);

  if (!isPlacementValid(state.board.size, occupiedWithoutSelected, candidateCells)) {
    return reduceRevertPiece(state, pieceId);
  }

  const nextPlacement: PlacedPiece = {
    pieceId,
    transform,
    position: previewPosition,
    isPlaced: true,
  };

  return {
    ...state,
    board: {
      ...state.board,
      placedPieces: upsertPlacedPiece(state.board.placedPieces, nextPlacement),
    },
    previewByPieceId: {
      ...state.previewByPieceId,
      [pieceId]: null,
    },
  };
}

function reduceResetBoard(state: GameState): GameState {
  const nextState = createInitialGameState();
  if (state.pieceCatalog === nextState.pieceCatalog) {
    return nextState;
  }
  return {
    ...nextState,
    pieceCatalog: state.pieceCatalog,
  };
}

export function tangramGameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "piece/select":
      return reduceSelectPiece(state, action.pieceId);
    case "piece/preview":
      return reducePreviewPiece(state, action.pieceId, action.position);
    case "piece/commit":
      return reduceCommitPiece(state, action.pieceId);
    case "piece/revert":
      return reduceRevertPiece(state, action.pieceId);
    case "board/reset":
      return reduceResetBoard(state);
    default:
      return state;
  }
}
