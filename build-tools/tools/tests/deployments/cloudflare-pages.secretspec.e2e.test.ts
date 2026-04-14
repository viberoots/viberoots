#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane.ts";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

async function writeWranglerConfig(root: string): Promise<void> {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

async function writeVaultFixture(filePath: string, contracts: Record<string, unknown>) {
  await fsp.writeFile(
    filePath,
    JSON.stringify(
      {
        schemaVersion: "deployment-vault-fixture@1",
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
    const fixturePath = path.join(tmp, "vault.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>pleomino staging</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "test-workspace", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await writeVaultFixture(fixturePath, {
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
    process.env.BNX_DEPLOYMENT_VAULT_FIXTURE_PATH = fixturePath;
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
      delete process.env.BNX_DEPLOYMENT_VAULT_FIXTURE_PATH;
      await server.close();
    }
  });
});

test("cloudflare-pages deploy fails closed when a required secretspec contract is missing", async () => {
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
    const fixturePath = path.join(tmp, "vault.json");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>pleomino staging</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "test-workspace", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await writeVaultFixture(fixturePath, {});
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
    process.env.BNX_DEPLOYMENT_VAULT_FIXTURE_PATH = fixturePath;
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
      const runFiles = await fsp.readdir(path.join(recordsRoot, "runs"));
      const record = JSON.parse(
        await fsp.readFile(path.join(recordsRoot, "runs", runFiles[0] || ""), "utf8"),
      );
      assert.equal(record.finalOutcome, "publish_failed");
      assert.equal(record.failedStep, "publish");
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG;
      delete process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN;
      delete process.env.BNX_DEPLOYMENT_VAULT_FIXTURE_PATH;
    }
  });
});
