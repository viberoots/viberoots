import { describe, expect, it } from "vitest";
import { BOARD_SIZE } from "../src/game/board.ts";
import { cellKey, inBounds, isPlacementValid, noOverlap } from "../src/game/placement.ts";

describe("placement validity", () => {
  it("accepts placements fully inside board bounds", () => {
    const cells = [
      { x: 0, y: 0 },
      { x: BOARD_SIZE.columns - 1, y: BOARD_SIZE.rows - 1 },
    ];

    expect(inBounds(BOARD_SIZE, cells)).toBe(true);
  });

  it("rejects out-of-bounds placements", () => {
    const cells = [
      { x: -1, y: 0 },
      { x: 0, y: BOARD_SIZE.rows },
    ];

    expect(inBounds(BOARD_SIZE, cells)).toBe(false);
  });

  it("rejects overlapping placements", () => {
    const occupied = new Set([cellKey({ x: 3, y: 4 })]);
    const cells = [
      { x: 2, y: 4 },
      { x: 3, y: 4 },
    ];

    expect(noOverlap(occupied, cells)).toBe(false);
    expect(isPlacementValid(BOARD_SIZE, occupied, cells)).toBe(false);
  });

  it("accepts empty-board placements when in bounds", () => {
    const occupied = new Set<string>();
    const cells = [
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 5, y: 6 },
    ];

    expect(isPlacementValid(BOARD_SIZE, occupied, cells)).toBe(true);
  });
});
