import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native-web";
import type { PieceViewModel } from "../game/selectors";

const MINI_CELL_SIZE = 12;

function pieceBounds(cells: readonly { x: number; y: number }[]): {
  columns: number;
  rows: number;
} {
  if (cells.length === 0) {
    return { columns: 1, rows: 1 };
  }
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  return {
    columns: maxX + 1,
    rows: maxY + 1,
  };
}

function pieceStatusText(piece: PieceViewModel): string {
  if (piece.isSelected) {
    return "Selected";
  }
  if (piece.isPlaced) {
    return "Placed";
  }
  return "Tray";
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function shiftHexColor(hexColor: string, delta: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hexColor);
  if (!match) {
    return hexColor;
  }

  const color = match[1];
  const red = parseInt(color.slice(0, 2), 16);
  const green = parseInt(color.slice(2, 4), 16);
  const blue = parseInt(color.slice(4, 6), 16);
  const nextRed = clampColor(red + delta);
  const nextGreen = clampColor(green + delta);
  const nextBlue = clampColor(blue + delta);

  return `#${nextRed.toString(16).padStart(2, "0")}${nextGreen
    .toString(16)
    .padStart(2, "0")}${nextBlue.toString(16).padStart(2, "0")}`;
}

function texturedCellColor(baseColor: string, x: number, y: number): string {
  if ((x + y) % 2 === 0) {
    return baseColor;
  }
  return shiftHexColor(baseColor, baseColor.toLowerCase() === "#000000" ? 18 : -10);
}

export function PieceView(props: {
  piece: PieceViewModel;
  onSelectPiece: (pieceId: string) => void;
}) {
  const bounds = pieceBounds(props.piece.cells);
  const statusText = pieceStatusText(props.piece);

  return (
    <Pressable
      onPress={() => props.onSelectPiece(props.piece.pieceId)}
      style={[styles.card, props.piece.isSelected ? styles.cardSelected : null]}
      testID="tangram-piece-view"
      accessibilityRole="button"
      accessibilityLabel={`Select piece ${props.piece.pieceId}`}
      accessibilityState={{ selected: props.piece.isSelected }}
    >
      <View
        style={[
          styles.sprite,
          {
            width: bounds.columns * MINI_CELL_SIZE,
            height: bounds.rows * MINI_CELL_SIZE,
          },
        ]}
      >
        {props.piece.cells.map((cell) => (
          <View
            key={`${props.piece.pieceId}-${cell.x},${cell.y}`}
            style={[
              styles.spriteCell,
              {
                left: cell.x * MINI_CELL_SIZE,
                top: cell.y * MINI_CELL_SIZE,
                backgroundColor: texturedCellColor(props.piece.color, cell.x, cell.y),
              },
            ]}
          />
        ))}
      </View>
      <Text style={styles.pieceId} testID={`tangram-piece-id-${props.piece.pieceId}`}>
        {props.piece.pieceId}
      </Text>
      <Text style={styles.pieceMeta} testID={`tangram-piece-status-${props.piece.pieceId}`}>
        {statusText}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d7dee7",
    backgroundColor: "#f8fafc",
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
    minWidth: 180,
  },
  cardSelected: {
    borderColor: "#1d4ed8",
    backgroundColor: "#dbeafe",
  },
  sprite: {
    position: "relative",
  },
  spriteCell: {
    position: "absolute",
    width: MINI_CELL_SIZE,
    height: MINI_CELL_SIZE,
  },
  pieceId: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "600",
  },
  pieceMeta: {
    color: "#334155",
    fontSize: 12,
  },
});
