import React from "react";
import { Text, View } from "react-native-web";
import { transformCells } from "../game/geometry";
import { loadPersistedGameStateFromHash } from "../game/persistence";
import { pleominoGameReducer } from "../game/reducer";
import { createGameViewSelector } from "../game/view-selector";
import { createInitialGameHistoryState, createInitialGameState } from "../game/state";
import { BoardGrid } from "./board-grid";
import { GameToolbar } from "./game-toolbar";
import { pageToViewportPosition } from "./game-screen-interaction-helpers";
import { gameScreenStyles as styles } from "./game-screen-styles";
import { useGameScreenSolve } from "./game-screen-solve";
import { PieceTray } from "./piece-tray";
import { pointerFromPressEvent } from "./piece-view-helpers";
import { computeResponsiveMetrics } from "./game-screen-responsive";
import {
  useGameScreenPersistence,
  useGameScreenReveal,
  useGameScreenViewport,
} from "./use-game-screen-bootstrap";
import { useGameScreenInteractions } from "./use-game-screen-interactions";
import { useGameScreenKeyboard } from "./use-game-screen-keyboard";

export function GameScreen(_props: { url: string }) {
  const createInitialHistoryState = React.useCallback(() => {
    const initialState = createInitialGameState();
    if (typeof window === "undefined") {
      return createInitialGameHistoryState();
    }
    try {
      const restored = loadPersistedGameStateFromHash(window.location, initialState);
      if (restored) {
        return {
          past: [],
          present: restored,
          future: [],
        };
      }
    } catch {
      // Fall through to the default empty board state.
    }
    return createInitialGameHistoryState();
  }, []);
  const [state, dispatch] = React.useReducer(
    pleominoGameReducer,
    undefined,
    createInitialHistoryState,
  );
  const presentState = state.present;
  const viewport = useGameScreenViewport();
  const selectGameView = React.useMemo(() => createGameViewSelector(), []);
  const viewModel = selectGameView(presentState);
  const solve = useGameScreenSolve({ state, dispatch });
  const interactionLocked = solve.isApplyingSolve;
  const boardGridElementRef = React.useRef<HTMLElement | null>(null);
  const responsive = React.useMemo(
    () => computeResponsiveMetrics(viewport.width, viewport.height),
    [viewport.height, viewport.width],
  );

  const pieceById = React.useMemo(
    () => new Map(presentState.pieceCatalog.map((piece) => [piece.pieceId, piece])),
    [presentState.pieceCatalog],
  );
  const placedByInstanceId = React.useMemo(
    () => new Map(presentState.board.placedPieces.map((piece) => [piece.instanceId, piece])),
    [presentState.board.placedPieces],
  );

  const interactions = useGameScreenInteractions({
    state: presentState,
    cellSize: responsive.cellSize,
    dispatch,
    interactionLocked,
    pieceById,
    placedByInstanceId,
    boardGridElementRef,
  });

  useGameScreenKeyboard({
    dispatch,
    dragSessionRef: interactions.dragSessionRef,
    interactionLocked,
    placedByInstanceId,
    selectedPieceId: viewModel.toolbar.selectedPieceId,
    selectedInstanceId: viewModel.toolbar.selectedInstanceId,
    previewByPieceId: presentState.previewByPieceId,
  });

  const handleResetBoard = React.useCallback(() => {
    interactions.clearPendingTap();
    dispatch({ type: "board/reset" });
  }, [interactions]);
  const handleUndo = React.useCallback(() => {
    dispatch({ type: "history/undo" });
  }, []);
  const handleRedo = React.useCallback(() => {
    dispatch({ type: "history/redo" });
  }, []);
  const handleSolve = React.useCallback(() => {
    interactions.clearPendingTap();
    void solve.handleSolve();
  }, [interactions, solve]);
  const handleBoardGridElement = React.useCallback((element: HTMLElement | null) => {
    boardGridElementRef.current = element;
  }, []);

  const persistenceReady = useGameScreenPersistence(presentState);
  useGameScreenReveal({ persistenceReady, viewport });

  return (
    <View
      style={styles.page}
      onMouseUp={(event) => interactions.handleEndDrag(pointerFromPressEvent(event), "global")}
      onTouchEnd={(event) => interactions.handleEndDrag(pointerFromPressEvent(event), "global")}
      testID="pleomino-game-screen"
      data-placed-piece-count={String(viewModel.status.placedPieceCount)}
      data-selected-piece-id={viewModel.toolbar.selectedPieceId ?? "none"}
      data-selected-rotation={
        viewModel.toolbar.selectedRotation === null
          ? "none"
          : String(viewModel.toolbar.selectedRotation)
      }
      data-selected-flipped={
        viewModel.toolbar.selectedFlipped === null
          ? "none"
          : viewModel.toolbar.selectedFlipped
            ? "yes"
            : "no"
      }
      data-solve-state={solve.solveState}
    >
      <Text style={styles.visuallyHidden} testID="pleomino-solve-state" accessibilityRole="status">
        {solve.solveState}
      </Text>
      <View style={styles.playArea}>
        <View style={[styles.toolbarWrap, responsive.isStacked ? styles.toolbarWrapStacked : null]}>
          <GameToolbar
            isStacked={responsive.isStacked}
            canUndo={state.past.length > 0}
            canRedo={state.future.length > 0}
            canSolve={true}
            solveState={solve.solveState}
            onReset={handleResetBoard}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onSolve={handleSolve}
          />
        </View>
        <View style={[styles.layout, responsive.isStacked ? styles.layoutStacked : null]}>
          <BoardGrid
            board={viewModel.board}
            cellSize={responsive.cellSize}
            shakeToken={interactions.boardShakeToken}
            failureFeedbackToken={solve.solveFailureToken}
            showSolveOverlay={solve.solveState === "solving"}
            onStartDragPlaced={interactions.handleStartDragPlaced}
            snapTargetCellKeys={interactions.snapTargetKeySet}
            onBoardGridElement={handleBoardGridElement}
          />
          <PieceTray
            tray={viewModel.tray}
            isStacked={responsive.isStacked}
            cellSize={responsive.cellSize}
            trayWidth={responsive.cardWidth}
            returnTargetPieceId={interactions.trayReturnTargetPieceId}
            onStartDrag={interactions.handleStartDrag}
            onEndDrag={interactions.handleEndDrag}
          />
        </View>
      </View>

      {interactions.dragVisual ? (
        <View
          style={styles.dragOverlay}
          testID="pleomino-drag-ghost"
          data-piece-id={interactions.dragVisual.pieceId}
        >
          {(() => {
            const session = interactions.dragSessionRef.current;
            const piece = pieceById.get(interactions.dragVisual.pieceId);
            if (!session || !piece) {
              return null;
            }
            const cells = transformCells(piece.baseCells, session.transform);
            const viewportPointer = pageToViewportPosition(interactions.dragVisual.pointer);
            return cells.map((cell) => (
              <View
                key={`${interactions.dragVisual.pieceId}-ghost-${cell.x},${cell.y}`}
                style={[
                  styles.dragCell,
                  {
                    left:
                      viewportPointer.x - session.grabbedOffsetPx.x + cell.x * responsive.cellSize,
                    top:
                      viewportPointer.y - session.grabbedOffsetPx.y + cell.y * responsive.cellSize,
                    width: responsive.cellSize,
                    height: responsive.cellSize,
                    backgroundColor: piece.color,
                  },
                ]}
              />
            ));
          })()}
        </View>
      ) : null}
    </View>
  );
}
