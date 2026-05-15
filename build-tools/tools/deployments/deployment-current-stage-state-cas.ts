#!/usr/bin/env zx-wrapper
import type { BackendQueryable } from "./nixos-shared-host-control-plane-backend-db";
import type { DeploymentCurrentStageState } from "./deployment-current-stage-state-types";

export async function writeCurrentStageStateCas(opts: {
  client: BackendQueryable;
  state: DeploymentCurrentStageState;
  stateJson: string;
  expectedCurrentRunId?: string | null;
  enforceCompareAndSwap?: boolean;
}) {
  if (opts.expectedCurrentRunId === undefined && opts.enforceCompareAndSwap) {
    throw Object.assign(
      new Error(
        `stage state compare-and-swap requires expected current run id for ${opts.state.deploymentId}/${opts.state.environmentStage}`,
      ),
      { code: "stage_state_expected_required" },
    );
  }
  return opts.expectedCurrentRunId === undefined
    ? await upsertCurrentStageState(opts)
    : await guardedWriteCurrentStageState({
        ...opts,
        expectedCurrentRunId: opts.expectedCurrentRunId,
      });
}

async function upsertCurrentStageState(opts: {
  client: BackendQueryable;
  state: DeploymentCurrentStageState;
  stateJson: string;
}) {
  await opts.client.query(
    `INSERT INTO current_stage_state (
      deployment_id, environment_stage, current_run_id, document_json, updated_at
    ) VALUES ($1, $2, $3, $4::jsonb, $5)
    ON CONFLICT(deployment_id, environment_stage) DO UPDATE SET
      current_run_id = EXCLUDED.current_run_id,
      document_json = EXCLUDED.document_json,
      updated_at = EXCLUDED.updated_at`,
    currentStageParams(opts.state, opts.stateJson),
  );
}

async function guardedWriteCurrentStageState(opts: {
  client: BackendQueryable;
  state: DeploymentCurrentStageState;
  stateJson: string;
  expectedCurrentRunId: string | null;
}) {
  const row = opts.expectedCurrentRunId ? await guardedUpdate(opts) : await guardedInsert(opts);
  if (!row?.deployment_id) {
    throw Object.assign(
      new Error(
        `stage state compare-and-swap failed for ${opts.state.deploymentId}/${opts.state.environmentStage}`,
      ),
      { code: "stage_state_stale" },
    );
  }
}

async function guardedUpdate(opts: {
  client: BackendQueryable;
  state: DeploymentCurrentStageState;
  stateJson: string;
  expectedCurrentRunId: string;
}) {
  return (
    await opts.client.query<{ deployment_id?: string }>(
      `UPDATE current_stage_state
       SET current_run_id = $1, document_json = $2::jsonb, updated_at = $3
       WHERE deployment_id = $4 AND environment_stage = $5 AND current_run_id = $6
       RETURNING deployment_id`,
      [
        opts.state.currentRunId,
        opts.stateJson,
        opts.state.updatedAt,
        opts.state.deploymentId,
        opts.state.environmentStage,
        opts.expectedCurrentRunId,
      ],
    )
  ).rows[0];
}

async function guardedInsert(opts: {
  client: BackendQueryable;
  state: DeploymentCurrentStageState;
  stateJson: string;
}) {
  return (
    await opts.client.query<{ deployment_id?: string }>(
      `INSERT INTO current_stage_state (
        deployment_id, environment_stage, current_run_id, document_json, updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT(deployment_id, environment_stage) DO NOTHING
      RETURNING deployment_id`,
      currentStageParams(opts.state, opts.stateJson),
    )
  ).rows[0];
}

function currentStageParams(state: DeploymentCurrentStageState, stateJson: string) {
  return [
    state.deploymentId,
    state.environmentStage,
    state.currentRunId,
    stateJson,
    state.updatedAt,
  ];
}
