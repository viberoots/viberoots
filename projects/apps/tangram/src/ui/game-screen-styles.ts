import { StyleSheet } from "react-native-web";
import { BOARD_CELL_SIZE } from "../game/board";

export const gameScreenStyles = StyleSheet.create({
  page: {
    minHeight: "100vh",
    backgroundColor: "#f5efe4",
    padding: 20,
    gap: 14,
  },
  headerCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#c8b58f",
    backgroundColor: "#fffaf0",
    padding: 16,
    gap: 6,
  },
  title: {
    color: "#362718",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  subtitle: {
    color: "#594325",
    fontSize: 13,
  },
  actionRow: {
    display: "flex",
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 6,
  },
  actionButton: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  actionButtonDefault: {
    borderColor: "#8f7754",
    backgroundColor: "#ead9bb",
  },
  actionButtonDanger: {
    borderColor: "#8e3528",
    backgroundColor: "#f5c3ae",
  },
  actionButtonText: {
    color: "#2e2116",
    fontSize: 12,
    fontWeight: "700",
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#c8b58f",
    backgroundColor: "#fffaf0",
    gap: 4,
  },
  statusText: {
    color: "#5b4327",
    fontSize: 13,
  },
  solvedText: {
    color: "#166534",
    fontWeight: "700",
  },
  dragOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    pointerEvents: "none",
  },
  dragCell: {
    position: "absolute",
    width: BOARD_CELL_SIZE,
    height: BOARD_CELL_SIZE,
    opacity: 0.8,
  },
});
