import { describe, expect, it } from "vitest";
import { computeWinState } from "../src/game/win.ts";
import type { GameState } from "../src/game/types.ts";

function createState(placements: GameState["board"]["placedPieces"]): GameState {
  return {
    board: {
      size: { columns: 2, rows: 2 },
      placedPieces: placements,
    },
    pieceCatalog: [
      {
        pieceId: "unit",
        color: "#000000",
        baseCells: [{ x: 0, y: 0 }],
      },
    ],
    selectedPieceId: null,
    selectedInstanceId: null,
    previewByPieceId: { unit: null },
    transformByPieceId: { unit: { rotation: 0, flipped: false } },
    nextPlacedInstanceId: 0,
  };
}

describe("computeWinState", () => {
  it("returns true only when every board cell is covered exactly once", () => {
    const solved = createState([
      {
        instanceId: "unit#0",
        pieceId: "unit",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 0 },
        isPlaced: true,
      },
      {
        instanceId: "unit#1",
        pieceId: "unit",
        transform: { rotation: 0, flipped: false },
        position: { x: 1, y: 0 },
        isPlaced: true,
      },
      {
        instanceId: "unit#2",
        pieceId: "unit",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 1 },
        isPlaced: true,
      },
      {
        instanceId: "unit#3",
        pieceId: "unit",
        transform: { rotation: 0, flipped: false },
        position: { x: 1, y: 1 },
        isPlaced: true,
      },
    ]);

    expect(computeWinState(solved)).toBe(true);
  });

  it("returns false when there are gaps or overlap", () => {
    const withGap = createState([
      {
        instanceId: "unit#0",
        pieceId: "unit",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 0 },
        isPlaced: true,
      },
      {
        instanceId: "unit#1",
        pieceId: "unit",
        transform: { rotation: 0, flipped: false },
        position: { x: 1, y: 0 },
        isPlaced: true,
      },
      {
        instanceId: "unit#2",
        pieceId: "unit",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 1 },
        isPlaced: true,
      },
    ]);
    const withOverlap = createState([
      {
        instanceId: "unit#0",
        pieceId: "unit",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 0 },
        isPlaced: true,
      },
      {
        instanceId: "unit#1",
        pieceId: "unit",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 0 },
        isPlaced: true,
      },
    ]);

    expect(computeWinState(withGap)).toBe(false);
    expect(computeWinState(withOverlap)).toBe(false);
  });
});
