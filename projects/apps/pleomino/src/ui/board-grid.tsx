import React from "react";
import { ActivityIndicator, View } from "react-native-web";
import type { BoardViewModel } from "../game/selectors";
import type { PixelPoint } from "../game/interaction";
import { cellKey } from "../game/placement";
import { grabbedOffsetFromBoardCellEvent, pointerFromBoardEvent } from "./board-grid-drag";
import { boardGridStyles as styles } from "./board-grid-styles";

export function BoardGrid(props: {
  board: BoardViewModel;
  cellSize: number;
  shakeToken?: number;
  failureFeedbackToken?: number;
  showSolveOverlay?: boolean;
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
  const [isFailureFlashing, setIsFailureFlashing] = React.useState(false);
  const snapTargetCellSet = props.snapTargetCellKeys ?? new Set<string>();

  React.useEffect(() => {
    if (!props.shakeToken) {
      return;
    }
    setIsShaking(true);
    const timeoutId = setTimeout(() => setIsShaking(false), 240);
    return () => clearTimeout(timeoutId);
  }, [props.shakeToken]);

  React.useEffect(() => {
    if (!props.failureFeedbackToken) {
      return;
    }
    setIsShaking(true);
    setIsFailureFlashing(true);
    const shakeTimeoutId = setTimeout(() => setIsShaking(false), 240);
    const flashTimeoutId = setTimeout(() => setIsFailureFlashing(false), 720);
    return () => {
      clearTimeout(shakeTimeoutId);
      clearTimeout(flashTimeoutId);
    };
  }, [props.failureFeedbackToken]);

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
                        const pointer = pointerFromBoardEvent(event);
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
                        const pointer = pointerFromBoardEvent(event);
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
    <View
      style={[
        styles.boardCard,
        isShaking ? styles.boardCardShake : null,
        isFailureFlashing ? styles.boardCardFailure : null,
      ]}
      testID="pleomino-board-card"
    >
      {isFailureFlashing ? (
        <View style={styles.failureMarker} testID="pleomino-board-failure-flash" />
      ) : null}
      {props.showSolveOverlay ? (
        <View style={styles.solveOverlay} testID="pleomino-solve-overlay">
          <View style={styles.solveOverlaySpinner}>
            <ActivityIndicator color="#eef5ff" size="large" />
          </View>
        </View>
      ) : null}
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
