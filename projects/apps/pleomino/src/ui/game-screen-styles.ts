import { StyleSheet } from "react-native-web";

export const gameScreenStyles = StyleSheet.create({
  page: {
    minHeight: "100vh",
    backgroundColor: "#27446b",
    paddingHorizontal: 2,
    paddingVertical: 5,
    justifyContent: "flex-start",
  },
  playArea: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  toolbarWrap: {
    width: "100%",
    alignItems: "center",
  },
  toolbarWrapStacked: {
    alignItems: "center",
  },
  layout: {
    display: "flex",
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "center",
    gap: 4,
  },
  layoutStacked: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    width: "100%",
  },
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    borderWidth: 0,
  },
  dragOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    pointerEvents: "none",
  },
  dragCell: {
    position: "absolute",
    opacity: 0.88,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.42)",
  },
});
