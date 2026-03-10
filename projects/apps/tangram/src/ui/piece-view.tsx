import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native-web";
import { BOARD_CELL_SIZE } from "../game/board";
import type { PixelPoint, PointerPoint } from "../game/interaction";
import type { PieceViewModel } from "../game/selectors";
import {
  grabbedOffsetFromPointer as grabbedOffsetFromPointerHelper,
  pieceBounds,
  pointerFromPressEvent,
  texturedCellColor,
} from "./piece-view-helpers";

function PieceViewBase(props: {
  piece: PieceViewModel;
  isReturnTarget?: boolean;
  onStartDrag: (
    pieceId: string,
    pointer: PointerPoint,
    grabbedOffsetPx: PixelPoint | null,
    mouseButton?: number,
  ) => void;
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

  const grabbedOffsetFromPointer = React.useCallback(
    (pointer: PointerPoint): PixelPoint | null => {
      return grabbedOffsetFromPointerHelper({
        pointer,
        spriteElement: spriteRef.current,
        columns: bounds.columns,
        rows: bounds.rows,
        spriteCellsByPosition,
      });
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
        button?: number;
      };
      target: EventTarget | null;
    }) => {
      if (!props.piece.canDrag) {
        return;
      }
      const pointer = pointerFromPressEvent(event);
      const grabbedOffsetPx = grabbedOffsetFromPointer(pointer);
      if (!grabbedOffsetPx) {
        return;
      }
      props.onStartDrag(props.piece.pieceId, pointer, grabbedOffsetPx, event.nativeEvent.button);
    },
    [grabbedOffsetFromPointer, props],
  );

  return (
    <Pressable
      onMouseDown={handleStartDrag}
      onTouchStart={handleStartDrag}
      onMouseUp={(event) => props.onEndDrag(pointerFromPressEvent(event))}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
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

export const PieceView = React.memo(PieceViewBase);

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
