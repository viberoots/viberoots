import { BOARD_CELL_SIZE } from "../game/board";
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

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function shiftHexColor(hexColor: string, delta: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hexColor);
  if (!match) {
    return hexColor;
  }

  const color = match[1];
  const red = parseInt(color.slice(0, 2), 16);
  const green = parseInt(color.slice(2, 4), 16);
  const blue = parseInt(color.slice(4, 6), 16);
  const nextRed = clampColor(red + delta);
  const nextGreen = clampColor(green + delta);
  const nextBlue = clampColor(blue + delta);

  return `#${nextRed.toString(16).padStart(2, "0")}${nextGreen
    .toString(16)
    .padStart(2, "0")}${nextBlue.toString(16).padStart(2, "0")}`;
}

export function texturedCellColor(baseColor: string, x: number, y: number): string {
  if ((x + y) % 2 === 0) {
    return baseColor;
  }
  return shiftHexColor(baseColor, baseColor.toLowerCase() === "#000000" ? 18 : -10);
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
    localX >= args.columns * BOARD_CELL_SIZE ||
    localY >= args.rows * BOARD_CELL_SIZE
  ) {
    return null;
  }
  const parsedX = Math.floor(localX / BOARD_CELL_SIZE);
  const parsedY = Math.floor(localY / BOARD_CELL_SIZE);
  if (!args.spriteCellsByPosition.has(`${parsedX},${parsedY}`)) {
    return null;
  }
  return { x: localX, y: localY };
}
