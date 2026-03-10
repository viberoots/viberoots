import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native-web";
import { BOARD_CELL_SIZE } from "../game/board";
import type { PixelPoint, PointerPoint } from "../game/interaction";
import type { PieceViewModel } from "../game/selectors";

function pieceBounds(cells: readonly { x: number; y: number }[]): {
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

function texturedCellColor(baseColor: string, x: number, y: number): string {
  if ((x + y) % 2 === 0) {
    return baseColor;
  }
  return shiftHexColor(baseColor, baseColor.toLowerCase() === "#000000" ? 18 : -10);
}

export function PieceView(props: {
  piece: PieceViewModel;
  isReturnTarget?: boolean;
  onSelectPiece: (pieceId: string) => void;
  onStartDrag: (pieceId: string, pointer: PointerPoint, grabbedOffsetPx: PixelPoint | null) => void;
  onMoveDrag: (pointer: PointerPoint) => void;
  onEndDrag: (pointer?: PointerPoint | null) => void;
}) {
  const bounds = pieceBounds(props.piece.cells);
  const spriteRef = React.useRef<HTMLElement | null>(null);
  const pieceCellKeySet = React.useMemo(
    () => new Set(props.piece.cells.map((cell) => `${cell.x},${cell.y}`)),
    [props.piece.cells],
  );
  const spriteCellsByPosition = React.useMemo(() => {
    const byPosition = new Map<string, { x: number; y: number }>();
    for (const cell of props.piece.cells) {
      byPosition.set(`${cell.x},${cell.y}`, { x: cell.x, y: cell.y });
    }
    return byPosition;
  }, [props.piece.cells]);

  const pointerFromEvent = React.useCallback(
    (event: {
      nativeEvent: {
        pageX?: number;
        pageY?: number;
        clientX?: number;
        clientY?: number;
        touches?: Array<{ pageX: number; pageY: number }>;
        changedTouches?: Array<{ pageX: number; pageY: number }>;
      };
    }): PointerPoint => {
      const native = event.nativeEvent;
      if (typeof native.pageX === "number" && typeof native.pageY === "number") {
        return {
          pageX: native.pageX,
          pageY: native.pageY,
        };
      }
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
      return {
        pageX: 0,
        pageY: 0,
      };
    },
    [],
  );

  const grabbedOffsetFromPointer = React.useCallback(
    (pointer: PointerPoint): PixelPoint | null => {
      const spriteElement = spriteRef.current;
      if (!spriteElement) {
        return null;
      }
      const rect = spriteElement.getBoundingClientRect();
      const localX = pointer.pageX - (rect.left + window.scrollX);
      const localY = pointer.pageY - (rect.top + window.scrollY);
      if (
        localX < 0 ||
        localY < 0 ||
        localX >= bounds.columns * BOARD_CELL_SIZE ||
        localY >= bounds.rows * BOARD_CELL_SIZE
      ) {
        return null;
      }
      const parsedX = Math.floor(localX / BOARD_CELL_SIZE);
      const parsedY = Math.floor(localY / BOARD_CELL_SIZE);
      if (!spriteCellsByPosition.has(`${parsedX},${parsedY}`)) {
        return null;
      }
      return { x: localX, y: localY };
    },
    [bounds.columns, bounds.rows, spriteCellsByPosition],
  );

  const handleStartDrag = React.useCallback(
    (event: {
      nativeEvent: {
        pageX?: number;
        pageY?: number;
        clientX?: number;
        clientY?: number;
        touches?: Array<{ pageX: number; pageY: number }>;
        changedTouches?: Array<{ pageX: number; pageY: number }>;
      };
      target: EventTarget | null;
    }) => {
      if (!props.piece.canDrag) {
        return;
      }
      const pointer = pointerFromEvent(event);
      const grabbedOffsetPx = grabbedOffsetFromPointer(pointer);
      if (!grabbedOffsetPx) {
        return;
      }
      props.onStartDrag(props.piece.pieceId, pointer, grabbedOffsetPx);
    },
    [grabbedOffsetFromPointer, pointerFromEvent, props],
  );

  return (
    <Pressable
      onPress={() => props.onSelectPiece(props.piece.pieceId)}
      onMouseDown={handleStartDrag}
      onTouchStart={handleStartDrag}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={handleStartDrag}
      onResponderMove={(event) => props.onMoveDrag(pointerFromEvent(event))}
      onResponderRelease={(event) => props.onEndDrag(pointerFromEvent(event))}
      onResponderTerminate={() => props.onEndDrag(null)}
      disabled={!props.piece.canDrag}
      style={[styles.card, !props.piece.canDrag ? styles.cardDisabled : null]}
      testID="tangram-piece-view"
      accessibilityRole="button"
      accessibilityLabel={`Piece ${props.piece.pieceId}, ${props.piece.remainingCount} left`}
      accessibilityState={{ disabled: !props.piece.canDrag }}
    >
      <View
        ref={(element) => {
          spriteRef.current = element as HTMLElement | null;
        }}
        style={[
          styles.sprite,
          {
            width: bounds.columns * BOARD_CELL_SIZE,
            height: bounds.rows * BOARD_CELL_SIZE,
          },
        ]}
        testID={props.isReturnTarget ? "tangram-piece-return-target" : undefined}
      >
        {props.piece.cells.map((cell) => (
          <View
            key={`${props.piece.pieceId}-${cell.x},${cell.y}`}
            style={[
              styles.spriteCell,
              {
                left: cell.x * BOARD_CELL_SIZE,
                top: cell.y * BOARD_CELL_SIZE,
                backgroundColor: texturedCellColor(props.piece.color, cell.x, cell.y),
              },
            ]}
            data-cell-x={cell.x}
            data-cell-y={cell.y}
          />
        ))}
        {props.isReturnTarget
          ? props.piece.cells.map((cell) => (
              <View
                key={`${props.piece.pieceId}-return-target-${cell.x},${cell.y}`}
                style={[
                  styles.returnTargetCell,
                  {
                    left: cell.x * BOARD_CELL_SIZE,
                    top: cell.y * BOARD_CELL_SIZE,
                    borderLeftWidth: pieceCellKeySet.has(`${cell.x - 1},${cell.y}`) ? 0 : 2,
                    borderRightWidth: pieceCellKeySet.has(`${cell.x + 1},${cell.y}`) ? 0 : 2,
                    borderTopWidth: pieceCellKeySet.has(`${cell.x},${cell.y - 1}`) ? 0 : 2,
                    borderBottomWidth: pieceCellKeySet.has(`${cell.x},${cell.y + 1}`) ? 0 : 2,
                  },
                ]}
              />
            ))
          : null}
      </View>
      <Text style={styles.countText} testID={`tangram-piece-count-${props.piece.pieceId}`}>
        {props.piece.remainingCount} left
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    alignItems: "flex-start",
    position: "relative",
  },
  cardDisabled: {
    opacity: 0.35,
  },
  sprite: {
    position: "relative",
  },
  spriteCell: {
    position: "absolute",
    width: BOARD_CELL_SIZE,
    height: BOARD_CELL_SIZE,
  },
  countText: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "600",
  },
  returnTargetCell: {
    position: "absolute",
    width: BOARD_CELL_SIZE,
    height: BOARD_CELL_SIZE,
    borderColor: "rgba(255, 255, 255, 0.9)",
    zIndex: 2,
    pointerEvents: "none",
  },
});
