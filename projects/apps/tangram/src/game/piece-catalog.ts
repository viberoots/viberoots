import type { PieceDefinition } from "./types";

export const TANGRAM_PIECE_CATALOG: readonly PieceDefinition[] = [
  {
    pieceId: "purple-2-1",
    color: "#a855f7",
    baseCells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
  },
  {
    pieceId: "red-2-2",
    color: "#ef4444",
    baseCells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
  },
  {
    pieceId: "green-2-2",
    color: "#22c55e",
    baseCells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
  {
    pieceId: "blue-3-1",
    color: "#3b82f6",
    baseCells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ],
  },
  {
    pieceId: "yellow-1-2-1",
    color: "#facc15",
    baseCells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ],
  },
  {
    pieceId: "orange-2-1-2",
    color: "#f97316",
    baseCells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ],
  },
  {
    pieceId: "black-1-1-1-1",
    color: "#000000",
    baseCells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
  },
  {
    pieceId: "white-1-1",
    color: "#ffffff",
    baseCells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
  },
];
