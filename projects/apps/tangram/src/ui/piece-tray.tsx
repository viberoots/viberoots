import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native-web";
import type { PixelPoint, PointerPoint } from "../game/interaction";
import type { PieceTrayViewModel } from "../game/selectors";
import { pieceBounds } from "./piece-view-helpers";
import { PieceView } from "./piece-view";

const STACKED_COLUMNS = 4;
const DESKTOP_COLUMNS = 2;
const DESKTOP_COLUMN_GAP = 18;
const STACKED_COLUMN_GAP = 8;
const BASE_TRAY_HORIZONTAL_PADDING = 12;
const STACKED_TRAY_HORIZONTAL_PADDING = 8;

function orderedTrayPieces(
  pieces: readonly PieceTrayViewModel["pieces"][number][],
  isStacked: boolean,
): PieceTrayViewModel["pieces"] {
  const pieceById = new Map(pieces.map((piece) => [piece.pieceId, piece]));
  const orderedIds = isStacked
    ? [
        "purple-2-1",
        "green-2-2",
        "yellow-1-2-1",
        "black-1-1-1-1",
        "red-2-2",
        "blue-3-1",
        "orange-2-1-2",
        "white-1-1",
      ]
    : [
        "purple-2-1",
        "red-2-2",
        "black-1-1-1-1",
        "green-2-2",
        "yellow-1-2-1",
        "blue-3-1",
        "orange-2-1-2",
        "white-1-1",
      ];
  const ordered: PieceTrayViewModel["pieces"] = [];
  for (const pieceId of orderedIds) {
    const piece = pieceById.get(pieceId);
    if (piece) {
      ordered.push(piece);
      pieceById.delete(pieceId);
    }
  }
  for (const piece of pieces) {
    if (pieceById.has(piece.pieceId)) {
      ordered.push(piece);
    }
  }
  return ordered;
}

function buildBalancedRows(
  pieces: readonly PieceTrayViewModel["pieces"][number][],
  columnCount: number,
): PieceTrayViewModel["pieces"][] {
  if (pieces.length === 0) {
    return [];
  }
  const widthByPieceId = new Map<string, number>();
  for (const piece of pieces) {
    widthByPieceId.set(piece.pieceId, pieceBounds(piece.cells).columns);
  }
  const sortedPieces = [...pieces].sort((left, right) => {
    const leftWidth = widthByPieceId.get(left.pieceId) ?? 0;
    const rightWidth = widthByPieceId.get(right.pieceId) ?? 0;
    if (leftWidth !== rightWidth) {
      return rightWidth - leftWidth;
    }
    return left.pieceId.localeCompare(right.pieceId);
  });
  const rowCount = Math.max(1, Math.ceil(pieces.length / columnCount));
  const rows: PieceTrayViewModel["pieces"][] = Array.from({ length: rowCount }, () => []);
  const rowWidths = Array.from({ length: rowCount }, () => 0);
  for (const piece of sortedPieces) {
    const width = widthByPieceId.get(piece.pieceId) ?? 0;
    let targetRow = -1;
    let bestWidth = Number.POSITIVE_INFINITY;
    let bestLength = Number.POSITIVE_INFINITY;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      if (rows[rowIndex].length >= columnCount) {
        continue;
      }
      const rowWidth = rowWidths[rowIndex];
      if (
        rowWidth < bestWidth ||
        (rowWidth === bestWidth && rows[rowIndex].length < bestLength) ||
        targetRow === -1
      ) {
        targetRow = rowIndex;
        bestWidth = rowWidth;
        bestLength = rows[rowIndex].length;
      }
    }
    if (targetRow === -1) {
      continue;
    }
    rows[targetRow].push(piece);
    rowWidths[targetRow] += width;
  }
  return rows.filter((row) => row.length > 0);
}

function buildDesktopRows(
  pieces: readonly PieceTrayViewModel["pieces"][number][],
): PieceTrayViewModel["pieces"][] {
  const pieceById = new Map(pieces.map((piece) => [piece.pieceId, piece]));
  const take = (pieceId: string): PieceTrayViewModel["pieces"][number] | null => {
    const piece = pieceById.get(pieceId);
    if (!piece) {
      return null;
    }
    pieceById.delete(pieceId);
    return piece;
  };
  const rows: PieceTrayViewModel["pieces"][] = [];
  const addRow = (pieceIds: readonly string[]) => {
    const row = pieceIds
      .map((pieceId) => take(pieceId))
      .filter((piece) => piece !== null) as PieceTrayViewModel["pieces"];
    if (row.length > 0) {
      rows.push(row);
    }
  };
  const blackPiece = pieceById.get("black-1-1-1-1");
  const blackBounds = blackPiece ? pieceBounds(blackPiece.cells) : null;
  const isBlackVertical = blackBounds !== null ? blackBounds.rows > blackBounds.columns : false;
  addRow(["purple-2-1", "red-2-2"]);
  addRow(isBlackVertical ? ["black-1-1-1-1", "orange-2-1-2"] : ["black-1-1-1-1"]);
  if (!isBlackVertical) {
    addRow(["orange-2-1-2"]);
  }
  addRow(["yellow-1-2-1", "blue-3-1"]);
  addRow(["green-2-2", "white-1-1"]);
  for (const piece of pieces) {
    if (pieceById.has(piece.pieceId)) {
      rows.push([piece]);
      pieceById.delete(piece.pieceId);
    }
  }
  return rows;
}

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
        testID="tangram-action-reset"
      >
        <Text style={styles.resetButtonText}>↺</Text>
      </Pressable>
      <View
        style={props.isStacked ? styles.stackedRows : styles.desktopRows}
        testID="tangram-piece-tray-grid"
      >
        {rows.map((row, index) => (
          <View
            key={`tray-row-${index}`}
            style={props.isStacked ? styles.stackedRow : styles.desktopRow}
            testID={`tangram-piece-tray-row-${row.length}`}
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
