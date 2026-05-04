import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BOARD_CELL_SIZE } from "../src/game/board";
import { pleominoGameReducer } from "../src/game/reducer";
import { selectGameViewModel } from "../src/game/selectors";
import { createInitialGameState } from "../src/game/state";
import { BoardGrid } from "../src/ui/board-grid";

describe("board preview", () => {
  it("renders preview cells during drag/preview state", () => {
    const previewed = pleominoGameReducer(createInitialGameState(), {
      type: "piece/preview",
      pieceId: "purple-2-1",
      position: { x: 0, y: 0 },
    });
    const viewModel = selectGameViewModel(previewed);
    const html = renderToStaticMarkup(
      <BoardGrid board={viewModel.board} cellSize={BOARD_CELL_SIZE} onStartDragPlaced={() => {}} />,
    );

    expect(html.match(/data-testid="pleomino-board-cell-preview"/g)?.length ?? 0).toBeGreaterThan(
      0,
    );
  });
});
