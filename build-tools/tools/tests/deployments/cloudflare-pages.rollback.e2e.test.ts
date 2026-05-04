#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { cloudflarePagesPublishedPath } from "../../deployments/cloudflare-pages-preview";
import { runInTemp } from "../lib/test-helpers";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
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
    BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    BNX_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    BNX_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}

test("cloudflare-pages rollback re-publishes a prior admitted exact artifact", async () => {
  await runInTemp("cloudflare-pages-rollback-e2e", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const deploymentJson = path.join(tmp, "deployment.json");
    const recordsRoot = path.join(tmp, "records");
    const artifactA = path.join(tmp, "artifact-a");
    const artifactB = path.join(tmp, "artifact-b");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactA, "<html>known-good</html>\n");
    await writeArtifact(artifactB, "<html>bad-release</html>\n");
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
    const server = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const firstRun = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactA} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const firstSummary = JSON.parse(String(firstRun.stdout));
      await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactB} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const rollbackRun = await $({
        cwd: tmp,
        env: fakeCloudflareEnv(fake),
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --rollback --source-run-id ${firstSummary.deployRunId} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const rollbackSummary = JSON.parse(String(rollbackRun.stdout));
      assert.equal(rollbackSummary.operationKind, "rollback");
      assert.equal(rollbackSummary.runClassification, "rollback");
      const record = JSON.parse(await fsp.readFile(rollbackSummary.recordPath, "utf8"));
      assert.equal(record.parentRunId, firstSummary.deployRunId);
      assert.equal(record.effectiveRunTarget.providerTargetIdentity, record.providerTargetIdentity);
      assert.equal(
        await fsp.readFile(
          path.join(
            cloudflarePagesPublishedPath(fake.publishRoot, deployment.providerTarget),
            "index.html",
          ),
          "utf8",
        ),
        "<html>known-good</html>\n",
      );
    } finally {
      await server.close();
    }
  });
});
