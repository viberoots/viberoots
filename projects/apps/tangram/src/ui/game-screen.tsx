import React from "react";
import { StyleSheet, Text, View } from "react-native-web";
import { BOARD_CELL_SIZE } from "../game/board";
import { beginDragSession, previewCellFromDrag } from "../game/interaction";
import type { PixelPoint } from "../game/interaction";
import { transformCells, translateCells } from "../game/geometry";
import { cellKey } from "../game/placement";
import { DEFAULT_PIECE_TRANSFORM } from "../game/piece-transform";
import { tangramGameReducer } from "../game/reducer";
import type { PieceTransform, PlacedPiece } from "../game/types";
import { selectGameViewModel } from "../game/selectors";
import { createInitialGameState } from "../game/state";
import { BoardGrid } from "./board-grid";
import { bindGlobalDragListeners } from "./drag-window-events";
import { PieceTray } from "./piece-tray";
import { Toolbar } from "./toolbar";

type Pointer = { pageX: number; pageY: number };

type ActiveDragSession = ReturnType<typeof beginDragSession> & {
  sourceInstanceId: string | null;
  transform: PieceTransform;
  startPointer: Pointer;
  mouseButton: number | null;
  hasMoved: boolean;
};

type DragVisualState = {
  pieceId: string;
  pointer: Pointer;
};

type PendingTap = {
  targetKey: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

const DRAG_START_THRESHOLD_PX = 8;
const DOUBLE_TAP_WINDOW_MS = 220;
const TAP_AFTER_DRAG_SUPPRESSION_MS = 120;

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
  pointer: Pointer | null | undefined,
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

function pointerDistanceSquared(left: Pointer, right: Pointer): number {
  const deltaX = left.pageX - right.pageX;
  const deltaY = left.pageY - right.pageY;
  return deltaX * deltaX + deltaY * deltaY;
}

function pageToViewportPosition(pointer: Pointer): { x: number; y: number } {
  return {
    x: pointer.pageX - window.scrollX,
    y: pointer.pageY - window.scrollY,
  };
}

function tapTargetKey(pieceId: string, instanceId: string | null): string {
  return `${pieceId}::${instanceId ?? "tray"}`;
}

function rotationDirectionForMouseButton(mouseButton: number | null): "cw" | "ccw" {
  return mouseButton === 2 ? "ccw" : "cw";
}

export function GameScreen(props: { url: string }) {
  const [state, dispatch] = React.useReducer(tangramGameReducer, undefined, createInitialGameState);
  const viewModel = React.useMemo(() => selectGameViewModel(state), [state]);
  const boardGridElementRef = React.useRef<HTMLElement | null>(null);
  const dragSessionRef = React.useRef<ActiveDragSession | null>(null);
  const pendingTapRef = React.useRef<PendingTap | null>(null);
  const tapSuppressedUntilRef = React.useRef(0);
  const [dragVisual, setDragVisual] = React.useState<DragVisualState | null>(null);
  const [snapTargetCellKeys, setSnapTargetCellKeys] = React.useState<string[]>([]);

  const pieceById = React.useMemo(
    () => new Map(state.pieceCatalog.map((piece) => [piece.pieceId, piece])),
    [state.pieceCatalog],
  );
  const placedByInstanceId = React.useMemo(
    () => new Map(state.board.placedPieces.map((piece) => [piece.instanceId, piece])),
    [state.board.placedPieces],
  );
  const snapTargetKeySet = React.useMemo(
    () => new Set<string>(snapTargetCellKeys),
    [snapTargetCellKeys],
  );

  const trayReturnTargetPieceId = React.useMemo(() => {
    const session = dragSessionRef.current;
    if (!session || !session.sourceInstanceId || !dragVisual || !session.hasMoved) {
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

  const clearPendingTap = React.useCallback(() => {
    const pendingTap = pendingTapRef.current;
    if (!pendingTap) {
      return;
    }
    clearTimeout(pendingTap.timeoutId);
    pendingTapRef.current = null;
  }, []);

  const computeSnapTargetKeys = React.useCallback(
    (
      session: ActiveDragSession,
      pointer: Pointer,
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
        transformCells(definition.baseCells, session.transform),
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
    dispatch({
      type: "piece/commit",
      pieceId: viewModel.toolbar.selectedPieceId,
      sourceInstanceId: viewModel.toolbar.selectedInstanceId,
    });
  }, [viewModel.toolbar.selectedInstanceId, viewModel.toolbar.selectedPieceId]);

  const handleRevertSelected = React.useCallback(() => {
    if (!viewModel.toolbar.selectedPieceId) {
      return;
    }
    dispatch({ type: "piece/revert", pieceId: viewModel.toolbar.selectedPieceId });
  }, [viewModel.toolbar.selectedPieceId]);

  const handleRotateSelectedClockwise = React.useCallback(() => {
    if (!viewModel.toolbar.selectedPieceId || dragSessionRef.current) {
      return;
    }
    dispatch({
      type: "piece/rotate",
      pieceId: viewModel.toolbar.selectedPieceId,
      instanceId: viewModel.toolbar.selectedInstanceId,
      direction: "cw",
    });
  }, [viewModel.toolbar.selectedInstanceId, viewModel.toolbar.selectedPieceId]);

  const handleRotateSelectedCounterClockwise = React.useCallback(() => {
    if (!viewModel.toolbar.selectedPieceId || dragSessionRef.current) {
      return;
    }
    dispatch({
      type: "piece/rotate",
      pieceId: viewModel.toolbar.selectedPieceId,
      instanceId: viewModel.toolbar.selectedInstanceId,
      direction: "ccw",
    });
  }, [viewModel.toolbar.selectedInstanceId, viewModel.toolbar.selectedPieceId]);

  const handleFlipSelected = React.useCallback(() => {
    if (!viewModel.toolbar.selectedPieceId || dragSessionRef.current) {
      return;
    }
    dispatch({
      type: "piece/flip",
      pieceId: viewModel.toolbar.selectedPieceId,
      instanceId: viewModel.toolbar.selectedInstanceId,
    });
  }, [viewModel.toolbar.selectedInstanceId, viewModel.toolbar.selectedPieceId]);

  const handleResetBoard = React.useCallback(() => {
    clearPendingTap();
    dispatch({ type: "board/reset" });
  }, [clearPendingTap]);

  const handleTapGesture = React.useCallback(
    (pieceId: string, instanceId: string | null, mouseButton: number | null) => {
      if (dragSessionRef.current) {
        return;
      }
      if (Date.now() < tapSuppressedUntilRef.current) {
        return;
      }
      const key = tapTargetKey(pieceId, instanceId);
      const pendingTap = pendingTapRef.current;
      if (pendingTap && pendingTap.targetKey === key) {
        clearTimeout(pendingTap.timeoutId);
        pendingTapRef.current = null;
        dispatch({ type: "piece/flip", pieceId, instanceId });
        return;
      }
      clearPendingTap();
      pendingTapRef.current = {
        targetKey: key,
        timeoutId: setTimeout(() => {
          dispatch({
            type: "piece/rotate",
            pieceId,
            instanceId,
            direction: rotationDirectionForMouseButton(mouseButton),
          });
          if (pendingTapRef.current?.targetKey === key) {
            pendingTapRef.current = null;
          }
        }, DOUBLE_TAP_WINDOW_MS),
      };
    },
    [clearPendingTap],
  );

  const handleStartDrag = React.useCallback(
    (
      pieceId: string,
      pointer: Pointer,
      grabbedOffsetPx: PixelPoint | null,
      mouseButton?: number,
    ) => {
      const transform = state.transformByPieceId[pieceId] ?? DEFAULT_PIECE_TRANSFORM;
      dispatch({ type: "piece/select", pieceId, instanceId: null });
      const session = beginDragSession({
        pieceId,
        grabbedOffsetPx,
      });
      dragSessionRef.current = {
        ...session,
        sourceInstanceId: null,
        transform,
        startPointer: pointer,
        mouseButton: mouseButton ?? null,
        hasMoved: false,
      };
    },
    [state.transformByPieceId],
  );

  const handleStartDragPlaced = React.useCallback(
    (
      pieceId: string,
      instanceId: string,
      grabbedOffsetPx: PixelPoint,
      pointer: Pointer,
      mouseButton?: number,
    ) => {
      const sourceInstance = placedByInstanceId.get(instanceId);
      const transform =
        sourceInstance?.transform ?? state.transformByPieceId[pieceId] ?? DEFAULT_PIECE_TRANSFORM;
      dispatch({ type: "piece/select", pieceId, instanceId });
      const session = beginDragSession({
        pieceId,
        grabbedOffsetPx,
      });
      dragSessionRef.current = {
        ...session,
        sourceInstanceId: instanceId,
        transform,
        startPointer: pointer,
        mouseButton: mouseButton ?? null,
        hasMoved: false,
      };
    },
    [placedByInstanceId, state.transformByPieceId],
  );

  const handleMoveDrag = React.useCallback(
    (pointer: Pointer) => {
      const session = dragSessionRef.current;
      if (!session) {
        return;
      }
      if (!session.hasMoved) {
        const minimumDistanceSquared = DRAG_START_THRESHOLD_PX * DRAG_START_THRESHOLD_PX;
        if (pointerDistanceSquared(pointer, session.startPointer) < minimumDistanceSquared) {
          return;
        }
        session.hasMoved = true;
        clearPendingTap();
      }
      const boardRect = boardRectFromElement(boardGridElementRef.current);
      setDragVisual({ pieceId: session.pieceId, pointer });
      setSnapTargetKeysIfChanged(computeSnapTargetKeys(session, pointer, boardRect));
    },
    [clearPendingTap, computeSnapTargetKeys, setSnapTargetKeysIfChanged],
  );

  const handleEndDrag = React.useCallback(
    (pointer?: Pointer | null) => {
      const session = dragSessionRef.current;
      if (!session) {
        return;
      }
      dragSessionRef.current = null;

      if (!session.hasMoved) {
        setDragVisual(null);
        setSnapTargetKeysIfChanged([]);
        if (pointer) {
          handleTapGesture(session.pieceId, session.sourceInstanceId, session.mouseButton);
        }
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
      tapSuppressedUntilRef.current = Date.now() + TAP_AFTER_DRAG_SUPPRESSION_MS;
      setDragVisual(null);
      setSnapTargetKeysIfChanged([]);
    },
    [handleTapGesture, setSnapTargetKeysIfChanged],
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

  React.useEffect(() => {
    return () => clearPendingTap();
  }, [clearPendingTap]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleKeyboard(event: KeyboardEvent) {
      if (dragSessionRef.current) {
        return;
      }
      const selectedPieceId = viewModel.toolbar.selectedPieceId;
      if (!selectedPieceId) {
        return;
      }
      const selectedInstanceId = viewModel.toolbar.selectedInstanceId;
      const selectedInstance: PlacedPiece | undefined = selectedInstanceId
        ? placedByInstanceId.get(selectedInstanceId)
        : undefined;

      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        dispatch({
          type: "piece/rotate",
          pieceId: selectedPieceId,
          instanceId: selectedInstanceId,
          direction: "cw",
        });
        return;
      }
      if (event.key === "q" || event.key === "Q") {
        event.preventDefault();
        dispatch({
          type: "piece/rotate",
          pieceId: selectedPieceId,
          instanceId: selectedInstanceId,
          direction: "ccw",
        });
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        dispatch({ type: "piece/flip", pieceId: selectedPieceId, instanceId: selectedInstanceId });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        dispatch({
          type: "piece/commit",
          pieceId: selectedPieceId,
          sourceInstanceId: selectedInstanceId,
        });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "piece/revert", pieceId: selectedPieceId });
        return;
      }

      const deltaByArrow: Record<string, { x: number; y: number } | undefined> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const delta = deltaByArrow[event.key];
      if (!delta) {
        return;
      }
      event.preventDefault();

      const basePreview = state.previewByPieceId[selectedPieceId] ?? null;
      const basePosition = basePreview ?? selectedInstance?.position ?? { x: 0, y: 0 };
      const nextPosition = {
        x: basePosition.x + delta.x,
        y: basePosition.y + delta.y,
      };
      dispatch({ type: "piece/preview", pieceId: selectedPieceId, position: nextPosition });
      if (selectedInstanceId) {
        dispatch({
          type: "piece/commit",
          pieceId: selectedPieceId,
          sourceInstanceId: selectedInstanceId,
        });
      }
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.removeEventListener("keydown", handleKeyboard);
    };
  }, [
    placedByInstanceId,
    state.previewByPieceId,
    viewModel.toolbar.selectedInstanceId,
    viewModel.toolbar.selectedPieceId,
  ]);

  return (
    <View style={styles.page} testID="tangram-game-screen">
      <Text style={styles.title}>Tangram Sandbox</Text>
      <Text style={styles.subtitle}>SSR route: {props.url}</Text>

      <Toolbar
        toolbar={viewModel.toolbar}
        onPreviewSelected={handlePreviewSelected}
        onCommitSelected={handleCommitSelected}
        onRevertSelected={handleRevertSelected}
        onRotateSelectedClockwise={handleRotateSelectedClockwise}
        onRotateSelectedCounterClockwise={handleRotateSelectedCounterClockwise}
        onFlipSelected={handleFlipSelected}
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
          onStartDrag={handleStartDrag}
          onEndDrag={handleEndDrag}
        />
      </View>

      <View style={styles.statusCard} testID="tangram-status-card">
        <Text style={styles.statusText}>Catalog pieces: {viewModel.status.catalogPieceCount}</Text>
        <Text style={styles.statusText}>Placed pieces: {viewModel.status.placedPieceCount}</Text>
        <Text
          style={[styles.statusText, viewModel.status.isSolved ? styles.solvedText : null]}
          testID="tangram-solved-status"
        >
          {viewModel.status.isSolved ? "Solved: yes" : "Solved: no"}
        </Text>
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
            const cells = transformCells(piece.baseCells, session.transform);
            const viewportPointer = pageToViewportPosition(dragVisual.pointer);
            return cells.map((cell) => (
              <View
                key={`${dragVisual.pieceId}-ghost-${cell.x},${cell.y}`}
                style={[
                  styles.dragCell,
                  {
                    left: viewportPointer.x - session.grabbedOffsetPx.x + cell.x * BOARD_CELL_SIZE,
                    top: viewportPointer.y - session.grabbedOffsetPx.y + cell.y * BOARD_CELL_SIZE,
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
  solvedText: {
    color: "#166534",
    fontWeight: "700",
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
