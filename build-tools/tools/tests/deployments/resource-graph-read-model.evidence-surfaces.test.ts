#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  syncBackendResourceGraphIndex,
  type NixosSharedHostControlPlaneBackendTarget,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { runResourceGraphForOperator } from "../../deployments/deploy-resource-graph-operator";
import {
  admitControlPlaneRuntimeRecord,
  type DeploymentRuntimeInventorySources,
  type RuntimeSourceRecord,
} from "../../deployments/resource-graph-types";
import { REQUIRED_AWS_EC2_ALARMS } from "../../deployments/cloud-control-aws-ec2-host-profile";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { runInTemp } from "../lib/test-helpers";
import { evidence, IMAGE_BUILD_IDENTITY } from "./cloud-control-cutover-fixture";
import { runtimeInputProfile } from "./cloud-control-runtime-input.fixture";
import { backendFor } from "./resource-graph-read-model.runtime.fixture";
import { fixtureDocuments } from "./resource-graph-read-model.reconciliation-fixture";

const TOKEN = "resource-graph-cli-token";
const validation = {
  expectedCallbackHost: "deploy-auth.example.test",
  expectedCallbackPath: "/oidc/callback",
  deploymentIds: ["sample-webapp-staging"],
  production: true,
  maxAgeMinutes: 60,
  nowMs: Date.parse("2026-07-05T00:30:00.000Z"),
};

test("CLI resource graph read exposes validator-backed runtime evidence", async () => {
  await runInTemp("resource-graph-runtime-evidence-cli", async (tmp) => {
    const backend = backendFor(tmp);
    await syncBackendResourceGraphIndex(backend, {
      ...fixtureDocuments(),
      sourceRef: "workspace-resource-graph-export",
      runtimeSources: validSources(),
    });
    const service = await startService(tmp, backend);
    try {
      const output = await captureStdout(() =>
        runResourceGraphForOperator({
          controlPlaneUrl: service.url,
          controlPlaneToken: TOKEN,
          selectedSource: "explicit",
        }),
      );
      const payload = JSON.parse(output);
      assert.equal(payload.runtime.runtimeEvidenceCount, 5);
      assertHasNode(payload, "RuntimeInput");
      assertHasNode(payload, "ControlPlaneReadinessEvidence");
      assert.doesNotMatch(output, /raw-secret|Bearer|token=/);
    } finally {
      await service.close();
    }
  });
});

test("backend runtime evidence ingestion rejects stale malformed or non-admitted records", async () => {
  await runInTemp("resource-graph-runtime-evidence-negatives", async (tmp) => {
    const backend = backendFor(tmp);
    await assert.rejects(
      () =>
        syncBackendResourceGraphIndex(backend, {
          ...fixtureDocuments(),
          sourceRef: "workspace-resource-graph-export",
        }),
      /RuntimeInput: required runtime evidence is missing/,
    );
    await assert.rejects(
      () =>
        syncBackendResourceGraphIndex(backend, {
          ...fixtureDocuments(),
          sourceRef: "workspace-resource-graph-export",
          runtimeSources: { runtimeInputs: validSources().runtimeInputs },
        }),
      /AuthProviderProfile: required runtime evidence is missing/,
    );
    await assert.rejects(
      () =>
        syncBackendResourceGraphIndex(backend, {
          ...fixtureDocuments(),
          sourceRef: "workspace-resource-graph-export",
          runtimeSources: invalidSources(),
        }),
      (error: any) => {
        const message = String(error?.message || "");
        assert.match(message, /evidence is stale/);
        assert.match(message, /AWS operational visibility missing alarm/);
        assert.match(message, /auth-provider provider is unsupported/);
        assert.match(message, /runtime source is not an admitted control-plane record/);
        return true;
      },
    );
  });
});

function validSources(): DeploymentRuntimeInventorySources {
  const input = runtimeInputProfile();
  return {
    runtimeInputs: [source("runtime-input", input, ["demo-web"])],
    authProviderProfiles: [source("auth-profile", input.authProvider, ["demo-web"])],
    readinessEvidence: [
      source("cutover-readiness", evidence(), ["demo-web"], {
        expectedHostProfile: "aws-ec2",
        expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
        maxAgeMinutes: 60,
        operation: "cutover",
      }),
    ],
    observabilityEvidence: [source("observability", observability(), ["demo-web"])],
    miniMigrationEvidence: [source("mini-migration", miniMigration(), ["demo-web"])],
  };
}

function invalidSources(): DeploymentRuntimeInventorySources {
  const input = runtimeInputProfile();
  return {
    authProviderProfiles: [
      source("auth-unsupported", { ...input.authProvider, provider: "unsupported" }),
      { id: "auth-not-admitted", value: input.authProvider, validation },
    ] as any,
    readinessEvidence: [
      source("cutover-stale", evidence({ generatedAt: "2000-01-01T00:00:00.000Z" }), [], {
        expectedHostProfile: "aws-ec2",
        expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
        maxAgeMinutes: 1,
        operation: "cutover",
      }),
    ],
    observabilityEvidence: [source("observability-malformed", { ...observability(), alarms: [] })],
  };
}

function source(
  id: string,
  value: unknown,
  refs: string[] = [],
  overrides: Partial<RuntimeSourceRecord["validation"]> = {},
) {
  return admitControlPlaneRuntimeRecord({
    id,
    refs,
    value,
    validation: { ...validation, ...overrides },
  });
}

function observability() {
  return {
    schemaVersion: "aws-ec2-control-plane-observability@1",
    checkedAt: "2026-07-05T00:00:00.000Z",
    provider: "aws-ec2",
    logSink: {
      kind: "cloudwatch",
      retentionDays: 30,
      accessControlDigest: "sha256:reviewed-log-access",
      token: "raw-secret",
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
  return {
    stateSync: { status: "passed", checkedAt: "2026-07-05T00:00:00.000Z" },
    restore: { status: "passed", checkedAt: "2026-07-05T00:00:00.000Z", evidenceRef: "r" },
    rollback: { status: "passed", checkedAt: "2026-07-05T00:00:00.000Z", evidenceRef: "b" },
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

async function startService(tmp: string, backend: NixosSharedHostControlPlaneBackendTarget) {
  return await startNixosSharedHostControlPlaneServer({
    workspaceRoot: tmp,
    paths: {
      statePath: path.join(tmp, "state.json"),
      hostRoot: tmp,
      recordsRoot: backend.recordsRoot,
    },
    backendDatabaseUrl: backend.databaseUrl,
    token: TOKEN,
    objectStore: memoryControlPlaneArtifactStore(),
  });
}

async function captureStdout(fn: () => Promise<void>) {
  const lines: string[] = [];
  const original = console.log;
  console.log = (value?: unknown) => lines.push(String(value ?? ""));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

function assertHasNode(model: any, kind: string) {
  assert.ok(model.nodes.some((node: any) => node.kind === kind));
}
