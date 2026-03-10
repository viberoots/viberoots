import React from "react";
import { StyleSheet, Text, View } from "react-native-web";
import { BOARD_CELL_SIZE } from "../game/board";
import { beginDragSession, previewCellFromDrag } from "../game/interaction";
import type { PixelPoint } from "../game/interaction";
import { DEFAULT_PIECE_TRANSFORM } from "../game/reducer";
import { tangramGameReducer } from "../game/reducer";
import { cellKey } from "../game/placement";
import { selectGameViewModel } from "../game/selectors";
import { createInitialGameState } from "../game/state";
import { transformCells, translateCells } from "../game/geometry";
import { BoardGrid } from "./board-grid";
import { bindGlobalDragListeners } from "./drag-window-events";
import { PieceTray } from "./piece-tray";
import { Toolbar } from "./toolbar";

type ActiveDragSession = ReturnType<typeof beginDragSession> & {
  sourceInstanceId: string | null;
};

type DragVisualState = {
  pieceId: string;
  pointer: { pageX: number; pageY: number };
};

function areSameKeyList(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false;
    }
  }
  return true;
}

function boardRectFromElement(element: HTMLElement | null): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return {
    left: rect.left + window.scrollX,
    top: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

function pointerIsInsideBoard(
  pointer: { pageX: number; pageY: number } | null | undefined,
  boardRect: { left: number; top: number; width: number; height: number } | null,
): boolean {
  if (!pointer || !boardRect) {
    return false;
  }
  return (
    pointer.pageX >= boardRect.left &&
    pointer.pageX < boardRect.left + boardRect.width &&
    pointer.pageY >= boardRect.top &&
    pointer.pageY < boardRect.top + boardRect.height
  );
}

export function GameScreen(props: { url: string }) {
  const [state, dispatch] = React.useReducer(tangramGameReducer, undefined, createInitialGameState);
  const viewModel = React.useMemo(() => selectGameViewModel(state), [state]);
  const boardGridElementRef = React.useRef<HTMLElement | null>(null);
  const dragSessionRef = React.useRef<ActiveDragSession | null>(null);
  const [dragVisual, setDragVisual] = React.useState<DragVisualState | null>(null);
  const [snapTargetCellKeys, setSnapTargetCellKeys] = React.useState<string[]>([]);

  const pieceById = React.useMemo(
    () => new Map(state.pieceCatalog.map((piece) => [piece.pieceId, piece])),
    [state.pieceCatalog],
  );
  const snapTargetKeySet = React.useMemo(
    () => new Set<string>(snapTargetCellKeys),
    [snapTargetCellKeys],
  );
  const trayReturnTargetPieceId = React.useMemo(() => {
    const session = dragSessionRef.current;
    if (!session || !session.sourceInstanceId || !dragVisual) {
      return null;
    }
    const boardRect = boardRectFromElement(boardGridElementRef.current);
    if (pointerIsInsideBoard(dragVisual.pointer, boardRect)) {
      return null;
    }
    return session.pieceId;
  }, [dragVisual]);

  const setSnapTargetKeysIfChanged = React.useCallback((nextKeys: string[]) => {
    setSnapTargetCellKeys((previous) => (areSameKeyList(previous, nextKeys) ? previous : nextKeys));
  }, []);

  const computeSnapTargetKeys = React.useCallback(
    (
      session: ActiveDragSession,
      pointer: { pageX: number; pageY: number },
      boardRect: { left: number; top: number; width: number; height: number } | null,
    ): string[] => {
      if (!boardRect || !pointerIsInsideBoard(pointer, boardRect)) {
        return [];
      }
      const definition = pieceById.get(session.pieceId);
      if (!definition) {
        return [];
      }
      const snappedPosition = previewCellFromDrag(session, pointer, boardRect, BOARD_CELL_SIZE);
      const footprint = translateCells(
        transformCells(definition.baseCells, DEFAULT_PIECE_TRANSFORM),
        snappedPosition,
      );
      const keys: string[] = [];
      for (const cell of footprint) {
        if (
          cell.x < 0 ||
          cell.y < 0 ||
          cell.x >= state.board.size.columns ||
          cell.y >= state.board.size.rows
        ) {
          continue;
        }
        keys.push(cellKey(cell));
      }
      return keys;
    },
    [pieceById, state.board.size.columns, state.board.size.rows],
  );

  const handleSelectPiece = React.useCallback((pieceId: string) => {
    dispatch({ type: "piece/select", pieceId });
  }, []);

  const handlePreviewSelected = React.useCallback(() => {
    if (!viewModel.toolbar.selectedPieceId) {
      return;
    }
    dispatch({
      type: "piece/preview",
      pieceId: viewModel.toolbar.selectedPieceId,
      position: { x: 0, y: 0 },
    });
  }, [viewModel.toolbar.selectedPieceId]);

  const handleCommitSelected = React.useCallback(() => {
    if (!viewModel.toolbar.selectedPieceId) {
      return;
    }
    dispatch({ type: "piece/commit", pieceId: viewModel.toolbar.selectedPieceId });
  }, [viewModel.toolbar.selectedPieceId]);

  const handleRevertSelected = React.useCallback(() => {
    if (!viewModel.toolbar.selectedPieceId) {
      return;
    }
    dispatch({ type: "piece/revert", pieceId: viewModel.toolbar.selectedPieceId });
  }, [viewModel.toolbar.selectedPieceId]);

  const handleResetBoard = React.useCallback(() => {
    dispatch({ type: "board/reset" });
  }, []);

  const handleStartDrag = React.useCallback(
    (
      pieceId: string,
      pointer: { pageX: number; pageY: number },
      grabbedOffsetPx: PixelPoint | null,
    ) => {
      const boardRect = boardRectFromElement(boardGridElementRef.current);
      if (!boardRect) {
        return;
      }

      dispatch({ type: "piece/select", pieceId });
      const session = beginDragSession({
        pieceId,
        grabbedOffsetPx,
      });
      dragSessionRef.current = { ...session, sourceInstanceId: null };
      setDragVisual({ pieceId, pointer });
      setSnapTargetKeysIfChanged(
        computeSnapTargetKeys({ ...session, sourceInstanceId: null }, pointer, boardRect),
      );
    },
    [computeSnapTargetKeys, setSnapTargetKeysIfChanged],
  );

  const handleStartDragPlaced = React.useCallback(
    (
      pieceId: string,
      instanceId: string,
      grabbedOffsetPx: PixelPoint,
      pointer: { pageX: number; pageY: number },
    ) => {
      const boardRect = boardRectFromElement(boardGridElementRef.current);
      if (!boardRect) {
        return;
      }
      dispatch({ type: "piece/select", pieceId });
      const session = beginDragSession({
        pieceId,
        grabbedOffsetPx,
      });
      dragSessionRef.current = { ...session, sourceInstanceId: instanceId };
      setDragVisual({ pieceId, pointer });
      setSnapTargetKeysIfChanged(
        computeSnapTargetKeys({ ...session, sourceInstanceId: instanceId }, pointer, boardRect),
      );
    },
    [computeSnapTargetKeys, setSnapTargetKeysIfChanged],
  );

  const handleMoveDrag = React.useCallback(
    (pointer: { pageX: number; pageY: number }) => {
      const session = dragSessionRef.current;
      if (!session) {
        return;
      }
      const boardRect = boardRectFromElement(boardGridElementRef.current);
      setDragVisual({ pieceId: session.pieceId, pointer });
      setSnapTargetKeysIfChanged(computeSnapTargetKeys(session, pointer, boardRect));
    },
    [computeSnapTargetKeys, setSnapTargetKeysIfChanged],
  );

  const handleEndDrag = React.useCallback(
    (pointer?: { pageX: number; pageY: number } | null) => {
      const session = dragSessionRef.current;
      if (!session) {
        return;
      }

      const boardRect = boardRectFromElement(boardGridElementRef.current);
      const dropOutside = !pointerIsInsideBoard(pointer ?? null, boardRect);
      if (!dropOutside && pointer && boardRect) {
        dispatch({
          type: "piece/preview",
          pieceId: session.pieceId,
          position: previewCellFromDrag(session, pointer, boardRect, BOARD_CELL_SIZE),
        });
      }
      dispatch({
        type: "piece/commit",
        pieceId: session.pieceId,
        sourceInstanceId: session.sourceInstanceId,
        dropOutside,
      });
      dragSessionRef.current = null;
      setDragVisual(null);
      setSnapTargetKeysIfChanged([]);
    },
    [setSnapTargetKeysIfChanged],
  );

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    return bindGlobalDragListeners({
      isDragging: () => dragSessionRef.current !== null,
      onMove: handleMoveDrag,
      onEnd: handleEndDrag,
    });
  }, [handleEndDrag, handleMoveDrag]);

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Tangram Sandbox</Text>
      <Text style={styles.subtitle}>SSR route: {props.url}</Text>

      <Toolbar
        toolbar={viewModel.toolbar}
        onPreviewSelected={handlePreviewSelected}
        onCommitSelected={handleCommitSelected}
        onRevertSelected={handleRevertSelected}
        onResetBoard={handleResetBoard}
      />

      <View style={styles.layout}>
        <BoardGrid
          board={viewModel.board}
          onStartDragPlaced={handleStartDragPlaced}
          snapTargetCellKeys={snapTargetKeySet}
          onBoardGridElement={(element) => {
            boardGridElementRef.current = element;
          }}
        />
        <PieceTray
          tray={viewModel.tray}
          returnTargetPieceId={trayReturnTargetPieceId}
          onSelectPiece={handleSelectPiece}
          onStartDrag={handleStartDrag}
          onMoveDrag={handleMoveDrag}
          onEndDrag={handleEndDrag}
        />
      </View>

      <View style={styles.statusCard} testID="tangram-status-card">
        <Text style={styles.statusText}>Catalog pieces: {viewModel.status.catalogPieceCount}</Text>
        <Text style={styles.statusText}>Placed pieces: {viewModel.status.placedPieceCount}</Text>
      </View>

      {dragVisual ? (
        <View
          style={styles.dragOverlay}
          testID="tangram-drag-ghost"
          data-piece-id={dragVisual.pieceId}
        >
          {(() => {
            const session = dragSessionRef.current;
            const piece = pieceById.get(dragVisual.pieceId);
            if (!session || !piece) {
              return null;
            }
            const cells = transformCells(piece.baseCells, DEFAULT_PIECE_TRANSFORM);
            return cells.map((cell) => (
              <View
                key={`${dragVisual.pieceId}-ghost-${cell.x},${cell.y}`}
                style={[
                  styles.dragCell,
                  {
                    left:
                      dragVisual.pointer.pageX -
                      session.grabbedOffsetPx.x +
                      cell.x * BOARD_CELL_SIZE,
                    top:
                      dragVisual.pointer.pageY -
                      session.grabbedOffsetPx.y +
                      cell.y * BOARD_CELL_SIZE,
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

const styles = StyleSheet.create({
  page: {
    minHeight: "100vh",
    backgroundColor: "#f8fafc",
    padding: 20,
    gap: 12,
  },
  title: {
    color: "#0f172a",
    fontSize: 30,
    fontWeight: "700",
  },
  subtitle: {
    color: "#334155",
    fontSize: 14,
  },
  layout: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "flex-start",
  },
  statusCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#94a3b8",
    backgroundColor: "#ffffff",
    gap: 4,
  },
  statusText: {
    color: "#334155",
    fontSize: 13,
  },
  dragOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    pointerEvents: "none",
  },
  dragCell: {
    position: "absolute",
    width: BOARD_CELL_SIZE,
    height: BOARD_CELL_SIZE,
    opacity: 0.8,
  },
});
