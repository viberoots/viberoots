#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  readBackendResourceGraphIndex,
  syncBackendResourceGraphIndex,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
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

const TOKEN = "resource-graph-evidence-token";
const validation = {
  expectedCallbackHost: "deploy-auth.example.test",
  expectedCallbackPath: "/oidc/callback",
  deploymentIds: ["sample-webapp-staging"],
  production: true,
  maxAgeMinutes: 60,
  nowMs: Date.parse("2026-07-05T00:30:00.000Z"),
};

test("backend resource graph status ingests validator-backed runtime evidence", async () => {
  await runInTemp("resource-graph-runtime-evidence", async (tmp) => {
    const backend = backendFor(tmp);
    await syncBackendResourceGraphIndex(backend, {
      ...fixtureDocuments(),
      sourceRef: "workspace-resource-graph-export",
      runtimeSources: runtimeSources(),
    });

    const model = await readBackendResourceGraphIndex(backend);
    for (const kind of [
      "RuntimeInput",
      "AuthProviderProfile",
      "ControlPlaneReadinessEvidence",
      "ControlPlaneObservabilityEvidence",
      "MiniMigrationPreflightEvidence",
    ]) {
      assertHasEvidenceNode(model, kind);
    }
    assert.equal(
      factsFor(model, "RuntimeInput", "runtime-input").value.authProvider.metadata.environment,
      "production",
    );
    assert.equal(
      factsFor(model, "ControlPlaneReadinessEvidence", "cutover-readiness").value.schemaVersion,
      "cloud-cutover-evidence@1",
    );
    assert.equal(model.runtime.runtimeEvidenceCount, 5);
    assert.ok(
      model.edges.some(
        (edge: any) =>
          edge.kind === "evidence" &&
          edge.fromUid === "runtime:RuntimeInput:runtime-input" &&
          edge.toUid === "uid:deployment",
      ),
    );
    assert.doesNotMatch(JSON.stringify(model), /Bearer|token=|raw-secret/);

    const service = await startService(tmp, backend);
    try {
      const headers = { authorization: `Bearer ${TOKEN}`, "x-request-id": "rg-evidence-api" };
      const direct = await readJson<any>(
        await fetch(new URL("/api/v1/resource-graph", service.url), { headers }),
      );
      assert.equal(direct.schemaVersion, "control-plane-resource-graph@1");
      assert.equal(direct.runtime.runtimeEvidenceCount, 5);
      assertSecretSafe(direct);
      const api = await readJson<any>(
        await fetch(new URL("/ops/api/v1/read/resource-graph", service.url), { headers }),
      );
      assert.equal(api.schemaVersion, "control-plane-resource-graph@1");
      assert.equal(api.runtime.runtimeEvidenceCount, 5);
      assertHasEvidenceNode(api, "ControlPlaneReadinessEvidence");
      assertSecretSafe(api);
      const mcp = await callMcp(service.url, "rg-evidence-mcp");
      assert.equal(mcp.result.requestId, "rg-evidence-mcp");
      assertHasEvidenceNode(mcp.result.data, "RuntimeInput");
      assertSecretSafe(mcp);
    } finally {
      await service.close();
    }
  });
});

test("backend resource graph evidence ingestion fails closed for invalid sources", async () => {
  await runInTemp("resource-graph-runtime-evidence-invalid", async (tmp) => {
    const backend = backendFor(tmp);
    await assert.rejects(
      () =>
        syncBackendResourceGraphIndex(backend, {
          ...fixtureDocuments(),
          sourceRef: "workspace-resource-graph-export",
          runtimeSources: {
            runtimeInputs: [
              source("runtime-input", {
                ...runtimeInputProfile(),
                mode: "local-fixture",
              }),
            ],
            miniMigrationEvidence: [
              source("mini-migration", {
                stateSync: { status: "passed", checkedAt: "2026-07-05T00:00:00.000Z" },
              }),
            ],
          },
        }),
      /production setup requires production runtime input|mini cloud migration evidence is incomplete/,
    );
  });
});

function runtimeSources(): DeploymentRuntimeInventorySources {
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

function assertHasEvidenceNode(model: any, kind: string) {
  assert.ok(model.nodes.some((node: any) => node.kind === kind));
}

function assertSecretSafe(value: unknown) {
  assert.doesNotMatch(JSON.stringify(value), /Bearer|token=|raw-secret/);
}

function factsFor(model: any, kind: string, name: string) {
  return model.nodes.find((node: any) => node.kind === kind && node.name === name)?.facts;
}

async function startService(tmp: string, backend: { recordsRoot: string; databaseUrl: string }) {
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
    webUi: { enabled: true, basePath: "/ops" },
    mcp: { enabled: true, basePath: "/mcp" },
  });
}

async function callMcp(serviceUrl: string, requestId: string) {
  return await readJson<any>(
    await fetch(new URL("/mcp", serviceUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: { name: "deployment_resource_graph", arguments: {} },
      }),
    }),
  );
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status !== 200) assert.fail(await response.text());
  return (await response.json()) as T;
}
