#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane";
import { runInTemp } from "../lib/test-helpers";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

async function writeArtifact(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, body, "utf8");
  }
}

test("nixos-shared-host deploy records smoke failure when the public health path fails", async () => {
  await runInTemp("nixos-shared-host-smoke-failure", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir, { "index.html": "<html>ok</html>\n" });
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      await assert.rejects(
        submitNixosSharedHostControlPlaneRun({
          workspaceRoot: tmp,
          operationKind: "deploy",
          deployment,
          artifactDir,
          paths: {
            statePath: path.join(tmp, "platform-state.json"),
            hostRoot,
            recordsRoot,
          },
          admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
          smokeConnectOverride: {
            protocol: "https:",
            hostname: "127.0.0.1",
            port: server.port,
            rejectUnauthorized: false,
          },
        }),
        (error: any) => {
          assert.equal(error.record.finalOutcome, "smoke_failed_after_publish");
          assert.equal(error.record.failedStep, "smoke");
          assert.equal(error.record.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
          assert.match(error.record.error, /expected 200/);
          return true;
        },
      );
      const runsDir = path.join(recordsRoot, "runs");
      const [recordName] = await fsp.readdir(runsDir);
      const record = JSON.parse(await fsp.readFile(path.join(runsDir, recordName), "utf8"));
      assert.equal(record.runClassification, "deploy");
      assert.equal(record.finalOutcome, "smoke_failed_after_publish");
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
    } finally {
      await server.close();
    }
  });
});

test("nixos-shared-host deploy rejects a reachable hostname serving the wrong artifact contents", async () => {
  await runInTemp("nixos-shared-host-content-mismatch", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const fixedRoot = path.join(tmp, "wrong-public-root");
    await writeArtifact(artifactDir, { "index.html": "<html>expected</html>\n" });
    await writeArtifact(fixedRoot, { "index.html": "<html>wrong</html>\n" });
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, fixedRoot });
    try {
      await assert.rejects(
        submitNixosSharedHostControlPlaneRun({
          workspaceRoot: tmp,
          operationKind: "deploy",
          deployment,
          artifactDir,
          paths: {
            statePath: path.join(tmp, "platform-state.json"),
            hostRoot: path.join(tmp, "host"),
            recordsRoot: path.join(tmp, "records"),
          },
          admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
          smokeConnectOverride: {
            protocol: "https:",
            hostname: "127.0.0.1",
            port: server.port,
            rejectUnauthorized: false,
          },
        }),
        (error: any) => {
          assert.equal(error.record.finalOutcome, "smoke_failed_after_publish");
          assert.equal(error.record.failedStep, "smoke");
          assert.equal(error.record.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
          assert.match(error.message, /smoke content mismatch/);
          return true;
        },
      );
    } finally {
      await server.close();
    }
  });
});
