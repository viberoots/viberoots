import React from "react";
import { StyleSheet, Text, View } from "react-native-web";
import type { BoardViewModel } from "../game/selectors";

const CELL_SIZE = 32;

export function BoardGrid(props: { board: BoardViewModel }) {
  const rows = [];
  for (let row = 0; row < props.board.rows; row += 1) {
    const rowStart = row * props.board.columns;
    const rowCells = props.board.cells.slice(rowStart, rowStart + props.board.columns);
    rows.push(
      <View key={row} style={styles.boardRow} testID="tangram-board-row">
        {rowCells.map((cell) => (
          <View
            key={cell.key}
            style={[
              styles.boardCell,
              cell.color
                ? { backgroundColor: cell.color }
                : (cell.x + cell.y) % 2 === 0
                  ? styles.boardCellEmptyA
                  : styles.boardCellEmptyB,
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
    borderRadius: 6,
  },
  boardRow: {
    display: "flex",
    flexDirection: "row",
  },
  boardCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
  },
  boardCellEmptyA: {
    backgroundColor: "#e8d5b6",
  },
  boardCellEmptyB: {
    backgroundColor: "#e3cfad",
  },
});
