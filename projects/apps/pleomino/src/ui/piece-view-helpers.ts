import type { PixelPoint, PointerPoint } from "../game/interaction";

export function pieceBounds(cells: readonly { x: number; y: number }[]): {
  columns: number;
  rows: number;
} {
  if (cells.length === 0) {
    return { columns: 1, rows: 1 };
  }
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  return {
    columns: maxX + 1,
    rows: maxY + 1,
  };
}

export function pointerFromPressEvent(event: {
  nativeEvent: {
    pageX?: number;
    pageY?: number;
    clientX?: number;
    clientY?: number;
    touches?: Array<{ pageX: number; pageY: number }>;
    changedTouches?: Array<{ pageX: number; pageY: number }>;
  };
}): PointerPoint {
  const native = event.nativeEvent;
  const firstTouch = native.touches?.[0] ?? native.changedTouches?.[0];
  if (firstTouch) {
    return {
      pageX: firstTouch.pageX,
      pageY: firstTouch.pageY,
    };
  }
  if (typeof native.clientX === "number" && typeof native.clientY === "number") {
    return {
      pageX: native.clientX + window.scrollX,
      pageY: native.clientY + window.scrollY,
    };
  }
  if (typeof native.pageX === "number" && typeof native.pageY === "number") {
    return {
      pageX: native.pageX,
      pageY: native.pageY,
    };
  }
  return {
    pageX: 0,
    pageY: 0,
  };
}

export function grabbedOffsetFromPointer(args: {
  pointer: PointerPoint;
  spriteElement: HTMLElement | null;
  columns: number;
  rows: number;
  cellSize: number;
  spriteCellsByPosition: ReadonlyMap<string, { x: number; y: number }>;
}): PixelPoint | null {
  const spriteElement = args.spriteElement;
  if (!spriteElement) {
    return null;
  }
  const rect = spriteElement.getBoundingClientRect();
  const localX = args.pointer.pageX - (rect.left + window.scrollX);
  const localY = args.pointer.pageY - (rect.top + window.scrollY);
  if (
    localX < 0 ||
    localY < 0 ||
    localX >= args.columns * args.cellSize ||
    localY >= args.rows * args.cellSize
  ) {
    return null;
  }
  const parsedX = Math.floor(localX / args.cellSize);
  const parsedY = Math.floor(localY / args.cellSize);
  if (!args.spriteCellsByPosition.has(`${parsedX},${parsedY}`)) {
    return null;
  }
  return { x: localX, y: localY };
}
