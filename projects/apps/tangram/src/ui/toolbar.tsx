import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native-web";
import type { ToolbarViewModel } from "../game/selectors";

function ActionButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={[styles.button, props.disabled ? styles.buttonDisabled : null]}
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(props.disabled) }}
    >
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

export function Toolbar(props: {
  toolbar: ToolbarViewModel;
  onPreviewSelected: () => void;
  onCommitSelected: () => void;
  onRevertSelected: () => void;
  onResetBoard: () => void;
}) {
  return (
    <View style={styles.toolbarCard}>
      <Text style={styles.title}>Toolbar</Text>
      <Text style={styles.status}>Selected piece: {props.toolbar.selectedPieceId ?? "none"}</Text>
      <View style={styles.actions}>
        <ActionButton
          label="Preview @ 0,0"
          onPress={props.onPreviewSelected}
          disabled={!props.toolbar.canPreviewSelected}
          testID="tangram-toolbar-preview"
        />
        <ActionButton
          label="Commit Placement"
          onPress={props.onCommitSelected}
          disabled={!props.toolbar.canCommitSelected}
          testID="tangram-toolbar-commit"
        />
        <ActionButton
          label="Revert Placement"
          onPress={props.onRevertSelected}
          disabled={!props.toolbar.canRevertSelected}
          testID="tangram-toolbar-revert"
        />
        <ActionButton
          label="Rotate (PR-5)"
          onPress={() => {}}
          disabled={true}
          testID="tangram-toolbar-rotate"
        />
        <ActionButton
          label="Flip (PR-5)"
          onPress={() => {}}
          disabled={true}
          testID="tangram-toolbar-flip"
        />
        <ActionButton
          label="Reset Board"
          onPress={props.onResetBoard}
          testID="tangram-toolbar-reset"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbarCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#94a3b8",
    backgroundColor: "#ffffff",
    gap: 8,
  },
  title: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "600",
  },
  status: {
    color: "#334155",
    fontSize: 13,
  },
  actions: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "600",
  },
});
