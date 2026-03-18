import { StyleSheet } from "react-native-web";

export const boardGridStyles = StyleSheet.create({
  boardCard: {
    position: "relative",
    borderRadius: 24,
    backgroundColor: "#d9e8f7",
    padding: 8,
    overflow: "hidden",
    boxShadow: "0 10px 18px rgba(56, 104, 168, 0.18)",
  },
  boardCardShake: {
    animationDuration: "240ms",
    animationTimingFunction: "ease-in-out",
    animationKeyframes: {
      "0%": { transform: "translateX(0px)" },
      "20%": { transform: "translateX(-7px)" },
      "40%": { transform: "translateX(7px)" },
      "60%": { transform: "translateX(-5px)" },
      "80%": { transform: "translateX(5px)" },
      "100%": { transform: "translateX(0px)" },
    },
  },
  boardCardFailure: {
    boxShadow: "0 0 0 2px rgba(207, 107, 107, 0.38), 0 10px 18px rgba(133, 54, 54, 0.24)",
  },
  boardGrid: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "center",
    overflow: "visible",
  },
  solveOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2,
    borderRadius: 24,
    backgroundColor: "rgba(76, 87, 102, 0.38)",
    alignItems: "center",
    justifyContent: "center",
  },
  solveOverlaySpinner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
    backgroundColor: "rgba(32, 43, 60, 0.52)",
    alignItems: "center",
    justifyContent: "center",
  },
  failureMarker: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  boardRow: {
    display: "flex",
    flexDirection: "row",
  },
  boardCell: {
    position: "relative",
  },
  previewCell: {
    opacity: 0.78,
  },
  boardCellEmptyA: {
    backgroundColor: "#cadcf0",
  },
  boardCellEmptyB: {
    backgroundColor: "#bccfe6",
  },
  snapTargetCell: {
    borderColor: "rgba(22, 101, 216, 0.85)",
  },
});
