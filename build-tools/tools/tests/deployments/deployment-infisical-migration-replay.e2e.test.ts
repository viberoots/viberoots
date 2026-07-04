#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane";
import { submitCloudflarePagesRollback } from "../../deployments/cloudflare-pages-rollback";
import {
  activateDeploymentSecretContext,
  type DeploymentSecretContext,
} from "../../deployments/deployment-secret-context";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  infisicalRequirement,
  infisicalRuntime,
  infisicalSecret,
  infisicalTestContext,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { withEnvOverrides } from "./nixos-shared-host.control-plane.helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { seedCurrentStageState } from "./nixos-shared-host.promotion.stage-state.helpers";
import { startFakeVaultServer } from "./vault.test-server";
import { runInTemp } from "../lib/test-helpers";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

async function writeWranglerConfig(root: string): Promise<void> {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{ "name": "sample-webapp-staging-pages" }\n', "utf8");
}

function fakeCloudflareOverrides(
  fake: Awaited<ReturnType<typeof installFakeCloudflarePagesWrangler>>,
) {
  return {
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    VBR_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    VBR_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}

async function withSecretContext<T>(
  context: DeploymentSecretContext,
  run: () => Promise<T>,
): Promise<T> {
  const restore = activateDeploymentSecretContext(context);
  try {
    return await run();
  } finally {
    restore();
  }
}

test("Vault-admitted Cloudflare runs remain replayable after Infisical metadata migration", async () => {
  await runInTemp("deploy-infisical-migration-replay", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const vault = await startFakeVaultServer(
      {
        "secret://deployments/sample-webapp/cloudflare_api_token": {
          currentVersion: "11",
          versions: { "11": { value: "vault-token-v11" } },
        },
      },
      { jwtAuth: { role: "deploy-sample-webapp-read", jwt: "cloudflare.workload.jwt" } },
    );
    const infisical = await startFakeInfisicalServer(
      { clientId: "id", clientSecret: "secret", accessToken: "infisical-access" },
      [infisicalSecret()],
    );
    const vaultDeployment = cloudflarePagesDeploymentFixture({
      secretRequirements: [infisicalRequirement],
    });
    const infisicalDeployment = {
      ...cloudflarePagesDeploymentFixture({
        secretRequirements: [infisicalRequirement],
      }),
      secretBackend: "infisical" as const,
      infisicalRuntime: { ...infisicalRuntime, siteUrl: infisical.siteUrl },
      secretRequirements: [infisicalRequirement],
    };
    await writeArtifact(artifactDir, "<html>migration replay</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "sample-webapp", "staging", "wrangler.jsonc"),
    );
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, vaultDeployment);
    const server = await startCloudflarePagesPublicServer({
      deployment: vaultDeployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      await withEnvOverrides(fakeCloudflareOverrides(fake), async () => {
        const vaultContext = {
          kind: "vault" as const,
          credential: {
            kind: "jwt" as const,
            addr: vault.addr,
            role: "deploy-sample-webapp-read",
            workloadJwt: "cloudflare.workload.jwt",
          },
        };
        const oldRun = await withSecretContext(
          vaultContext,
          async () =>
            await submitCloudflarePagesControlPlaneDeploy({
              workspaceRoot: tmp,
              deployment: vaultDeployment,
              artifactDir,
              recordsRoot,
              admissionEvidence: deploymentAdmissionEvidenceFixture({
                deployment: vaultDeployment,
                operationKind: "deploy",
                sourceRevision: "rev-vault-before-migration",
                artifactIdentity: "artifact-vault-before-migration",
                artifactLineageId: "artifact-vault-before-migration",
              }),
              smokeConnectOverride: {
                protocol: "https:",
                hostname: "127.0.0.1",
                port: server.port,
                rejectUnauthorized: false,
              },
            }),
        );
        const newRun = await withSecretContext(
          infisicalTestContext(infisical.siteUrl),
          async () =>
            await submitCloudflarePagesControlPlaneDeploy({
              workspaceRoot: tmp,
              deployment: infisicalDeployment,
              artifactDir,
              recordsRoot,
              admissionEvidence: deploymentAdmissionEvidenceFixture({
                deployment: infisicalDeployment,
                operationKind: "deploy",
                sourceRevision: "rev-infisical-after-migration",
                artifactIdentity: "artifact-infisical-after-migration",
                artifactLineageId: "artifact-infisical-after-migration",
              }),
              smokeConnectOverride: {
                protocol: "https:",
                hostname: "127.0.0.1",
                port: server.port,
                rejectUnauthorized: false,
              },
            }),
        );
        assert.equal(oldRun.record.admittedContext.admittedSecretReferences[0].backend, "vault");
        assert.equal(
          oldRun.record.admittedContext.admittedSecretReferences[0].resolvedVersion,
          "11",
        );
        assert.equal(
          newRun.record.admittedContext.admittedSecretReferences[0].backend,
          "infisical",
        );
        await seedCurrentStageState({
          recordsRoot,
          recordPath: oldRun.recordPath,
          deployment: infisicalDeployment,
        });
        const backendDatabaseUrl = await seedCurrentStageState({
          recordsRoot,
          recordPath: newRun.recordPath,
          deployment: infisicalDeployment,
        });
        const oldReplay = await withSecretContext(
          vaultContext,
          async () =>
            await submitCloudflarePagesRollback({
              workspaceRoot: tmp,
              deployment: infisicalDeployment,
              recordsRoot,
              sourceRunId: oldRun.record.deployRunId,
              backendDatabaseUrl,
              admissionEvidence: deploymentAdmissionEvidenceFixture({
                deployment: infisicalDeployment,
                operationKind: "rollback",
                sourceRevision: "rev-infisical-after-migration",
                artifactIdentity: oldRun.record.artifact.identity,
                artifactLineageId: oldRun.record.artifactLineageId,
              }),
              smokeConnectOverride: {
                protocol: "https:",
                hostname: "127.0.0.1",
                port: server.port,
                rejectUnauthorized: false,
              },
            }),
        );
        assert.equal(oldReplay.record.operationKind, "rollback");
        assert.equal(oldReplay.record.parentRunId, oldRun.record.deployRunId);
        assert.equal(oldReplay.record.admittedContext.admittedSecretReferences[0].backend, "vault");
        await seedCurrentStageState({
          recordsRoot,
          recordPath: oldReplay.recordPath,
          deployment: infisicalDeployment,
        });
        const newReplay = await withSecretContext(
          infisicalTestContext(infisical.siteUrl),
          async () =>
            await submitCloudflarePagesRollback({
              workspaceRoot: tmp,
              deployment: infisicalDeployment,
              recordsRoot,
              sourceRunId: newRun.record.deployRunId,
              backendDatabaseUrl,
              admissionEvidence: deploymentAdmissionEvidenceFixture({
                deployment: infisicalDeployment,
                operationKind: "rollback",
                sourceRevision: "rev-infisical-after-migration",
                artifactIdentity: newRun.record.artifact.identity,
                artifactLineageId: newRun.record.artifactLineageId,
              }),
              smokeConnectOverride: {
                protocol: "https:",
                hostname: "127.0.0.1",
                port: server.port,
                rejectUnauthorized: false,
              },
            }),
        );
        assert.equal(newReplay.record.operationKind, "rollback");
        assert.equal(newReplay.record.parentRunId, newRun.record.deployRunId);
        assert.equal(
          newReplay.record.admittedContext.admittedSecretReferences[0].backend,
          "infisical",
        );
      });
    } finally {
      await server.close();
      await vault.close();
      await infisical.close();
    }
  });
});
