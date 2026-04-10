#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { grantsFor } from "../../deployments/deployment-control-plane-authz.ts";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { acquireBreakGlassFreeze } from "../../deployments/nixos-shared-host-break-glass-freeze.ts";
import { runNixosSharedHostBreakGlassDeploy } from "../../deployments/nixos-shared-host-break-glass.ts";
import {
  admitNixosSharedHostComponentArtifacts,
  compositeNixosSharedHostArtifactIdentity,
} from "../../deployments/nixos-shared-host-component-artifacts.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string, body: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${body}</html>\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("break-glass deploy captures evidence and records exact admitted-artifact reuse", async () => {
  await runInTemp("deployment-control-plane-break-glass", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const originalArtifact = path.join(tmp, "artifact-original");
    const emergencyArtifact = path.join(tmp, "artifact-emergency");
    await writeArtifact(originalArtifact, "original");
    await writeArtifact(emergencyArtifact, "emergency");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-break-glass-1",
      artifactIdentity: "artifact-break-glass-1",
      artifactLineageId: "artifact-break-glass-1",
    });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
    try {
      await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir: originalArtifact,
        paths,
        admissionEvidence,
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      const componentArtifacts = await admitNixosSharedHostComponentArtifacts({
        deployment,
        recordsRoot: paths.recordsRoot,
        artifactDirsByComponentId: { default: emergencyArtifact },
      });
      const compositeArtifactIdentity =
        compositeNixosSharedHostArtifactIdentity(componentArtifacts);
      const authorization = grantsFor({ principalId: "user:incident-requester" }, [
        { role: "break_glass", scope: { kind: "break_glass_incident", value: "INC-123" } },
      ]);
      const result = await runNixosSharedHostBreakGlassDeploy({
        deployment,
        componentArtifacts,
        compositeArtifactIdentity,
        paths,
        authorization,
        incidentRef: "INC-123",
        justification: "control plane backend unavailable during incident",
        bypassReason: "shared control plane unavailable",
        executedBy: { principalId: "user:incident-operator" },
        approvedBy: { principalId: "user:incident-commander" },
        publishBehavior: "publish-only",
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      assert.equal(result.record.breakGlass?.incidentRef, "INC-123");
      assert.equal(result.record.breakGlass?.selection.artifactIdentity, compositeArtifactIdentity);
      assert.equal(result.record.artifact?.identity, compositeArtifactIdentity);
      const evidence = JSON.parse(
        await fsp.readFile(String(result.record.breakGlass?.evidencePath), "utf8"),
      ) as { requestedBy: { principalId: string } };
      assert.equal(evidence.requestedBy.principalId, "user:incident-requester");
    } finally {
      await server.close();
    }
  });
});

test("break-glass freezes block simultaneous normal-path mutation and reject under-specified requests", async () => {
  await runInTemp("deployment-control-plane-break-glass-freeze", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const recordsRoot = path.join(tmp, "records");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const freeze = await acquireBreakGlassFreeze(
      recordsRoot,
      deployment.providerTarget.sharedDevTargetIdentity,
    );
    try {
      await assert.rejects(
        submitNixosSharedHostControlPlaneRun({
          workspaceRoot: tmp,
          operationKind: "explicit_removal",
          deployment,
          paths: {
            statePath: path.join(tmp, "platform-state.json"),
            hostRoot: path.join(tmp, "host"),
            recordsRoot,
          },
        }),
        /break-glass freeze is active/,
      );
    } finally {
      await freeze.release();
    }
    await assert.rejects(
      runNixosSharedHostBreakGlassDeploy({
        deployment,
        componentArtifacts: [],
        compositeArtifactIdentity: "",
        paths: {
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot: path.join(tmp, "host"),
          recordsRoot,
        },
        authorization: grantsFor({ principalId: "user:nope" }, [
          { role: "break_glass", scope: { kind: "break_glass_incident", value: "INC-999" } },
        ]),
        incidentRef: "",
        justification: "",
        bypassReason: "",
        executedBy: { principalId: "user:nope" },
      }),
      /break-glass requires incidentRef, justification, and bypassReason/,
    );
  });
});
