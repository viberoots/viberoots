#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import {
  readBackendResourceGraphIndex,
  writeBackendRunActionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { runInTemp } from "../lib/test-helpers";
import {
  backendFor,
  seedResourceGraphIntent,
  seedRuntimeRows,
} from "./resource-graph-read-model.runtime.fixture";

test("resource graph read model links admitted runtime facts without leaking secrets", async () => {
  await runInTemp("resource-graph-runtime-read-model", async (tmp) => {
    const backend = backendFor(tmp);
    await seedResourceGraphIntent(backend);
    await seedRuntimeRows(backend, tmp);

    const model = await readBackendResourceGraphIndex(backend);
    assertHasNode(model, "DeployRun", "run-1");
    assertHasNode(model, "ProviderEvidence", "run-1");
    assertHasNode(model, "RunAction", "action-b");
    assertHasNode(model, "ArtifactChallenge", "challenge-1");
    assertHasNode(model, "StaticWebappUploadSession", "upload-1");
    assertHasNode(model, "CleanupEvidence", "cleanup-1");
    assertHasNode(model, "CurrentStageState", "demo-web:staging");
    assertHasNode(model, "RetainedEvidence", "demo-web:staging:execution_snapshot");
    const challenge = factsFor(model, "ArtifactChallenge", "challenge-1");
    assert.equal(challenge.deploymentId, "demo-web");
    assert.equal(challenge.proofKeyId, "key-1");
    assert.equal(challenge.status, "accepted");
    assert.equal(challenge.nonceValidationOutcome, "matched-redacted-nonce-digest");
    assert.equal(challenge.proofKeyValidationOutcome, "trusted-key");
    assert.equal(challenge.oneTimeConsumption, "consumed-once");
    assert.equal(challenge.admittedProvenance, "object://artifact-store/artifact-1");
    const provider = factsFor(model, "ProviderEvidence", "run-1");
    assert.equal(provider.provider, "nixos-shared-host");
    assert.equal(provider.liveTargetIdentity, "nixos-shared-host:default:demo-web");
    assert.equal(provider.partialPublishEvidence.finalOutcome, "succeeded");
    assert.equal(provider.smokeReadinessEvidence, "passed");
    assert.equal(provider.sourcePlanRef, "source-plan:demo");
    assert.deepEqual(provider.retainedRenderEvidence, [
      { kind: "execution_snapshot", referencePath: "/tmp/execution-snapshot.json" },
    ]);
    assert.deepEqual(provider.retainedArtifactEvidence, [
      {
        identity: "artifact-1",
        storedArtifactPath: "/tmp/artifact.tgz",
        provenancePath: "/tmp/provenance.json",
      },
    ]);
    assert.equal(
      factsFor(model, "CleanupEvidence", "cleanup-1").diagnostics,
      "cleanup failed (permission_denied)",
    );
    assert.equal(model.runtime.status, "runtime-linked");
    assert.deepEqual(model.runtime.latestActions, [
      {
        submissionId: "submission-1",
        actionId: "action-b",
        submittedAt: "2026-07-05T12:02:00.000Z",
      },
    ]);
    assert.ok(
      model.edges.some(
        (edge: any) =>
          edge.kind === "runtime_status" &&
          edge.fromUid === "runtime:DeployRun:run-1" &&
          edge.toUid === "uid:deployment",
      ),
    );
    assert.ok(
      model.edges.some(
        (edge: any) =>
          edge.kind === "provider_target" &&
          edge.fromUid === "runtime:ProviderEvidence:run-1" &&
          edge.toUid === "uid:provider",
      ),
    );
    assert.ok(
      model.edges.some(
        (edge: any) =>
          edge.kind === "runtime_status" &&
          edge.fromUid === "runtime:ProviderEvidence:run-1" &&
          edge.toUid === "runtime:ExecutionSnapshot:submission-1",
      ),
    );
    assert.ok(
      model.edges.some(
        (edge: any) =>
          edge.kind === "evidence" &&
          edge.fromUid === "runtime:ProviderEvidence:run-1" &&
          edge.toUid === "runtime:CurrentStageState:demo-web:staging",
      ),
    );
    assert.doesNotMatch(JSON.stringify(model), /raw-secret|proof-secret|Bearer|token=/);
  });
});

test("run-action persistence preserves original idempotent request ordering identity", async () => {
  await runInTemp("resource-graph-run-action-preserve", async (tmp) => {
    const backend = backendFor(tmp);
    await seedResourceGraphIntent(backend);
    const first = await writeBackendRunActionDoc(backend, {
      actionId: "action-reused",
      submissionId: "submission-1",
      action: "cancel",
      submittedAt: "2026-07-05T12:00:00.000Z",
    } as any);
    const reused = await writeBackendRunActionDoc(backend, {
      actionId: "action-reused",
      submissionId: "submission-1",
      action: "cancel",
      submittedAt: "2026-07-05T12:05:00.000Z",
    } as any);
    assert.equal(first.submittedAt, "2026-07-05T12:00:00.000Z");
    assert.equal(reused.submittedAt, "2026-07-05T12:00:00.000Z");

    const row = (
      await queryBackend<any>(
        backend,
        "SELECT request_json FROM run_actions WHERE action_id = $1",
        ["action-reused"],
      )
    ).rows[0];
    assert.equal(row.request_json.submittedAt, "2026-07-05T12:00:00.000Z");
    const model = await readBackendResourceGraphIndex(backend);
    assert.deepEqual(model.runtime.latestActions, [
      {
        submissionId: "submission-1",
        actionId: "action-reused",
        submittedAt: "2026-07-05T12:00:00.000Z",
      },
    ]);
  });
});

function assertHasNode(model: any, kind: string, name: string) {
  assert.ok(model.nodes.some((node: any) => node.kind === kind && node.name === name));
}

function factsFor(model: any, kind: string, name: string) {
  return model.nodes.find((node: any) => node.kind === kind && node.name === name)?.facts;
}
