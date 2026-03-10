import React from "react";
import { Text, View } from "react-native-web";
import { BOARD_CELL_SIZE } from "../game/board";
import { transformCells } from "../game/geometry";
import { loadPersistedGameStateFromHash, savePersistedGameStateToHash } from "../game/persistence";
import { tangramGameReducer } from "../game/reducer";
import { createGameViewSelector } from "../game/view-selector";
import { createInitialGameState } from "../game/state";
import { BoardGrid } from "./board-grid";
import { pageToViewportPosition } from "./game-screen-interaction-helpers";
import { gameScreenStyles as styles } from "./game-screen-styles";
import { PieceTray } from "./piece-tray";
import { pointerFromPressEvent } from "./piece-view-helpers";
import { useGameScreenInteractions } from "./use-game-screen-interactions";
import { useGameScreenKeyboard } from "./use-game-screen-keyboard";

const PAGE_HORIZONTAL_PADDING = 2;
const PAGE_VERTICAL_PADDING = 2;
const LAYOUT_GAP = 4;
const BOARD_CARD_PADDING = 6;
const BOARD_CARD_BORDER = 1;
const DESKTOP_TRAY_MAX_ROW_UNITS = 7;
const DESKTOP_TRAY_COLUMN_GAP = 18;
const DESKTOP_TRAY_HORIZONTAL_PADDING = 12;
const MIN_CELL_SIZE = 24;
const STACKED_MAX_CELL_SIZE = 56;
const DESKTOP_MAX_CELL_SIZE = 72;
const MOBILE_BREAKPOINT_PX = 900;
const STACKED_TRAY_HEIGHT_CHROME = 58;
const STACKED_TOTAL_CELL_ROWS = 24;
const STACKED_BOTTOM_SAFE_PX = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeResponsiveMetrics(
  viewportWidth: number,
  viewportHeight: number,
): {
  cellSize: number;
  isStacked: boolean;
  cardWidth: number | string;
} {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return {
      cellSize: BOARD_CELL_SIZE,
      isStacked: false,
      cardWidth:
        BOARD_CELL_SIZE * DESKTOP_TRAY_MAX_ROW_UNITS +
        DESKTOP_TRAY_COLUMN_GAP +
        DESKTOP_TRAY_HORIZONTAL_PADDING,
    };
  }

  const isStacked = viewportWidth < MOBILE_BREAKPOINT_PX;
  const boardChrome = BOARD_CARD_PADDING * 2 + BOARD_CARD_BORDER * 2;
  const desktopTrayChrome = DESKTOP_TRAY_COLUMN_GAP + DESKTOP_TRAY_HORIZONTAL_PADDING;
  const maxCellSizeByWidth = isStacked
    ? Math.floor((viewportWidth - PAGE_HORIZONTAL_PADDING * 2 - boardChrome) / 10)
    : Math.floor(
        (viewportWidth -
          PAGE_HORIZONTAL_PADDING * 2 -
          LAYOUT_GAP -
          boardChrome -
          desktopTrayChrome) /
          (10 + DESKTOP_TRAY_MAX_ROW_UNITS),
      );
  const maxCellSizeByHeight = isStacked
    ? Math.floor(
        (viewportHeight -
          PAGE_VERTICAL_PADDING -
          STACKED_BOTTOM_SAFE_PX -
          LAYOUT_GAP -
          STACKED_TRAY_HEIGHT_CHROME) /
          STACKED_TOTAL_CELL_ROWS,
      )
    : Math.floor((viewportHeight - PAGE_VERTICAL_PADDING * 2 - BOARD_CARD_PADDING * 2) / 15);

  const cellSize = clamp(
    Math.min(
      isStacked ? STACKED_MAX_CELL_SIZE : DESKTOP_MAX_CELL_SIZE,
      maxCellSizeByWidth,
      maxCellSizeByHeight,
    ),
    MIN_CELL_SIZE,
    isStacked ? STACKED_MAX_CELL_SIZE : DESKTOP_MAX_CELL_SIZE,
  );
  const boardCardWidth = cellSize * 10 + BOARD_CARD_PADDING * 2 + BOARD_CARD_BORDER * 2;
  const cardWidth = isStacked
    ? viewportWidth - PAGE_HORIZONTAL_PADDING * 2
    : cellSize * DESKTOP_TRAY_MAX_ROW_UNITS + desktopTrayChrome;
  return { cellSize, isStacked, cardWidth };
}

export function GameScreen(_props: { url: string }) {
  const [state, dispatch] = React.useReducer(tangramGameReducer, undefined, createInitialGameState);
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
      testID="tangram-game-screen"
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
        <View style={styles.orientationLockCard} testID="tangram-orientation-lock">
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
          testID="tangram-drag-ghost"
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
