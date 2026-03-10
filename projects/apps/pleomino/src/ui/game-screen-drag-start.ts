import type React from "react";
import { beginDragSession } from "../game/interaction";
import { DEFAULT_PIECE_TRANSFORM } from "../game/piece-transform";
import type { GameAction } from "../game/reducer";
import type { GameState, PlacedPiece } from "../game/types";
import type { Pointer, ActiveDragSession } from "./game-screen-interaction-helpers";

export function startDragFromTray(args: {
  pieceId: string;
  pointer: Pointer;
  grabbedOffsetPx: { x: number; y: number };
  mouseButton?: number;
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  dragSessionRef: React.MutableRefObject<ActiveDragSession | null>;
}) {
  const transform = args.state.transformByPieceId[args.pieceId] ?? DEFAULT_PIECE_TRANSFORM;
  args.dispatch({ type: "piece/select", pieceId: args.pieceId, instanceId: null });
  args.dispatch({ type: "piece/revert", pieceId: args.pieceId });
  const session = beginDragSession({
    pieceId: args.pieceId,
    grabbedOffsetPx: args.grabbedOffsetPx,
  });
  args.dragSessionRef.current = {
    ...session,
    sourceInstanceId: null,
    transform,
    startPointer: args.pointer,
    mouseButton: args.mouseButton ?? null,
    hasMoved: false,
  };
}

export function startDragFromPlaced(args: {
  pieceId: string;
  instanceId: string;
  grabbedOffsetPx: { x: number; y: number };
  pointer: Pointer;
  mouseButton?: number;
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  placedByInstanceId: Map<string, PlacedPiece>;
  dragSessionRef: React.MutableRefObject<ActiveDragSession | null>;
}) {
  const sourceInstance = args.placedByInstanceId.get(args.instanceId);
  const transform =
    sourceInstance?.transform ??
    args.state.transformByPieceId[args.pieceId] ??
    DEFAULT_PIECE_TRANSFORM;
  args.dispatch({ type: "piece/select", pieceId: args.pieceId, instanceId: args.instanceId });
  args.dispatch({ type: "piece/revert", pieceId: args.pieceId });
  const session = beginDragSession({
    pieceId: args.pieceId,
    grabbedOffsetPx: args.grabbedOffsetPx,
  });
  args.dragSessionRef.current = {
    ...session,
    sourceInstanceId: args.instanceId,
    transform,
    startPointer: args.pointer,
    mouseButton: args.mouseButton ?? null,
    hasMoved: false,
  };
}
