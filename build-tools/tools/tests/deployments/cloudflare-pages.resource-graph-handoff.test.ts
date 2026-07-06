#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { syncBackendResourceGraphIndex } from "../../deployments/nixos-shared-host-control-plane-backend";
import type { CloudflarePagesRuntimeEvidenceHandoff } from "../../deployments/cloudflare-pages-resource-graph-runtime-evidence";
import { runtimeEvidenceDocuments } from "../../deployments/resource-graph-runtime-evidence";
import {
  admitControlPlaneRuntimeRecord,
  type DeploymentRuntimeInventorySources,
} from "../../deployments/resource-graph-types";
import { runtimeSourcesFromHandoff } from "./cloudflare-pages.resource-graph-import.helpers";
import { runInTemp } from "../lib/test-helpers";
import { backendFor } from "./resource-graph-read-model.runtime.fixture";
import { fixtureDocuments } from "./resource-graph-read-model.reconciliation-fixture";

const deploymentId = "sample-webapp-staging";
const requiredSources = [
  "runtimeInputs",
  "authProviderProfiles",
  "readinessEvidence",
  "observabilityEvidence",
  "miniMigrationEvidence",
] as const;

test("Cloudflare resource graph import requires control-plane runtime evidence handoff", () => {
  const handoff = validHandoff();
  assert.equal(
    runtimeEvidenceDocuments(runtimeSourcesFromHandoff(handoff, deploymentId)).length,
    5,
  );
  for (const key of requiredSources) {
    assert.throws(
      () =>
        runtimeSourcesFromHandoff(
          { ...handoff, runtimeSources: { ...handoff.runtimeSources, [key]: [] } },
          deploymentId,
        ),
      new RegExp(`handoff missing ${key}`),
    );
  }
  assert.throws(
    () => runtimeSourcesFromHandoff({ ...handoff, deploymentId: "other" }, deploymentId),
    /handoff deployment mismatch/,
  );
  assert.throws(
    () =>
      runtimeSourcesFromHandoff(
        { ...handoff, sourceRef: "fixture-runtime-evidence" as never },
        deploymentId,
      ),
    /handoff source is unsupported/,
  );
  assert.throws(
    () =>
      runtimeSourcesFromHandoff(
        { ...handoff, producedBy: { ...handoff.producedBy, deployRunIds: [] } },
        deploymentId,
      ),
    /handoff producer is incomplete/,
  );
  assert.throws(
    () =>
      runtimeEvidenceDocuments({
        ...handoff.runtimeSources,
        runtimeInputs: [
          source("runtime-input", {
            ...reference("cloud-control-runtime-input-reference@1", "runtime"),
            sourceSnapshot: undefined,
          }),
        ],
      }),
    /source snapshot submissionId is required/,
  );
});

test("backend importer fixtures can still provide focused runtime evidence", async () => {
  await runInTemp("resource-graph-runtime-evidence-handoff-regression", async (tmp) => {
    const result = await syncBackendResourceGraphIndex(backendFor(tmp), {
      ...fixtureDocuments(),
      sourceRef: "focused-runtime-evidence-fixture",
      runtimeSources: validHandoff().runtimeSources,
    });
    assert.match(result.importId, /^resource-graph:/);
  });
});

function validHandoff(): CloudflarePagesRuntimeEvidenceHandoff {
  return {
    sourceRef: "cloudflare-pages-control-plane-runtime-evidence",
    deploymentId,
    producedBy: {
      path: "cloudflare-pages-control-plane-reconciler",
      deployRunIds: ["run-first", "run-second", "run-rollback"],
    },
    runtimeSources: validSources(),
  };
}

function validSources(): DeploymentRuntimeInventorySources {
  return {
    runtimeInputs: [
      source("runtime-input", reference("cloud-control-runtime-input-reference@1", "runtime")),
    ],
    authProviderProfiles: [
      source("auth-profile", reference("auth-provider-profile-reference@1", "auth")),
    ],
    readinessEvidence: [
      source("readiness", {
        ...reference("control-plane-readiness-reference@1", "readiness"),
        operation: "cutover",
      }),
    ],
    observabilityEvidence: [
      source(
        "observability",
        reference("aws-ec2-control-plane-observability-reference@1", "observability"),
      ),
    ],
    miniMigrationEvidence: [
      source("mini-migration", reference("mini-migration-preflight-reference@1", "migration")),
    ],
  };
}

function source(id: string, value: unknown) {
  return admitControlPlaneRuntimeRecord({
    id,
    refs: [deploymentId],
    value,
    validation: {
      expectedCallbackHost: "deploy-auth.example.test",
      expectedCallbackPath: "/oidc/callback",
      deploymentIds: [deploymentId],
      production: true,
      maxAgeMinutes: 60,
      nowMs: Date.now(),
      operation: "cutover",
    },
  });
}

function reference(schemaVersion: string, name: string) {
  const submissionId = "cp-runtime-evidence";
  return {
    schemaVersion,
    checkedAt: new Date().toISOString(),
    evidenceRef: `evidence://control-plane/cloudflare-pages/snapshots/${submissionId}/${name}`,
    provider: "aws-ec2",
    sourceSnapshot: {
      submissionId,
      executionSnapshotPath: `/control-plane/snapshots/${submissionId}.json`,
    },
  };
}
