import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native-web";
import type { PixelPoint, PointerPoint } from "../game/interaction";
import type { PieceTrayViewModel } from "../game/selectors";
import { pieceBounds } from "./piece-view-helpers";
import { PieceView } from "./piece-view";
import {
  BASE_TRAY_HORIZONTAL_PADDING,
  buildBalancedRows,
  buildDesktopRows,
  DESKTOP_COLUMN_GAP,
  orderedTrayPieces,
  STACKED_COLUMN_GAP,
  STACKED_COLUMNS,
  STACKED_TRAY_HORIZONTAL_PADDING,
} from "./piece-tray-layout";

function PieceTrayBase(props: {
  tray: PieceTrayViewModel;
  isStacked: boolean;
  cellSize: number;
  trayWidth: number | string;
  onStartDrag: (
    pieceId: string,
    pointer: PointerPoint,
    grabbedOffsetPx: PixelPoint | null,
    mouseButton?: number,
  ) => void;
  onEndDrag: (pointer?: PointerPoint | null, source?: "piece" | "global") => void;
  returnTargetPieceId?: string | null;
  onResetBoard: () => void;
}) {
  const rows = React.useMemo(() => {
    const ordered = orderedTrayPieces(props.tray.pieces, props.isStacked);
    if (props.isStacked) {
      return buildBalancedRows(ordered, STACKED_COLUMNS);
    }
    return buildDesktopRows(ordered);
  }, [props.isStacked, props.tray.pieces]);
  const rowContentMaxWidth = React.useMemo(() => {
    const columnGap = props.isStacked ? STACKED_COLUMN_GAP : DESKTOP_COLUMN_GAP;
    let maxWidth = 0;
    for (const row of rows) {
      const pieceWidth = row.reduce(
        (total, piece) => total + pieceBounds(piece.cells).columns * props.cellSize,
        0,
      );
      const rowWidth = pieceWidth + Math.max(0, row.length - 1) * columnGap;
      if (rowWidth > maxWidth) {
        maxWidth = rowWidth;
      }
    }
    return maxWidth;
  }, [props.cellSize, props.isStacked, rows]);
  const resolvedTrayWidth = React.useMemo(() => {
    if (props.isStacked || typeof props.trayWidth !== "number") {
      return props.trayWidth;
    }
    return Math.max(props.trayWidth, rowContentMaxWidth + BASE_TRAY_HORIZONTAL_PADDING);
  }, [props.isStacked, props.trayWidth, rowContentMaxWidth]);

  const renderPiece = (piece: PieceTrayViewModel["pieces"][number]) => (
    <PieceView
      key={piece.pieceId}
      piece={piece}
      cellSize={props.cellSize}
      isReturnTarget={piece.pieceId === (props.returnTargetPieceId ?? null)}
      onStartDrag={props.onStartDrag}
      onEndDrag={props.onEndDrag}
    />
  );
  return (
    <View
      style={[
        styles.trayCard,
        props.isStacked ? styles.trayCardStacked : null,
        {
          width: resolvedTrayWidth,
          minWidth: props.isStacked
            ? rowContentMaxWidth + STACKED_TRAY_HORIZONTAL_PADDING
            : rowContentMaxWidth + BASE_TRAY_HORIZONTAL_PADDING,
          maxWidth: "100%",
        },
      ]}
    >
      <Pressable
        style={[styles.resetButton, props.isStacked ? styles.resetButtonStacked : null]}
        onPress={props.onResetBoard}
        accessibilityRole="button"
        accessibilityLabel="Reset board"
        testID="pleomino-action-reset"
      >
        <Text style={styles.resetButtonText}>↺</Text>
      </Pressable>
      <View
        style={props.isStacked ? styles.stackedRows : styles.desktopRows}
        testID="pleomino-piece-tray-grid"
      >
        {rows.map((row, index) => (
          <View
            key={`tray-row-${index}`}
            style={props.isStacked ? styles.stackedRow : styles.desktopRow}
            testID={`pleomino-piece-tray-row-${row.length}`}
          >
            {row.map(renderPiece)}
          </View>
        ))}
      </View>
    </View>
  );
}

export const PieceTray = React.memo(PieceTrayBase);

const styles = StyleSheet.create({
  trayCard: {
    width: 180,
    paddingHorizontal: 6,
    gap: 10,
    overflow: "visible",
  },
  trayCardStacked: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    gap: 10,
  },
  resetButton: {
    alignSelf: "flex-end",
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#6e90bf",
    backgroundColor: "#325786",
    alignItems: "center",
    justifyContent: "center",
  },
  resetButtonStacked: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  resetButtonText: {
    color: "#eef5ff",
    fontSize: 18,
    lineHeight: 18,
    fontWeight: "700",
  },
  desktopRows: {
    display: "flex",
    flexDirection: "column",
    rowGap: 20,
    overflow: "visible",
  },
  desktopRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    columnGap: DESKTOP_COLUMN_GAP,
    overflow: "visible",
  },
  stackedRows: {
    display: "flex",
    flexDirection: "column",
    rowGap: 14,
    overflow: "visible",
  },
  stackedRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
    columnGap: STACKED_COLUMN_GAP,
    overflow: "visible",
  },
});
