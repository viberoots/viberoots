#!/usr/bin/env zx-wrapper
import { getFlagBool } from "../lib/cli";

export type DeployControlPlaneOperatorAction =
  | "status"
  | "record"
  | "current-stage-state"
  | "stage-history"
  | "stage-state-audit"
  | "print-run-lock-scope"
  | "approve"
  | "cancel-run"
  | "resume-run"
  | "abort-run";

export function selectedDeployControlPlaneOperatorAction():
  | DeployControlPlaneOperatorAction
  | undefined {
  const selected = (
    [
      ["status", getFlagBool("status")],
      ["record", getFlagBool("record")],
      ["current-stage-state", getFlagBool("current-stage-state")],
      ["stage-history", getFlagBool("stage-history")],
      ["stage-state-audit", getFlagBool("stage-state-audit")],
      ["print-run-lock-scope", getFlagBool("print-run-lock-scope")],
      ["approve", getFlagBool("approve")],
      ["cancel-run", getFlagBool("cancel-run")],
      ["resume-run", getFlagBool("resume-run")],
      ["abort-run", getFlagBool("abort-run")],
    ] as const
  )
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  if (selected.length > 1) {
    throw new Error(
      `control-plane operator helpers are mutually exclusive; choose one of ${selected.map((name) => `--${name}`).join(", ")}`,
    );
  }
  return selected[0];
}
