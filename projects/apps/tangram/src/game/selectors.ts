import { transformCells, translateCells } from "./geometry";
import { cellKey } from "./placement";
import { DEFAULT_PIECE_TRANSFORM } from "./reducer";
import type { Cell, GameState, PieceDefinition, PlacedPiece } from "./types";

export type BoardCellView = {
  key: string;
  x: number;
  y: number;
  pieceId: string | null;
  color: string | null;
};

export type PieceViewModel = {
  pieceId: string;
  color: string;
  cells: readonly Cell[];
  isSelected: boolean;
  isPlaced: boolean;
  boardPosition: Cell | null;
  previewPosition: Cell | null;
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
  canPreviewSelected: boolean;
  canCommitSelected: boolean;
  canRevertSelected: boolean;
};

export type GameViewModel = {
  board: BoardViewModel;
  tray: PieceTrayViewModel;
  toolbar: ToolbarViewModel;
  status: {
    catalogPieceCount: number;
    placedPieceCount: number;
  };
};

type OccupiedCell = {
  pieceId: string;
  color: string;
};

function indexPiecesById(catalog: readonly PieceDefinition[]): Map<string, PieceDefinition> {
  return new Map(catalog.map((piece) => [piece.pieceId, piece]));
}

function indexPlacedById(placedPieces: readonly PlacedPiece[]): Map<string, PlacedPiece> {
  return new Map(placedPieces.map((placed) => [placed.pieceId, placed]));
}

function buildOccupiedCellMap(state: GameState): Map<string, OccupiedCell> {
  const pieceById = indexPiecesById(state.pieceCatalog);
  const occupiedByCell = new Map<string, OccupiedCell>();

  for (const placed of state.board.placedPieces) {
    const definition = pieceById.get(placed.pieceId);
    if (!definition || !placed.isPlaced) {
      continue;
    }
    const transformed = transformCells(definition.baseCells, placed.transform);
    const boardCells = translateCells(transformed, placed.position);
    for (const cell of boardCells) {
      occupiedByCell.set(cellKey(cell), {
        pieceId: placed.pieceId,
        color: definition.color,
      });
    }
  }

  return occupiedByCell;
}

export function selectBoardView(state: GameState): BoardViewModel {
  const occupiedByCell = buildOccupiedCellMap(state);
  const cells: BoardCellView[] = [];

  for (let row = 0; row < state.board.size.rows; row += 1) {
    for (let column = 0; column < state.board.size.columns; column += 1) {
      const key = `${column},${row}`;
      const occupied = occupiedByCell.get(key);
      cells.push({
        key,
        x: column,
        y: row,
        pieceId: occupied?.pieceId ?? null,
        color: occupied?.color ?? null,
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
  const placedById = indexPlacedById(state.board.placedPieces);

  return {
    selectedPieceId: state.selectedPieceId,
    pieces: state.pieceCatalog.map((piece) => {
      const placed = placedById.get(piece.pieceId);
      const transform = placed?.transform ?? DEFAULT_PIECE_TRANSFORM;
      return {
        pieceId: piece.pieceId,
        color: piece.color,
        cells: transformCells(piece.baseCells, transform),
        isSelected: state.selectedPieceId === piece.pieceId,
        isPlaced: Boolean(placed?.isPlaced),
        boardPosition: placed?.position ?? null,
        previewPosition: state.previewByPieceId[piece.pieceId] ?? null,
      };
    }),
  };
}

export function selectToolbarView(state: GameState): ToolbarViewModel {
  const selectedPieceId = state.selectedPieceId;
  if (!selectedPieceId) {
    return {
      selectedPieceId,
      canPreviewSelected: false,
      canCommitSelected: false,
      canRevertSelected: false,
    };
  }

  const previewPosition = state.previewByPieceId[selectedPieceId] ?? null;
  const hasPlacedSelection = state.board.placedPieces.some(
    (piece) => piece.pieceId === selectedPieceId,
  );

  return {
    selectedPieceId,
    canPreviewSelected: true,
    canCommitSelected: previewPosition !== null,
    canRevertSelected: previewPosition !== null || hasPlacedSelection,
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
    },
  };
}
