import type { Cell } from "./types";

export type PointerPoint = {
  pageX: number;
  pageY: number;
};

export type PixelPoint = {
  x: number;
  y: number;
};

export type BoardRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DragSession = {
  pieceId: string;
  grabbedOffsetPx: PixelPoint;
};

export type BeginDragInput = {
  pieceId: string;
  grabbedOffsetPx: PixelPoint | null;
};

function boardCellFromPointer(pointer: PointerPoint, boardRect: BoardRect, cellSize: number): Cell {
  return {
    x: Math.floor((pointer.pageX - boardRect.left) / cellSize),
    y: Math.floor((pointer.pageY - boardRect.top) / cellSize),
  };
}

export function beginDragSession(input: BeginDragInput): DragSession {
  if (!input.grabbedOffsetPx) {
    return {
      pieceId: input.pieceId,
      grabbedOffsetPx: { x: 0, y: 0 },
    };
  }

  return {
    pieceId: input.pieceId,
    grabbedOffsetPx: input.grabbedOffsetPx,
  };
}

export function previewCellFromDrag(
  session: DragSession,
  pointer: PointerPoint,
  boardRect: BoardRect,
  cellSize: number,
): Cell {
  const pointerOffsetX = pointer.pageX - boardRect.left - session.grabbedOffsetPx.x;
  const pointerOffsetY = pointer.pageY - boardRect.top - session.grabbedOffsetPx.y;
  return {
    x: Math.floor(pointerOffsetX / cellSize),
    y: Math.floor(pointerOffsetY / cellSize),
  };
}
