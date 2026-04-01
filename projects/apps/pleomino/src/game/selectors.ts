import { PIECE_TYPE_INITIAL_SUPPLY } from "./board";
import { translateCells } from "./geometry";
import { cellKey } from "./placement";
import { DEFAULT_PIECE_TRANSFORM } from "./piece-transform";
import {
  buildOccupiedCellMap,
  countPlacedByType,
  createTransformedCellsForPiece,
  type OccupiedCell,
} from "./selectors-helpers";
import { computeWinState } from "./win";
import type { Cell, GameState, PieceDefinition, PieceTransform, PlacedPiece } from "./types";

export type BoardCellView = {
  key: string;
  x: number;
  y: number;
  pieceId: string | null;
  instanceId: string | null;
  localCell: Cell | null;
  color: string | null;
  state: "empty" | "placed" | "preview";
};

export type PieceViewModel = {
  pieceId: string;
  color: string;
  cells: readonly Cell[];
  remainingCount: number;
  canDrag: boolean;
};

export type BoardViewModel = {
  columns: number;
  rows: number;
  cells: readonly BoardCellView[];
};

export type PieceTrayViewModel = {
  selectedPieceId: string | null;
  pieces: readonly PieceViewModel[];
};

export type ToolbarViewModel = {
  selectedPieceId: string | null;
  selectedInstanceId: string | null;
  selectedRotation: 0 | 90 | 180 | 270 | null;
  selectedFlipped: boolean | null;
  canPreviewSelected: boolean;
  canCommitSelected: boolean;
  canRevertSelected: boolean;
  canRotateSelected: boolean;
  canFlipSelected: boolean;
};

export type GameViewModel = {
  board: BoardViewModel;
  tray: PieceTrayViewModel;
  toolbar: ToolbarViewModel;
  status: {
    catalogPieceCount: number;
    placedPieceCount: number;
    isSolved: boolean;
  };
};

export type GameViewSelector = (state: GameState) => GameViewModel;

export function selectBoardView(state: GameState): BoardViewModel {
  const { pieceById, transformedCellsForPiece } = createTransformedCellsForPiece(
    state.pieceCatalog,
  );
  const occupiedByCell = buildOccupiedCellMap(state, pieceById, transformedCellsForPiece);
  const previewByCell = new Map<string, OccupiedCell>();
  const boardColumns = state.board.size.columns;
  const boardRows = state.board.size.rows;

  for (const [pieceId, previewPosition] of Object.entries(state.previewByPieceId)) {
    if (!previewPosition) {
      continue;
    }
    const definition = pieceById.get(pieceId);
    if (!definition) {
      continue;
    }
    const transform = state.transformByPieceId[pieceId] ?? DEFAULT_PIECE_TRANSFORM;
    const transformed = transformedCellsForPiece(pieceId, transform);
    if (!transformed) {
      continue;
    }
    const previewCells = translateCells(transformed, previewPosition);
    for (const cell of previewCells) {
      if (cell.x < 0 || cell.y < 0 || cell.x >= boardColumns || cell.y >= boardRows) {
        continue;
      }
      const key = cellKey(cell);
      if (occupiedByCell.has(key)) {
        continue;
      }
      previewByCell.set(key, {
        pieceId,
        instanceId: `${pieceId}#preview`,
        localCell: cell,
        color: definition.color,
      });
    }
  }

  const cells: BoardCellView[] = [];

  for (let row = 0; row < boardRows; row += 1) {
    for (let column = 0; column < boardColumns; column += 1) {
      const key = `${column},${row}`;
      const occupied = occupiedByCell.get(key);
      const preview = previewByCell.get(key);
      cells.push({
        key,
        x: column,
        y: row,
        pieceId: occupied?.pieceId ?? preview?.pieceId ?? null,
        instanceId: occupied?.instanceId ?? null,
        localCell: occupied?.localCell ?? null,
        color: occupied?.color ?? preview?.color ?? null,
        state: occupied ? "placed" : preview ? "preview" : "empty",
      });
    }
  }

  return {
    columns: state.board.size.columns,
    rows: state.board.size.rows,
    cells,
  };
}

export function selectPieceTrayView(state: GameState): PieceTrayViewModel {
  const placedCountByType = countPlacedByType(state.board.placedPieces);
  const { transformedCellsForPiece } = createTransformedCellsForPiece(state.pieceCatalog);

  return {
    selectedPieceId: state.selectedPieceId,
    selectedInstanceId: state.selectedInstanceId,
    pieces: state.pieceCatalog.map((piece) => {
      const placedCount = placedCountByType.get(piece.pieceId) ?? 0;
      const remainingCount = Math.max(0, PIECE_TYPE_INITIAL_SUPPLY - placedCount);
      const trayTransform = state.transformByPieceId[piece.pieceId] ?? DEFAULT_PIECE_TRANSFORM;
      const cells = transformedCellsForPiece(piece.pieceId, trayTransform) ?? piece.baseCells;
      return {
        pieceId: piece.pieceId,
        color: piece.color,
        cells,
        remainingCount,
        canDrag: remainingCount > 0,
      };
    }),
  };
}

export function selectToolbarView(state: GameState): ToolbarViewModel {
  const selectedPieceId = state.selectedPieceId;
  if (!selectedPieceId) {
    return {
      selectedPieceId,
      selectedInstanceId: null,
      selectedRotation: null,
      selectedFlipped: null,
      canPreviewSelected: false,
      canCommitSelected: false,
      canRevertSelected: false,
      canRotateSelected: false,
      canFlipSelected: false,
    };
  }

  const previewPosition = state.previewByPieceId[selectedPieceId] ?? null;
  const hasPlacedSelection = state.board.placedPieces.some(
    (piece) => piece.pieceId === selectedPieceId,
  );
  const selectedInstance = state.selectedInstanceId
    ? (state.board.placedPieces.find((piece) => piece.instanceId === state.selectedInstanceId) ??
      null)
    : null;
  const selectedTransform =
    selectedInstance?.transform ?? state.transformByPieceId[selectedPieceId];

  return {
    selectedPieceId,
    selectedInstanceId: state.selectedInstanceId,
    selectedRotation: selectedTransform?.rotation ?? null,
    selectedFlipped: selectedTransform?.flipped ?? null,
    canPreviewSelected: true,
    canCommitSelected: previewPosition !== null,
    canRevertSelected: previewPosition !== null || hasPlacedSelection,
    canRotateSelected: true,
    canFlipSelected: true,
  };
}

export function selectGameViewModel(state: GameState): GameViewModel {
  return {
    board: selectBoardView(state),
    tray: selectPieceTrayView(state),
    toolbar: selectToolbarView(state),
    status: {
      catalogPieceCount: state.pieceCatalog.length,
      placedPieceCount: state.board.placedPieces.length,
      isSolved: computeWinState(state),
    },
  };
}
