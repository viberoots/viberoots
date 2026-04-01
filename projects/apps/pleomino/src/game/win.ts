import { transformCells, translateCells } from "./geometry";
import { cellKey } from "./placement";
import type { GameState } from "./types";

export function computeWinState(state: GameState): boolean {
  if (state.board.placedPieces.length === 0) {
    return false;
  }

  const boardCellCount = state.board.size.columns * state.board.size.rows;
  const pieceById = new Map(state.pieceCatalog.map((piece) => [piece.pieceId, piece]));
  let coveredCellBudget = 0;
  for (const placed of state.board.placedPieces) {
    const definition = pieceById.get(placed.pieceId);
    if (!definition || !placed.isPlaced) {
      continue;
    }
    coveredCellBudget += definition.baseCells.length;
    if (coveredCellBudget > boardCellCount) {
      return false;
    }
  }
  if (coveredCellBudget !== boardCellCount) {
    return false;
  }

  const occupied = new Set<string>();

  for (const placed of state.board.placedPieces) {
    const definition = pieceById.get(placed.pieceId);
    if (!definition || !placed.isPlaced) {
      continue;
    }
    const boardCells = translateCells(
      transformCells(definition.baseCells, placed.transform),
      placed.position,
    );
    for (const cell of boardCells) {
      if (
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= state.board.size.columns ||
        cell.y >= state.board.size.rows
      ) {
        return false;
      }
      const key = cellKey(cell);
      if (occupied.has(key)) {
        return false;
      }
      occupied.add(key);
    }
  }

  return occupied.size === boardCellCount;
}
