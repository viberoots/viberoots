import { describe, expect, it } from "vitest";
import type { GameAction } from "../src/game/reducer.ts";
import { pleominoGameReducer } from "../src/game/reducer.ts";
import { createInitialGameHistoryState } from "../src/game/state.ts";
import type { GameHistoryState, GameState } from "../src/game/types.ts";

function reduce(state: GameHistoryState, action: GameAction): GameHistoryState {
  return pleominoGameReducer(state, action);
}

function current(state: GameHistoryState): GameState {
  return state.present;
}

function placePurpleAt(
  state: GameHistoryState,
  position: { x: number; y: number },
): GameHistoryState {
  const previewed = reduce(state, {
    type: "piece/preview",
    pieceId: "purple-2-1",
    position,
  });
  return reduce(previewed, { type: "piece/commit", pieceId: "purple-2-1" });
}

describe("game history reducer", () => {
  it("undo restores the previous committed state exactly", () => {
    const initial = createInitialGameHistoryState();
    const afterFirstCommit = placePurpleAt(initial, { x: 0, y: 0 });
    const afterSecondCommit = placePurpleAt(afterFirstCommit, { x: 2, y: 0 });

    const undone = reduce(afterSecondCommit, { type: "history/undo" });

    expect(current(undone)).toEqual(current(afterFirstCommit));
    expect(undone.future.length).toBe(1);
  });

  it("redo restores the most recently undone committed state", () => {
    const initial = createInitialGameHistoryState();
    const committed = placePurpleAt(initial, { x: 0, y: 0 });
    const rotated = reduce(committed, {
      type: "piece/rotate",
      pieceId: "purple-2-1",
      direction: "cw",
    });
    const undone = reduce(rotated, { type: "history/undo" });

    const redone = reduce(undone, { type: "history/redo" });

    expect(current(redone)).toEqual(current(rotated));
  });

  it("new committed action clears future history", () => {
    const initial = createInitialGameHistoryState();
    const committed = placePurpleAt(initial, { x: 0, y: 0 });
    const rotated = reduce(committed, {
      type: "piece/rotate",
      pieceId: "purple-2-1",
      direction: "cw",
    });
    const undone = reduce(rotated, { type: "history/undo" });

    const recommitted = reduce(undone, {
      type: "piece/flip",
      pieceId: "purple-2-1",
    });

    expect(recommitted.future).toEqual([]);
    expect(recommitted.past.length).toBeGreaterThan(0);
  });

  it("preview-only actions do not add history entries", () => {
    const initial = createInitialGameHistoryState();

    const previewed = reduce(initial, {
      type: "piece/preview",
      pieceId: "purple-2-1",
      position: { x: 4, y: 4 },
    });

    expect(previewed.past).toEqual([]);
    expect(previewed.future).toEqual([]);
  });

  it("solve apply is atomic and undo/redo restore exact snapshots", () => {
    const initial = createInitialGameHistoryState();
    const previewed = reduce(initial, {
      type: "piece/preview",
      pieceId: "purple-2-1",
      position: { x: 1, y: 1 },
    });
    const solved = reduce(previewed, {
      type: "solve/apply",
      placements: [
        {
          pieceId: "purple-2-1",
          transform: { rotation: 0, flipped: false },
          position: { x: 0, y: 0 },
        },
        {
          pieceId: "red-2-2",
          transform: { rotation: 90, flipped: false },
          position: { x: 4, y: 0 },
        },
      ],
    });
    expect(current(solved).previewByPieceId["purple-2-1"]).toBeNull();
    expect(solved.past.length).toBe(1);

    const undone = reduce(solved, { type: "history/undo" });
    expect(current(undone)).toEqual(current(initial));

    const redone = reduce(undone, { type: "history/redo" });
    expect(current(redone)).toEqual(current(solved));
  });

  it("caps past history length to keep reducer snapshots bounded", () => {
    let state = createInitialGameHistoryState();
    for (let index = 0; index < 240; index += 1) {
      state = reduce(state, {
        type: "piece/rotate",
        pieceId: "purple-2-1",
        direction: "cw",
      });
    }
    expect(state.past.length).toBe(200);
  });
});
