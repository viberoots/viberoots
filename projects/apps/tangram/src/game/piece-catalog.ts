import type { PieceDefinition } from "./types";

export const TANGRAM_PIECE_CATALOG: readonly PieceDefinition[] = [
  {
    pieceId: "tan-large-a",
    color: "#ef4444",
    baseCells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
  },
  {
    pieceId: "tan-large-b",
    color: "#f97316",
    baseCells: [
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
  },
  {
    pieceId: "tan-medium",
    color: "#facc15",
    baseCells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
    ],
  },
  {
    pieceId: "tan-small-a",
    color: "#22c55e",
    baseCells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
  },
  {
    pieceId: "tan-small-b",
    color: "#06b6d4",
    baseCells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
  },
  {
    pieceId: "tan-square",
    color: "#3b82f6",
    baseCells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
  {
    pieceId: "tan-parallelogram",
    color: "#a855f7",
    baseCells: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
];
