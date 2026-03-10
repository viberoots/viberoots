import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { tangramGameReducer } from "../src/game/reducer.ts";
import { selectGameViewModel } from "../src/game/selectors.ts";
import { createInitialGameState } from "../src/game/state.ts";
import { BoardGrid } from "../src/ui/board-grid.tsx";

describe("board preview", () => {
  it("renders preview cells during drag/preview state", () => {
    const previewed = tangramGameReducer(createInitialGameState(), {
      type: "piece/preview",
      pieceId: "purple-2-1",
      position: { x: 0, y: 0 },
    });
    const viewModel = selectGameViewModel(previewed);
    const html = renderToStaticMarkup(
      <BoardGrid board={viewModel.board} onStartDragPlaced={() => {}} />,
    );

    expect(html.match(/data-testid="tangram-board-cell-preview"/g)?.length ?? 0).toBeGreaterThan(0);
  });
});
