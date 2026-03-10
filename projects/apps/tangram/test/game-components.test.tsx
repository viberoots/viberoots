import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { tangramGameReducer } from "../src/game/reducer.ts";
import { selectGameViewModel } from "../src/game/selectors.ts";
import { createInitialGameState } from "../src/game/state.ts";
import { BoardGrid } from "../src/ui/board-grid.tsx";
import { PieceTray } from "../src/ui/piece-tray.tsx";

describe("game components", () => {
  it("renders the expected 10x15 board grid shape", () => {
    const viewModel = selectGameViewModel(createInitialGameState());
    const html = renderToStaticMarkup(
      <BoardGrid board={viewModel.board} onStartDragPlaced={() => {}} />,
    );

    expect(html).toContain("Board");
    expect(html.match(/data-testid=\"tangram-board-row\"/g)?.length ?? 0).toBe(15);
    expect(html.match(/data-testid=\"tangram-board-cell\"/g)?.length ?? 0).toBe(150);
  });

  it("renders every catalog piece in the tray", () => {
    const state = createInitialGameState();
    const viewModel = selectGameViewModel(state);
    const html = renderToStaticMarkup(
      <PieceTray
        tray={viewModel.tray}
        onSelectPiece={() => {}}
        onStartDrag={() => {}}
        onMoveDrag={() => {}}
        onEndDrag={() => {}}
      />,
    );

    expect(html.match(/data-testid=\"tangram-piece-view\"/g)?.length ?? 0).toBe(
      state.pieceCatalog.length,
    );

    expect(html.match(/left</g)?.length ?? 0).toBe(state.pieceCatalog.length);
  });

  it("renders remaining supply counts for tray piece types", () => {
    const state = tangramGameReducer(
      tangramGameReducer(createInitialGameState(), {
        type: "piece/preview",
        pieceId: "purple-2-1",
        position: { x: 0, y: 0 },
      }),
      { type: "piece/commit", pieceId: "purple-2-1" },
    );
    const viewModel = selectGameViewModel(state);
    const html = renderToStaticMarkup(
      <PieceTray
        tray={viewModel.tray}
        onSelectPiece={() => {}}
        onStartDrag={() => {}}
        onMoveDrag={() => {}}
        onEndDrag={() => {}}
      />,
    );

    expect(html).toContain("4 left");
  });
});
