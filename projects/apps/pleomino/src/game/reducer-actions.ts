import { transformCells, translateCells } from "./geometry";
import { cellKey, isPlacementValid } from "./placement";
import {
  DEFAULT_PIECE_TRANSFORM,
  flipTransformHorizontally,
  rotateTransformClockwise,
  rotateTransformCounterClockwise,
} from "./piece-transform";
import { createInitialGameState } from "./state";
import type { Cell, GameState, PieceDefinition, PlacedPiece } from "./types";

function findPieceDefinition(state: GameState, pieceId: string): PieceDefinition | undefined {
  return state.pieceCatalog.find((piece) => piece.pieceId === pieceId);
}

function normalizePreviewPosition(position: Cell | null): Cell | null {
  if (position === null) {
    return null;
  }
  return { x: Math.trunc(position.x), y: Math.trunc(position.y) };
}

function findPlacedInstance(state: GameState, instanceId: string): PlacedPiece | undefined {
  return state.board.placedPieces.find((piece) => piece.instanceId === instanceId);
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
      occupied.add(cellKey(cell));
    }
  }
  return occupied;
}

function normalizeSelectedInstanceId(
  state: GameState,
  pieceId: string,
  instanceId: string | null | undefined,
): string | null {
  if (!instanceId) {
    return null;
  }
  const instance = findPlacedInstance(state, instanceId);
  if (!instance || instance.pieceId !== pieceId) {
    return null;
  }
  return instanceId;
}

export function reduceSelectPiece(
  state: GameState,
  pieceId: string,
  instanceId: string | null | undefined,
): GameState {
  if (!findPieceDefinition(state, pieceId)) {
    return state;
  }
  const nextSelectedInstanceId = normalizeSelectedInstanceId(state, pieceId, instanceId);
  if (state.selectedPieceId === pieceId && state.selectedInstanceId === nextSelectedInstanceId) {
    return state;
  }
  return { ...state, selectedPieceId: pieceId, selectedInstanceId: nextSelectedInstanceId };
}

export function reducePreviewPiece(
  state: GameState,
  pieceId: string,
  position: Cell | null,
): GameState {
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
    previewByPieceId: { ...state.previewByPieceId, [pieceId]: nextPosition },
  };
}

export function reduceRevertPiece(state: GameState, pieceId: string): GameState {
  if (!findPieceDefinition(state, pieceId)) {
    return state;
  }
  return {
    ...state,
    previewByPieceId: { ...state.previewByPieceId, [pieceId]: null },
  };
}

export function reduceRotatePiece(
  state: GameState,
  pieceId: string,
  instanceId: string | null | undefined,
  direction: "cw" | "ccw",
): GameState {
  if (!findPieceDefinition(state, pieceId)) {
    return state;
  }
  const sourceInstance = instanceId ? findPlacedInstance(state, instanceId) : undefined;
  if (sourceInstance && sourceInstance.pieceId !== pieceId) {
    return state;
  }
  if (sourceInstance) {
    const definition = findPieceDefinition(state, pieceId);
    if (!definition) {
      return state;
    }
    const nextTransform =
      direction === "ccw"
        ? rotateTransformCounterClockwise(sourceInstance.transform)
        : rotateTransformClockwise(sourceInstance.transform);
    const candidateCells = translateCells(
      transformCells(definition.baseCells, nextTransform),
      sourceInstance.position,
    );
    const occupiedCells = collectOccupiedCells(state, sourceInstance.instanceId);
    if (!isPlacementValid(state.board.size, occupiedCells, candidateCells)) {
      return state;
    }
    return {
      ...state,
      board: {
        ...state.board,
        placedPieces: state.board.placedPieces.map((piece) =>
          piece.instanceId === sourceInstance.instanceId
            ? { ...piece, transform: nextTransform }
            : piece,
        ),
      },
    };
  }
  const currentTransform = state.transformByPieceId[pieceId] ?? DEFAULT_PIECE_TRANSFORM;
  const nextTransform =
    direction === "ccw"
      ? rotateTransformCounterClockwise(currentTransform)
      : rotateTransformClockwise(currentTransform);
  return {
    ...state,
    transformByPieceId: { ...state.transformByPieceId, [pieceId]: nextTransform },
  };
}

export function reduceFlipPiece(
  state: GameState,
  pieceId: string,
  instanceId: string | null | undefined,
): GameState {
  if (!findPieceDefinition(state, pieceId)) {
    return state;
  }
  const sourceInstance = instanceId ? findPlacedInstance(state, instanceId) : undefined;
  if (sourceInstance && sourceInstance.pieceId !== pieceId) {
    return state;
  }
  if (sourceInstance) {
    const definition = findPieceDefinition(state, pieceId);
    if (!definition) {
      return state;
    }
    const nextTransform = flipTransformHorizontally(sourceInstance.transform);
    const candidateCells = translateCells(
      transformCells(definition.baseCells, nextTransform),
      sourceInstance.position,
    );
    const occupiedCells = collectOccupiedCells(state, sourceInstance.instanceId);
    if (!isPlacementValid(state.board.size, occupiedCells, candidateCells)) {
      return state;
    }
    return {
      ...state,
      board: {
        ...state.board,
        placedPieces: state.board.placedPieces.map((piece) =>
          piece.instanceId === sourceInstance.instanceId
            ? { ...piece, transform: nextTransform }
            : piece,
        ),
      },
    };
  }
  const currentTransform = state.transformByPieceId[pieceId] ?? DEFAULT_PIECE_TRANSFORM;
  return {
    ...state,
    transformByPieceId: {
      ...state.transformByPieceId,
      [pieceId]: flipTransformHorizontally(currentTransform),
    },
  };
}

export function reduceResetBoard(state: GameState): GameState {
  const nextState = createInitialGameState();
  if (state.pieceCatalog === nextState.pieceCatalog) {
    return nextState;
  }
  return { ...nextState, pieceCatalog: state.pieceCatalog };
}
