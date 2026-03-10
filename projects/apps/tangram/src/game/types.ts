export type Cell = {
  x: number;
  y: number;
};

export type PieceTransform = {
  rotation: 0 | 90 | 180 | 270;
  flipped: boolean;
};

export type PieceDefinition = {
  pieceId: string;
  color: string;
  baseCells: readonly Cell[];
};

export type PlacedPiece = {
  instanceId: string;
  pieceId: string;
  transform: PieceTransform;
  position: Cell;
  isPlaced: boolean;
};

export type BoardSize = {
  columns: number;
  rows: number;
};

export type BoardState = {
  size: BoardSize;
  placedPieces: PlacedPiece[];
};

export type PiecePreviewMap = Record<string, Cell | null>;

export type GameState = {
  board: BoardState;
  pieceCatalog: readonly PieceDefinition[];
  selectedPieceId: string | null;
  previewByPieceId: PiecePreviewMap;
  nextPlacedInstanceId: number;
};
