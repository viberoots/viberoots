import { StyleSheet } from "react-native-web";

export const gameScreenStyles = StyleSheet.create({
  page: {
    minHeight: "100vh",
    backgroundColor: "#27446b",
    paddingHorizontal: 2,
    paddingVertical: 2,
    justifyContent: "flex-start",
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
  orientationLockCard: {
    marginTop: 48,
    alignSelf: "center",
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#3f5f8c",
    backgroundColor: "#27446b",
    paddingHorizontal: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  orientationLockTitle: {
    color: "#eef5ff",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "700",
    textAlign: "center",
  },
  orientationLockSubtitle: {
    marginTop: 8,
    color: "#cde1ff",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
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
