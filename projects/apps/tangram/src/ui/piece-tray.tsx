import React from "react";
import { StyleSheet, Text, View } from "react-native-web";
import type { PieceTrayViewModel } from "../game/selectors";
import { PieceView } from "./piece-view";

export function PieceTray(props: {
  tray: PieceTrayViewModel;
  onSelectPiece: (pieceId: string) => void;
}) {
  return (
    <View style={styles.trayCard}>
      <Text style={styles.sectionTitle}>Piece Tray</Text>
      <View style={styles.grid} testID="tangram-piece-tray-grid">
        {props.tray.pieces.map((piece) => (
          <PieceView key={piece.pieceId} piece={piece} onSelectPiece={props.onSelectPiece} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trayCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#94a3b8",
    backgroundColor: "#ffffff",
    minWidth: 240,
    gap: 8,
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  grid: {
    gap: 8,
  },
});
