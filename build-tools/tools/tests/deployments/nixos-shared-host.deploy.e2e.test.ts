#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { inspectNixosSharedHostAdmission } from "../../deployments/nixos-shared-host-admission-inspect.ts";
import { inspectNixosSharedHostReplay } from "../../deployments/nixos-shared-host-replay-inspect.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import {
  readRecord,
  startControlPlaneHarness,
  writeDemoArtifact,
  writeSsrArtifact,
} from "./nixos-shared-host.control-plane.helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

test("nixos-shared-host deploy CLI completes the shared-dev static-webapp flow end to end", async () => {
  await runInTemp("nixos-shared-host-e2e", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const statePath = path.join(tmp, "platform-state.json");
    const hostConfigPath = path.join(tmp, "rendered-host.json");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deployment,
      deploymentLabel: deployment.label,
    });
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot,
      fixedRoot: artifactDir,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
      hostConfigPath,
    });
    try {
      const result = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.operationKind, "deploy");
      assert.equal(summary.runClassification, "deploy");
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.publicUrl, "https://demoapp.apps.kilty.io/");
      assert.equal(summary.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
      const record = await readRecord(harness.controlPlane.url, summary.deployRunId);
      assert.equal(record.schemaVersion, "deploy-record@2026-04-10");
      assert.equal(record.deployRunId, summary.deployRunId);
      assert.equal(record.runClassification, "deploy");
      assert.equal(record.lifecycleState, "finished");
      assert.equal(record.provider, "nixos-shared-host");
      assert.equal(record.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(record.controlPlane.submissionId, summary.controlPlane.submissionId);
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
      assert.equal(
        record.controlPlane.executionSnapshotPath,
        summary.controlPlane.executionSnapshotPath,
      );
      assert.equal(record.admittedContext.source.sourceRef, "env/pleomino/dev");
      assert.equal(record.admittedContext.targetEnvironment.targetRef, "env/pleomino/dev");
      assert.equal(record.artifact.identity, summary.artifactIdentity);
      assert.match(record.artifact.storedArtifactPath, /records\/artifacts\/blobs\//);
      assert.match(record.artifact.provenancePath, /records\/artifacts\/provenance\//);
      assert.match(record.deploymentMetadataFingerprint, /^sha256:/);
      assert.match(record.replaySnapshotPath, /records\/replay\//);
      assert.equal(record.finalOutcome, "succeeded");
      const snapshot = JSON.parse(
        await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
      );
      assert.equal(snapshot.operationKind, "deploy");
      assert.equal(snapshot.deploymentLabel, "//projects/deployments/demoapp-dev:deploy");
      assert.equal(snapshot.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(snapshot.action.publishBehavior, "deploy");
      assert.equal(snapshot.admittedContext.source.sourceRef, "env/pleomino/dev");
      await fsp.rm(artifactDir, { recursive: true, force: true });
      const replay = await inspectNixosSharedHostReplay({
        deployRunId: summary.deployRunId,
        recordsRoot,
        backendDatabaseUrl,
      });
      assert.equal(replay.deployRunId, summary.deployRunId);
      assert.equal(replay.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(replay.publishInput.kind, "component-artifacts");
      assert.equal(replay.publishInput.components[0].artifact.identity, summary.artifactIdentity);
      assert.equal(replay.replaySnapshotPath, record.replaySnapshotPath);
      assert.equal(replay.deploymentMetadataFingerprint, record.deploymentMetadataFingerprint);
      assert.equal(replay.admittedContext.source.sourceRef, "env/pleomino/dev");
      assert.equal("recordPath" in replay, false);
      assert.equal("controlPlaneExecutionSnapshotPath" in replay, false);
      const admission = await inspectNixosSharedHostAdmission({
        deployRunId: summary.deployRunId,
        recordsRoot,
        backendDatabaseUrl,
      });
      assert.equal(admission.deployRunId, summary.deployRunId);
      assert.equal(admission.admittedContext.environmentStage, "dev");
      assert.equal(admission.admittedContext.targetEnvironment.targetRef, "env/pleomino/dev");
      assert.equal(
        admission.admittedContext.policyEvaluation.laneGovernance.governanceRef,
        deployment.lanePolicy.governanceRef,
      );
      assert.equal("recordPath" in admission, false);
      assert.equal("controlPlaneExecutionSnapshotPath" in admission, false);
      const rendered = JSON.parse(await fsp.readFile(hostConfigPath, "utf8"));
      assert.ok(rendered.containers.demoapp);
    } finally {
      await harness.close();
      await server.close();
    }
  });
});

test("nixos-shared-host deploy CLI completes the reviewed ssr-webapp flow end to end", async () => {
  await runInTemp("nixos-shared-host-ssr-e2e", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      component: { kind: "ssr-webapp", target: "//projects/apps/demoapp:app" },
      publisher: { type: "nixos-shared-host-ssr-webapp" },
      runtime: {
        appName: "demoapp",
        containerPort: 3000,
        healthPath: "/healthz",
        runtimeContract: {
          type: "node-dist-server-v1",
          framework: "vite",
          serverEntry: "dist/server/index.js",
          clientDir: "dist/client",
          servingTopology: "single-host-node-with-nginx",
          environmentNeutralBuild: true,
          runtimeConfigInjection: "runtime_config_requirements",
          secretInjection: "secret_requirements",
        },
      } as any,
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    const hostConfigPath = path.join(tmp, "rendered-host.json");
    await writeSsrArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deployment,
      deploymentLabel: deployment.label,
    });
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot,
      fixedRoot: artifactDir,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
      hostConfigPath,
    });
    try {
      const result = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.publicUrl, "https://demoapp.apps.kilty.io/");
      const rendered = JSON.parse(await fsp.readFile(hostConfigPath, "utf8"));
      assert.equal(rendered.containers.demoapp.runtime, "ssr-webapp-host");
      assert.equal(
        rendered.containers.demoapp.serverEntry,
        "/srv/ssr-app/live/dist/server/index.js",
      );
      const record = await readRecord(harness.controlPlane.url, summary.deployRunId);
      assert.equal(record.publisherType, "nixos-shared-host-ssr-webapp");
      assert.equal(record.smokeRunnerType, "nixos-shared-host-ssr-webapp-smoke");
      assert.equal(record.componentResults[0].artifact.kind, "ssr-webapp");
      assert.equal(record.componentResults[0].artifactIdentity.startsWith("ssr-webapp:"), true);
    } finally {
      await harness.close();
      await server.close();
    }
  });
});
