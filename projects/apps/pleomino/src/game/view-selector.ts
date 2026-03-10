import { computeWinState } from "./win";
import type { GameState } from "./types";
import {
  selectBoardView,
  selectGameViewModel,
  selectPieceTrayView,
  selectToolbarView,
  type GameViewModel,
  type GameViewSelector,
} from "./selectors";

export function createGameViewSelector(): GameViewSelector {
  let previousBoardInput: {
    board: GameState["board"];
    previewByPieceId: GameState["previewByPieceId"];
    transformByPieceId: GameState["transformByPieceId"];
    pieceCatalog: GameState["pieceCatalog"];
  } | null = null;
  let previousTrayInput: {
    selectedPieceId: GameState["selectedPieceId"];
    selectedInstanceId: GameState["selectedInstanceId"];
    boardPlacedPieces: GameState["board"]["placedPieces"];
    transformByPieceId: GameState["transformByPieceId"];
    pieceCatalog: GameState["pieceCatalog"];
  } | null = null;
  let previousToolbarInput: {
    selectedPieceId: GameState["selectedPieceId"];
    selectedInstanceId: GameState["selectedInstanceId"];
    previewByPieceId: GameState["previewByPieceId"];
    boardPlacedPieces: GameState["board"]["placedPieces"];
    transformByPieceId: GameState["transformByPieceId"];
  } | null = null;
  let previousStatusInput: {
    board: GameState["board"];
    pieceCatalog: GameState["pieceCatalog"];
  } | null = null;
  let previousViewModel: GameViewModel | null = null;

  return (state: GameState) => {
    const boardChanged =
      !previousBoardInput ||
      previousBoardInput.board !== state.board ||
      previousBoardInput.previewByPieceId !== state.previewByPieceId ||
      previousBoardInput.transformByPieceId !== state.transformByPieceId ||
      previousBoardInput.pieceCatalog !== state.pieceCatalog;
    const trayChanged =
      !previousTrayInput ||
      previousTrayInput.selectedPieceId !== state.selectedPieceId ||
      previousTrayInput.selectedInstanceId !== state.selectedInstanceId ||
      previousTrayInput.boardPlacedPieces !== state.board.placedPieces ||
      previousTrayInput.transformByPieceId !== state.transformByPieceId ||
      previousTrayInput.pieceCatalog !== state.pieceCatalog;
    const toolbarChanged =
      !previousToolbarInput ||
      previousToolbarInput.selectedPieceId !== state.selectedPieceId ||
      previousToolbarInput.selectedInstanceId !== state.selectedInstanceId ||
      previousToolbarInput.previewByPieceId !== state.previewByPieceId ||
      previousToolbarInput.boardPlacedPieces !== state.board.placedPieces ||
      previousToolbarInput.transformByPieceId !== state.transformByPieceId;
    const statusChanged =
      !previousStatusInput ||
      previousStatusInput.board !== state.board ||
      previousStatusInput.pieceCatalog !== state.pieceCatalog;

    if (!previousViewModel) {
      previousViewModel = selectGameViewModel(state);
    } else if (boardChanged || trayChanged || toolbarChanged || statusChanged) {
      previousViewModel = {
        board: boardChanged ? selectBoardView(state) : previousViewModel.board,
        tray: trayChanged ? selectPieceTrayView(state) : previousViewModel.tray,
        toolbar: toolbarChanged ? selectToolbarView(state) : previousViewModel.toolbar,
        status: statusChanged
          ? {
              catalogPieceCount: state.pieceCatalog.length,
              placedPieceCount: state.board.placedPieces.length,
              isSolved: computeWinState(state),
            }
          : previousViewModel.status,
      };
    }

    previousBoardInput = {
      board: state.board,
      previewByPieceId: state.previewByPieceId,
      transformByPieceId: state.transformByPieceId,
      pieceCatalog: state.pieceCatalog,
    };
    previousTrayInput = {
      selectedPieceId: state.selectedPieceId,
      selectedInstanceId: state.selectedInstanceId,
      boardPlacedPieces: state.board.placedPieces,
      transformByPieceId: state.transformByPieceId,
      pieceCatalog: state.pieceCatalog,
    };
    previousToolbarInput = {
      selectedPieceId: state.selectedPieceId,
      selectedInstanceId: state.selectedInstanceId,
      previewByPieceId: state.previewByPieceId,
      boardPlacedPieces: state.board.placedPieces,
      transformByPieceId: state.transformByPieceId,
    };
    previousStatusInput = {
      board: state.board,
      pieceCatalog: state.pieceCatalog,
    };
    return previousViewModel;
  };
}
