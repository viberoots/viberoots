import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BOARD_CELL_SIZE } from "../src/game/board.ts";
import { pleominoGameReducer } from "../src/game/reducer.ts";
import { selectGameViewModel } from "../src/game/selectors.ts";
import { createInitialGameState } from "../src/game/state.ts";
import { BoardGrid } from "../src/ui/board-grid.tsx";
import { PieceTray } from "../src/ui/piece-tray.tsx";

describe("game components", () => {
  it("renders the expected 10x15 board grid shape", () => {
    const viewModel = selectGameViewModel(createInitialGameState());
    const html = renderToStaticMarkup(
      <BoardGrid board={viewModel.board} cellSize={BOARD_CELL_SIZE} onStartDragPlaced={() => {}} />,
    );

    expect(html.match(/data-testid=\"pleomino-board-row\"/g)?.length ?? 0).toBe(15);
    expect(html.match(/data-testid=\"pleomino-board-cell\"/g)?.length ?? 0).toBe(150);
  });

  it("renders every catalog piece in the tray", () => {
    const state = createInitialGameState();
    const viewModel = selectGameViewModel(state);
    const html = renderToStaticMarkup(
      <PieceTray
        tray={viewModel.tray}
        isStacked={false}
        cellSize={BOARD_CELL_SIZE}
        trayWidth={220}
        onStartDrag={() => {}}
        onEndDrag={() => {}}
      />,
    );

    expect(html.match(/data-testid=\"pleomino-piece-view\"/g)?.length ?? 0).toBe(
      state.pieceCatalog.length,
    );
  });

  it("renders remaining supply counts for tray piece types", () => {
    const state = pleominoGameReducer(
      pleominoGameReducer(createInitialGameState(), {
        type: "piece/preview",
        pieceId: "purple-2-1",
        position: { x: 0, y: 0 },
      }),
      { type: "piece/commit", pieceId: "purple-2-1" },
    );
    const viewModel = selectGameViewModel(state);
    const reducedPiece = viewModel.tray.pieces.find((piece) => piece.pieceId === "purple-2-1");
    const html = renderToStaticMarkup(
      <PieceTray
        tray={viewModel.tray}
        isStacked={false}
        cellSize={BOARD_CELL_SIZE}
        trayWidth={220}
        onStartDrag={() => {}}
        onEndDrag={() => {}}
      />,
    );

    expect(reducedPiece?.remainingCount).toBe(4);
    expect(html.match(/data-testid=\"pleomino-piece-view\"/g)?.length ?? 0).toBe(
      state.pieceCatalog.length,
    );
  });

  it("keeps small-mode tray rows visibility-safe", () => {
    const state = createInitialGameState();
    const viewModel = selectGameViewModel(state);
    const html = renderToStaticMarkup(
      <PieceTray
        tray={viewModel.tray}
        isStacked={true}
        cellSize={24}
        trayWidth={260}
        onStartDrag={() => {}}
        onEndDrag={() => {}}
      />,
    );

    const rowMatches = [...html.matchAll(/data-testid=\"pleomino-piece-tray-row-(\d+)\"/g)];
    expect(rowMatches.length).toBe(2);
    for (const match of rowMatches) {
      expect(Number.parseInt(match[1] ?? "0", 10)).toBe(4);
    }
  });
});
