import React from "react";
import type { GameAction } from "../game/reducer";
import {
  DOUBLE_TAP_WINDOW_MS,
  pointerDistanceSquared,
  rotationDirectionForMouseButton,
  TAP_AFTER_DRAG_SUPPRESSION_MS,
  tapTargetKey,
  type ActiveDragSession,
  type Pointer,
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

export function usePieceTapGesture(args: {
  dispatch: React.Dispatch<GameAction>;
  dragSessionRef: React.MutableRefObject<ActiveDragSession | null>;
}) {
  const pendingTapRef = React.useRef<PendingTap | null>(null);
  const recentTapRef = React.useRef<RecentTap | null>(null);
  const tapSuppressedUntilRef = React.useRef(0);

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
      if (args.dragSessionRef.current || Date.now() < tapSuppressedUntilRef.current) {
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
    [args, clearPendingTap],
  );

  const suppressTapAfterDrag = React.useCallback(() => {
    tapSuppressedUntilRef.current = Date.now() + TAP_AFTER_DRAG_SUPPRESSION_MS;
  }, []);

  return { clearPendingTap, handleTapGesture, suppressTapAfterDrag };
}
