#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { DeploymentCurrentStageState } from "./deployment-current-stage-state-types";

function pathPart(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

export function stageStateBackupPath(recordsRoot: string, state: DeploymentCurrentStageState) {
  return path.join(
    path.resolve(recordsRoot),
    "control-plane",
    "current-stage-state",
    pathPart(state.deploymentId),
    `${pathPart(state.environmentStage)}.json`,
  );
}

export function stageStateHistoryBackupPath(
  recordsRoot: string,
  state: DeploymentCurrentStageState,
) {
  return path.join(
    path.resolve(recordsRoot),
    "control-plane",
    "stage-state-history",
    pathPart(state.deploymentId),
    pathPart(state.environmentStage),
    `${pathPart(state.currentRunId)}.json`,
  );
}

export async function writeStageStateBackupFiles(opts: {
  recordsRoot: string;
  state: DeploymentCurrentStageState;
}) {
  const payload = JSON.stringify(opts.state, null, 2) + "\n";
  for (const filePath of [
    stageStateBackupPath(opts.recordsRoot, opts.state),
    stageStateHistoryBackupPath(opts.recordsRoot, opts.state),
  ]) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, payload, "utf8");
  }
}
