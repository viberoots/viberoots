#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { startControlPlaneHarness } from "./nixos-shared-host.control-plane.helpers";
import {
  deploymentSourceRef,
  ensureNixosSharedHostReviewedSourceRef,
} from "./nixos-shared-host.fixture";
import { runInTemp } from "../lib/test-helpers";
import {
  writeCloudflareServiceArtifact,
  writeWranglerConfig,
} from "./cloudflare-pages.service-flow.helpers";
import { terminalControlPlaneRejectionMessage } from "../../deployments/deployment-provider-protected-front-door";
import { controlPlaneRecordFailureMessage } from "../../deployments/deployment-control-plane-record-failure";

async function gitStdout(cwd: string, $: any, ...args: string[]): Promise<string> {
  return String((await $({ cwd, stdio: "pipe" })`git ${args}`).stdout).trim();
}

async function commitLocalChange(cwd: string, $: any, name: string): Promise<string> {
  await fsp.writeFile(path.join(cwd, `${name}.txt`), `${name}\n`, "utf8");
  await $({ cwd, stdio: "pipe" })`git add ${`${name}.txt`}`;
  await $({ cwd, stdio: "pipe" })`git commit -m ${name}`;
  return await gitStdout(cwd, $, "rev-parse", "HEAD");
}

test("public cloudflare-pages deploy requires a control-plane URL for protected/shared targets", async () => {
  await runInTemp("cloudflare-pages-public-service-required", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeCloudflareServiceArtifact(artifactDir, "<html>service-required</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    await assert.rejects(
      $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactDir} --admission-evidence-json ${admissionEvidenceJson}`,
      /cloudflare-pages (shared_nonprod|production_facing) mutation requires --control-plane-url or VBR_DEPLOY_CONTROL_PLANE_URL/,
    );
  });
});

test("public cloudflare-pages deploy rejects mixed service and local records flags", async () => {
  await runInTemp("cloudflare-pages-public-service-mixed-flags", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    await writeCloudflareServiceArtifact(artifactDir, "<html>mixed-mode</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot: path.join(tmp, "host"),
      statePath: path.join(tmp, "platform-state.json"),
      recordsRoot,
    });
    try {
      await assert.rejects(
        $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactDir} --admission-evidence-json ${admissionEvidenceJson} --control-plane-url ${harness.controlPlane.url} --records-root ${recordsRoot}`,
        /service-only cloudflare-pages deploy does not support --records-root/,
      );
    } finally {
      await harness.close();
    }
  });
});

test("service-backed cloudflare-pages deploy fails closed when client source differs from service ref", async () => {
  await runInTemp("cloudflare-pages-reviewed-source-mismatch", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    await writeCloudflareServiceArtifact(artifactDir, "<html>source-mismatch</html>\n");
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const sourceRef = deploymentSourceRef(deployment as any);
    const serviceRevision = await gitStdout(tmp, $, "rev-parse", sourceRef);
    const clientRevision = await commitLocalChange(tmp, $, "client-drift");
    assert.notEqual(clientRevision, serviceRevision);
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot: path.join(tmp, "host"),
      statePath: path.join(tmp, "platform-state.json"),
      recordsRoot,
    });
    try {
      await assert.rejects(
        $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url}`,
        new RegExp(
          [
            `reviewed source mismatch for ${sourceRef}`,
            `clientExpectedSourceRevision=${clientRevision}`,
            `serviceReviewedSourceRevision=${serviceRevision}`,
            "service fetched the reviewed deployment source ref before admission",
            "that source ref is up to date and pushed before retrying",
          ].join("[\\s\\S]*"),
        ),
      );
    } finally {
      await harness.close();
    }
  });
});

test("service terminal admission rejection is reported without deploy-record lookup", () => {
  const message = terminalControlPlaneRejectionMessage({
    schemaVersion: "deployment-control-plane-status@1",
    submissionId: "cp-test",
    submittedAt: "2026-04-30T00:00:00.000Z",
    completedAt: "2026-04-30T00:00:01.000Z",
    deploymentId: "pleomino-staging",
    deploymentLabel: "//projects/deployments/pleomino-staging:deploy",
    operationKind: "deploy",
    providerTargetIdentity: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    lockScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    lifecycleState: "finished",
    terminationReason: "no_longer_admitted",
    rejectionCode: "no_longer_admitted",
    deployRunId: "deploy-test",
    dedupe: { mode: "created", requestFingerprint: "sha256:test" },
  });

  assert.equal(
    message,
    "shared control-plane mutation rejected for pleomino-staging: no_longer_admitted",
  );
});

test("service terminal record failures include step, ids, and inspection command", () => {
  const message = controlPlaneRecordFailureMessage({
    deployRunId: "deploy-redacted",
    finalOutcome: "publish_failed",
    failedStep: "publish",
    error:
      "payload redacted (sha256:b37ccd6d8a492dfeebf6a9faa4a4b04650f23958e3527f7cdf31919f8a9450cb)",
    errorFingerprint: "sha256:b37ccd6d8a492dfeebf6a9faa4a4b04650f23958e3527f7cdf31919f8a9450cb",
    controlPlane: { submissionId: "cp-redacted" },
  });

  assert.match(message, /outcome publish_failed/);
  assert.match(message, /failed step publish/);
  assert.match(message, /deployRunId deploy-redacted/);
  assert.match(message, /submissionId cp-redacted/);
  assert.match(message, /errorFingerprint sha256:b37ccd6d8a492dfe/);
  assert.match(message, /deploy --record --deploy-run-id deploy-redacted --text/);
});

test("service terminal admission rejection includes concrete rejection details", () => {
  const message = terminalControlPlaneRejectionMessage({
    schemaVersion: "deployment-control-plane-status@1",
    submissionId: "cp-test",
    submittedAt: "2026-04-30T00:00:00.000Z",
    completedAt: "2026-04-30T00:00:01.000Z",
    deploymentId: "pleomino-staging",
    deploymentLabel: "//projects/deployments/pleomino-staging:deploy",
    operationKind: "deploy",
    providerTargetIdentity: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    lockScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    lifecycleState: "finished",
    terminationReason: "no_longer_admitted",
    rejectionCode: "no_longer_admitted",
    rejectionMessage: "prerequisite deployment has no successful admitted run: pleomino-dev",
    deployRunId: "deploy-test",
    dedupe: { mode: "created", requestFingerprint: "sha256:test" },
  });

  assert.equal(
    message,
    "shared control-plane mutation rejected for pleomino-staging: no_longer_admitted: prerequisite deployment has no successful admitted run: pleomino-dev",
  );
});
