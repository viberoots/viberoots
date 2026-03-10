import React from "react";
import { StyleSheet, Text, View } from "react-native-web";
import { BOARD_CELL_SIZE } from "../game/board";
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
): PixelPoint | null {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const rect = target.getBoundingClientRect();
  const localInCellX = pointer.pageX - (rect.left + window.scrollX);
  const localInCellY = pointer.pageY - (rect.top + window.scrollY);
  return {
    x: localCell.x * BOARD_CELL_SIZE + localInCellX,
    y: localCell.y * BOARD_CELL_SIZE + localInCellY,
  };
}

export function BoardGrid(props: {
  board: BoardViewModel;
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
  const snapTargetCellSet = props.snapTargetCellKeys ?? new Set<string>();

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
      <View key={row} style={styles.boardRow} testID="tangram-board-row">
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
                        const grabbedOffsetPx = grabbedOffsetFromBoardCellEvent(
                          event,
                          cell.localCell!,
                          pointer,
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
                        const grabbedOffsetPx = grabbedOffsetFromBoardCellEvent(
                          event,
                          cell.localCell!,
                          pointer,
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
                    ? "tangram-board-cell-snap-target"
                    : cell.state === "preview"
                      ? "tangram-board-cell-preview"
                      : "tangram-board-cell"
                }
              />
            );
          })(),
        )}
      </View>,
    );
  }

  return (
    <View style={styles.boardCard}>
      <Text style={styles.sectionTitle}>
        Board ({props.board.columns}x{props.board.rows})
      </Text>
      <View
        ref={(element) => props.onBoardGridElement?.(element as HTMLElement | null)}
        style={styles.boardGrid}
        testID="tangram-board-grid"
      >
        {rows}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  boardCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#94a3b8",
    backgroundColor: "#ffffff",
    minWidth: 360,
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  boardGrid: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: 6,
  },
  boardRow: {
    display: "flex",
    flexDirection: "row",
  },
  boardCell: {
    width: BOARD_CELL_SIZE,
    height: BOARD_CELL_SIZE,
  },
  previewCell: {
    opacity: 0.55,
  },
  boardCellEmptyA: {
    backgroundColor: "#e8d5b6",
  },
  boardCellEmptyB: {
    backgroundColor: "#e3cfad",
  },
  snapTargetCell: {
    borderColor: "rgba(255, 255, 255, 0.9)",
  },
});
