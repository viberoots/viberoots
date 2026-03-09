import type { Cell, PieceTransform } from "./types";

function rotateClockwise(cell: Cell): Cell {
  return { x: cell.y, y: -cell.x };
}

function applyRotation(cell: Cell, rotation: PieceTransform["rotation"]): Cell {
  let rotated = cell;
  const turns = rotation / 90;
  for (let index = 0; index < turns; index += 1) {
    rotated = rotateClockwise(rotated);
  }
  return rotated;
}

function applyHorizontalFlip(cell: Cell): Cell {
  return { x: -cell.x, y: cell.y };
}

export function normalizeCells(cells: Cell[]): Cell[] {
  if (cells.length === 0) {
    return [];
  }

  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));

  return cells
    .map((cell) => ({ x: cell.x - minX, y: cell.y - minY }))
    .sort((left, right) => {
      if (left.y === right.y) {
        return left.x - right.x;
      }
      return left.y - right.y;
    });
}

export function transformCells(baseCells: Cell[], transform: PieceTransform): Cell[] {
  const transformed = baseCells.map((baseCell) => {
    const rotated = applyRotation(baseCell, transform.rotation);
    return transform.flipped ? applyHorizontalFlip(rotated) : rotated;
  });
  return normalizeCells(transformed);
}

export function translateCells(cells: Cell[], origin: Cell): Cell[] {
  return cells.map((cell) => ({ x: cell.x + origin.x, y: cell.y + origin.y }));
}

export function canonicalCellSignature(cells: Cell[]): string {
  return normalizeCells(cells)
    .map((cell) => `${cell.x},${cell.y}`)
    .join(";");
}
