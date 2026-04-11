#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { artifactIdentityForStaticWebappDir } from "../../deployments/static-webapp-artifacts.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import {
  cloudflarePagesPreviewFixture,
  cloudflarePagesDeploymentFixture,
} from "./cloudflare-pages.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

async function writeWranglerConfig(root: string) {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

function fakeCloudflareEnv(fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>) {
  return {
    ...process.env,
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    BNX_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    BNX_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}

test("cloudflare-pages rollback rejects preview source runs and missing exact artifacts", async () => {
  await runInTemp("cloudflare-pages-rollback-guardrails", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      preview: cloudflarePagesPreviewFixture(),
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>preview-source</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson,
      deployment,
    });
    const normalServer = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const normalRun = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(normalServer.port)} --smoke-connect-protocol https:`;
      const normalSummary = JSON.parse(String(normalRun.stdout));
      const previewRunId = "preview-source-run";
      const previewRecord = JSON.parse(await fsp.readFile(normalSummary.recordPath, "utf8"));
      previewRecord.deployRunId = previewRunId;
      previewRecord.publishMode = "preview";
      previewRecord.effectiveRunTarget = {
        ...deployment.providerTarget,
        previewBranch: "preview-short",
        providerTargetIdentity: `${deployment.providerTarget.providerTargetIdentity}#preview-short`,
        canonicalUrl: `https://preview-short.${deployment.providerTarget.project}.pages.dev/`,
      };
      previewRecord.previewIdentitySelector = {
        kind: "source_run",
        sourceRunId: normalSummary.deployRunId,
      };
      await fsp.writeFile(
        path.join(recordsRoot, "runs", `${previewRunId}.json`),
        JSON.stringify(previewRecord, null, 2) + "\n",
        "utf8",
      );
      await assert.rejects(
        async () =>
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: fakeCloudflareEnv(fake),
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --publish-only --rollback --source-run-id ${previewRunId} --records-root ${recordsRoot}`,
        /preview rather than the normal live target/,
      );
      const firstRecord = JSON.parse(await fsp.readFile(normalSummary.recordPath, "utf8"));
      await fsp.rm(firstRecord.artifact.storedArtifactPath, { recursive: true, force: true });
      await assert.rejects(
        async () =>
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: fakeCloudflareEnv(fake),
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --publish-only --rollback --source-run-id ${normalSummary.deployRunId} --records-root ${recordsRoot}`,
        /recorded exact artifact is unavailable/,
      );
    } finally {
      await normalServer.close();
    }
  });
});

test("cloudflare-pages production rollback requires fresh approval evidence", async () => {
  await runInTemp("cloudflare-pages-rollback-prod-approval", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      deploymentId: "pleomino-prod",
      label: "//projects/deployments/pleomino-prod:deploy",
      protectionClass: "production_facing",
      environmentStage: "prod",
      lanePolicy: {
        ...cloudflarePagesDeploymentFixture().lanePolicy,
        stageBranches: {
          dev: "env/pleomino/dev",
          staging: "env/pleomino/staging",
          prod: "env/pleomino/prod",
        },
      },
      admissionPolicy: {
        ...cloudflarePagesDeploymentFixture().admissionPolicy,
        ref: "//projects/deployments/pleomino-prod:prod_release",
        allowedRefs: ["env/pleomino/prod"],
        requiredApprovals: ["prod-approval"],
      },
      admissionPolicyRef: "//projects/deployments/pleomino-prod:prod_release",
      providerTarget: {
        ...cloudflarePagesDeploymentFixture().providerTarget,
        account: "web-platform-prod",
        project: "pleomino-prod-pages",
        id: "pleomino-prod-pages",
        providerTargetIdentity: "cloudflare-pages:web-platform-prod/pleomino-prod-pages",
        canonicalUrl: "https://pleomino-prod-pages.pages.dev/",
      },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const evidenceJson = path.join(tmp, "evidence.json");
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>prod-good</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-prod", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const server = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const deployEvidence = deploymentAdmissionEvidenceFixture({
        deployment,
        operationKind: "deploy",
        sourceRevision: (
          await $({ cwd: tmp, stdio: "pipe" })`git rev-parse env/pleomino/prod`
        ).stdout.trim(),
        artifactIdentity: await artifactIdentityForStaticWebappDir(artifactDir),
      });
      await fsp.writeFile(evidenceJson, JSON.stringify(deployEvidence, null, 2) + "\n", "utf8");
      const seededRun = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https: --admission-evidence-json ${evidenceJson}`;
      const seededSummary = JSON.parse(String(seededRun.stdout));
      await assert.rejects(
        async () =>
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: fakeCloudflareEnv(fake),
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --publish-only --rollback --source-run-id ${seededSummary.deployRunId} --records-root ${recordsRoot}`,
        /requires approval prod-approval/,
      );
    } finally {
      await server.close();
    }
  });
});
