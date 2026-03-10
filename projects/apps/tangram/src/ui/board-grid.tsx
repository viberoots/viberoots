import React from "react";
import { StyleSheet, Text, View } from "react-native-web";
import type { BoardViewModel } from "../game/selectors";

const CELL_SIZE = 32;
const GRID_LINE_WIDTH = 1;
const CELL_CONTENT_SIZE = CELL_SIZE - GRID_LINE_WIDTH;

export function BoardGrid(props: { board: BoardViewModel }) {
  const rows = [];
  for (let row = 0; row < props.board.rows; row += 1) {
    const rowStart = row * props.board.columns;
    const rowCells = props.board.cells.slice(rowStart, rowStart + props.board.columns);
    rows.push(
      <View key={row} style={styles.boardRow} testID="tangram-board-row">
        {rowCells.map((cell, column) => (
          <View
            key={cell.key}
            style={[
              styles.boardCell,
              column < props.board.columns - 1 ? styles.boardCellDividerRight : null,
              row < props.board.rows - 1 ? styles.boardCellDividerBottom : null,
              cell.color ? { backgroundColor: cell.color } : styles.boardCellEmpty,
            ]}
            testID="tangram-board-cell"
          />
        ))}
      </View>,
    );
  }

  return (
    <View style={styles.boardCard}>
      <Text style={styles.sectionTitle}>
        Board ({props.board.columns}x{props.board.rows})
      </Text>
      <View style={styles.boardGrid} testID="tangram-board-grid">
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
    borderWidth: GRID_LINE_WIDTH,
    borderColor: "#cbd5e1",
  },
  boardRow: {
    display: "flex",
    flexDirection: "row",
  },
  boardCell: {
    width: CELL_CONTENT_SIZE,
    height: CELL_CONTENT_SIZE,
  },
  boardCellEmpty: {
    backgroundColor: "#f1f5f9",
  },
  boardCellDividerRight: {
    borderRightWidth: GRID_LINE_WIDTH,
    borderColor: "#e2e8f0",
  },
  boardCellDividerBottom: {
    borderBottomWidth: GRID_LINE_WIDTH,
    borderColor: "#e2e8f0",
  },
});
