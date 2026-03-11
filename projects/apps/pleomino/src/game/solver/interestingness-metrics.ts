import { transformCells, translateCells } from "../geometry";
import type { PieceDefinition } from "../types";
import type { SolverPlacement } from "./solver-types";

export const INTERESTINGNESS_WEIGHTS = {
  symmetry: 0.45,
  repetition: 0.2,
  rhythm: 0.15,
  edgeAesthetic: 0.1,
  colorDistribution: 0.1,
} as const;

function toCellIndex(columns: number, x: number, y: number): number {
  return y * columns + x;
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
