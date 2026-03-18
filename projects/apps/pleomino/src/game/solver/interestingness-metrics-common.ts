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

export function toCellIndex(columns: number, x: number, y: number): number {
  return y * columns + x;
}

export function clamp01(value: number): number {
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
