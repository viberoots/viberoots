import { PIECE_TYPE_INITIAL_SUPPLY } from "./board";
import { transformCells, translateCells } from "./geometry";
import { cellKey, isPlacementValid } from "./placement";
import {
  DEFAULT_PIECE_TRANSFORM,
  flipTransformHorizontally,
  rotateTransformClockwise,
  rotateTransformCounterClockwise,
} from "./piece-transform";
import { createInitialGameState } from "./state";
import type { Cell, GameState, PieceDefinition, PieceTransform, PlacedPiece } from "./types";

export type GameAction =
  | { type: "piece/select"; pieceId: string; instanceId?: string | null }
  | { type: "piece/preview"; pieceId: string; position: Cell | null }
  | {
      type: "piece/commit";
      pieceId: string;
      sourceInstanceId?: string | null;
      dropOutside?: boolean;
    }
  | { type: "piece/rotate"; pieceId: string; instanceId?: string | null; direction?: "cw" | "ccw" }
  | { type: "piece/flip"; pieceId: string; instanceId?: string | null }
  | { type: "piece/revert"; pieceId: string }
  | { type: "board/reset" };

function findPieceDefinition(state: GameState, pieceId: string): PieceDefinition | undefined {
  return state.pieceCatalog.find((piece) => piece.pieceId === pieceId);
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

function countPlacedPiecesOfType(state: GameState, pieceId: string): number {
  return state.board.placedPieces.filter((piece) => piece.pieceId === pieceId).length;
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

function reduceSelectPiece(
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

  return {
    ...state,
    selectedPieceId: pieceId,
    selectedInstanceId: nextSelectedInstanceId,
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

  return {
    ...state,
    previewByPieceId: {
      ...state.previewByPieceId,
      [pieceId]: null,
    },
  };
}

function pieceTransformForType(state: GameState, pieceId: string): PieceTransform {
  return state.transformByPieceId[pieceId] ?? DEFAULT_PIECE_TRANSFORM;
}

function reduceRotatePiece(
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

  const currentTransform = pieceTransformForType(state, pieceId);
  const nextTransform =
    direction === "ccw"
      ? rotateTransformCounterClockwise(currentTransform)
      : rotateTransformClockwise(currentTransform);
  return {
    ...state,
    transformByPieceId: {
      ...state.transformByPieceId,
      [pieceId]: nextTransform,
    },
  };
}

function reduceFlipPiece(
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

  const currentTransform = pieceTransformForType(state, pieceId);
  const nextTransform = flipTransformHorizontally(currentTransform);
  return {
    ...state,
    transformByPieceId: {
      ...state.transformByPieceId,
      [pieceId]: nextTransform,
    },
  };
}

function reduceCommitPiece(
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
      board: {
        ...state.board,
        placedPieces: nextPlacedPieces,
      },
      selectedInstanceId: removedSelected ? null : state.selectedInstanceId,
      previewByPieceId: {
        ...state.previewByPieceId,
        [pieceId]: null,
      },
    };
  }

  const previewPosition = state.previewByPieceId[pieceId] ?? null;
  if (!previewPosition) {
    return state;
  }

  const sourceInstance = sourceInstanceId ? findPlacedInstance(state, sourceInstanceId) : undefined;
  if (!sourceInstance) {
    const placedCount = countPlacedPiecesOfType(state, pieceId);
    const remainingSupply = PIECE_TYPE_INITIAL_SUPPLY - placedCount;
    if (remainingSupply <= 0) {
      return reduceRevertPiece(state, pieceId);
    }
  }

  const transform = sourceInstance?.transform ?? pieceTransformForType(state, pieceId);
  const candidateCells = translateCells(
    transformCells(definition.baseCells, transform),
    previewPosition,
  );
  const occupiedCells = collectOccupiedCells(state, sourceInstanceId ?? null);

  if (!isPlacementValid(state.board.size, occupiedCells, candidateCells)) {
    if (sourceInstance) {
      return {
        ...state,
        previewByPieceId: {
          ...state.previewByPieceId,
          [pieceId]: sourceInstance.position,
        },
      };
    }
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
    board: {
      ...state.board,
      placedPieces: nextPlacedPieces,
    },
    previewByPieceId: {
      ...state.previewByPieceId,
      [pieceId]: null,
    },
    nextPlacedInstanceId: sourceInstance
      ? state.nextPlacedInstanceId
      : state.nextPlacedInstanceId + 1,
    selectedInstanceId: sourceInstance ? sourceInstance.instanceId : state.selectedInstanceId,
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
      return reduceSelectPiece(state, action.pieceId, action.instanceId);
    case "piece/preview":
      return reducePreviewPiece(state, action.pieceId, action.position);
    case "piece/commit":
      return reduceCommitPiece(state, action.pieceId, action.sourceInstanceId, action.dropOutside);
    case "piece/rotate":
      return reduceRotatePiece(state, action.pieceId, action.instanceId, action.direction ?? "cw");
    case "piece/flip":
      return reduceFlipPiece(state, action.pieceId, action.instanceId);
    case "piece/revert":
      return reduceRevertPiece(state, action.pieceId);
    case "board/reset":
      return reduceResetBoard(state);
    default:
      return state;
  }
}
