#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane";
import { artifactIdentityForStaticWebappDir } from "../../deployments/nixos-shared-host-artifacts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";
import { runInTemp } from "../lib/test-helpers";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("control-plane records and replay snapshots preserve supply-chain admission facts", async () => {
  await runInTemp("deployment-admission-supply-chain-replay", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      admissionPolicy: {
        ...nixosSharedHostDeploymentFixture().admissionPolicy,
        attestation: {
          trustedBuilderIdentities: ["builder:trusted"],
          acceptedProvenanceFormats: ["slsa_provenance_v1"],
          artifactBinding: "source_revision_and_build_inputs",
          expiredBehavior: "fail_closed",
          revokedBehavior: "fail_closed",
          trustDriftBehavior: "fail_closed",
          signatureRequired: true,
          trustedSignerIdentities: ["signer:trusted"],
        },
        sbom: { required: true, acceptedFormats: ["cyclonedx-json"] },
        supplyChainGates: [
          { name: "vuln/critical", category: "vulnerability", applyAt: "publish_admission" },
        ],
      },
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const sourceRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse env/pleomino/dev`).stdout,
    ).trim();
    const artifactIdentity = await artifactIdentityForStaticWebappDir(artifactDir);
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
        paths: { statePath: path.join(tmp, "platform-state.json"), hostRoot, recordsRoot },
        admissionEvidence: deploymentAdmissionEvidenceFixture({
          deployment,
          operationKind: "deploy",
          sourceRevision,
          artifactIdentity,
          buildInputsFingerprint: "sha256:build-inputs",
          supplyChainGates: [
            { name: "vuln/critical", category: "vulnerability", applyAt: "publish_admission" },
          ],
        }),
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      assert.equal(
        result.record.admittedContext.policyEvaluation.attestation?.builderIdentity,
        "builder:trusted",
      );
      assert.equal(result.record.admittedContext.policyEvaluation.sbom?.format, "cyclonedx-json");
      assert.equal(
        result.record.admittedContext.policyEvaluation.supplyChainGates[0]?.name,
        "vuln/critical",
      );
      const replay = JSON.parse(await fsp.readFile(result.record.replaySnapshotPath!, "utf8"));
      assert.equal(
        replay.admittedContext.policyEvaluation.attestation.builderIdentity,
        "builder:trusted",
      );
      assert.equal(replay.admittedContext.policyEvaluation.sbom.format, "cyclonedx-json");
      assert.equal(
        replay.admittedContext.policyEvaluation.supplyChainGates[0].name,
        "vuln/critical",
      );
    } finally {
      await server.close();
    }
  });
});
