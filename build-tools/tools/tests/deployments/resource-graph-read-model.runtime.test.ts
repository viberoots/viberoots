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
    assertHasNode(model, "Deployment", "demo-web");
    assertHasNode(model, "DeployRun", "run-1");
    assertHasNode(model, "ProviderEvidence", "run-1");
    assertHasNode(model, "DeploymentTargetException", "target-exception:cf-target-migration");
    assertHasNode(model, "ProviderCapabilityPolicy", "provider-capability:cloudflare-pages");
    assertHasNode(model, "ProviderCapabilityPolicy", "provider-capability:opentofu");
    assertHasNode(model, "ReleaseActionPolicy", "//demo:release/cache-warmup:policy");
    assertHasNode(model, "Provisioner", "demo-infra:provisioner");
    assertHasNode(model, "RunAction", "action-b");
    assertHasNode(model, "ArtifactChallenge", "challenge-1");
    assertHasNode(model, "StaticWebappUploadSession", "upload-1");
    assertHasNode(model, "CleanupEvidence", "cleanup-1");
    assertHasNode(model, "WorkerEvidence", "worker-1");
    assertHasNode(model, "CurrentStageState", "demo-web:staging");
    assertHasNode(model, "CurrentStageState", "demo-infra:staging");
    assertHasNode(model, "RetainedEvidence", "demo-infra:staging:execution_snapshot");
    const deployment = factsFor(model, "Deployment", "demo-web");
    assert.equal(deployment.selectedControlPlane.profile, "shared-cloudflare");
    assert.equal(deployment.localOverrideEvidence[0].localToken, "<redacted>");
    assert.deepEqual(deployment.sourceModeEvidence, [
      "remote-store",
      "local-self",
      "local-sibling-submodule",
    ]);
    const sourceSelection = (nodeFor(model, "Deployment", "demo-web") as any).sourceSelection;
    assert.equal(sourceSelection.nixpkgs_profile, "cloudflare_profile");
    assert.equal(sourceSelection.sourcePlanRef, "source-plan:local-selected");
    assert.equal(sourceSelection.cacheManifestRef, "cache-manifest:remote-snapshot");
    const challenge = factsFor(model, "ArtifactChallenge", "challenge-1");
    assert.equal(challenge.deploymentId, "demo-web");
    assert.equal(challenge.proofKeyId, "key-1");
    assert.equal(challenge.status, "accepted");
    assert.equal(challenge.nonceValidationOutcome, "matched-redacted-nonce-digest");
    assert.equal(challenge.proofKeyValidationOutcome, "trusted-key");
    assert.equal(challenge.oneTimeConsumption, "consumed-once");
    assert.equal(challenge.admittedProvenance, "object://artifact-store/artifact-1");
    const upload = factsFor(model, "StaticWebappUploadSession", "upload-1");
    assert.equal(upload.archiveFormat, "tar.gz");
    assert.equal(upload.archivePath, "uploads/demo.tgz");
    assert.equal(upload.objectIdentity, "artifact-1");
    assert.equal(upload.provenance, "upload-session:upload-1");
    const provider = factsFor(model, "ProviderEvidence", "run-1");
    assert.equal(provider.provider, "cloudflare-pages");
    assert.equal(provider.liveTargetIdentity, "cloudflare-pages:web-platform/demo-web");
    assert.equal(provider.previewTargetEvidence, "https://preview.demo.pages.dev");
    assert.equal(provider.partialPublishEvidence.finalOutcome, "succeeded");
    assert.equal(provider.smokeReadinessEvidence, "passed");
    assert.equal(provider.sourcePlanRef, "source-plan:local-selected");
    const provisioner = factsFor(model, "ProviderEvidence", "run-2");
    assert.equal(provisioner.provider, "opentofu");
    assert.deepEqual(factsFor(model, "ProviderEvidence", "run-2").retainedRenderEvidence, [
      { kind: "provisioner_plan", referencePath: "/tmp/opentofu/plan.bin" },
      { kind: "execution_snapshot", referencePath: "/tmp/execution-snapshot.json" },
    ]);
    const release = factsFor(model, "DeployRun", "run-3");
    assert.equal(release.releaseActionResults[0].status, "succeeded");
    assert.equal(
      factsFor(model, "CleanupEvidence", "cleanup-1").diagnostics,
      "cleanup failed (permission_denied)",
    );
    const worker = factsFor(model, "WorkerEvidence", "worker-1");
    assert.equal(worker.health.status, "healthy");
    assert.equal(worker.authorizesWork, false);
    assert.equal(worker.leaseClaims[0].deployRunId, "run-1");
    assert.equal(model.runtime.status, "runtime-linked");
    assert.equal(model.runtime.workerEvidenceCount, 1);
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
          edge.kind === "runtime_status" &&
          edge.fromUid === "runtime:WorkerEvidence:worker-1" &&
          edge.toUid === "runtime:DeployRun:run-1",
      ),
    );
    assert.ok(
      model.edges.some(
        (edge: any) =>
          edge.kind === "runtime_status" &&
          edge.fromUid === "runtime:WorkerEvidence:worker-1" &&
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
    assert.ok(
      model.edges.some(
        (edge: any) =>
          edge.kind === "runtime_status" &&
          edge.fromUid === "uid:provisioner" &&
          edge.toUid === "runtime:DeployRun:run-2",
      ),
    );
    assert.ok(
      model.edges.some(
        (edge: any) =>
          edge.kind === "runtime_status" &&
          edge.fromUid === "uid:provisioner" &&
          edge.toUid === "runtime:ExecutionSnapshot:submission-2",
      ),
    );
    assert.ok(
      model.edges.some(
        (edge: any) =>
          edge.kind === "runtime_status" &&
          edge.fromUid === "uid:provisioner" &&
          edge.toUid === "runtime:CurrentStageState:demo-infra:staging",
      ),
    );
    assertPolicyEdge(model, "runtime:DeployRun:run-1", "ProviderCapabilityPolicy");
    assertPolicyEdge(model, "runtime:DeployRun:run-3", "ReleaseActionPolicy");
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
  return nodeFor(model, kind, name)?.facts;
}

function nodeFor(model: any, kind: string, name: string) {
  return model.nodes.find((node: any) => node.kind === kind && node.name === name);
}

function assertPolicyEdge(model: any, fromUid: string, toKind: string) {
  assert.ok(
    model.edges.some(
      (edge: any) => edge.kind === "policy" && edge.fromUid === fromUid && edge.toKind === toKind,
    ),
  );
}
