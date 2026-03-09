import React from "react";
import { StyleSheet, Text, View } from "react-native-web";
import { BOARD_COLUMNS, BOARD_ROWS } from "../game/board";
import { createInitialGameState } from "../game/state";

const boardRows = Array.from({ length: BOARD_ROWS }, (_, row) => row);
const boardColumns = Array.from({ length: BOARD_COLUMNS }, (_, column) => column);
const CELL_SIZE = 32;
const GRID_LINE_WIDTH = 1;
const CELL_CONTENT_SIZE = CELL_SIZE - GRID_LINE_WIDTH;

export function GameShell(props: { url: string }) {
  const gameState = createInitialGameState();

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Tangram Sandbox</Text>
      <Text style={styles.subtitle}>SSR route: {props.url}</Text>

      <View style={styles.layout}>
        <View style={styles.boardCard}>
          <Text style={styles.sectionTitle}>
            Board ({BOARD_COLUMNS}x{BOARD_ROWS})
          </Text>
          <View style={styles.boardGrid} testID="tangram-board-grid">
            {boardRows.map((row) => (
              <View key={row} style={styles.boardRow} testID="tangram-board-row">
                {boardColumns.map((column) => (
                  <View
                    key={`${row}-${column}`}
                    style={[
                      styles.boardCell,
                      column < BOARD_COLUMNS - 1 ? styles.boardCellDividerRight : null,
                      row < BOARD_ROWS - 1 ? styles.boardCellDividerBottom : null,
                    ]}
                    testID="tangram-board-cell"
                  />
                ))}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.trayCard}>
          <Text style={styles.sectionTitle}>Piece Tray</Text>
          <Text style={styles.trayText}>Catalog loading in PR-2.</Text>
          <Text style={styles.trayText}>Placed pieces: {gameState.board.placedPieces.length}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    minHeight: "100vh",
    backgroundColor: "#f8fafc",
    padding: 20,
    gap: 10,
  },
  title: {
    color: "#0f172a",
    fontSize: 30,
    fontWeight: "700",
  },
  subtitle: {
    color: "#334155",
    fontSize: 14,
    marginBottom: 6,
  },
  layout: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "flex-start",
  },
  boardCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#94a3b8",
    backgroundColor: "#ffffff",
    minWidth: 360,
  },
  trayCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#94a3b8",
    backgroundColor: "#ffffff",
    minWidth: 220,
    gap: 8,
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
  trayText: {
    color: "#334155",
    fontSize: 13,
  },
});
