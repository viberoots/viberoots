import { BOARD_SIZE } from "./board";
import { TANGRAM_PIECE_CATALOG } from "./piece-catalog";
import { validatePieceCatalog } from "./piece-catalog-validation";
import type { GameState, PieceDefinition, PiecePreviewMap } from "./types";

export const INITIAL_PIECE_CATALOG = TANGRAM_PIECE_CATALOG;
export const INITIAL_PIECE_CATALOG_METADATA = validatePieceCatalog(INITIAL_PIECE_CATALOG);

function createPreviewByPieceId(catalog: readonly PieceDefinition[]): PiecePreviewMap {
  const previewByPieceId: PiecePreviewMap = {};
  for (const piece of catalog) {
    previewByPieceId[piece.pieceId] = null;
  }
  return previewByPieceId;
}

export function createInitialGameState(): GameState {
  return {
    board: {
      size: BOARD_SIZE,
      placedPieces: [],
    },
    pieceCatalog: INITIAL_PIECE_CATALOG,
    selectedPieceId: null,
    previewByPieceId: createPreviewByPieceId(INITIAL_PIECE_CATALOG),
    nextPlacedInstanceId: 0,
  };
}
