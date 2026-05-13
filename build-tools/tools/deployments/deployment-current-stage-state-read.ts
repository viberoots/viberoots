#!/usr/bin/env zx-wrapper
import { decodeBackendJson, queryBackend } from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";
import type { DeploymentCurrentStageState } from "./deployment-current-stage-state-types";

export async function readBackendCurrentStageState(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId: string; environmentStage: string },
) {
  const row = (
    await queryBackend<{ document_json?: unknown }>(
      backend,
      `SELECT document_json FROM current_stage_state
       WHERE deployment_id = $1 AND environment_stage = $2`,
      [opts.deploymentId, opts.environmentStage],
    )
  ).rows[0];
  return row?.document_json
    ? decodeBackendJson<DeploymentCurrentStageState>(row.document_json)
    : null;
}

export async function readBackendCurrentStageStates(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId?: string; environmentStage?: string },
) {
  const params = [opts.deploymentId || "", opts.environmentStage || ""];
  const rows = (
    await queryBackend<{ document_json?: unknown }>(
      backend,
      `SELECT document_json FROM current_stage_state
       WHERE ($1 = '' OR deployment_id = $1)
         AND ($2 = '' OR environment_stage = $2)
       ORDER BY deployment_id ASC, environment_stage ASC`,
      params,
    )
  ).rows;
  return rows
    .map((row) =>
      row.document_json ? decodeBackendJson<DeploymentCurrentStageState>(row.document_json) : null,
    )
    .filter((row): row is DeploymentCurrentStageState => Boolean(row));
}

export async function readBackendStageHistory(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId: string; environmentStage?: string },
) {
  const params = opts.environmentStage
    ? [opts.deploymentId, opts.environmentStage]
    : [opts.deploymentId];
  const where = opts.environmentStage
    ? "deployment_id = $1 AND environment_stage = $2"
    : "deployment_id = $1";
  const rows = (
    await queryBackend<{ document_json?: unknown }>(
      backend,
      `SELECT document_json FROM stage_state_history
       WHERE ${where}
       ORDER BY updated_at DESC`,
      params,
    )
  ).rows;
  return rows
    .map((row) =>
      row.document_json ? decodeBackendJson<DeploymentCurrentStageState>(row.document_json) : null,
    )
    .filter((row): row is DeploymentCurrentStageState => Boolean(row));
}
