import React from "react";
import { StyleSheet, View } from "react-native-web";
import type { BoardViewModel } from "../game/selectors";
import type { PixelPoint } from "../game/interaction";
import { cellKey } from "../game/placement";

function pointerFromEvent(event: {
  nativeEvent: {
    pageX?: number;
    pageY?: number;
    clientX?: number;
    clientY?: number;
    touches?: Array<{ pageX: number; pageY: number }>;
    changedTouches?: Array<{ pageX: number; pageY: number }>;
  };
}): { pageX: number; pageY: number } {
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
  return {
    pageX: 0,
    pageY: 0,
  };
}

function grabbedOffsetFromBoardCellEvent(
  event: { currentTarget: EventTarget | null; nativeEvent: unknown },
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

export function BoardGrid(props: {
  board: BoardViewModel;
  cellSize: number;
  shakeToken?: number;
  onStartDragPlaced: (
    pieceId: string,
    instanceId: string,
    grabbedOffsetPx: PixelPoint,
    pointer: { pageX: number; pageY: number },
    mouseButton?: number,
  ) => void;
  onBoardGridElement?: (element: HTMLElement | null) => void;
  snapTargetCellKeys?: ReadonlySet<string>;
}) {
  const [isShaking, setIsShaking] = React.useState(false);
  const snapTargetCellSet = props.snapTargetCellKeys ?? new Set<string>();

  React.useEffect(() => {
    if (!props.shakeToken) {
      return;
    }
    setIsShaking(true);
    const timeoutId = setTimeout(() => setIsShaking(false), 240);
    return () => clearTimeout(timeoutId);
  }, [props.shakeToken]);

  const snapOutlineStyleForCell = React.useCallback(
    (x: number, y: number) => {
      const hasLeft = snapTargetCellSet.has(cellKey({ x: x - 1, y }));
      const hasRight = snapTargetCellSet.has(cellKey({ x: x + 1, y }));
      const hasUp = snapTargetCellSet.has(cellKey({ x, y: y - 1 }));
      const hasDown = snapTargetCellSet.has(cellKey({ x, y: y + 1 }));
      return {
        borderLeftWidth: hasLeft ? 0 : 2,
        borderRightWidth: hasRight ? 0 : 2,
        borderTopWidth: hasUp ? 0 : 2,
        borderBottomWidth: hasDown ? 0 : 2,
      };
    },
    [snapTargetCellSet],
  );

  const rows = [];
  for (let row = 0; row < props.board.rows; row += 1) {
    const rowStart = row * props.board.columns;
    const rowCells = props.board.cells.slice(rowStart, rowStart + props.board.columns);
    rows.push(
      <View key={row} style={styles.boardRow} testID="pleomino-board-row">
        {rowCells.map((cell) =>
          (() => {
            const isSnapTarget = props.snapTargetCellKeys?.has(cell.key) ?? false;
            return (
              <View
                key={cell.key}
                onMouseDown={
                  cell.state === "placed" && cell.pieceId && cell.instanceId && cell.localCell
                    ? (event) => {
                        const pointer = pointerFromEvent(event);
                        event.preventDefault();
                        const grabbedOffsetPx = grabbedOffsetFromBoardCellEvent(
                          event,
                          cell.localCell!,
                          pointer,
                          props.cellSize,
                        );
                        if (!grabbedOffsetPx) {
                          return;
                        }
                        props.onStartDragPlaced(
                          cell.pieceId!,
                          cell.instanceId!,
                          grabbedOffsetPx,
                          pointer,
                          event.nativeEvent.button,
                        );
                      }
                    : undefined
                }
                onTouchStart={
                  cell.state === "placed" && cell.pieceId && cell.instanceId && cell.localCell
                    ? (event) => {
                        const pointer = pointerFromEvent(event);
                        event.preventDefault();
                        const grabbedOffsetPx = grabbedOffsetFromBoardCellEvent(
                          event,
                          cell.localCell!,
                          pointer,
                          props.cellSize,
                        );
                        if (!grabbedOffsetPx) {
                          return;
                        }
                        props.onStartDragPlaced(
                          cell.pieceId!,
                          cell.instanceId!,
                          grabbedOffsetPx,
                          pointer,
                          event.nativeEvent.button,
                        );
                      }
                    : undefined
                }
                style={[
                  styles.boardCell,
                  { width: props.cellSize, height: props.cellSize },
                  cell.color
                    ? cell.state === "preview"
                      ? [styles.previewCell, { backgroundColor: cell.color }]
                      : { backgroundColor: cell.color }
                    : (cell.x + cell.y) % 2 === 0
                      ? styles.boardCellEmptyA
                      : styles.boardCellEmptyB,
                  isSnapTarget ? styles.snapTargetCell : null,
                  isSnapTarget ? snapOutlineStyleForCell(cell.x, cell.y) : null,
                ]}
                data-cell-x={cell.x}
                data-cell-y={cell.y}
                testID={
                  isSnapTarget
                    ? "pleomino-board-cell-snap-target"
                    : cell.state === "preview"
                      ? "pleomino-board-cell-preview"
                      : "pleomino-board-cell"
                }
              />
            );
          })(),
        )}
      </View>,
    );
  }

  return (
    <View style={[styles.boardCard, isShaking ? styles.boardCardShake : null]}>
      <View
        ref={(element) => props.onBoardGridElement?.(element as HTMLElement | null)}
        style={styles.boardGrid}
        testID="pleomino-board-grid"
      >
        {rows}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  boardCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#89b0de",
    backgroundColor: "#d9e8f7",
    padding: 6,
    boxShadow: "0 10px 18px rgba(56, 104, 168, 0.18)",
  },
  boardCardShake: {
    animationDuration: "240ms",
    animationTimingFunction: "ease-in-out",
    animationKeyframes: {
      "0%": { transform: "translateX(0px)" },
      "20%": { transform: "translateX(-7px)" },
      "40%": { transform: "translateX(7px)" },
      "60%": { transform: "translateX(-5px)" },
      "80%": { transform: "translateX(5px)" },
      "100%": { transform: "translateX(0px)" },
    },
  },
  boardGrid: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "center",
    overflow: "hidden",
    borderRadius: 6,
  },
  boardRow: {
    display: "flex",
    flexDirection: "row",
  },
  boardCell: {
    position: "relative",
  },
  previewCell: {
    opacity: 0.78,
  },
  boardCellEmptyA: {
    backgroundColor: "#cadcf0",
  },
  boardCellEmptyB: {
    backgroundColor: "#bccfe6",
  },
  snapTargetCell: {
    borderColor: "rgba(22, 101, 216, 0.85)",
  },
});
