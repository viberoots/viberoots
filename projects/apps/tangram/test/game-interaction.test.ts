import { describe, expect, it } from "vitest";
import { BOARD_CELL_SIZE } from "../src/game/board.ts";
import { beginDragSession, previewCellFromDrag } from "../src/game/interaction.ts";

const BOARD_RECT = {
  left: 100,
  top: 200,
  width: 320,
  height: 480,
};

describe("game interaction", () => {
  it("uses zero grabbed offset when drag starts without an anchor", () => {
    const session = beginDragSession({
      pieceId: "purple-2-1",
      grabbedOffsetPx: null,
    });

    expect(session.grabbedOffsetPx).toEqual({ x: 0, y: 0 });
  });

  it("preserves explicit grabbed offsets from pointer interaction", () => {
    const session = beginDragSession({
      pieceId: "purple-2-1",
      grabbedOffsetPx: { x: 3, y: 6 },
    });

    expect(session.grabbedOffsetPx).toEqual({ x: 3, y: 6 });
  });

  it("snaps preview coordinates to board cells deterministically", () => {
    const session = beginDragSession({
      pieceId: "purple-2-1",
      grabbedOffsetPx: {
        x: BOARD_CELL_SIZE + 5,
        y: BOARD_CELL_SIZE * 2 + 9,
      },
    });

    const preview = previewCellFromDrag(
      session,
      {
        pageX: 100 + BOARD_CELL_SIZE * 2 + 17,
        pageY: 200 + BOARD_CELL_SIZE * 5 + 29,
      },
      BOARD_RECT,
      BOARD_CELL_SIZE,
    );

    expect(preview).toEqual({ x: 1, y: 3 });
  });
});
