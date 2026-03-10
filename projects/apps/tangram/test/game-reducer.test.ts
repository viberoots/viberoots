import { describe, expect, it } from "vitest";
import { tangramGameReducer } from "../src/game/reducer.ts";
import { createInitialGameState } from "../src/game/state.ts";
import type { GameState } from "../src/game/types.ts";

function reduce(
  state: GameState,
  action:
    | { type: "piece/select"; pieceId: string }
    | { type: "piece/preview"; pieceId: string; position: { x: number; y: number } | null }
    | { type: "piece/commit"; pieceId: string }
    | { type: "piece/revert"; pieceId: string }
    | { type: "board/reset" },
): GameState {
  return tangramGameReducer(state, action);
}

function getPlacedPosition(state: GameState, pieceId: string): { x: number; y: number } | null {
  return state.board.placedPieces.find((piece) => piece.pieceId === pieceId)?.position ?? null;
}

describe("game reducer", () => {
  it("selects known pieces and ignores unknown piece ids", () => {
    const state = createInitialGameState();

    const selected = reduce(state, { type: "piece/select", pieceId: "purple-2-1" });
    const unchanged = reduce(selected, { type: "piece/select", pieceId: "missing-piece" });

    expect(selected.selectedPieceId).toBe("purple-2-1");
    expect(unchanged.selectedPieceId).toBe("purple-2-1");
  });

  it("commits a valid preview position into board placement state", () => {
    const state = createInitialGameState();

    const previewed = reduce(state, {
      type: "piece/preview",
      pieceId: "purple-2-1",
      position: { x: 0, y: 0 },
    });
    const committed = reduce(previewed, { type: "piece/commit", pieceId: "purple-2-1" });

    expect(getPlacedPosition(committed, "purple-2-1")).toEqual({ x: 0, y: 0 });
    expect(committed.previewByPieceId["purple-2-1"]).toBeNull();
  });

  it("reverts invalid commits to last valid position for an already placed piece", () => {
    const state = createInitialGameState();
    const committed = reduce(
      reduce(state, {
        type: "piece/preview",
        pieceId: "purple-2-1",
        position: { x: 0, y: 0 },
      }),
      { type: "piece/commit", pieceId: "purple-2-1" },
    );

    const invalidPreview = reduce(committed, {
      type: "piece/preview",
      pieceId: "purple-2-1",
      position: { x: -10, y: 0 },
    });
    const invalidCommit = reduce(invalidPreview, { type: "piece/commit", pieceId: "purple-2-1" });

    expect(getPlacedPosition(invalidCommit, "purple-2-1")).toEqual({ x: 0, y: 0 });
    expect(invalidCommit.previewByPieceId["purple-2-1"]).toEqual({ x: 0, y: 0 });
  });

  it("reverts invalid overlap commits to null preview for unplaced pieces", () => {
    const state = createInitialGameState();
    const withFirstPiece = reduce(
      reduce(state, {
        type: "piece/preview",
        pieceId: "purple-2-1",
        position: { x: 0, y: 0 },
      }),
      { type: "piece/commit", pieceId: "purple-2-1" },
    );

    const overlapPreview = reduce(withFirstPiece, {
      type: "piece/preview",
      pieceId: "red-2-2",
      position: { x: 0, y: 0 },
    });
    const overlapCommit = reduce(overlapPreview, { type: "piece/commit", pieceId: "red-2-2" });

    expect(getPlacedPosition(overlapCommit, "red-2-2")).toBeNull();
    expect(overlapCommit.previewByPieceId["red-2-2"]).toBeNull();
  });

  it("resets board, selection, and previews deterministically", () => {
    const state = createInitialGameState();
    const populated = reduce(
      reduce(
        reduce(state, {
          type: "piece/select",
          pieceId: "purple-2-1",
        }),
        {
          type: "piece/preview",
          pieceId: "purple-2-1",
          position: { x: 0, y: 0 },
        },
      ),
      { type: "piece/commit", pieceId: "purple-2-1" },
    );

    const reset = reduce(populated, { type: "board/reset" });

    expect(reset.selectedPieceId).toBeNull();
    expect(reset.board.placedPieces).toEqual([]);
    expect(reset.previewByPieceId["purple-2-1"]).toBeNull();
    expect(reset.pieceCatalog).toBe(state.pieceCatalog);
  });
});
