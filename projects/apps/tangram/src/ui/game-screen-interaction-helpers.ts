import { BOARD_CELL_SIZE } from "../game/board";
import { transformCells, translateCells } from "../game/geometry";
import { previewCellFromDrag } from "../game/interaction";
import type { Cell, GameState, PieceDefinition, PieceTransform } from "../game/types";

export type Pointer = { pageX: number; pageY: number };

export type ActiveDragSession = {
  pieceId: string;
  grabbedOffsetPx: { x: number; y: number };
  sourceInstanceId: string | null;
  transform: PieceTransform;
  startPointer: Pointer;
  mouseButton: number | null;
  hasMoved: boolean;
};

export type DragVisualState = {
  pieceId: string;
  pointer: Pointer;
};

export const DRAG_START_THRESHOLD_PX = 8;
export const DOUBLE_TAP_WINDOW_MS = 220;
export const TAP_AFTER_DRAG_SUPPRESSION_MS = 120;

export function areSameKeyList(previous: readonly string[], next: readonly string[]): boolean {
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

export function boardRectFromElement(element: HTMLElement | null): {
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

export function pointerIsInsideBoard(
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

export function pointerDistanceSquared(left: Pointer, right: Pointer): number {
  const deltaX = left.pageX - right.pageX;
  const deltaY = left.pageY - right.pageY;
  return deltaX * deltaX + deltaY * deltaY;
}

export function pageToViewportPosition(pointer: Pointer): { x: number; y: number } {
  return {
    x: pointer.pageX - window.scrollX,
    y: pointer.pageY - window.scrollY,
  };
}

export function tapTargetKey(pieceId: string, instanceId: string | null): string {
  return `${pieceId}::${instanceId ?? "tray"}`;
}

export function rotationDirectionForMouseButton(mouseButton: number | null): "cw" | "ccw" {
  return mouseButton === 2 ? "ccw" : "cw";
}

export function computeSnapTargetKeys(args: {
  boardSize: GameState["board"]["size"];
  boardRect: { left: number; top: number; width: number; height: number } | null;
  pointer: Pointer;
  pieceById: Map<string, PieceDefinition>;
  session: ActiveDragSession;
  cellKey: (cell: Cell) => string;
}): string[] {
  if (!args.boardRect || !pointerIsInsideBoard(args.pointer, args.boardRect)) {
    return [];
  }
  const definition = args.pieceById.get(args.session.pieceId);
  if (!definition) {
    return [];
  }
  const snappedPosition = previewCellFromDrag(
    args.session,
    args.pointer,
    args.boardRect,
    BOARD_CELL_SIZE,
  );
  const footprint = translateCells(
    transformCells(definition.baseCells, args.session.transform),
    snappedPosition,
  );
  const keys: string[] = [];
  for (const cell of footprint) {
    if (
      cell.x < 0 ||
      cell.y < 0 ||
      cell.x >= args.boardSize.columns ||
      cell.y >= args.boardSize.rows
    ) {
      continue;
    }
    keys.push(args.cellKey(cell));
  }
  return keys;
}

export function computeTrayReturnTargetPieceId(
  dragSession: ActiveDragSession | null,
  dragVisual: DragVisualState | null,
  boardElement: HTMLElement | null,
): string | null {
  if (!dragSession || !dragSession.sourceInstanceId || !dragVisual || !dragSession.hasMoved) {
    return null;
  }
  const boardRect = boardRectFromElement(boardElement);
  if (pointerIsInsideBoard(dragVisual.pointer, boardRect)) {
    return null;
  }
  return dragSession.pieceId;
}
