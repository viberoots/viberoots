#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveInitialCloudflarePagesAdmittedContext } from "../../deployments/cloudflare-pages-admission";
import { cloudflarePagesPublishedPath } from "../../deployments/cloudflare-pages-preview";
import { runCloudflarePagesStaticDeploy } from "../../deployments/cloudflare-pages-static-deploy";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import {
  DEPLOYMENT_SECRET_FIXTURE_PATH_ENV,
  DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
} from "../../deployments/deployment-secret-fixture";
import type { DeploymentSecretBackendKind } from "../../deployments/deployment-sprinkle-ref";
import { resolveDeploymentInfisicalAdmittedReferences } from "../../deployments/deployment-secret-infisical";
import type { DeploymentRequirementStep } from "../../deployments/deployment-requirements";
import { admitStaticWebappArtifact } from "../../deployments/static-webapp-artifacts";
import { runInTemp } from "../lib/test-helpers";
import {
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import {
  withFakeCloudflareLifecycleApi,
  writeLifecycleArtifact,
  writeLifecycleWranglerConfig,
} from "./cloudflare-pages.secret-runtime-lifecycle.helpers";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture";
import {
  infisicalRuntime,
  infisicalSecret,
  infisicalTestContext,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { startStaticWebappHttpsMultiServer } from "./static-webapp.https-server";

const contractId = "secret://deployments/sample-webapp/cloudflare_api_token";
const cfToken = "cf-test-token";
const lifecycleSteps: DeploymentRequirementStep[] = ["provision", "publish", "smoke"];

function vaultAdmittedReferences(targetScope: string) {
  return lifecycleSteps.map((step) => ({
    name: "cloudflare_api_token",
    step,
    contractId,
    required: true,
    backend: "vault" as const,
    referenceId: `vault:${contractId}`,
    targetScope,
    backendRef: contractId,
    selectorRef: contractId,
    resolvedAt: new Date().toISOString(),
    refreshMode: "none" as const,
    credentialClass: "routine" as const,
  }));
}

test("Cloudflare lifecycle resolves provision, publish, and smoke secrets through neutral runtime", async () => {
  await runInTemp("cloudflare-secret-runtime-lifecycle", async (tmp, $) => {
    const outcomes: Record<string, unknown>[] = [];
    for (const backend of ["vault", "infisical"] as DeploymentSecretBackendKind[]) {
      const fake = await installFakeCloudflarePagesWrangler(path.join(tmp, backend));
      const artifactDir = path.join(tmp, backend, "artifact");
      const recordsRoot = path.join(tmp, backend, "records");
      const server =
        backend === "infisical"
          ? await startFakeInfisicalServer(
              { clientId: "id", clientSecret: "secret", accessToken: "token" },
              [infisicalSecret({ secretValue: cfToken })],
            )
          : undefined;
      const restoreContext = server
        ? activateDeploymentSecretContext(
            infisicalTestContext(server.siteUrl, { clientSecret: "secret" }),
          )
        : () => {};
      const deployment = {
        ...cloudflarePagesDeploymentFixture({
          providerTarget: {
            ...cloudflarePagesDeploymentFixture().providerTarget,
            accountId: "1b911846f80a89272c0dbaf44f5c810f",
            customDomain: "staging.sample-webapp.com",
            customDomainZoneId: "zone-sample-webapp",
          },
          secretRequirements: lifecycleSteps.map((step) =>
            deploymentRequirementFixture({
              name: "cloudflare_api_token",
              step,
              contractId,
            }),
          ),
        }),
        ...(backend === "infisical"
          ? {
              secretBackend: "infisical" as const,
              infisicalRuntime: { ...infisicalRuntime, siteUrl: server!.siteUrl },
            }
          : {}),
      };
      await writeLifecycleArtifact(artifactDir, `<html>${backend}</html>\n`);
      await writeLifecycleWranglerConfig(
        path.join(tmp, "projects", "deployments", "sample-webapp", "staging", "wrangler.jsonc"),
      );
      await installCloudflarePagesTargets(tmp, [deployment]);
      await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
      const artifact = await admitStaticWebappArtifact({ recordsRoot, artifactDir });
      const originalEnv = { ...process.env };
      Object.assign(process.env, {
        PATH: `${fake.binDir}:${originalEnv.PATH || ""}`,
        VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
        VBR_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
        VBR_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
      });
      if (backend === "vault") {
        process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = path.join(tmp, "vault-fixture.json");
        await fsp.writeFile(
          process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV],
          JSON.stringify({
            schemaVersion: DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
            contracts: {
              [contractId]: {
                value: cfToken,
                allowedSteps: ["provision", "publish", "smoke"],
                targetScopes: [deployment.providerTarget.providerTargetIdentity],
              },
            },
          }),
        );
      } else {
        delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
      }
      const admittedContext = await resolveInitialCloudflarePagesAdmittedContext({
        workspaceRoot: tmp,
        deployment,
        artifactIdentity: artifact.identity,
        deferSecretReferenceResolution: true,
      });
      admittedContext.admittedSecretReferences =
        backend === "vault"
          ? vaultAdmittedReferences(deployment.providerTarget.providerTargetIdentity)
          : await resolveDeploymentInfisicalAdmittedReferences({
              requirements: deployment.secretRequirements,
              targetScope: deployment.providerTarget.providerTargetIdentity,
              runtime: deployment.infisicalRuntime,
              secretContext: infisicalTestContext(server!.siteUrl, { clientSecret: "secret" }),
            });
      const publishedRoot = cloudflarePagesPublishedPath(
        fake.publishRoot,
        deployment.providerTarget,
      );
      const publicServer = await startStaticWebappHttpsMultiServer({
        hosts: {
          "sample-webapp-staging-pages.pages.dev": publishedRoot,
          "staging.sample-webapp.com": publishedRoot,
        },
        tlsRoot: tmp,
      });
      try {
        const result = await withFakeCloudflareLifecycleApi(
          cfToken,
          async () =>
            await runCloudflarePagesStaticDeploy({
              workspaceRoot: tmp,
              deployment,
              artifact,
              recordsRoot,
              admittedContext,
              authority: {
                kind: "control-plane-worker",
                submissionId: `cp-${backend}`,
                workerId: "worker",
                lockScope: deployment.providerTarget.providerTargetIdentity,
                executionSnapshotPath: path.join(tmp, `${backend}-snapshot.json`),
              },
              smokeConnectOverride: {
                protocol: "https:",
                hostname: "127.0.0.1",
                port: publicServer.port,
                rejectUnauthorized: false,
              },
            }),
        );
        const record = JSON.parse(await fsp.readFile(result.recordPath, "utf8"));
        const wranglerLog = JSON.parse((await fsp.readFile(fake.logPath, "utf8")).trim());
        assert.equal(record.finalOutcome, "succeeded");
        assert.deepEqual(
          admittedContext.admittedSecretReferences.map((reference) => reference.step).sort(),
          ["provision", "publish", "smoke"],
        );
        outcomes.push({
          backend,
          argsShape: [
            wranglerLog.args[0],
            wranglerLog.args[1],
            wranglerLog.args[3],
            wranglerLog.args[4],
          ],
          projectName: wranglerLog.projectName,
          accountId: wranglerLog.accountId,
          providerReleaseId: record.providerReleaseId,
        });
      } finally {
        process.env = originalEnv;
        restoreContext();
        await publicServer.close();
        await server?.close();
      }
    }
    const providerOutcomes = outcomes.map(({ backend: _backend, ...provider }) => provider);
    assert.deepEqual(providerOutcomes, [providerOutcomes[0], providerOutcomes[0]]);
  });
});
