import React from "react";
import { Text, View } from "react-native-web";
import { transformCells } from "../game/geometry";
import { loadPersistedGameStateFromHash, savePersistedGameStateToHash } from "../game/persistence";
import { pleominoGameReducer } from "../game/reducer";
import { createGameViewSelector } from "../game/view-selector";
import { createInitialGameState } from "../game/state";
import { BoardGrid } from "./board-grid";
import { pageToViewportPosition } from "./game-screen-interaction-helpers";
import { gameScreenStyles as styles } from "./game-screen-styles";
import { PieceTray } from "./piece-tray";
import { pointerFromPressEvent } from "./piece-view-helpers";
import { computeResponsiveMetrics } from "./game-screen-responsive";
import { useGameScreenInteractions } from "./use-game-screen-interactions";
import { useGameScreenKeyboard } from "./use-game-screen-keyboard";

export function GameScreen(_props: { url: string }) {
  const [state, dispatch] = React.useReducer(
    pleominoGameReducer,
    undefined,
    createInitialGameState,
  );
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const selectGameView = React.useMemo(() => createGameViewSelector(), []);
  const viewModel = selectGameView(state);
  const boardGridElementRef = React.useRef<HTMLElement | null>(null);
  const persistenceReadyRef = React.useRef(false);
  const responsive = React.useMemo(
    () => computeResponsiveMetrics(viewport.width, viewport.height),
    [viewport.height, viewport.width],
  );
  const isLandscapeBlocked =
    responsive.isStacked && viewport.height > 0 && viewport.width > viewport.height;

  const pieceById = React.useMemo(
    () => new Map(state.pieceCatalog.map((piece) => [piece.pieceId, piece])),
    [state.pieceCatalog],
  );
  const placedByInstanceId = React.useMemo(
    () => new Map(state.board.placedPieces.map((piece) => [piece.instanceId, piece])),
    [state.board.placedPieces],
  );

  const interactions = useGameScreenInteractions({
    state,
    cellSize: responsive.cellSize,
    dispatch,
    pieceById,
    placedByInstanceId,
    boardGridElementRef,
  });

  useGameScreenKeyboard({
    dispatch,
    dragSessionRef: interactions.dragSessionRef,
    placedByInstanceId,
    selectedPieceId: viewModel.toolbar.selectedPieceId,
    selectedInstanceId: viewModel.toolbar.selectedInstanceId,
    previewByPieceId: state.previewByPieceId,
  });

  const handleResetBoard = React.useCallback(() => {
    interactions.clearPendingTap();
    dispatch({ type: "board/reset" });
  }, [interactions]);

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
      const restored = loadPersistedGameStateFromHash(window.location, state);
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
      savePersistedGameStateToHash(window.history, window.location, state);
    } catch {}
  }, [state]);

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
            onResetBoard={handleResetBoard}
            returnTargetPieceId={interactions.trayReturnTargetPieceId}
            onStartDrag={interactions.handleStartDrag}
            onEndDrag={interactions.handleEndDrag}
          />
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
