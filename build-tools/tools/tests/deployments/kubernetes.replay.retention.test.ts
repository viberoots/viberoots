#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  createKubernetesDeployRecord,
  writeKubernetesDeployRecord,
} from "../../deployments/kubernetes-records";
import { fingerprintValue } from "../../deployments/nixos-shared-host-deployment-fingerprint";
import {
  resolveKubernetesReplaySource,
  writeKubernetesReplaySnapshot,
} from "../../deployments/kubernetes-replay";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";

test("kubernetes replay retention requires component artifact provenance", async () => {
  await runInTemp("kubernetes-replay-retention-provenance", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const deployment = kubernetesDeploymentFixture({ protectionClass: "shared_nonprod" });
    const storedArtifactPath = path.join(recordsRoot, "artifacts", "blobs", "api");
    const provenancePath = path.join(recordsRoot, "artifacts", "provenance", "api.json");
    const providerConfigPath = path.join(recordsRoot, "provider-config", "deploy-1.json");
    const componentArtifacts = [
      { componentId: "api", identity: "node-service:api", storedArtifactPath, provenancePath },
    ];
    const rendered = {
      chart: "./chart",
      cluster: deployment.providerTarget.cluster,
      namespace: deployment.providerTarget.namespace,
      release: deployment.providerTarget.release,
      provider_target_identity: deployment.providerTarget.providerTargetIdentity,
      smoke_url: "http://shared-observability.example.test/healthz",
      component_artifacts: {
        api: { path: storedArtifactPath, identity: "node-service:api" },
      },
    };
    const admittedContext = {
      source: { sourceRef: "refs/tags/release/prod", sourceRevision: "rev-1" },
      admittedSecretReferences: [],
      policyEvaluation: { binding: { payloadFingerprint: "sha256:policy" } },
    };
    await fsp.mkdir(storedArtifactPath, { recursive: true });
    await fsp.mkdir(path.dirname(providerConfigPath), { recursive: true });
    await fsp.writeFile(path.join(storedArtifactPath, "marker"), "artifact\n", "utf8");
    await fsp.writeFile(providerConfigPath, JSON.stringify(rendered, null, 2) + "\n", "utf8");
    const replaySnapshotPath = await writeKubernetesReplaySnapshot({
      recordsRoot,
      deployRunId: "deploy-1",
      deployment,
      artifactIdentity: "kubernetes-composite:api",
      componentArtifacts,
      admittedContext: admittedContext as any,
      providerConfigSnapshotPath: providerConfigPath,
    });
    const record = createKubernetesDeployRecord(deployment, {
      deployRunId: "deploy-1",
      operationKind: "deploy",
      runClassification: "deploy",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      artifact: { identity: "kubernetes-composite:api" },
      componentArtifacts,
      admittedContext: admittedContext as any,
      deploymentMetadataFingerprint: "sha256:deployment",
      providerConfigFingerprint: fingerprintValue(rendered),
      replaySnapshotPath,
    });
    await writeKubernetesDeployRecord(recordsRoot, record);
    await assert.rejects(
      () => resolveKubernetesReplaySource({ recordsRoot, deployRunId: "deploy-1" }),
      /replay bundle is incomplete/,
    );
  });
});
