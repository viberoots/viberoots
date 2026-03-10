import React from "react";
import type { PixelPoint } from "../game/interaction";
import type { GameAction } from "../game/reducer";
import type { GameState, PlacedPiece } from "../game/types";
import type { ActiveDragSession, Pointer } from "./game-screen-interaction-helpers";
import { startDragFromPlaced, startDragFromTray } from "./game-screen-drag-start";

export function useDragStartHandlers(args: {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  placedByInstanceId: Map<string, PlacedPiece>;
  dragSessionRef: React.MutableRefObject<ActiveDragSession | null>;
}) {
  const handleStartDrag = React.useCallback(
    (
      pieceId: string,
      pointer: Pointer,
      grabbedOffsetPx: PixelPoint | null,
      mouseButton?: number,
    ) => {
      if (!grabbedOffsetPx) {
        return;
      }
      startDragFromTray({
        pieceId,
        pointer,
        grabbedOffsetPx,
        mouseButton,
        state: args.state,
        dispatch: args.dispatch,
        dragSessionRef: args.dragSessionRef,
      });
    },
    [args],
  );

  const handleStartDragPlaced = React.useCallback(
    (
      pieceId: string,
      instanceId: string,
      grabbedOffsetPx: PixelPoint,
      pointer: Pointer,
      mouseButton?: number,
    ) => {
      startDragFromPlaced({
        pieceId,
        instanceId,
        grabbedOffsetPx,
        pointer,
        mouseButton,
        state: args.state,
        dispatch: args.dispatch,
        placedByInstanceId: args.placedByInstanceId,
        dragSessionRef: args.dragSessionRef,
      });
    },
    [args],
  );

  return { handleStartDrag, handleStartDragPlaced };
}
