import { transformCells, translateCells } from "../geometry";
import type { PieceDefinition } from "../types";
import type { SolverPlacement } from "./solver-types";

export type InterestingnessObjectiveVector = {
  symmetry: number;
  repetition: number;
  rhythm: number;
  edgeAesthetic: number;
  colorDistribution: number;
  globalMotif: number;
  intentionalContrast: number;
  composition: number;
};

export const INTERESTINGNESS_WEIGHTS: InterestingnessObjectiveVector = {
  symmetry: 0.24,
  repetition: 0.2,
  rhythm: 0.08,
  edgeAesthetic: 0.06,
  colorDistribution: 0.08,
  globalMotif: 0.24,
  intentionalContrast: 0.05,
  composition: 0.05,
} as const;

function toCellIndex(columns: number, x: number, y: number): number {
  return y * columns + x;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function buildColorBoard(args: {
  boardColumns: number;
  boardRows: number;
  pieceCatalog: readonly PieceDefinition[];
  placements: readonly SolverPlacement[];
}): string[] {
  const board = new Array<string>(args.boardColumns * args.boardRows).fill("");
  const pieceById = new Map(args.pieceCatalog.map((piece) => [piece.pieceId, piece]));
  for (const placement of args.placements) {
    const definition = pieceById.get(placement.pieceId);
    if (!definition) {
      continue;
    }
    const cells = translateCells(
      transformCells(definition.baseCells, placement.transform),
      placement.position,
    );
    for (const cell of cells) {
      if (cell.x < 0 || cell.y < 0 || cell.x >= args.boardColumns || cell.y >= args.boardRows) {
        continue;
      }
      board[toCellIndex(args.boardColumns, cell.x, cell.y)] = definition.color;
    }
  }
  return board;
}

function mirrorAgreement(
  board: readonly string[],
  columns: number,
  rows: number,
  rightX: (x: number) => number,
  rightY: (y: number) => number,
): number {
  let matches = 0;
  let total = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const left = board[toCellIndex(columns, x, y)] ?? "";
      const right = board[toCellIndex(columns, rightX(x), rightY(y))] ?? "";
      if (!left || !right) {
        continue;
      }
      total += 1;
      if (left === right) {
        matches += 1;
      }
    }
  }
  if (total === 0) {
    return 0;
  }
  return matches / total;
}

export function symmetryScore(board: readonly string[], columns: number, rows: number): number {
  const horizontal = mirrorAgreement(
    board,
    columns,
    rows,
    (x) => columns - 1 - x,
    (y) => y,
  );
  const vertical = mirrorAgreement(
    board,
    columns,
    rows,
    (x) => x,
    (y) => rows - 1 - y,
  );
  const rotation = mirrorAgreement(
    board,
    columns,
    rows,
    (x) => columns - 1 - x,
    (y) => rows - 1 - y,
  );
  return (horizontal + vertical + rotation) / 3;
}

export function patternRepetitionScore(
  board: readonly string[],
  columns: number,
  rows: number,
): number {
  if (columns < 2 || rows < 2) {
    return 0;
  }
  const signatures = new Map<string, number>();
  let windows = 0;
  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < columns - 1; x += 1) {
      const signature = [
        board[toCellIndex(columns, x, y)] ?? "",
        board[toCellIndex(columns, x + 1, y)] ?? "",
        board[toCellIndex(columns, x, y + 1)] ?? "",
        board[toCellIndex(columns, x + 1, y + 1)] ?? "",
      ].join("|");
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
      windows += 1;
    }
  }
  if (windows === 0) {
    return 0;
  }
  let repeated = 0;
  for (const count of signatures.values()) {
    repeated += Math.max(0, count - 1);
  }
  return repeated / windows;
}

function transitionRatios(board: readonly string[], columns: number, rows: number): number[] {
  const ratios: number[] = [];
  for (let y = 0; y < rows; y += 1) {
    if (columns <= 1) {
      continue;
    }
    let transitions = 0;
    for (let x = 1; x < columns; x += 1) {
      const left = board[toCellIndex(columns, x - 1, y)] ?? "";
      const right = board[toCellIndex(columns, x, y)] ?? "";
      if (left && right && left !== right) {
        transitions += 1;
      }
    }
    ratios.push(transitions / (columns - 1));
  }
  for (let x = 0; x < columns; x += 1) {
    if (rows <= 1) {
      continue;
    }
    let transitions = 0;
    for (let y = 1; y < rows; y += 1) {
      const top = board[toCellIndex(columns, x, y - 1)] ?? "";
      const bottom = board[toCellIndex(columns, x, y)] ?? "";
      if (top && bottom && top !== bottom) {
        transitions += 1;
      }
    }
    ratios.push(transitions / (rows - 1));
  }
  return ratios;
}

export function rhythmScore(board: readonly string[], columns: number, rows: number): number {
  const ratios = transitionRatios(board, columns, rows);
  if (ratios.length === 0) {
    return 0;
  }
  const mean = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  const deviation =
    ratios.reduce((sum, ratio) => sum + Math.abs(ratio - mean), 0) / Math.max(1, ratios.length);
  return Math.max(0, 1 - deviation);
}

export function edgeAestheticScore(
  board: readonly string[],
  columns: number,
  rows: number,
): number {
  let changes = 0;
  let totalEdges = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 1; x < columns; x += 1) {
      const left = board[toCellIndex(columns, x - 1, y)] ?? "";
      const right = board[toCellIndex(columns, x, y)] ?? "";
      if (!left || !right) {
        continue;
      }
      totalEdges += 1;
      if (left !== right) {
        changes += 1;
      }
    }
  }
  for (let x = 0; x < columns; x += 1) {
    for (let y = 1; y < rows; y += 1) {
      const top = board[toCellIndex(columns, x, y - 1)] ?? "";
      const bottom = board[toCellIndex(columns, x, y)] ?? "";
      if (!top || !bottom) {
        continue;
      }
      totalEdges += 1;
      if (top !== bottom) {
        changes += 1;
      }
    }
  }
  if (totalEdges === 0) {
    return 0;
  }
  return 1 - changes / totalEdges;
}

function edgeContrastRatio(board: readonly string[], columns: number, rows: number): number {
  let changes = 0;
  let totalEdges = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 1; x < columns; x += 1) {
      const left = board[toCellIndex(columns, x - 1, y)] ?? "";
      const right = board[toCellIndex(columns, x, y)] ?? "";
      if (!left || !right) {
        continue;
      }
      totalEdges += 1;
      if (left !== right) {
        changes += 1;
      }
    }
  }
  for (let x = 0; x < columns; x += 1) {
    for (let y = 1; y < rows; y += 1) {
      const top = board[toCellIndex(columns, x, y - 1)] ?? "";
      const bottom = board[toCellIndex(columns, x, y)] ?? "";
      if (!top || !bottom) {
        continue;
      }
      totalEdges += 1;
      if (top !== bottom) {
        changes += 1;
      }
    }
  }
  if (totalEdges === 0) {
    return 0;
  }
  return changes / totalEdges;
}

export function intentionalContrastScore(
  board: readonly string[],
  columns: number,
  rows: number,
): number {
  const contrastRatio = edgeContrastRatio(board, columns, rows);
  const target = 0.45;
  const tolerance = 0.35;
  const contrastIntent = 1 - Math.abs(contrastRatio - target) / tolerance;

  let isolatedPixels = 0;
  let totalCells = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const color = board[toCellIndex(columns, x, y)] ?? "";
      if (!color) {
        continue;
      }
      totalCells += 1;
      let sameNeighbors = 0;
      if (x > 0 && board[toCellIndex(columns, x - 1, y)] === color) {
        sameNeighbors += 1;
      }
      if (x + 1 < columns && board[toCellIndex(columns, x + 1, y)] === color) {
        sameNeighbors += 1;
      }
      if (y > 0 && board[toCellIndex(columns, x, y - 1)] === color) {
        sameNeighbors += 1;
      }
      if (y + 1 < rows && board[toCellIndex(columns, x, y + 1)] === color) {
        sameNeighbors += 1;
      }
      if (sameNeighbors === 0) {
        isolatedPixels += 1;
      }
    }
  }
  const antiNoise = totalCells > 0 ? 1 - isolatedPixels / totalCells : 0;
  return clamp01(0.7 * contrastIntent + 0.3 * antiNoise);
}

export function colorDistributionScore(
  board: readonly string[],
  columns: number,
  rows: number,
): number {
  const quadrantByColor = new Map<string, [number, number, number, number]>();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const color = board[toCellIndex(columns, x, y)] ?? "";
      if (!color) {
        continue;
      }
      const quadrant = (y < rows / 2 ? 0 : 2) + (x < columns / 2 ? 0 : 1);
      const counts = quadrantByColor.get(color) ?? [0, 0, 0, 0];
      counts[quadrant] += 1;
      quadrantByColor.set(color, counts);
    }
  }
  if (quadrantByColor.size === 0) {
    return 0;
  }
  let totalScore = 0;
  for (const counts of quadrantByColor.values()) {
    const total = counts[0] + counts[1] + counts[2] + counts[3];
    if (total <= 0) {
      continue;
    }
    let imbalance = 0;
    for (const count of counts) {
      imbalance += Math.abs(count / total - 0.25);
    }
    totalScore += Math.max(0, 1 - imbalance / 1.5);
  }
  return totalScore / quadrantByColor.size;
}

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
  if (total === 0) {
    return 0;
  }
  return matching / total;
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
  if (total === 0) {
    return 0;
  }
  return consistent / total;
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
