import { describe, expect, it } from "vitest";
import { TANGRAM_PIECE_CATALOG } from "../src/game/piece-catalog.ts";
import { validatePieceCatalog } from "../src/game/piece-catalog-validation.ts";
import {
  INITIAL_PIECE_CATALOG,
  INITIAL_PIECE_CATALOG_METADATA,
  createInitialGameState,
} from "../src/game/state.ts";
import type { PieceDefinition } from "../src/game/types.ts";

describe("piece catalog", () => {
  it("validates the shipped catalog entries", () => {
    expect(() => validatePieceCatalog(TANGRAM_PIECE_CATALOG)).not.toThrow();
  });

  it("keeps metadata stable for piece count, ids, and colors", () => {
    expect(INITIAL_PIECE_CATALOG_METADATA).toEqual({
      pieceCount: 8,
      pieceIds: [
        "purple-2-1",
        "red-2-2",
        "green-2-2",
        "blue-3-1",
        "yellow-1-2-1",
        "orange-2-1-2",
        "black-1-1-1-1",
        "white-1-1",
      ],
      colorTokens: [
        "#a855f7",
        "#ef4444",
        "#22c55e",
        "#3b82f6",
        "#facc15",
        "#f97316",
        "#000000",
        "#ffffff",
      ],
      canonicalSignatures: {
        "purple-2-1": "0,0;1,0;0,1",
        "red-2-2": "0,0;0,1;1,1;1,2",
        "green-2-2": "0,0;1,0;0,1;1,1",
        "blue-3-1": "0,0;0,1;0,2;1,2",
        "yellow-1-2-1": "0,0;1,0;2,0;1,1",
        "orange-2-1-2": "0,0;1,0;2,0;0,1;2,1",
        "black-1-1-1-1": "0,0;1,0;2,0;3,0",
        "white-1-1": "0,0;1,0",
      },
    });
  });

  it("uses the validated catalog as the initial game-state source of truth", () => {
    const state = createInitialGameState();
    expect(state.pieceCatalog).toBe(INITIAL_PIECE_CATALOG);
    expect(state.pieceCatalog).toBe(TANGRAM_PIECE_CATALOG);
  });

  it("fails validation on malformed or duplicate piece definitions", () => {
    const duplicateIds: PieceDefinition[] = [
      {
        pieceId: "dup",
        color: "#111111",
        baseCells: [{ x: 0, y: 0 }],
      },
      {
        pieceId: "dup",
        color: "#222222",
        baseCells: [{ x: 1, y: 0 }],
      },
    ];
    const duplicateCells: PieceDefinition[] = [
      {
        pieceId: "dup-cells",
        color: "#111111",
        baseCells: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    ];
    const duplicateShapes: PieceDefinition[] = [
      {
        pieceId: "shape-a",
        color: "#111111",
        baseCells: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
      {
        pieceId: "shape-b",
        color: "#222222",
        baseCells: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
    ];
    const nonIntegerCell: PieceDefinition[] = [
      {
        pieceId: "float-cell",
        color: "#111111",
        baseCells: [{ x: 0.5, y: 0 }],
      },
    ];
    const emptyCells: PieceDefinition[] = [
      {
        pieceId: "empty",
        color: "#111111",
        baseCells: [],
      },
    ];

    expect(() => validatePieceCatalog(duplicateIds)).toThrow("duplicate pieceId");
    expect(() => validatePieceCatalog(duplicateCells)).toThrow("duplicate cell coordinate");
    expect(() => validatePieceCatalog(duplicateShapes)).toThrow("duplicates canonical shape");
    expect(() => validatePieceCatalog(nonIntegerCell)).toThrow("non-integer cell coordinate");
    expect(() => validatePieceCatalog(emptyCells)).toThrow("at least one cell");
  });
});
