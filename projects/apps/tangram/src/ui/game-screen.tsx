import React from "react";
import { StyleSheet, Text, View } from "react-native-web";
import { tangramGameReducer } from "../game/reducer";
import { selectGameViewModel } from "../game/selectors";
import { createInitialGameState } from "../game/state";
import { BoardGrid } from "./board-grid";
import { PieceTray } from "./piece-tray";
import { Toolbar } from "./toolbar";

export function GameScreen(props: { url: string }) {
  const [state, dispatch] = React.useReducer(tangramGameReducer, undefined, createInitialGameState);
  const viewModel = React.useMemo(() => selectGameViewModel(state), [state]);

  const handleSelectPiece = React.useCallback((pieceId: string) => {
    dispatch({ type: "piece/select", pieceId });
  }, []);

  const handlePreviewSelected = React.useCallback(() => {
    if (!viewModel.toolbar.selectedPieceId) {
      return;
    }
    dispatch({
      type: "piece/preview",
      pieceId: viewModel.toolbar.selectedPieceId,
      position: { x: 0, y: 0 },
    });
  }, [viewModel.toolbar.selectedPieceId]);

  const handleCommitSelected = React.useCallback(() => {
    if (!viewModel.toolbar.selectedPieceId) {
      return;
    }
    dispatch({ type: "piece/commit", pieceId: viewModel.toolbar.selectedPieceId });
  }, [viewModel.toolbar.selectedPieceId]);

  const handleRevertSelected = React.useCallback(() => {
    if (!viewModel.toolbar.selectedPieceId) {
      return;
    }
    dispatch({ type: "piece/revert", pieceId: viewModel.toolbar.selectedPieceId });
  }, [viewModel.toolbar.selectedPieceId]);

  const handleResetBoard = React.useCallback(() => {
    dispatch({ type: "board/reset" });
  }, []);

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Tangram Sandbox</Text>
      <Text style={styles.subtitle}>SSR route: {props.url}</Text>

      <Toolbar
        toolbar={viewModel.toolbar}
        onPreviewSelected={handlePreviewSelected}
        onCommitSelected={handleCommitSelected}
        onRevertSelected={handleRevertSelected}
        onResetBoard={handleResetBoard}
      />

      <View style={styles.layout}>
        <BoardGrid board={viewModel.board} />
        <PieceTray tray={viewModel.tray} onSelectPiece={handleSelectPiece} />
      </View>

      <View style={styles.statusCard} testID="tangram-status-card">
        <Text style={styles.statusText}>Catalog pieces: {viewModel.status.catalogPieceCount}</Text>
        <Text style={styles.statusText}>Placed pieces: {viewModel.status.placedPieceCount}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    minHeight: "100vh",
    backgroundColor: "#f8fafc",
    padding: 20,
    gap: 12,
  },
  title: {
    color: "#0f172a",
    fontSize: 30,
    fontWeight: "700",
  },
  subtitle: {
    color: "#334155",
    fontSize: 14,
  },
  layout: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "flex-start",
  },
  statusCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#94a3b8",
    backgroundColor: "#ffffff",
    gap: 4,
  },
  statusText: {
    color: "#334155",
    fontSize: 13,
  },
});
