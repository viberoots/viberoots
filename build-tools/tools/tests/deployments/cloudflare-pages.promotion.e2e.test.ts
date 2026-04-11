#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveCloudflarePagesPromotionSelection } from "../../deployments/cloudflare-pages-promotion.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

async function writeWranglerConfig(root: string) {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

function pleominoDevDeployment() {
  const lanePolicy = {
    ...cloudflarePagesDeploymentFixture().lanePolicy,
    promotionCompatibility: {
      crossProviderPromotionEdges: ["dev->staging"],
    },
  };
  return nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: "//projects/deployments/pleomino-dev:deploy",
    lanePolicy,
    lanePolicyRef: lanePolicy.ref,
    component: { kind: "static-webapp", target: "//projects/apps/pleomino:app" },
    runtime: { appName: "pleomino", containerPort: 3000, healthPath: "/healthz" },
  });
}

function pleominoProdDeployment() {
  const lanePolicy = {
    ...cloudflarePagesDeploymentFixture().lanePolicy,
    promotionCompatibility: {
      crossProviderPromotionEdges: ["dev->staging"],
    },
  };
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture({
    ref: "//projects/deployments/pleomino-shared:prod_release",
    name: "prod_release",
    allowedRefs: ["env/pleomino/prod"],
    requiredChecks: [],
    fingerprint: "sha256:admission-pleomino-prod",
  });
  return cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-prod",
    label: "//projects/deployments/pleomino-prod:deploy",
    lanePolicy,
    lanePolicyRef: lanePolicy.ref,
    protectionClass: "production_facing",
    environmentStage: "prod",
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    providerTarget: {
      account: "web-platform-prod",
      project: "pleomino-prod-pages",
      id: "pleomino-prod-pages",
      canonicalUrl: "https://pleomino-prod-pages.pages.dev/",
      providerTargetIdentity: "cloudflare-pages:web-platform-prod/pleomino-prod-pages",
    },
  });
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

test("cloudflare-pages allows reviewed cross-provider same-artifact promotion only on declared edges", async () => {
  await runInTemp("cloudflare-pages-promotion-e2e", async (tmp, $) => {
    const dev = pleominoDevDeployment();
    const staging = cloudflarePagesDeploymentFixture({
      lanePolicy: dev.lanePolicy,
      lanePolicyRef: dev.lanePolicyRef,
    });
    const prod = pleominoProdDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const devJson = path.join(tmp, "pleomino-dev.json");
    const stagingJson = path.join(tmp, "pleomino-staging.json");
    const prodJson = path.join(tmp, "pleomino-prod.json");
    await writeArtifact(artifactDir, "<html>pleomino release</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-prod", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, dev);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    await ensureNixosSharedHostStageBranch(tmp, $, prod);
    await writeDeploymentJson(devJson, dev);
    await writeDeploymentJson(stagingJson, staging);
    await writeDeploymentJson(prodJson, prod);
    const devEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson: devJson,
      deployment: dev,
    });
    const devServer = await startNixosSharedHostPublicServer({ deployment: dev, hostRoot });
    const stagingServer = await startCloudflarePagesPublicServer({
      deployment: staging,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    const prodServer = await startCloudflarePagesPublicServer({
      deployment: prod,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      const devRun = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${devJson} --admission-evidence-json ${devEvidenceJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(devServer.port)} --smoke-connect-protocol https:`;
      const devSummary = JSON.parse(String(devRun.stdout));
      const stagingPromotion = await resolveCloudflarePagesPromotionSelection({
        workspaceRoot: tmp,
        deployment: staging,
        recordsRoot,
        sourceRunId: devSummary.deployRunId,
      });
      assert.equal(stagingPromotion.operationKind, "promotion");
      assert.equal(stagingPromotion.parentRunId, devSummary.deployRunId);
      await assert.rejects(
        resolveCloudflarePagesPromotionSelection({
          workspaceRoot: tmp,
          deployment: prod,
          recordsRoot,
          sourceRunId: devSummary.deployRunId,
        }),
        /promotion edge is not allowed by the current lane policy/,
      );
    } finally {
      await devServer.close();
      await stagingServer.close();
      await prodServer.close();
    }
  });
});

test("cloudflare-pages promotion fails closed when staging smoke blocks the promoted artifact", async () => {
  await runInTemp("cloudflare-pages-promotion-smoke-failure", async (tmp, $) => {
    const dev = pleominoDevDeployment();
    const staging = cloudflarePagesDeploymentFixture({
      lanePolicy: dev.lanePolicy,
      lanePolicyRef: dev.lanePolicyRef,
    });
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const devJson = path.join(tmp, "pleomino-dev.json");
    await writeArtifact(artifactDir, "<html>expected</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, dev);
    await ensureNixosSharedHostStageBranch(tmp, $, staging);
    await writeDeploymentJson(devJson, dev);
    const devEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson: devJson,
      deployment: dev,
    });
    const devServer = await startNixosSharedHostPublicServer({ deployment: dev, hostRoot });
    const wrongPublishRoot = path.join(tmp, "wrong-public");
    await writeArtifact(
      path.join(wrongPublishRoot, staging.providerTarget.project),
      "<html>wrong</html>\n",
    );
    const stagingServer = await startCloudflarePagesPublicServer({
      deployment: staging,
      publishRoot: wrongPublishRoot,
      tlsRoot: tmp,
    });
    const originalEnv = { ...process.env };
    Object.assign(process.env, fakeCloudflareEnv(fake));
    try {
      const devRun = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${devJson} --admission-evidence-json ${devEvidenceJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(devServer.port)} --smoke-connect-protocol https:`;
      const devSummary = JSON.parse(String(devRun.stdout));
      const promotion = await resolveCloudflarePagesPromotionSelection({
        workspaceRoot: tmp,
        deployment: staging,
        recordsRoot,
        sourceRunId: devSummary.deployRunId,
      });
      assert.equal(promotion.operationKind, "promotion");
      const records = await Promise.all(
        (await fsp.readdir(path.join(recordsRoot, "runs")))
          .sort()
          .map(async (name) =>
            JSON.parse(await fsp.readFile(path.join(recordsRoot, "runs", name), "utf8")),
          ),
      );
      const failedPromotion = records.find((record) => record.operationKind === "promotion");
      assert.equal(failedPromotion, undefined);
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN;
      await devServer.close();
      await stagingServer.close();
    }
  });
});
