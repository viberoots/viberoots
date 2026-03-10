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

    const selected = reduce(state, { type: "piece/select", pieceId: "tan-large-a" });
    const unchanged = reduce(selected, { type: "piece/select", pieceId: "missing-piece" });

    expect(selected.selectedPieceId).toBe("tan-large-a");
    expect(unchanged.selectedPieceId).toBe("tan-large-a");
  });

  it("commits a valid preview position into board placement state", () => {
    const state = createInitialGameState();

    const previewed = reduce(state, {
      type: "piece/preview",
      pieceId: "tan-large-a",
      position: { x: 0, y: 0 },
    });
    const committed = reduce(previewed, { type: "piece/commit", pieceId: "tan-large-a" });

    expect(getPlacedPosition(committed, "tan-large-a")).toEqual({ x: 0, y: 0 });
    expect(committed.previewByPieceId["tan-large-a"]).toBeNull();
  });

  it("reverts invalid commits to last valid position for an already placed piece", () => {
    const state = createInitialGameState();
    const committed = reduce(
      reduce(state, {
        type: "piece/preview",
        pieceId: "tan-large-a",
        position: { x: 0, y: 0 },
      }),
      { type: "piece/commit", pieceId: "tan-large-a" },
    );

    const invalidPreview = reduce(committed, {
      type: "piece/preview",
      pieceId: "tan-large-a",
      position: { x: -10, y: 0 },
    });
    const invalidCommit = reduce(invalidPreview, { type: "piece/commit", pieceId: "tan-large-a" });

    expect(getPlacedPosition(invalidCommit, "tan-large-a")).toEqual({ x: 0, y: 0 });
    expect(invalidCommit.previewByPieceId["tan-large-a"]).toEqual({ x: 0, y: 0 });
  });

  it("reverts invalid overlap commits to null preview for unplaced pieces", () => {
    const state = createInitialGameState();
    const withFirstPiece = reduce(
      reduce(state, {
        type: "piece/preview",
        pieceId: "tan-large-a",
        position: { x: 0, y: 0 },
      }),
      { type: "piece/commit", pieceId: "tan-large-a" },
    );

    const overlapPreview = reduce(withFirstPiece, {
      type: "piece/preview",
      pieceId: "tan-large-b",
      position: { x: 0, y: 0 },
    });
    const overlapCommit = reduce(overlapPreview, { type: "piece/commit", pieceId: "tan-large-b" });

    expect(getPlacedPosition(overlapCommit, "tan-large-b")).toBeNull();
    expect(overlapCommit.previewByPieceId["tan-large-b"]).toBeNull();
  });

  it("resets board, selection, and previews deterministically", () => {
    const state = createInitialGameState();
    const populated = reduce(
      reduce(
        reduce(state, {
          type: "piece/select",
          pieceId: "tan-large-a",
        }),
        {
          type: "piece/preview",
          pieceId: "tan-large-a",
          position: { x: 0, y: 0 },
        },
      ),
      { type: "piece/commit", pieceId: "tan-large-a" },
    );

    const reset = reduce(populated, { type: "board/reset" });

    expect(reset.selectedPieceId).toBeNull();
    expect(reset.board.placedPieces).toEqual([]);
    expect(reset.previewByPieceId["tan-large-a"]).toBeNull();
    expect(reset.pieceCatalog).toBe(state.pieceCatalog);
  });
});
