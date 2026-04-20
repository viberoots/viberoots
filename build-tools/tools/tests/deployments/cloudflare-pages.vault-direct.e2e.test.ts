#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane.ts";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context.ts";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler.ts";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { startFakeVaultServer } from "./vault.test-server.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

async function writeWranglerConfig(root: string): Promise<void> {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

test("cloudflare-pages deploy reads Vault directly on the reviewed runtime path", async () => {
  await runInTemp("cloudflare-pages-vault-direct", async (tmp, $) => {
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
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const vault = await startFakeVaultServer(
      {
        "secret://deployments/pleomino/cloudflare_api_token": {
          currentVersion: "11",
          versions: { "11": { value: "direct-vault-token" } },
        },
      },
      { jwtAuth: { role: "deploy-pleomino-read", jwt: "cloudflare.workload.jwt" } },
    );
    await writeArtifact(artifactDir, "<html>pleomino staging</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-cloudflare-direct-vault-1",
      artifactIdentity: "artifact-cloudflare-direct-vault-1",
      artifactLineageId: "artifact-cloudflare-direct-vault-1",
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
    delete process.env.BNX_DEPLOYMENT_SECRET_FIXTURE_PATH;
    const restoreSecretContext = activateDeploymentSecretContext({
      kind: "vault",
      credential: {
        kind: "jwt",
        addr: vault.addr,
        role: "deploy-pleomino-read",
        workloadJwt: "cloudflare.workload.jwt",
      },
    });
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
      assert.equal(record.finalOutcome, "succeeded");
      assert.equal(record.admittedContext.admittedSecretReferences[0].resolvedVersion, "11");
    } finally {
      restoreSecretContext();
      process.env = originalEnv;
      await server.close();
      await vault.close();
    }
  });
});
