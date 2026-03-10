import React from "react";
import { StyleSheet, Text, View } from "react-native-web";
import type { PixelPoint, PointerPoint } from "../game/interaction";
import type { PieceTrayViewModel } from "../game/selectors";
import { PieceView } from "./piece-view";

function PieceTrayBase(props: {
  tray: PieceTrayViewModel;
  onStartDrag: (
    pieceId: string,
    pointer: PointerPoint,
    grabbedOffsetPx: PixelPoint | null,
    mouseButton?: number,
  ) => void;
  onEndDrag: (pointer?: PointerPoint | null) => void;
  returnTargetPieceId?: string | null;
}) {
  return (
    <View style={styles.trayCard}>
      <Text style={styles.sectionTitle}>Piece Tray</Text>
      <View style={styles.grid} testID="tangram-piece-tray-grid">
        {props.tray.pieces.map((piece) => (
          <PieceView
            key={piece.pieceId}
            piece={piece}
            isReturnTarget={piece.pieceId === (props.returnTargetPieceId ?? null)}
            onStartDrag={props.onStartDrag}
            onEndDrag={props.onEndDrag}
          />
        ))}
      </View>
    </View>
  );
}

export const PieceTray = React.memo(PieceTrayBase);

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
