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
    const html = renderToStaticMarkup(<BoardGrid board={viewModel.board} />);

    expect(html).toContain("Board");
    expect(html.match(/data-testid=\"tangram-board-row\"/g)?.length ?? 0).toBe(15);
    expect(html.match(/data-testid=\"tangram-board-cell\"/g)?.length ?? 0).toBe(150);
  });

  it("renders every catalog piece in the tray", () => {
    const state = createInitialGameState();
    const viewModel = selectGameViewModel(state);
    const html = renderToStaticMarkup(<PieceTray tray={viewModel.tray} onSelectPiece={() => {}} />);

    expect(html.match(/data-testid=\"tangram-piece-view\"/g)?.length ?? 0).toBe(
      state.pieceCatalog.length,
    );

    for (const piece of state.pieceCatalog) {
      expect(html).toContain(piece.pieceId);
    }
  });

  it("renders selected-piece highlighting text in the tray", () => {
    const selectedState = tangramGameReducer(createInitialGameState(), {
      type: "piece/select",
      pieceId: "tan-large-a",
    });
    const viewModel = selectGameViewModel(selectedState);
    const html = renderToStaticMarkup(<PieceTray tray={viewModel.tray} onSelectPiece={() => {}} />);

    expect(html).toMatch(/data-testid=\"tangram-piece-status-tan-large-a\"[^>]*>Selected</);
  });
});
