#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { materializeSnapshotArtifacts } from "../../deployments/control-plane-artifact-materialize";
import { resolveCloudflarePagesArtifactInput } from "../../deployments/cloudflare-pages-artifact-input";
import { admitStaticWebappArtifact } from "../../deployments/static-webapp-artifacts";
import {
  createStaticWebappArtifactBundleBytes,
  digestStaticWebappArtifactBundleBytes,
} from "../../deployments/static-webapp-artifact-bundle";
import { runInTemp } from "../lib/test-helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";

async function writeArtifact(root: string, body = "<html>cloudflare</html>\n") {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), body, "utf8");
}

async function reviewedRevision(tmp: string, $: any, deployment: any) {
  await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
  return String((await $({ cwd: tmp, stdio: "pipe" })`git rev-parse main`).stdout).trim();
}

test("cloudflare ci_attested object artifacts include deployment provenance for worker materialization", async () => {
  await runInTemp("cloudflare-ci-attested-object-provenance", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const recordsRoot = path.join(tmp, "records");
    const store = memoryControlPlaneArtifactStore();
    const sourceRevision = await reviewedRevision(tmp, $, deployment);
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir);
    const archiveBytes = await createStaticWebappArtifactBundleBytes(artifactDir);
    const archivePath = path.join(tmp, "artifact.bundle.json");
    await fsp.writeFile(archivePath, archiveBytes);
    const admitted = await resolveCloudflarePagesArtifactInput({
      workspaceRoot: tmp,
      recordsRoot,
      deployment,
      submissionId: "cf-ci-submit",
      objectStore: store,
      artifactInput: {
        kind: "ci_attested",
        artifactRef: pathToFileURL(archivePath).toString(),
        artifactDigest: digestStaticWebappArtifactBundleBytes(archiveBytes),
        sourceRevision,
        deploymentLabel: deployment.label,
        buildTarget: deployment.component.target,
        ciRunId: "ci-123",
      },
    });
    assert.equal(admitted.object?.provenance.deploymentId, deployment.deploymentId);
    assert.equal(admitted.object?.provenance.submissionId, "cf-ci-submit");
    await fsp.rm(artifactDir, { recursive: true, force: true });
    await materializeSnapshotArtifacts({
      store,
      outputRoot: path.join(tmp, "worker-artifacts"),
      snapshot: {
        deploymentId: deployment.deploymentId,
        submissionId: "cf-ci-submit",
        action: { kind: "deploy", publishInput: { kind: "exact-artifact", artifact: admitted } },
      } as any,
    });
  });
});

test("cloudflare existing_admitted_artifact reuses object-backed artifacts without local blob paths", async () => {
  await runInTemp("cloudflare-existing-object-artifact", async (tmp) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const recordsRoot = path.join(tmp, "records");
    const store = memoryControlPlaneArtifactStore();
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir, "<html>existing</html>\n");
    const admitted = await admitStaticWebappArtifact({
      recordsRoot,
      artifactDir,
      objectStore: store,
      deploymentId: deployment.deploymentId,
      submissionId: "cf-prior-submit",
      producer: { producerKind: "existing_admitted_artifact" },
    });
    await fsp.rm(artifactDir, { recursive: true, force: true });
    const resolved = await resolveCloudflarePagesArtifactInput({
      workspaceRoot: tmp,
      recordsRoot,
      deployment,
      submissionId: "cf-existing-submit",
      objectStore: store,
      artifactInput: {
        kind: "existing_admitted_artifact",
        artifactIdentity: admitted.identity,
      },
    });
    assert.equal(resolved.object?.key, admitted.object?.key);
    assert.equal(resolved.producerKind, "existing_admitted_artifact");
    assert.match(resolved.storedArtifactPath, /^artifact-object:\/\//);
    await materializeSnapshotArtifacts({
      store,
      outputRoot: path.join(tmp, "worker-artifacts"),
      snapshot: {
        deploymentId: deployment.deploymentId,
        submissionId: "cf-existing-submit",
        action: { kind: "deploy", publishInput: { kind: "exact-artifact", artifact: resolved } },
      } as any,
    });
  });
});
