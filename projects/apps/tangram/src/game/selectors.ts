import { PIECE_TYPE_INITIAL_SUPPLY } from "./board";
import { transformCells, translateCells } from "./geometry";
import { cellKey } from "./placement";
import { DEFAULT_PIECE_TRANSFORM } from "./reducer";
import type { Cell, GameState, PieceDefinition, PlacedPiece } from "./types";

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
  instanceId: string;
  localCell: Cell;
  color: string;
};

function indexPiecesById(catalog: readonly PieceDefinition[]): Map<string, PieceDefinition> {
  return new Map(catalog.map((piece) => [piece.pieceId, piece]));
}

function countPlacedByType(placedPieces: readonly PlacedPiece[]): Map<string, number> {
  const countByType = new Map<string, number>();
  for (const piece of placedPieces) {
    countByType.set(piece.pieceId, (countByType.get(piece.pieceId) ?? 0) + 1);
  }
  return countByType;
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
    for (let index = 0; index < boardCells.length; index += 1) {
      const cell = boardCells[index];
      const localCell = transformed[index];
      occupiedByCell.set(cellKey(cell), {
        pieceId: placed.pieceId,
        instanceId: placed.instanceId,
        localCell,
        color: definition.color,
      });
    }
  }

  return occupiedByCell;
}

export function selectBoardView(state: GameState): BoardViewModel {
  const pieceById = indexPiecesById(state.pieceCatalog);
  const occupiedByCell = buildOccupiedCellMap(state);
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
    const transform = DEFAULT_PIECE_TRANSFORM;
    const previewCells = translateCells(
      transformCells(definition.baseCells, transform),
      previewPosition,
    );
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

  return {
    selectedPieceId: state.selectedPieceId,
    pieces: state.pieceCatalog.map((piece) => {
      const placedCount = placedCountByType.get(piece.pieceId) ?? 0;
      const remainingCount = Math.max(0, PIECE_TYPE_INITIAL_SUPPLY - placedCount);
      return {
        pieceId: piece.pieceId,
        color: piece.color,
        cells: transformCells(piece.baseCells, DEFAULT_PIECE_TRANSFORM),
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
