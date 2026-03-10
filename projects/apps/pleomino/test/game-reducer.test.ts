import { describe, expect, it } from "vitest";
import { pleominoGameReducer } from "../src/game/reducer.ts";
import { createInitialGameState } from "../src/game/state.ts";
import type { GameState } from "../src/game/types.ts";

function reduce(
  state: GameState,
  action:
    | { type: "piece/select"; pieceId: string; instanceId?: string | null }
    | { type: "piece/preview"; pieceId: string; position: { x: number; y: number } | null }
    | { type: "piece/commit"; pieceId: string; sourceInstanceId?: string | null }
    | {
        type: "piece/rotate";
        pieceId: string;
        instanceId?: string | null;
        direction?: "cw" | "ccw";
      }
    | { type: "piece/flip"; pieceId: string; instanceId?: string | null }
    | { type: "piece/revert"; pieceId: string }
    | { type: "board/reset" },
): GameState {
  return pleominoGameReducer(state, action);
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

  it("reverts invalid commits to null preview", () => {
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
    expect(invalidCommit.previewByPieceId["purple-2-1"]).toBeNull();
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

  it("clears preview when moving a placed piece to an invalid position", () => {
    const placed = reduce(
      reduce(createInitialGameState(), {
        type: "piece/preview",
        pieceId: "yellow-1-2-1",
        position: { x: 1, y: 1 },
      }),
      { type: "piece/commit", pieceId: "yellow-1-2-1" },
    );
    const yellowInstance = placed.board.placedPieces.find(
      (piece) => piece.pieceId === "yellow-1-2-1",
    );
    if (!yellowInstance) {
      throw new Error("expected placed yellow instance");
    }

    const invalidMovePreview = reduce(placed, {
      type: "piece/preview",
      pieceId: "yellow-1-2-1",
      position: { x: -5, y: -5 },
    });
    const invalidMoveCommit = reduce(invalidMovePreview, {
      type: "piece/commit",
      pieceId: "yellow-1-2-1",
      sourceInstanceId: yellowInstance.instanceId,
    });

    const afterInvalidMove = invalidMoveCommit.board.placedPieces.find(
      (piece) => piece.instanceId === yellowInstance.instanceId,
    );
    expect(afterInvalidMove?.position).toEqual({ x: 1, y: 1 });
    expect(invalidMoveCommit.previewByPieceId["yellow-1-2-1"]).toBeNull();
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
    expect(reset.selectedInstanceId).toBeNull();
    expect(reset.board.placedPieces).toEqual([]);
    expect(reset.previewByPieceId["purple-2-1"]).toBeNull();
    expect(reset.pieceCatalog).toBe(state.pieceCatalog);
  });

  it("consumes supply up to five placements per piece type", () => {
    let state = createInitialGameState();
    for (let index = 0; index < 5; index += 1) {
      state = reduce(
        reduce(state, {
          type: "piece/preview",
          pieceId: "purple-2-1",
          position: { x: index * 2, y: index * 2 },
        }),
        { type: "piece/commit", pieceId: "purple-2-1" },
      );
    }

    const sixthAttempt = reduce(
      reduce(state, {
        type: "piece/preview",
        pieceId: "purple-2-1",
        position: { x: 1, y: 1 },
      }),
      { type: "piece/commit", pieceId: "purple-2-1" },
    );

    const placedCount = sixthAttempt.board.placedPieces.filter(
      (piece) => piece.pieceId === "purple-2-1",
    ).length;
    expect(placedCount).toBe(5);
    expect(sixthAttempt.previewByPieceId["purple-2-1"]).toBeNull();
  });

  it("rotates and flips tray piece transform when no placed instance is selected", () => {
    const state = createInitialGameState();

    const rotated = reduce(state, {
      type: "piece/rotate",
      pieceId: "purple-2-1",
      direction: "cw",
    });
    const flipped = reduce(rotated, {
      type: "piece/flip",
      pieceId: "purple-2-1",
    });

    expect(rotated.transformByPieceId["purple-2-1"]).toEqual({ rotation: 90, flipped: false });
    expect(flipped.transformByPieceId["purple-2-1"]).toEqual({ rotation: 90, flipped: true });
  });

  it("rotates an already placed piece instance in place when valid", () => {
    const placed = reduce(
      reduce(createInitialGameState(), {
        type: "piece/preview",
        pieceId: "black-1-1-1-1",
        position: { x: 0, y: 0 },
      }),
      { type: "piece/commit", pieceId: "black-1-1-1-1" },
    );
    const blackInstance = placed.board.placedPieces.find(
      (piece) => piece.pieceId === "black-1-1-1-1",
    );
    if (!blackInstance) {
      throw new Error("expected placed black instance");
    }

    const rotated = reduce(placed, {
      type: "piece/rotate",
      pieceId: "black-1-1-1-1",
      instanceId: blackInstance.instanceId,
      direction: "cw",
    });

    const nextBlack = rotated.board.placedPieces.find(
      (piece) => piece.instanceId === blackInstance.instanceId,
    );
    expect(nextBlack?.transform).toEqual({ rotation: 90, flipped: false });
  });
});
