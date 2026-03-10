import React from "react";
import { beginDragSession, previewCellFromDrag } from "../game/interaction";
import { transformCells, translateCells } from "../game/geometry";
import type { PixelPoint } from "../game/interaction";
import { cellKey } from "../game/placement";
import { DEFAULT_PIECE_TRANSFORM } from "../game/piece-transform";
import type { GameAction } from "../game/reducer";
import type { GameState, PieceDefinition, PlacedPiece } from "../game/types";
import { bindGlobalDragListeners } from "./drag-window-events";
import {
  areSameKeyList,
  boardRectFromElement,
  computeTrayReturnTargetPieceId,
  DOUBLE_TAP_WINDOW_MS,
  DRAG_START_THRESHOLD_PX,
  findNearestValidPlacement,
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

type RecentTap = {
  targetKey: string;
  atMs: number;
  pointer: Pointer;
};

const DUPLICATE_TAP_WINDOW_MS = 140;
const DUPLICATE_TAP_POSITION_PX = 4;

export function useGameScreenInteractions(args: {
  state: GameState;
  cellSize: number;
  dispatch: React.Dispatch<GameAction>;
  pieceById: Map<string, PieceDefinition>;
  placedByInstanceId: Map<string, PlacedPiece>;
  boardGridElementRef: React.MutableRefObject<HTMLElement | null>;
}) {
  const dragSessionRef = React.useRef<ActiveDragSession | null>(null);
  const pendingTapRef = React.useRef<PendingTap | null>(null);
  const recentTapRef = React.useRef<RecentTap | null>(null);
  const tapSuppressedUntilRef = React.useRef(0);
  const [dragVisual, setDragVisual] = React.useState<DragVisualState | null>(null);
  const [snapTargetCellKeys, setSnapTargetCellKeys] = React.useState<string[]>([]);
  const [boardShakeToken, setBoardShakeToken] = React.useState(0);
  const moveHandlerRef = React.useRef<(pointer: Pointer) => void>(() => {});
  const endHandlerRef = React.useRef<(pointer?: Pointer | null) => void>(() => {});

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
    (pieceId: string, instanceId: string | null, mouseButton: number | null, pointer: Pointer) => {
      if (dragSessionRef.current || Date.now() < tapSuppressedUntilRef.current) {
        return;
      }
      const key = tapTargetKey(pieceId, instanceId);
      const now = Date.now();
      const recentTap = recentTapRef.current;
      if (
        recentTap &&
        recentTap.targetKey === key &&
        now - recentTap.atMs <= DUPLICATE_TAP_WINDOW_MS &&
        pointerDistanceSquared(recentTap.pointer, pointer) <=
          DUPLICATE_TAP_POSITION_PX * DUPLICATE_TAP_POSITION_PX
      ) {
        return;
      }
      recentTapRef.current = { targetKey: key, atMs: now, pointer };
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
      args.dispatch({ type: "piece/revert", pieceId });
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
      args.dispatch({ type: "piece/revert", pieceId });
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
      if (!boardRect || !pointerIsInsideBoard(pointer, boardRect)) {
        setSnapTargetKeysIfChanged([]);
        return;
      }
      const definition = args.pieceById.get(session.pieceId);
      if (!definition) {
        setSnapTargetKeysIfChanged([]);
        return;
      }

      const transformedCells = transformCells(definition.baseCells, session.transform);
      const occupiedCells = new Set<string>();
      for (const placed of args.state.board.placedPieces) {
        if (placed.instanceId === session.sourceInstanceId) {
          continue;
        }
        const placedDefinition = args.pieceById.get(placed.pieceId);
        if (!placedDefinition) {
          continue;
        }
        const placedCells = translateCells(
          transformCells(placedDefinition.baseCells, placed.transform),
          placed.position,
        );
        for (const placedCell of placedCells) {
          occupiedCells.add(cellKey(placedCell));
        }
      }
      const snappedPosition = previewCellFromDrag(session, pointer, boardRect, args.cellSize);
      const targetPosition = findNearestValidPlacement({
        boardSize: args.state.board.size,
        occupiedCells,
        transformedCells,
        preferredPosition: snappedPosition,
      });
      if (!targetPosition) {
        setSnapTargetKeysIfChanged([]);
        return;
      }
      const targetCells = translateCells(transformedCells, targetPosition);
      setSnapTargetKeysIfChanged(targetCells.map((cell) => cellKey(cell)));
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
        const definition = args.pieceById.get(session.pieceId);
        if (definition) {
          const occupiedCells = new Set<string>();
          for (const placed of args.state.board.placedPieces) {
            if (placed.instanceId === session.sourceInstanceId) {
              continue;
            }
            const placedDefinition = args.pieceById.get(placed.pieceId);
            if (!placedDefinition) {
              continue;
            }
            const placedCells = translateCells(
              transformCells(placedDefinition.baseCells, placed.transform),
              placed.position,
            );
            for (const placedCell of placedCells) {
              occupiedCells.add(cellKey(placedCell));
            }
          }
          const transformedCells = transformCells(definition.baseCells, session.transform);
          const snappedPosition = previewCellFromDrag(session, pointer, boardRect, args.cellSize);
          const targetPosition = findNearestValidPlacement({
            boardSize: args.state.board.size,
            occupiedCells,
            transformedCells,
            preferredPosition: snappedPosition,
          });
          if (targetPosition) {
            args.dispatch({
              type: "piece/preview",
              pieceId: session.pieceId,
              position: targetPosition,
            });
          } else {
            setBoardShakeToken((previous) => previous + 1);
            shouldCommit = false;
          }
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
      tapSuppressedUntilRef.current = Date.now() + TAP_AFTER_DRAG_SUPPRESSION_MS;
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
