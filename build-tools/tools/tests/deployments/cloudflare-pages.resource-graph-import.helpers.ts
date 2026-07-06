#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { exportDeploymentResourceGraph } from "../../deployments/resource-graph-export";
import { syncBackendResourceGraphIndex } from "../../deployments/nixos-shared-host-control-plane-backend";
import {
  DEFAULT_RESOURCE_GRAPH_EDGES_PATH,
  DEFAULT_RESOURCE_GRAPH_NODES_PATH,
} from "../../lib/workspace-state-paths";
import { REQUIRED_AWS_EC2_ALARMS } from "../../deployments/cloud-control-aws-ec2-host-profile";
import { admitControlPlaneRuntimeRecord } from "../../deployments/resource-graph-types";
import { evidence, IMAGE_BUILD_IDENTITY } from "./cloud-control-cutover-fixture";
import { runtimeInputProfile } from "./cloud-control-runtime-input.fixture";

export async function importExportedGraph(ctx: {
  tmp: string;
  backend: Parameters<typeof syncBackendResourceGraphIndex>[0];
  deployment: { deploymentId: string };
}) {
  await exportDeploymentResourceGraph({ workspaceRoot: ctx.tmp });
  await syncBackendResourceGraphIndex(ctx.backend, {
    nodes: await readJson(path.join(ctx.tmp, DEFAULT_RESOURCE_GRAPH_NODES_PATH)),
    edges: await readJson(path.join(ctx.tmp, DEFAULT_RESOURCE_GRAPH_EDGES_PATH)),
    sourceRef: "cloudflare-pages-real-reconciler-e2e",
    runtimeSources: runtimeSources(ctx.deployment.deploymentId),
  });
}

async function readJson(file: string) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

function runtimeSources(deploymentId: string) {
  const input = runtimeInputProfile();
  const validation = {
    expectedCallbackHost: "deploy-auth.example.test",
    expectedCallbackPath: "/oidc/callback",
    deploymentIds: [deploymentId],
    production: true,
    maxAgeMinutes: 60,
    nowMs: Date.parse("2026-07-05T00:30:00.000Z"),
  };
  const source = (id: string, value: unknown, overrides = {}) =>
    admitControlPlaneRuntimeRecord({
      id,
      refs: [deploymentId],
      value,
      validation: { ...validation, ...overrides },
    });
  return {
    runtimeInputs: [source("runtime-input", input)],
    authProviderProfiles: [source("auth-profile", input.authProvider)],
    readinessEvidence: [
      source("cutover-readiness", evidence(), {
        expectedHostProfile: "aws-ec2",
        expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
        operation: "cutover",
      }),
    ],
    observabilityEvidence: [source("observability", observability())],
    miniMigrationEvidence: [source("mini-migration", miniMigration())],
  };
}

function observability() {
  const checkedAt = "2026-07-05T00:00:00.000Z";
  return {
    schemaVersion: "aws-ec2-control-plane-observability@1",
    checkedAt,
    provider: "aws-ec2",
    logSink: {
      kind: "cloudwatch",
      retentionDays: 30,
      accessControlDigest: "sha256:reviewed-log-access",
    },
    unitLogRouting: { api: "deployment-control-plane-api.service" },
    history: { readiness: true, workerHeartbeat: true },
    alarms: REQUIRED_AWS_EC2_ALARMS.map((id) => ({
      id,
      target: `alarm-${id}`,
      action: "reviewed-notification-hook",
    })),
  };
}

function miniMigration() {
  const checkedAt = "2026-07-05T00:00:00.000Z";
  return {
    stateSync: { status: "passed", checkedAt },
    restore: { status: "passed", checkedAt, evidenceRef: "r" },
    rollback: { status: "passed", checkedAt, evidenceRef: "b" },
    migratedRows: {
      submissions: 1,
      queue: 1,
      control_plane_audit_events: 1,
      current_stage_state: 1,
      deploy_records: 1,
      idempotency: 1,
    },
  };
}
