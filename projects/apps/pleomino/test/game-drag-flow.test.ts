import { describe, expect, it } from "vitest";
import { BOARD_CELL_SIZE } from "../src/game/board";
import { beginDragSession, previewCellFromDrag } from "../src/game/interaction";
import { pleominoGameReducer } from "../src/game/reducer";
import { createInitialGameState } from "../src/game/state";
import type { GameAction } from "../src/game/reducer";
import type { GameState } from "../src/game/types";

const BOARD_RECT = {
  left: 100,
  top: 200,
  width: BOARD_CELL_SIZE * 10,
  height: BOARD_CELL_SIZE * 15,
};

function reduce(state: GameState, action: GameAction): GameState {
  return pleominoGameReducer(state, action);
}

function runDrag(
  state: GameState,
  pieceId: string,
  grabbedOffsetPx: { x: number; y: number } | null,
): {
  move: (pointer: { pageX: number; pageY: number }) => GameState;
} {
  const session = beginDragSession({
    pieceId,
    grabbedOffsetPx,
  });

  const selected = reduce(state, { type: "piece/select", pieceId });

  return {
    move(pointer) {
      const preview = previewCellFromDrag(session, pointer, BOARD_RECT, BOARD_CELL_SIZE);
      const previewed = reduce(selected, {
        type: "piece/preview",
        pieceId,
        position: preview,
      });
      return reduce(previewed, { type: "piece/commit", pieceId });
    },
  };
}

function placedPosition(state: GameState, pieceId: string): { x: number; y: number } | null {
  return state.board.placedPieces.find((piece) => piece.pieceId === pieceId)?.position ?? null;
}

describe("drag flow integration", () => {
  it("places a piece using drag preview and snap-to-grid commit", () => {
    const state = createInitialGameState();
    const afterDrag = runDrag(state, "purple-2-1", { x: 0, y: 0 }).move({
      pageX: 100 + BOARD_CELL_SIZE * 3 + 10,
      pageY: 200 + BOARD_CELL_SIZE * 4 + 10,
    });

    expect(placedPosition(afterDrag, "purple-2-1")).toEqual({ x: 3, y: 4 });
    expect(afterDrag.previewByPieceId["purple-2-1"]).toBeNull();
  });

  it("rejects overlap via drag commit and rolls back unplaced preview to null", () => {
    const state = createInitialGameState();
    const placedPurple = runDrag(state, "purple-2-1", { x: 0, y: 0 }).move({
      pageX: 108,
      pageY: 208,
    });

    const overlap = runDrag(placedPurple, "red-2-2", { x: 0, y: 0 }).move({
      pageX: 112,
      pageY: 212,
    });

    expect(placedPosition(overlap, "red-2-2")).toBeNull();
    expect(overlap.previewByPieceId["red-2-2"]).toBeNull();
  });

  it("rejects out-of-bounds drag and clears preview", () => {
    const state = createInitialGameState();
    const placed = runDrag(state, "purple-2-1", { x: 0, y: 0 }).move({
      pageX: 100 + BOARD_CELL_SIZE * 2 + 8,
      pageY: 200 + BOARD_CELL_SIZE * 2 + 8,
    });

    const invalid = runDrag(placed, "purple-2-1", { x: 0, y: 0 }).move({
      pageX: 100 - BOARD_CELL_SIZE + 8,
      pageY: 200 + 8,
    });

    expect(placedPosition(invalid, "purple-2-1")).toEqual({ x: 2, y: 2 });
    expect(invalid.previewByPieceId["purple-2-1"]).toBeNull();
  });

  it("allows placing multiple instances from the same tray piece type up to supply", () => {
    let state = createInitialGameState();
    const dropCells = [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 4, y: 4 },
      { x: 6, y: 6 },
      { x: 8, y: 8 },
    ];
    for (let index = 0; index < 5; index += 1) {
      const dropCell = dropCells[index];
      state = runDrag(state, "purple-2-1", { x: 0, y: 0 }).move({
        pageX: 100 + BOARD_CELL_SIZE * dropCell.x + 8,
        pageY: 200 + BOARD_CELL_SIZE * dropCell.y + 8,
      });
    }

    const sixthAttempt = runDrag(state, "purple-2-1", { x: 0, y: 0 }).move({
      pageX: 100 + BOARD_CELL_SIZE * 1 + 8,
      pageY: 200 + BOARD_CELL_SIZE * 1 + 8,
    });

    const placedCount = sixthAttempt.board.placedPieces.filter(
      (piece) => piece.pieceId === "purple-2-1",
    ).length;
    expect(placedCount).toBe(5);
  });
});
