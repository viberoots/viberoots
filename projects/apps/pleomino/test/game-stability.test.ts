import { describe, expect, it } from "vitest";
import { transformCells, translateCells } from "../src/game/geometry";
import { cellKey, isPlacementValid } from "../src/game/placement";
import { pleominoGameReducer } from "../src/game/reducer";
import { createInitialGameState } from "../src/game/state";

function occupiedKeys(state: ReturnType<typeof createInitialGameState>): Set<string> {
  const byId = new Map(state.pieceCatalog.map((piece) => [piece.pieceId, piece]));
  const occupied = new Set<string>();
  for (const placed of state.board.placedPieces) {
    const def = byId.get(placed.pieceId);
    if (!def) {
      continue;
    }
    const boardCells = translateCells(
      transformCells(def.baseCells, placed.transform),
      placed.position,
    );
    for (const cell of boardCells) {
      occupied.add(cellKey(cell));
    }
  }
  return occupied;
}

describe("game stability", () => {
  it("keeps board state valid across repeated drag+transform cycles", () => {
    let state = createInitialGameState();

    for (let index = 0; index < 40; index += 1) {
      state = pleominoGameReducer(state, { type: "piece/select", pieceId: "black-1-1-1-1" });
      state = pleominoGameReducer(state, {
        type: "piece/preview",
        pieceId: "black-1-1-1-1",
        position: { x: index % 10, y: (index * 3) % 15 },
      });
      state = pleominoGameReducer(state, { type: "piece/commit", pieceId: "black-1-1-1-1" });
      state = pleominoGameReducer(state, {
        type: "piece/rotate",
        pieceId: "black-1-1-1-1",
        direction: index % 2 === 0 ? "cw" : "ccw",
      });
      state = pleominoGameReducer(state, {
        type: "piece/flip",
        pieceId: "black-1-1-1-1",
      });
    }

    const occupied = occupiedKeys(state);
    expect(state.board.placedPieces.length).toBeGreaterThan(0);

    for (const placed of state.board.placedPieces) {
      const peerOccupied = new Set<string>();
      for (const other of state.board.placedPieces) {
        if (other.instanceId === placed.instanceId) {
          continue;
        }
        const def = state.pieceCatalog.find((piece) => piece.pieceId === other.pieceId);
        if (!def) {
          continue;
        }
        const cells = translateCells(
          transformCells(def.baseCells, other.transform),
          other.position,
        );
        for (const cell of cells) {
          peerOccupied.add(cellKey(cell));
        }
      }

      const def = state.pieceCatalog.find((piece) => piece.pieceId === placed.pieceId);
      if (!def) {
        throw new Error("missing piece definition");
      }
      const cells = translateCells(
        transformCells(def.baseCells, placed.transform),
        placed.position,
      );
      expect(isPlacementValid(state.board.size, peerOccupied, cells)).toBe(true);
    }

    expect(occupied.size).toBeGreaterThan(0);
  });
});
