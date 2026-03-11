import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native-web";

type ToolbarAction = {
  key: "reset" | "undo" | "redo" | "solve";
  icon: string;
  label: string;
  testId: string;
  disabled?: boolean;
  onPress: () => void;
};

export type ToolbarSolveState = "idle" | "solving" | "solved-applied" | "unsolved";

function solveStatusLabel(state: ToolbarSolveState): string {
  switch (state) {
    case "solving":
      return "Solving";
    case "solved-applied":
      return "Solved";
    case "unsolved":
      return "Unsolved";
    default:
      return "Idle";
  }
}

function GameToolbarBase(props: {
  isStacked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canSolve: boolean;
  solveState: ToolbarSolveState;
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSolve: () => void;
}) {
  const solving = props.solveState === "solving";
  const actions: ToolbarAction[] = [
    {
      key: "reset",
      icon: "↺",
      label: "Reset board",
      testId: "pleomino-action-reset",
      onPress: props.onReset,
    },
    {
      key: "undo",
      icon: "↶",
      label: "Undo",
      testId: "pleomino-action-undo",
      disabled: !props.canUndo,
      onPress: props.onUndo,
    },
    {
      key: "redo",
      icon: "↷",
      label: "Redo",
      testId: "pleomino-action-redo",
      disabled: !props.canRedo,
      onPress: props.onRedo,
    },
    {
      key: "solve",
      icon: "◈",
      label: solving ? "Solving" : "Solve",
      testId: "pleomino-action-solve",
      disabled: !props.canSolve || solving,
      onPress: props.onSolve,
    },
  ];

  return (
    <View
      style={[styles.row, props.isStacked ? styles.rowStacked : styles.rowDesktop]}
      testID="pleomino-game-toolbar"
      data-layout={props.isStacked ? "stacked" : "desktop"}
      data-solve-state={props.solveState}
    >
      {actions.map((action) => (
        <Pressable
          key={action.key}
          style={[styles.button, action.disabled ? styles.buttonDisabled : null]}
          onPress={action.onPress}
          disabled={action.disabled}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          testID={action.testId}
        >
          <Text style={styles.buttonIcon}>{action.icon}</Text>
        </Pressable>
      ))}
      <View
        style={[
          styles.solveStateChip,
          props.solveState === "solving"
            ? styles.solveStateChipSolving
            : props.solveState === "solved-applied"
              ? styles.solveStateChipSolved
              : props.solveState === "unsolved"
                ? styles.solveStateChipUnsolved
                : null,
        ]}
        testID="pleomino-solve-state"
        accessibilityRole="status"
        accessibilityLabel={`Solve state: ${solveStatusLabel(props.solveState)}`}
      >
        <Text style={styles.solveStateText}>{solveStatusLabel(props.solveState)}</Text>
      </View>
    </View>
  );
}

export const GameToolbar = React.memo(GameToolbarBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#5f83b3",
    backgroundColor: "rgba(25, 52, 86, 0.92)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  rowDesktop: {
    alignSelf: "flex-end",
  },
  rowStacked: {
    alignSelf: "center",
  },
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#6e90bf",
    backgroundColor: "#325786",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.42,
  },
  buttonIcon: {
    color: "#eef5ff",
    fontSize: 18,
    lineHeight: 18,
    fontWeight: "700",
  },
  solveStateChip: {
    marginLeft: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#6e90bf",
    backgroundColor: "#325786",
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 62,
    alignItems: "center",
  },
  solveStateChipSolving: {
    backgroundColor: "#2e67a8",
  },
  solveStateChipSolved: {
    backgroundColor: "#2f7f45",
  },
  solveStateChipUnsolved: {
    backgroundColor: "#87443d",
  },
  solveStateText: {
    color: "#eef5ff",
    fontSize: 11,
    lineHeight: 12,
    fontWeight: "600",
  },
});
