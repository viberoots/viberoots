import { BOARD_SIZE } from "./board";
import { DEFAULT_PIECE_TRANSFORM } from "./piece-transform";
import { PLEOMINO_PIECE_CATALOG } from "./piece-catalog";
import { validatePieceCatalog } from "./piece-catalog-validation";
import type {
  GameHistoryState,
  GameState,
  PieceDefinition,
  PiecePreviewMap,
  PieceTransformMap,
} from "./types";

export const INITIAL_PIECE_CATALOG = PLEOMINO_PIECE_CATALOG;
export const INITIAL_PIECE_CATALOG_METADATA = validatePieceCatalog(INITIAL_PIECE_CATALOG);

function createPreviewByPieceId(catalog: readonly PieceDefinition[]): PiecePreviewMap {
  const previewByPieceId: PiecePreviewMap = {};
  for (const piece of catalog) {
    previewByPieceId[piece.pieceId] = null;
  }
  return previewByPieceId;
}

function createTransformByPieceId(catalog: readonly PieceDefinition[]): PieceTransformMap {
  const transformByPieceId: PieceTransformMap = {};
  for (const piece of catalog) {
    transformByPieceId[piece.pieceId] = DEFAULT_PIECE_TRANSFORM;
  }
  return transformByPieceId;
}

export function createInitialGameState(): GameState {
  return {
    board: {
      size: BOARD_SIZE,
      placedPieces: [],
    },
    pieceCatalog: INITIAL_PIECE_CATALOG,
    selectedPieceId: null,
    selectedInstanceId: null,
    previewByPieceId: createPreviewByPieceId(INITIAL_PIECE_CATALOG),
    transformByPieceId: createTransformByPieceId(INITIAL_PIECE_CATALOG),
    nextPlacedInstanceId: 0,
  };
}

export function createInitialGameHistoryState(): GameHistoryState {
  return {
    past: [],
    present: createInitialGameState(),
    future: [],
  };
}
