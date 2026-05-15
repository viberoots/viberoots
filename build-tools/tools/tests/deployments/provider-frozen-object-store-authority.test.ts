#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/s3-static-control-plane";
import { handleControlPlaneSubmit } from "../../deployments/nixos-shared-host-control-plane-service-api";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";

async function writeStaticArtifact(root: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>frozen</html>\n", "utf8");
  return root;
}

test("production provider submit requires object-store artifact authority", async () => {
  await runInTemp("provider-frozen-submit-object-store-authority", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const deployment = s3StaticDeploymentFixture();
    deployment.lanePolicy.sourceRefPolicy[deployment.environmentStage] = "main";
    deployment.admissionPolicy.allowedRefs = ["main"];
    deployment.admissionPolicy.requiredChecks = [];
    deployment.lanePolicy.governance.sourceRefPolicies =
      deployment.lanePolicy.governance.sourceRefPolicies.map((policy) =>
        policy.stage === deployment.environmentStage
          ? { ...policy, allowedRefs: ["main"], requiredChecks: [] }
          : policy,
      );
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const sourceRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse main`).stdout,
    ).trim();
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision,
    }) as any;
    delete admissionEvidence.requestedBy;
    const request = {
      schemaVersion: S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
      submissionId: "s3-provider-submit",
      submittedAt: new Date().toISOString(),
      deployment,
      operationKind: "deploy" as const,
      artifactDir: await writeStaticArtifact(path.join(tmp, "s3-provider-artifact")),
      admissionEvidence,
    };
    const backend = { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
    await assert.rejects(
      () =>
        handleControlPlaneSubmit(request, {
          workspaceRoot: tmp,
          paths: { recordsRoot, statePath: path.join(tmp, "state.json"), hostRoot: "" },
          backend,
        }),
      /production control-plane artifact authority requires an S3-compatible object store/,
    );
    const store = memoryControlPlaneArtifactStore();
    const queued = await handleControlPlaneSubmit(request, {
      workspaceRoot: tmp,
      paths: { recordsRoot, statePath: path.join(tmp, "state.json"), hostRoot: "" },
      backend,
      objectStore: store,
    });
    assert.equal(queued.lifecycleState, "queued");
    assert.ok([...store.objects.keys()].some((key) => key.includes("/execution-snapshot/")));
    assert.ok([...store.objects.keys()].some((key) => key.includes("/artifact/")));
  });
});
