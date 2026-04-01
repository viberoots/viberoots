import React from "react";
import { Pressable, StyleSheet, View } from "react-native-web";
import type { PixelPoint, PointerPoint } from "../game/interaction";
import type { PieceViewModel } from "../game/selectors";
import {
  grabbedOffsetFromPointer as grabbedOffsetFromPointerHelper,
  pieceBounds,
  pointerFromPressEvent,
} from "./piece-view-helpers";

function PieceViewBase(props: {
  piece: PieceViewModel;
  cellSize: number;
  isReturnTarget?: boolean;
  onStartDrag: (
    pieceId: string,
    pointer: PointerPoint,
    grabbedOffsetPx: PixelPoint | null,
    mouseButton?: number,
  ) => void;
  onEndDrag: (pointer?: PointerPoint | null, source?: "piece" | "global") => void;
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
        cellSize: props.cellSize,
        spriteCellsByPosition,
      });
    },
    [bounds.columns, bounds.rows, props.cellSize, spriteCellsByPosition],
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
      if (typeof (event as { preventDefault?: () => void }).preventDefault === "function") {
        event.preventDefault();
      }
      const grabbedOffsetPx = grabbedOffsetFromPointer(pointer);
      if (!grabbedOffsetPx) {
        return;
      }
      props.onStartDrag(props.piece.pieceId, pointer, grabbedOffsetPx, event.nativeEvent.button);
    },
    [grabbedOffsetFromPointer, props.onStartDrag, props.piece.canDrag, props.piece.pieceId],
  );

  return (
    <Pressable
      onMouseDown={handleStartDrag}
      onTouchStart={handleStartDrag}
      onMouseUp={(event) => props.onEndDrag(pointerFromPressEvent(event), "piece")}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      hitSlop={Math.max(8, Math.floor(props.cellSize * 0.3))}
      style={[styles.card, !props.piece.canDrag ? styles.cardDisabled : null]}
      testID="pleomino-piece-view"
      data-piece-id={props.piece.pieceId}
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
            width: bounds.columns * props.cellSize,
            height: bounds.rows * props.cellSize,
          },
        ]}
        testID={props.isReturnTarget ? "pleomino-piece-return-target" : undefined}
      >
        {props.piece.cells.map((cell) => (
          <View
            key={`${props.piece.pieceId}-${cell.x},${cell.y}`}
            style={[
              styles.spriteCell,
              {
                left: cell.x * props.cellSize,
                top: cell.y * props.cellSize,
                backgroundColor: props.piece.color,
                width: props.cellSize,
                height: props.cellSize,
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
                    left: cell.x * props.cellSize,
                    top: cell.y * props.cellSize,
                    borderLeftWidth: pieceCellKeySet.has(`${cell.x - 1},${cell.y}`) ? 0 : 2,
                    borderRightWidth: pieceCellKeySet.has(`${cell.x + 1},${cell.y}`) ? 0 : 2,
                    borderTopWidth: pieceCellKeySet.has(`${cell.x},${cell.y - 1}`) ? 0 : 2,
                    borderBottomWidth: pieceCellKeySet.has(`${cell.x},${cell.y + 1}`) ? 0 : 2,
                    width: props.cellSize,
                    height: props.cellSize,
                  },
                ]}
              />
            ))
          : null}
      </View>
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
  },
  returnTargetCell: {
    position: "absolute",
    borderColor: "rgba(255, 255, 255, 0.9)",
    zIndex: 2,
    pointerEvents: "none",
  },
});
