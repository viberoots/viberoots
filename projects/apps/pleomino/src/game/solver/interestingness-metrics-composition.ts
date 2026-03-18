import { clamp01, toCellIndex } from "./interestingness-metrics-common";
import { symmetryScore } from "./interestingness-metrics-surface";

function diagonalMotifScore(board: readonly string[], columns: number, rows: number): number {
  let matching = 0;
  let total = 0;
  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < columns - 1; x += 1) {
      const center = board[toCellIndex(columns, x, y)] ?? "";
      const diag = board[toCellIndex(columns, x + 1, y + 1)] ?? "";
      if (!center || !diag) {
        continue;
      }
      total += 1;
      if (center === diag) {
        matching += 1;
      }
    }
  }
  return total === 0 ? 0 : matching / total;
}

function radialMotifScore(board: readonly string[], columns: number, rows: number): number {
  const centerX = (columns - 1) / 2;
  const centerY = (rows - 1) / 2;
  let total = 0;
  let consistent = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const color = board[toCellIndex(columns, x, y)] ?? "";
      if (!color) {
        continue;
      }
      const mirroredX = Math.round(2 * centerX - x);
      const mirroredY = Math.round(2 * centerY - y);
      if (mirroredX < 0 || mirroredY < 0 || mirroredX >= columns || mirroredY >= rows) {
        continue;
      }
      const mirroredColor = board[toCellIndex(columns, mirroredX, mirroredY)] ?? "";
      if (!mirroredColor) {
        continue;
      }
      total += 1;
      if (mirroredColor === color) {
        consistent += 1;
      }
    }
  }
  return total === 0 ? 0 : consistent / total;
}

export function globalMotifScore(board: readonly string[], columns: number, rows: number): number {
  const diagonal = diagonalMotifScore(board, columns, rows);
  const radial = radialMotifScore(board, columns, rows);
  const mirror = symmetryScore(board, columns, rows);
  return clamp01(0.4 * diagonal + 0.35 * radial + 0.25 * mirror);
}

function compositionMassBalanceScore(
  board: readonly string[],
  columns: number,
  rows: number,
): number {
  let sumX = 0;
  let sumY = 0;
  let cells = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (!(board[toCellIndex(columns, x, y)] ?? "")) {
        continue;
      }
      sumX += x;
      sumY += y;
      cells += 1;
    }
  }
  if (cells === 0) {
    return 0;
  }
  const centerX = (columns - 1) / 2;
  const centerY = (rows - 1) / 2;
  const meanX = sumX / cells;
  const meanY = sumY / cells;
  const dx = meanX - centerX;
  const dy = meanY - centerY;
  const maxDistance = Math.hypot(Math.max(1, centerX), Math.max(1, centerY));
  return clamp01(1 - Math.hypot(dx, dy) / maxDistance);
}

function compositionRuleOfThirdsScore(
  board: readonly string[],
  columns: number,
  rows: number,
): number {
  const countsByColor = new Map<string, number>();
  const sumByColor = new Map<string, { x: number; y: number }>();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const color = board[toCellIndex(columns, x, y)] ?? "";
      if (!color) {
        continue;
      }
      countsByColor.set(color, (countsByColor.get(color) ?? 0) + 1);
      const sum = sumByColor.get(color) ?? { x: 0, y: 0 };
      sum.x += x;
      sum.y += y;
      sumByColor.set(color, sum);
    }
  }
  if (countsByColor.size === 0) {
    return 0;
  }
  const anchors = [
    { x: (columns - 1) / 3, y: (rows - 1) / 3 },
    { x: ((columns - 1) * 2) / 3, y: (rows - 1) / 3 },
    { x: (columns - 1) / 3, y: ((rows - 1) * 2) / 3 },
    { x: ((columns - 1) * 2) / 3, y: ((rows - 1) * 2) / 3 },
  ];
  const maxDistance = Math.hypot(columns - 1, rows - 1);
  let bestAnchorFit = 0;
  for (const [color, count] of countsByColor.entries()) {
    const sum = sumByColor.get(color);
    if (!sum || count <= 0) {
      continue;
    }
    const centroid = { x: sum.x / count, y: sum.y / count };
    let closest = Infinity;
    for (const anchor of anchors) {
      closest = Math.min(closest, Math.hypot(centroid.x - anchor.x, centroid.y - anchor.y));
    }
    bestAnchorFit = Math.max(bestAnchorFit, clamp01(1 - closest / Math.max(1, maxDistance * 0.5)));
  }
  return bestAnchorFit;
}

function compositionDirectionalFlowScore(
  board: readonly string[],
  columns: number,
  rows: number,
): number {
  let horizontalBoundaries = 0;
  let verticalBoundaries = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 1; x < columns; x += 1) {
      const left = board[toCellIndex(columns, x - 1, y)] ?? "";
      const right = board[toCellIndex(columns, x, y)] ?? "";
      if (left && right && left !== right) {
        verticalBoundaries += 1;
      }
    }
  }
  for (let x = 0; x < columns; x += 1) {
    for (let y = 1; y < rows; y += 1) {
      const top = board[toCellIndex(columns, x, y - 1)] ?? "";
      const bottom = board[toCellIndex(columns, x, y)] ?? "";
      if (top && bottom && top !== bottom) {
        horizontalBoundaries += 1;
      }
    }
  }
  const total = horizontalBoundaries + verticalBoundaries;
  if (total === 0) {
    return 0;
  }
  const directionalBias = Math.abs(horizontalBoundaries - verticalBoundaries) / total;
  return clamp01(1 - directionalBias);
}

export function compositionScore(board: readonly string[], columns: number, rows: number): number {
  const massBalance = compositionMassBalanceScore(board, columns, rows);
  const thirds = compositionRuleOfThirdsScore(board, columns, rows);
  const flow = compositionDirectionalFlowScore(board, columns, rows);
  return clamp01(0.45 * massBalance + 0.3 * thirds + 0.25 * flow);
}
