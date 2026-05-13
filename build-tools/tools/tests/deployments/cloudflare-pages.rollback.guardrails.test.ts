#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import { artifactIdentityForStaticWebappDir } from "../../deployments/static-webapp-artifacts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  cloudflarePagesPreviewFixture,
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { runInTemp } from "../lib/test-helpers";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";

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
    VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    VBR_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    VBR_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
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
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
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
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(normalServer.port)} --smoke-connect-protocol https:`;
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
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --rollback --source-run-id ${previewRunId} --records-root ${recordsRoot}`,
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
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --rollback --source-run-id ${normalSummary.deployRunId} --records-root ${recordsRoot}`,
        /recorded exact artifact is unavailable/,
      );
    } finally {
      await normalServer.close();
    }
  });
});

test("cloudflare-pages production rollback requires fresh approval evidence", async () => {
  await runInTemp("cloudflare-pages-rollback-prod-approval", async (tmp, $) => {
    const baseLanePolicy = cloudflarePagesDeploymentFixture().lanePolicy;
    const deployment = cloudflarePagesDeploymentFixture({
      deploymentId: "pleomino-prod",
      label: "//projects/deployments/pleomino-prod:deploy",
      protectionClass: "production_facing",
      environmentStage: "prod",
      lanePolicy: {
        ...baseLanePolicy,
        sourceRefPolicy: {
          dev: "main",
          staging: "main",
          prod: "main",
        },
        governance: {
          ...baseLanePolicy.governance,
          sourceRefPolicies: baseLanePolicy.governance.sourceRefPolicies.map((policy) =>
            policy.stage === "prod"
              ? {
                  ...policy,
                  allowedRefs: ["main"],
                  requiredChecks: [],
                }
              : policy,
          ),
        },
      },
      admissionPolicy: {
        ...cloudflarePagesDeploymentFixture().admissionPolicy,
        ref: "//projects/deployments/pleomino-prod:prod_release",
        allowedRefs: ["main"],
        requiredApprovals: ["prod-approval", "release-owner"],
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
    await installCloudflarePagesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const resolvedDeployment = (await resolveDeploymentFromTarget(
      tmp,
      deployment.label,
    )) as typeof deployment;
    const server = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const deployEvidence = deploymentAdmissionEvidenceFixture({
        deployment: resolvedDeployment,
        operationKind: "deploy",
        sourceRevision: (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse main`).stdout.trim(),
        artifactIdentity: await artifactIdentityForStaticWebappDir(artifactDir),
      });
      await fsp.writeFile(evidenceJson, JSON.stringify(deployEvidence, null, 2) + "\n", "utf8");
      const seededRun = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https: --admission-evidence-json ${evidenceJson}`;
      const seededSummary = JSON.parse(String(seededRun.stdout));
      await assert.rejects(
        async () =>
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: fakeCloudflareEnv(fake),
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --publish-only --rollback --source-run-id ${seededSummary.deployRunId} --records-root ${recordsRoot}`,
        /requires approval prod-approval/,
      );
    } finally {
      await server.close();
    }
  });
});
