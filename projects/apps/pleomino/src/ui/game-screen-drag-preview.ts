import { previewCellFromDrag } from "../game/interaction";
import type { GameState, PieceDefinition, PlacedPiece } from "../game/types";
import {
  collectOccupiedCellsForDrag,
  pointerIsInsideBoard,
  resolveNearestPlacement,
  type ActiveDragSession,
  type Pointer,
} from "./game-screen-interaction-helpers";

export function previewDragTarget(args: {
  pointer: Pointer;
  boardRect: { left: number; top: number; width: number; height: number } | null;
  session: ActiveDragSession;
  board: GameState["board"];
  cellSize: number;
  pieceById: Map<string, PieceDefinition>;
  placedPieces: readonly PlacedPiece[];
}): string[] {
  if (!args.boardRect || !pointerIsInsideBoard(args.pointer, args.boardRect)) {
    return [];
  }
  const occupiedCells = collectOccupiedCellsForDrag({
    placedPieces: args.placedPieces,
    pieceById: args.pieceById,
    sourceInstanceId: args.session.sourceInstanceId,
  });
  const snappedPosition = previewCellFromDrag(
    args.session,
    args.pointer,
    args.boardRect,
    args.cellSize,
  );
  const target = resolveNearestPlacement({
    boardSize: args.board.size,
    occupiedCells,
    pieceById: args.pieceById,
    pieceId: args.session.pieceId,
    transform: args.session.transform,
    preferredPosition: snappedPosition,
  });
  return target ? target.targetCells.map((cell) => `${cell.x},${cell.y}`) : [];
}
