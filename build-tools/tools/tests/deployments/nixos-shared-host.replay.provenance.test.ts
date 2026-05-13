#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  localHarnessControlPlaneDatabaseUrl,
  syncBackendDeployRecord,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import {
  readNixosSharedHostReplaySnapshot,
  resolveNixosSharedHostReplaySelection,
} from "../../deployments/nixos-shared-host-replay";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("nixos-shared-host replay snapshot reader migrates the prior schema and backfills provenance", async () => {
  await runInTemp("nixos-shared-host-replay-provenance-migrate", async (tmp) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const replaySnapshotPath = path.join(tmp, "snapshot.json");
    await fsp.writeFile(
      replaySnapshotPath,
      JSON.stringify(
        {
          schemaVersion: "nixos-shared-host-replay-snapshot@2",
          deployRunId: "deploy-123",
          createdAt: "2026-04-10T00:00:00.000Z",
          deploymentId: deployment.deploymentId,
          deploymentLabel: deployment.label,
          providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
          deploymentMetadataFingerprint: "sha256:deadbeef",
          artifactIdentity: "artifact-123",
          publishInput: {
            kind: "exact-artifact",
            artifact: {
              kind: "static-webapp",
              identity: "artifact-123",
              storedArtifactPath: "/tmp/artifact",
              provenancePath: "/tmp/artifact.json",
            },
          },
          admittedContext: {
            lanePolicyRef: deployment.lanePolicyRef,
            lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
            admissionPolicyRef: deployment.admissionPolicyRef,
            admissionPolicyFingerprint: deployment.admissionPolicy.fingerprint,
            environmentStage: deployment.environmentStage,
            source: {
              mode: "reviewed_source_ref",
              sourceRef: "main",
              sourceRevision: "rev-123",
            },
            targetEnvironment: {
              mode: "reviewed_source_snapshot",
              targetRef: "main",
              targetRevision: "rev-123",
              providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
              lockScope: deployment.providerTarget.providerTargetIdentity,
            },
            policyEvaluation: { checks: [], approvals: [] },
          },
          deployment,
          platformStateSnapshotPath: "/tmp/platform-state.json",
          hostConfigSnapshotPath: "/tmp/host-config.json",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const snapshot = await readNixosSharedHostReplaySnapshot(replaySnapshotPath);
    assert.equal(snapshot.schemaVersion, "nixos-shared-host-replay-snapshot@3");
    assert.equal(snapshot.runnerIdentities.publisher, "nixos-shared-host-static-webapp");
    assert.equal(snapshot.releaseActionPlan?.length, 0);
  });
});

test("nixos-shared-host replay fails closed when stored runner provenance no longer matches", async () => {
  await runInTemp("nixos-shared-host-replay-provenance-mismatch", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot,
      fixedRoot: artifactDir,
    });
    try {
      const result = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: {
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot,
          recordsRoot,
        },
        admissionEvidence: deploymentAdmissionEvidenceFixture({
          deployment,
          operationKind: "deploy",
          sourceRevision: "rev-source-123",
          artifactIdentity: "artifact-123",
          artifactLineageId: "artifact-123",
        }),
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      const record = JSON.parse(await fsp.readFile(result.recordPath, "utf8"));
      record.runnerIdentities.publisher = "nixos-shared-host-static-webapp@legacy";
      await fsp.writeFile(result.recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
      await syncBackendDeployRecord(
        { recordsRoot, databaseUrl: backendDatabaseUrl },
        result.recordPath,
      );
      await assert.rejects(
        resolveNixosSharedHostReplaySelection({
          deployment,
          recordsRoot,
          backendDatabaseUrl,
          sourceRunId: result.record.deployRunId,
          rollback: false,
        }),
        /publisher runner identity mismatch/,
      );
    } finally {
      await server.close();
    }
  });
});

test("nixos-shared-host replay fails closed when a source snapshot omits the recorded release-action plan", async () => {
  await runInTemp("nixos-shared-host-replay-provenance-missing-plan", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot,
      fixedRoot: artifactDir,
    });
    try {
      const result = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment: {
          ...deployment,
          releaseActions: [
            {
              ref: "//projects/deployments/demoapp-shared:post_publish_verification",
              type: "post_publish_verification",
              phase: "post_smoke",
              runCondition: "success_only",
              abortBehavior: "fail_run",
              dataCompatibility: "reversible",
              replayPolicy: {
                deploy_publish_slice: "skip",
                retry: "skip",
                rollback: "fail",
                promotion: "skip",
              },
              duplicateSafety: {},
              operationKeys: {},
              requiredSecretRequirementNames: [],
              requiredRuntimeConfigRequirementNames: [],
            },
          ],
        },
        artifactDir,
        paths: {
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot,
          recordsRoot,
        },
        admissionEvidence: deploymentAdmissionEvidenceFixture({
          deployment,
          operationKind: "deploy",
          sourceRevision: "rev-source-123",
          artifactIdentity: "artifact-123",
          artifactLineageId: "artifact-123",
        }),
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      const replaySnapshot = JSON.parse(
        await fsp.readFile(result.record.replaySnapshotPath!, "utf8"),
      );
      delete replaySnapshot.releaseActionPlan;
      await fsp.writeFile(
        result.record.replaySnapshotPath!,
        JSON.stringify(replaySnapshot, null, 2) + "\n",
        "utf8",
      );
      await syncBackendDeployRecord(
        { recordsRoot, databaseUrl: backendDatabaseUrl },
        result.recordPath,
      );
      await assert.rejects(
        resolveNixosSharedHostReplaySelection({
          deployment: {
            ...deployment,
            releaseActions: replaySnapshot.deployment.releaseActions,
          },
          recordsRoot,
          backendDatabaseUrl,
          sourceRunId: result.record.deployRunId,
          rollback: false,
        }),
        /missing the release-action plan required for replay/,
      );
    } finally {
      await server.close();
    }
  });
});
