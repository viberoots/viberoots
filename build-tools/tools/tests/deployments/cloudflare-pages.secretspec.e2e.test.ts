#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEPLOYMENT_SECRET_FIXTURE_SCHEMA } from "../../deployments/deployment-secret-fixture";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture";
import { runInTemp } from "../lib/test-helpers";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

async function writeWranglerConfig(root: string): Promise<void> {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

async function writeSecretFixture(filePath: string, contracts: Record<string, unknown>) {
  await fsp.writeFile(
    filePath,
    JSON.stringify(
      {
        schemaVersion: DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
        contracts,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

test("cloudflare-pages deploy keeps secretspec-backed Vault values out of records and snapshots", async () => {
  await runInTemp("cloudflare-pages-secretspec", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      secretRequirements: [
        deploymentRequirementFixture({
          name: "cloudflare_api_token",
          step: "publish",
          contractId: "secret://deployments/pleomino/cloudflare_api_token",
        }),
      ],
    });
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fixturePath = path.join(tmp, "secret-fixture.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>pleomino staging</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await writeSecretFixture(fixturePath, {
      "secret://deployments/pleomino/cloudflare_api_token": {
        value: "super-secret-token",
        allowedSteps: ["publish"],
        targetScopes: ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
      },
    });
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-cloudflare-secretspec-1",
      artifactIdentity: "artifact-cloudflare-secretspec-1",
      artifactLineageId: "artifact-cloudflare-secretspec-1",
    });
    const server = await startCloudflarePagesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    const originalEnv = { ...process.env };
    process.env.PATH = `${fake.binDir}:${originalEnv.PATH || ""}`;
    process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT = fake.publishRoot;
    process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG = fake.logPath;
    process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN = path.join(fake.binDir, "wrangler");
    process.env.BNX_DEPLOYMENT_SECRET_FIXTURE_PATH = fixturePath;
    try {
      const result = await submitCloudflarePagesControlPlaneDeploy({
        workspaceRoot: tmp,
        deployment,
        artifactDir,
        recordsRoot,
        admissionEvidence,
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      const record = JSON.parse(await fsp.readFile(result.recordPath, "utf8"));
      const executionSnapshot = JSON.parse(
        await fsp.readFile(result.executionSnapshotPath, "utf8"),
      );
      const replaySnapshot = JSON.parse(await fsp.readFile(record.replaySnapshotPath, "utf8"));
      const wranglerLog = await fsp.readFile(fake.logPath, "utf8");
      const rendered = JSON.stringify({ record, executionSnapshot, replaySnapshot, wranglerLog });

      assert.equal(record.finalOutcome, "succeeded");
      assert.ok(!rendered.includes("super-secret-token"));
      assert.equal(
        record.admittedContext.secretRequirements[0].contractId,
        "secret://deployments/pleomino/cloudflare_api_token",
      );
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN;
      delete process.env.BNX_DEPLOYMENT_SECRET_FIXTURE_PATH;
      await server.close();
    }
  });
});

test("cloudflare-pages admission fails closed when a required secretspec contract is missing", async () => {
  await runInTemp("cloudflare-pages-secretspec-missing", async (tmp, $) => {
    const deployment = cloudflarePagesDeploymentFixture({
      secretRequirements: [
        deploymentRequirementFixture({
          name: "cloudflare_api_token",
          step: "publish",
          contractId: "secret://deployments/pleomino/cloudflare_api_token",
        }),
      ],
    });
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fixturePath = path.join(tmp, "secret-fixture.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>pleomino staging</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await writeSecretFixture(fixturePath, {});
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-cloudflare-secretspec-2",
      artifactIdentity: "artifact-cloudflare-secretspec-2",
      artifactLineageId: "artifact-cloudflare-secretspec-2",
    });
    const originalEnv = { ...process.env };
    process.env.PATH = `${fake.binDir}:${originalEnv.PATH || ""}`;
    process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT = fake.publishRoot;
    process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG = fake.logPath;
    process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN = path.join(fake.binDir, "wrangler");
    process.env.BNX_DEPLOYMENT_SECRET_FIXTURE_PATH = fixturePath;
    try {
      await assert.rejects(
        async () =>
          await submitCloudflarePagesControlPlaneDeploy({
            workspaceRoot: tmp,
            deployment,
            artifactDir,
            recordsRoot,
            admissionEvidence,
          }),
        /required secret contract secret:\/\/deployments\/pleomino\/cloudflare_api_token is missing/,
      );
      await assert.rejects(async () => await fsp.readdir(path.join(recordsRoot, "runs")));
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN;
      delete process.env.BNX_DEPLOYMENT_SECRET_FIXTURE_PATH;
    }
  });
});
