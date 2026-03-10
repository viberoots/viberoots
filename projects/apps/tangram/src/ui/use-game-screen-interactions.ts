import React from "react";
import { BOARD_CELL_SIZE } from "../game/board";
import { beginDragSession, previewCellFromDrag } from "../game/interaction";
import type { PixelPoint } from "../game/interaction";
import { cellKey } from "../game/placement";
import { DEFAULT_PIECE_TRANSFORM } from "../game/piece-transform";
import type { GameAction } from "../game/reducer";
import type { GameState, PieceDefinition, PlacedPiece } from "../game/types";
import { bindGlobalDragListeners } from "./drag-window-events";
import {
  areSameKeyList,
  boardRectFromElement,
  computeSnapTargetKeys,
  computeTrayReturnTargetPieceId,
  DOUBLE_TAP_WINDOW_MS,
  DRAG_START_THRESHOLD_PX,
  pointerDistanceSquared,
  Pointer,
  pointerIsInsideBoard,
  rotationDirectionForMouseButton,
  tapTargetKey,
  TAP_AFTER_DRAG_SUPPRESSION_MS,
  type ActiveDragSession,
  type DragVisualState,
} from "./game-screen-interaction-helpers";

type PendingTap = {
  targetKey: string;
  timeoutId: ReturnType<typeof setTimeout>;
};

export function useGameScreenInteractions(args: {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  pieceById: Map<string, PieceDefinition>;
  placedByInstanceId: Map<string, PlacedPiece>;
  boardGridElementRef: React.MutableRefObject<HTMLElement | null>;
}) {
  const dragSessionRef = React.useRef<ActiveDragSession | null>(null);
  const pendingTapRef = React.useRef<PendingTap | null>(null);
  const tapSuppressedUntilRef = React.useRef(0);
  const [dragVisual, setDragVisual] = React.useState<DragVisualState | null>(null);
  const [snapTargetCellKeys, setSnapTargetCellKeys] = React.useState<string[]>([]);

  const trayReturnTargetPieceId = React.useMemo(
    () =>
      computeTrayReturnTargetPieceId(
        dragSessionRef.current,
        dragVisual,
        args.boardGridElementRef.current,
      ),
    [args.boardGridElementRef, dragVisual],
  );

  const snapTargetKeySet = React.useMemo(
    () => new Set<string>(snapTargetCellKeys),
    [snapTargetCellKeys],
  );

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

  const handleTapGesture = React.useCallback(
    (pieceId: string, instanceId: string | null, mouseButton: number | null) => {
      if (dragSessionRef.current || Date.now() < tapSuppressedUntilRef.current) {
        return;
      }
      const key = tapTargetKey(pieceId, instanceId);
      const pendingTap = pendingTapRef.current;
      if (pendingTap && pendingTap.targetKey === key) {
        clearTimeout(pendingTap.timeoutId);
        pendingTapRef.current = null;
        args.dispatch({ type: "piece/flip", pieceId, instanceId });
        return;
      }
      clearPendingTap();
      pendingTapRef.current = {
        targetKey: key,
        timeoutId: setTimeout(() => {
          args.dispatch({
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
    [args.dispatch, clearPendingTap],
  );

  const handleStartDrag = React.useCallback(
    (
      pieceId: string,
      pointer: Pointer,
      grabbedOffsetPx: PixelPoint | null,
      mouseButton?: number,
    ) => {
      const transform = args.state.transformByPieceId[pieceId] ?? DEFAULT_PIECE_TRANSFORM;
      args.dispatch({ type: "piece/select", pieceId, instanceId: null });
      const session = beginDragSession({ pieceId, grabbedOffsetPx });
      dragSessionRef.current = {
        ...session,
        sourceInstanceId: null,
        transform,
        startPointer: pointer,
        mouseButton: mouseButton ?? null,
        hasMoved: false,
      };
    },
    [args.dispatch, args.state.transformByPieceId],
  );

  const handleStartDragPlaced = React.useCallback(
    (
      pieceId: string,
      instanceId: string,
      grabbedOffsetPx: PixelPoint,
      pointer: Pointer,
      mouseButton?: number,
    ) => {
      const sourceInstance = args.placedByInstanceId.get(instanceId);
      const transform =
        sourceInstance?.transform ??
        args.state.transformByPieceId[pieceId] ??
        DEFAULT_PIECE_TRANSFORM;
      args.dispatch({ type: "piece/select", pieceId, instanceId });
      const session = beginDragSession({ pieceId, grabbedOffsetPx });
      dragSessionRef.current = {
        ...session,
        sourceInstanceId: instanceId,
        transform,
        startPointer: pointer,
        mouseButton: mouseButton ?? null,
        hasMoved: false,
      };
    },
    [args.dispatch, args.placedByInstanceId, args.state.transformByPieceId],
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
      const boardRect = boardRectFromElement(args.boardGridElementRef.current);
      setDragVisual({ pieceId: session.pieceId, pointer });
      setSnapTargetKeysIfChanged(
        computeSnapTargetKeys({
          boardSize: args.state.board.size,
          boardRect,
          pointer,
          pieceById: args.pieceById,
          session,
          cellKey,
        }),
      );
    },
    [
      args.boardGridElementRef,
      args.pieceById,
      args.state.board.size,
      clearPendingTap,
      setSnapTargetKeysIfChanged,
    ],
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

      const boardRect = boardRectFromElement(args.boardGridElementRef.current);
      const dropOutside = !pointerIsInsideBoard(pointer ?? null, boardRect);
      if (!dropOutside && pointer && boardRect) {
        args.dispatch({
          type: "piece/preview",
          pieceId: session.pieceId,
          position: previewCellFromDrag(session, pointer, boardRect, BOARD_CELL_SIZE),
        });
      }
      args.dispatch({
        type: "piece/commit",
        pieceId: session.pieceId,
        sourceInstanceId: session.sourceInstanceId,
        dropOutside,
      });
      tapSuppressedUntilRef.current = Date.now() + TAP_AFTER_DRAG_SUPPRESSION_MS;
      setDragVisual(null);
      setSnapTargetKeysIfChanged([]);
    },
    [args.boardGridElementRef, args.dispatch, handleTapGesture, setSnapTargetKeysIfChanged],
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

  React.useEffect(() => () => clearPendingTap(), [clearPendingTap]);

  return {
    clearPendingTap,
    dragSessionRef,
    dragVisual,
    handleEndDrag,
    handleStartDrag,
    handleStartDragPlaced,
    snapTargetKeySet,
    trayReturnTargetPieceId,
  };
}
