import React from "react";
import { Text, View } from "react-native-web";
import { transformCells } from "../game/geometry";
import { loadPersistedGameStateFromHash, savePersistedGameStateToHash } from "../game/persistence";
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
import { useGameScreenInteractions } from "./use-game-screen-interactions";
import { useGameScreenKeyboard } from "./use-game-screen-keyboard";

export function GameScreen(_props: { url: string }) {
  const [state, dispatch] = React.useReducer(
    pleominoGameReducer,
    undefined,
    createInitialGameHistoryState,
  );
  const presentState = state.present;
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const selectGameView = React.useMemo(() => createGameViewSelector(), []);
  const viewModel = selectGameView(presentState);
  const solve = useGameScreenSolve({ state, dispatch });
  const interactionLocked = solve.isApplyingSolve;
  const boardGridElementRef = React.useRef<HTMLElement | null>(null);
  const persistenceReadyRef = React.useRef(false);
  const responsive = React.useMemo(
    () => computeResponsiveMetrics(viewport.width, viewport.height),
    [viewport.height, viewport.width],
  );
  const isLandscapeBlocked =
    responsive.isStacked && viewport.height > 0 && viewport.width > viewport.height;

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

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const applyViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    applyViewport();
    window.addEventListener("resize", applyViewport);
    return () => window.removeEventListener("resize", applyViewport);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const restored = loadPersistedGameStateFromHash(window.location, createInitialGameState());
      if (restored) {
        interactions.clearPendingTap();
        dispatch({ type: "state/replace", state: restored });
      }
    } catch {}
    persistenceReadyRef.current = true;
    // hydration-safe restore runs once after mount
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!persistenceReadyRef.current) {
      return;
    }
    try {
      savePersistedGameStateToHash(window.history, window.location, presentState);
    } catch {}
  }, [presentState]);

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
      {isLandscapeBlocked ? (
        <View style={styles.orientationLockCard} testID="pleomino-orientation-lock">
          <Text style={styles.orientationLockTitle}>Rotate to Portrait</Text>
          <Text style={styles.orientationLockSubtitle}>
            Landscape mode is disabled on smaller screens.
          </Text>
        </View>
      ) : null}
      {isLandscapeBlocked ? null : (
        <View style={styles.playArea}>
          <View
            style={[styles.toolbarWrap, responsive.isStacked ? styles.toolbarWrapStacked : null]}
          >
            <GameToolbar
              isStacked={responsive.isStacked}
              canUndo={state.past.length > 0}
              canRedo={state.future.length > 0}
              canSolve={true}
              solveState={solve.solveState}
              interestingnessThreshold={solve.interestingnessThreshold}
              onInterestingnessThresholdChange={solve.setInterestingnessThreshold}
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
              onStartDragPlaced={interactions.handleStartDragPlaced}
              snapTargetCellKeys={interactions.snapTargetKeySet}
              onBoardGridElement={(element) => {
                boardGridElementRef.current = element;
              }}
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
      )}

      {interactions.dragVisual && !isLandscapeBlocked ? (
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
