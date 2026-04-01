import { transformCells, translateCells } from "./geometry";
import { cellKey } from "./placement";
import type { Cell, GameState, PieceDefinition, PieceTransform, PlacedPiece } from "./types";

export type OccupiedCell = {
  pieceId: string;
  instanceId: string;
  localCell: Cell;
  color: string;
};

export function indexPiecesById(catalog: readonly PieceDefinition[]): Map<string, PieceDefinition> {
  return new Map(catalog.map((piece) => [piece.pieceId, piece]));
}

export function countPlacedByType(placedPieces: readonly PlacedPiece[]): Map<string, number> {
  const countByType = new Map<string, number>();
  for (const piece of placedPieces) {
    countByType.set(piece.pieceId, (countByType.get(piece.pieceId) ?? 0) + 1);
  }
  return countByType;
}

export function createTransformedCellsForPiece(catalog: readonly PieceDefinition[]): {
  pieceById: Map<string, PieceDefinition>;
  transformedCellsForPiece: (pieceId: string, transform: PieceTransform) => readonly Cell[] | null;
} {
  const pieceById = indexPiecesById(catalog);
  const transformedCellsBySignature = new Map<string, readonly Cell[]>();

  return {
    pieceById,
    transformedCellsForPiece: (
      pieceId: string,
      transform: PieceTransform,
    ): readonly Cell[] | null => {
      const cacheKey = `${pieceId}|${transform.rotation}|${transform.flipped ? "1" : "0"}`;
      const cached = transformedCellsBySignature.get(cacheKey);
      if (cached) {
        return cached;
      }
      const definition = pieceById.get(pieceId);
      if (!definition) {
        return null;
      }
      const transformed = transformCells(definition.baseCells, transform);
      transformedCellsBySignature.set(cacheKey, transformed);
      return transformed;
    },
  };
}

export function buildOccupiedCellMap(
  state: GameState,
  pieceById: ReadonlyMap<string, PieceDefinition>,
  transformedCellsForPiece: (pieceId: string, transform: PieceTransform) => readonly Cell[] | null,
): Map<string, OccupiedCell> {
  const occupiedByCell = new Map<string, OccupiedCell>();

  for (const placed of state.board.placedPieces) {
    const definition = pieceById.get(placed.pieceId);
    if (!definition || !placed.isPlaced) {
      continue;
    }
    const transformed = transformedCellsForPiece(placed.pieceId, placed.transform);
    if (!transformed) {
      continue;
    }
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
