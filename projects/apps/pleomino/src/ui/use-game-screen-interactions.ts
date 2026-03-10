import React from "react";
import { previewCellFromDrag } from "../game/interaction";
import type { GameAction } from "../game/reducer";
import type { GameState, PieceDefinition, PlacedPiece } from "../game/types";
import { bindGlobalDragListeners } from "./drag-window-events";
import { previewDragTarget } from "./game-screen-drag-preview";
import {
  areSameKeyList,
  boardRectFromElement,
  collectOccupiedCellsForDrag,
  computeTrayReturnTargetPieceId,
  DRAG_START_THRESHOLD_PX,
  pointerDistanceSquared,
  Pointer,
  pointerIsInsideBoard,
  resolveNearestPlacement,
  type ActiveDragSession,
  type DragVisualState,
} from "./game-screen-interaction-helpers";
import { useDragStartHandlers } from "./use-drag-start-handlers";
import { usePieceTapGesture } from "./use-piece-tap-gesture";

export function useGameScreenInteractions(args: {
  state: GameState;
  cellSize: number;
  dispatch: React.Dispatch<GameAction>;
  pieceById: Map<string, PieceDefinition>;
  placedByInstanceId: Map<string, PlacedPiece>;
  boardGridElementRef: React.MutableRefObject<HTMLElement | null>;
}) {
  const dragSessionRef = React.useRef<ActiveDragSession | null>(null);
  const [dragVisual, setDragVisual] = React.useState<DragVisualState | null>(null);
  const [snapTargetCellKeys, setSnapTargetCellKeys] = React.useState<string[]>([]);
  const [boardShakeToken, setBoardShakeToken] = React.useState(0);
  const moveHandlerRef = React.useRef<(pointer: Pointer) => void>(() => {});
  const endHandlerRef = React.useRef<(pointer?: Pointer | null) => void>(() => {});
  const { clearPendingTap, handleTapGesture, suppressTapAfterDrag } = usePieceTapGesture({
    dispatch: args.dispatch,
    dragSessionRef,
  });
  const { handleStartDrag, handleStartDragPlaced } = useDragStartHandlers({
    state: args.state,
    dispatch: args.dispatch,
    placedByInstanceId: args.placedByInstanceId,
    dragSessionRef,
  });

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
      const targetKeys = previewDragTarget({
        pointer,
        boardRect,
        session,
        board: args.state.board,
        cellSize: args.cellSize,
        pieceById: args.pieceById,
        placedPieces: args.state.board.placedPieces,
      });
      setSnapTargetKeysIfChanged(targetKeys);
    },
    [
      args.boardGridElementRef,
      args.cellSize,
      args.pieceById,
      args.state.board.placedPieces,
      args.state.board.size,
      clearPendingTap,
      setSnapTargetKeysIfChanged,
    ],
  );

  const handleEndDrag = React.useCallback(
    (pointer?: Pointer | null, source: "piece" | "global" = "global") => {
      const session = dragSessionRef.current;
      if (!session) {
        return;
      }
      const movedOnRelease =
        session.hasMoved ||
        (pointer
          ? pointerDistanceSquared(pointer, session.startPointer) >=
            DRAG_START_THRESHOLD_PX * DRAG_START_THRESHOLD_PX
          : false);
      dragSessionRef.current = null;

      if (!movedOnRelease) {
        setDragVisual(null);
        setSnapTargetKeysIfChanged([]);
        if (pointer) {
          handleTapGesture(session.pieceId, session.sourceInstanceId, session.mouseButton, pointer);
        }
        return;
      }

      const boardRect = boardRectFromElement(args.boardGridElementRef.current);
      const dropOutside = !pointerIsInsideBoard(pointer ?? null, boardRect);
      let shouldCommit = true;
      if (!dropOutside && boardRect && pointer) {
        const occupiedCells = collectOccupiedCellsForDrag({
          placedPieces: args.state.board.placedPieces,
          pieceById: args.pieceById,
          sourceInstanceId: session.sourceInstanceId,
        });
        const snappedPosition = previewCellFromDrag(session, pointer, boardRect, args.cellSize);
        const target = resolveNearestPlacement({
          boardSize: args.state.board.size,
          occupiedCells,
          pieceById: args.pieceById,
          pieceId: session.pieceId,
          transform: session.transform,
          preferredPosition: snappedPosition,
        });
        if (target) {
          args.dispatch({
            type: "piece/preview",
            pieceId: session.pieceId,
            position: target.targetPosition,
          });
        } else {
          setBoardShakeToken((previous) => previous + 1);
          shouldCommit = false;
        }
      }
      if (shouldCommit) {
        args.dispatch({
          type: "piece/commit",
          pieceId: session.pieceId,
          sourceInstanceId: session.sourceInstanceId,
          dropOutside,
        });
      } else {
        args.dispatch({
          type: "piece/revert",
          pieceId: session.pieceId,
        });
      }
      suppressTapAfterDrag();
      setDragVisual(null);
      setSnapTargetKeysIfChanged([]);
    },
    [
      args.boardGridElementRef,
      args.cellSize,
      args.dispatch,
      args.pieceById,
      args.state.board.placedPieces,
      args.state.board.size,
      handleTapGesture,
      setSnapTargetKeysIfChanged,
      suppressTapAfterDrag,
    ],
  );

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    return bindGlobalDragListeners({
      isDragging: () => dragSessionRef.current !== null,
      onMove: (pointer) => moveHandlerRef.current(pointer),
      onEnd: (pointer) => endHandlerRef.current(pointer),
    });
  }, []);

  React.useEffect(() => {
    moveHandlerRef.current = handleMoveDrag;
  }, [handleMoveDrag]);

  React.useEffect(() => {
    endHandlerRef.current = (pointer?: Pointer | null) => handleEndDrag(pointer, "global");
  }, [handleEndDrag]);

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
    boardShakeToken,
  };
}
