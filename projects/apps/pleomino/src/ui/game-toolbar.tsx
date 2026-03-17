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
  const failed = props.solveState === "unsolved";
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
      icon: failed ? "✕" : "◈",
      label: solving ? "Solving" : failed ? "Solve failed" : "Solve",
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
          style={({ pressed }) => [
            styles.button,
            action.key === "solve" && failed ? styles.buttonFailed : null,
            pressed && !action.disabled ? styles.buttonPressed : null,
            action.disabled ? styles.buttonDisabled : null,
          ]}
          onPress={action.onPress}
          disabled={action.disabled}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          testID={action.testId}
        >
          <Text style={styles.buttonIcon}>{action.icon}</Text>
        </Pressable>
      ))}
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
    alignSelf: "center",
  },
  rowStacked: {
    alignSelf: "center",
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#6e90bf",
    backgroundColor: "#325786",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.42,
  },
  buttonFailed: {
    borderColor: "#d97979",
    backgroundColor: "#8f3d3d",
  },
  buttonPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: "#274d77",
    borderColor: "#8bb3e6",
  },
  buttonIcon: {
    color: "#eef5ff",
    fontSize: 20,
    lineHeight: 20,
    fontWeight: "700",
  },
});
