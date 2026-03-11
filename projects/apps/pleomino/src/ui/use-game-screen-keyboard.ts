import React from "react";
import type { GameAction } from "../game/reducer";
import type { GameState, PlacedPiece } from "../game/types";

export function useGameScreenKeyboard(args: {
  dispatch: React.Dispatch<GameAction>;
  dragSessionRef: React.MutableRefObject<unknown | null>;
  interactionLocked: boolean;
  placedByInstanceId: Map<string, PlacedPiece>;
  selectedPieceId: string | null;
  selectedInstanceId: string | null;
  previewByPieceId: GameState["previewByPieceId"];
}) {
  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleKeyboard(event: KeyboardEvent) {
      if (args.dragSessionRef.current || args.interactionLocked) {
        return;
      }
      const key = event.key.toLowerCase();
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      if (hasCommandModifier && !event.altKey && key === "z") {
        event.preventDefault();
        args.dispatch({ type: event.shiftKey ? "history/redo" : "history/undo" });
        return;
      }
      if (hasCommandModifier && !event.altKey && key === "y") {
        event.preventDefault();
        args.dispatch({ type: "history/redo" });
        return;
      }
      if (!args.selectedPieceId) {
        return;
      }
      const selectedInstance: PlacedPiece | undefined = args.selectedInstanceId
        ? args.placedByInstanceId.get(args.selectedInstanceId)
        : undefined;

      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        args.dispatch({
          type: "piece/rotate",
          pieceId: args.selectedPieceId,
          instanceId: args.selectedInstanceId,
          direction: "cw",
        });
        return;
      }
      if (event.key === "q" || event.key === "Q") {
        event.preventDefault();
        args.dispatch({
          type: "piece/rotate",
          pieceId: args.selectedPieceId,
          instanceId: args.selectedInstanceId,
          direction: "ccw",
        });
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        args.dispatch({
          type: "piece/flip",
          pieceId: args.selectedPieceId,
          instanceId: args.selectedInstanceId,
        });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        args.dispatch({
          type: "piece/commit",
          pieceId: args.selectedPieceId,
          sourceInstanceId: args.selectedInstanceId,
        });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        args.dispatch({ type: "piece/revert", pieceId: args.selectedPieceId });
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

      const basePreview = args.previewByPieceId[args.selectedPieceId] ?? null;
      const basePosition = basePreview ?? selectedInstance?.position ?? { x: 0, y: 0 };
      const nextPosition = {
        x: basePosition.x + delta.x,
        y: basePosition.y + delta.y,
      };
      args.dispatch({
        type: "piece/preview",
        pieceId: args.selectedPieceId,
        position: nextPosition,
      });
      if (args.selectedInstanceId) {
        args.dispatch({
          type: "piece/commit",
          pieceId: args.selectedPieceId,
          sourceInstanceId: args.selectedInstanceId,
        });
      }
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.removeEventListener("keydown", handleKeyboard);
    };
  }, [
    args.dispatch,
    args.dragSessionRef,
    args.interactionLocked,
    args.placedByInstanceId,
    args.previewByPieceId,
    args.selectedInstanceId,
    args.selectedPieceId,
  ]);
}
