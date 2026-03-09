import type { BoardSize, Cell } from "./types";

export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

export function inBounds(boardSize: BoardSize, cells: Cell[]): boolean {
  return cells.every((cell) => {
    return cell.x >= 0 && cell.y >= 0 && cell.x < boardSize.columns && cell.y < boardSize.rows;
  });
}

export function noOverlap(occupiedSet: ReadonlySet<string>, cells: Cell[]): boolean {
  return cells.every((cell) => !occupiedSet.has(cellKey(cell)));
}

export function isPlacementValid(
  boardSize: BoardSize,
  occupiedSet: ReadonlySet<string>,
  cells: Cell[],
): boolean {
  return inBounds(boardSize, cells) && noOverlap(occupiedSet, cells);
}
