#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { materializeSnapshotArtifacts } from "../../deployments/control-plane-artifact-materialize";
import { putVerifiedArtifactObject } from "../../deployments/control-plane-artifact-store";
import { createStaticWebappArtifactBundleBytes } from "../../deployments/static-webapp-artifact-bundle";
import { artifactIdentityForStaticWebappDir } from "../../deployments/static-webapp-artifacts";
import { runInTemp } from "../lib/test-helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";

test("provider materialization verifies object provenance and allows source-run reuse", async () => {
  await runInTemp("provider-artifact-provenance-mismatch", async (tmp) => {
    const store = memoryControlPlaneArtifactStore();
    const artifactDir = path.join(tmp, "provider-artifact");
    await writeDemoArtifact(artifactDir, "provider");
    const identity = await artifactIdentityForStaticWebappDir(artifactDir);
    const body = await createStaticWebappArtifactBundleBytes(artifactDir);
    const wrongDeployment = await putVerifiedArtifactObject({
      store,
      body,
      payloadKind: "artifact",
      provenance: {
        deploymentId: "other-deployment",
        submissionId: "submit-a",
        artifactIdentity: identity,
      },
    });
    await assert.rejects(
      () =>
        materializeSnapshotArtifacts({
          store,
          outputRoot: path.join(tmp, "out-deployment"),
          snapshot: {
            deploymentId: "deployment-a",
            submissionId: "submit-a",
            artifact: { identity, storedArtifactPath: "", object: wrongDeployment },
          } as any,
        }),
      /deploymentId provenance mismatch/,
    );
    const wrongPayload = await putVerifiedArtifactObject({
      store,
      body,
      payloadKind: "execution-snapshot",
      provenance: {
        deploymentId: "deployment-a",
        submissionId: "submit-a",
        artifactIdentity: identity,
      },
    });
    await assert.rejects(
      () =>
        materializeSnapshotArtifacts({
          store,
          outputRoot: path.join(tmp, "out-payload"),
          snapshot: {
            deploymentId: "deployment-a",
            submissionId: "submit-a",
            artifact: { identity, storedArtifactPath: "", object: wrongPayload },
          } as any,
        }),
      /payloadKind provenance mismatch/,
    );
    const priorSubmission = await putVerifiedArtifactObject({
      store,
      body,
      payloadKind: "artifact",
      provenance: {
        deploymentId: "deployment-a",
        submissionId: "submit-source",
        artifactIdentity: identity,
      },
    });
    await assert.rejects(
      () =>
        materializeSnapshotArtifacts({
          store,
          outputRoot: path.join(tmp, "out-submit"),
          snapshot: {
            deploymentId: "deployment-a",
            submissionId: "submit-current",
            operationKind: "deploy",
            artifact: { identity, storedArtifactPath: "", object: priorSubmission },
          } as any,
        }),
      /submissionId provenance mismatch/,
    );
    const replayed = await materializeSnapshotArtifacts({
      store,
      outputRoot: path.join(tmp, "out-retry"),
      snapshot: {
        deploymentId: "deployment-a",
        submissionId: "submit-current",
        operationKind: "retry",
        sourceRunId: "source-run",
        artifact: { identity, storedArtifactPath: "", object: priorSubmission },
      } as any,
    });
    assert.ok((replayed as any).artifact.storedArtifactPath);
  });
});
