import type { PixelPoint } from "../game/interaction";

type BoardPointerEvent = {
  currentTarget: EventTarget | null;
  nativeEvent: {
    pageX?: number;
    pageY?: number;
    clientX?: number;
    clientY?: number;
    touches?: Array<{ pageX: number; pageY: number }>;
    changedTouches?: Array<{ pageX: number; pageY: number }>;
  };
};

export function pointerFromBoardEvent(event: BoardPointerEvent): { pageX: number; pageY: number } {
  const native = event.nativeEvent;
  const touch = native.touches?.[0] ?? native.changedTouches?.[0];
  if (touch) {
    return { pageX: touch.pageX, pageY: touch.pageY };
  }
  if (typeof native.clientX === "number" && typeof native.clientY === "number") {
    return {
      pageX: native.clientX + window.scrollX,
      pageY: native.clientY + window.scrollY,
    };
  }
  if (typeof native.pageX === "number" && typeof native.pageY === "number") {
    return { pageX: native.pageX, pageY: native.pageY };
  }
  return { pageX: 0, pageY: 0 };
}

export function grabbedOffsetFromBoardCellEvent(
  event: BoardPointerEvent,
  localCell: { x: number; y: number },
  pointer: { pageX: number; pageY: number },
  cellSize: number,
): PixelPoint | null {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const rect = target.getBoundingClientRect();
  const localInCellX = pointer.pageX - (rect.left + window.scrollX);
  const localInCellY = pointer.pageY - (rect.top + window.scrollY);
  return {
    x: localCell.x * cellSize + localInCellX,
    y: localCell.y * cellSize + localInCellY,
  };
}
