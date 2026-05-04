import { describe, expect, it } from "vitest";
import { buildSolverPreparedInput } from "../src/game/solver/candidate-generation";
import type { SolverRequest } from "../src/game/solver/solver-types";

const DOMINO_PIECE = {
  pieceId: "domino",
  color: "#000000",
  baseCells: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
};

function requestWithLockedCellOverlapFilter(): SolverRequest {
  return {
    boardSize: { columns: 3, rows: 2 },
    pieceCatalog: [DOMINO_PIECE],
    lockedPlacements: [
      {
        instanceId: "domino#0",
        pieceId: "domino",
        transform: { rotation: 0, flipped: false },
        position: { x: 0, y: 0 },
        isPlaced: true,
      },
    ],
    remainingInventory: { domino: 1 },
    maxNodeExpansions: 200,
    maxWallClockMs: 100,
  };
}

describe("solver candidate generation", () => {
  it("enumerates deterministic in-bounds placements across unique orientations", () => {
    const prepared = buildSolverPreparedInput({
      boardSize: { columns: 3, rows: 2 },
      pieceCatalog: [DOMINO_PIECE],
      lockedPlacements: [],
      remainingInventory: { domino: 1 },
      maxNodeExpansions: 200,
      maxWallClockMs: 100,
    });

    expect(prepared.candidates.length).toBe(7);
    expect(prepared.candidates[0]?.position).toEqual({ x: 0, y: 0 });
    expect(prepared.candidates[0]?.transform).toEqual({ rotation: 0, flipped: false });
    expect(prepared.candidates[0]?.candidateIndex).toBe(0);
    expect(prepared.candidates.at(-1)?.candidateIndex).toBe(prepared.candidates.length - 1);
  });

  it("excludes candidates that overlap locked placements", () => {
    const prepared = buildSolverPreparedInput(requestWithLockedCellOverlapFilter());
    expect(prepared.candidates.length).toBe(3);
    const keys = prepared.candidates.map(
      (candidate) => `${candidate.position.x},${candidate.position.y}`,
    );
    expect(keys).toEqual(["2,0", "0,1", "1,1"]);
  });
});
