import React from "react";
import type { PixelPoint } from "../game/interaction";
import type { GameAction } from "../game/reducer";
import type { GameState, PlacedPiece } from "../game/types";
import type { ActiveDragSession, Pointer } from "./game-screen-interaction-helpers";
import { startDragFromPlaced, startDragFromTray } from "./game-screen-drag-start";

export function useDragStartHandlers(args: {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  interactionLocked: boolean;
  placedByInstanceId: Map<string, PlacedPiece>;
  dragSessionRef: React.MutableRefObject<ActiveDragSession | null>;
}) {
  const { dispatch, dragSessionRef, interactionLocked, placedByInstanceId, state } = args;

  const handleStartDrag = React.useCallback(
    (
      pieceId: string,
      pointer: Pointer,
      grabbedOffsetPx: PixelPoint | null,
      mouseButton?: number,
    ) => {
      if (!grabbedOffsetPx || interactionLocked) {
        return;
      }
      startDragFromTray({
        pieceId,
        pointer,
        grabbedOffsetPx,
        mouseButton,
        state,
        dispatch,
        dragSessionRef,
      });
    },
    [dispatch, dragSessionRef, interactionLocked, state],
  );

  const handleStartDragPlaced = React.useCallback(
    (
      pieceId: string,
      instanceId: string,
      grabbedOffsetPx: PixelPoint,
      pointer: Pointer,
      mouseButton?: number,
    ) => {
      if (interactionLocked) {
        return;
      }
      startDragFromPlaced({
        pieceId,
        instanceId,
        grabbedOffsetPx,
        pointer,
        mouseButton,
        state,
        dispatch,
        placedByInstanceId,
        dragSessionRef,
      });
    },
    [dispatch, dragSessionRef, interactionLocked, placedByInstanceId, state],
  );

  return { handleStartDrag, handleStartDragPlaced };
}
