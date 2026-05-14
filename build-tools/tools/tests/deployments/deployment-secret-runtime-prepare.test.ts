#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runDeployCli } from "../../deployments/deploy-cli";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import {
  cleanupDeploymentSecretRuntime,
  prepareDeploymentSecretRuntime,
} from "../../deployments/deployment-secret-runtime-prepare";
import {
  cloudflarePagesApiTokenRequirements,
  cloudflarePagesDeploymentFixture,
} from "./cloudflare-pages.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import { writeTempCloudflareValidationWorkspace } from "./deploy.front-door.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { infisicalRuntime, infisicalSecret } from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { withEnvOverrides } from "./nixos-shared-host.control-plane.helpers";
import { runInTemp } from "../lib/test-helpers";

async function withArgv<T>(args: string[], fn: () => Promise<T>): Promise<T> {
  const oldGlobal = (globalThis as { argv?: unknown }).argv;
  const oldArgv = process.argv.slice();
  delete (globalThis as { argv?: unknown }).argv;
  process.argv = ["node", "deploy", ...args];
  try {
    return await fn();
  } finally {
    process.argv = oldArgv;
    if (oldGlobal === undefined) delete (globalThis as { argv?: unknown }).argv;
    else (globalThis as { argv?: unknown }).argv = oldGlobal;
  }
}

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>direct infisical</html>\n", "utf8");
}

test("local direct Infisical runtime uses reviewed Universal Auth env names", async () => {
  const result = await prepareDeploymentSecretRuntime({
    workspaceRoot: process.cwd(),
    deployment: {
      ...cloudflarePagesDeploymentFixture({
        secretRequirements: cloudflarePagesApiTokenRequirements(),
      }),
      secretBackend: "infisical",
      infisicalRuntime: {
        ...infisicalRuntime,
        machineIdentityClientIdEnv: "VBR_MINI_INFISICAL_CLIENT_ID",
        machineIdentityClientSecretEnv: "VBR_MINI_INFISICAL_CLIENT_SECRET",
        preferredCredentialSource: "machine_identity_universal_auth",
      },
    },
    env: {
      VBR_MINI_INFISICAL_CLIENT_ID: "mini-worker",
      VBR_MINI_INFISICAL_CLIENT_SECRET: "server-local-secret",
    },
  });
  assert.equal(result.minted, true);
  assert.equal(result.secretContext?.kind, "infisical");
  const credential =
    result.secretContext?.kind === "infisical" ? result.secretContext.credential : undefined;
  assert.equal(credential?.kind, "universal_auth");
  assert.equal(credential?.kind === "universal_auth" ? credential.clientId : "", "mini-worker");
  await cleanupDeploymentSecretRuntime(result);
  assert.equal(credential?.kind === "universal_auth" ? credential.clientSecret : "missing", "");
  assert.equal(result.secretContext, undefined);
});

test("local direct backend-aware runtime preserves Vault default behavior", async () => {
  await assert.rejects(
    prepareDeploymentSecretRuntime({
      workspaceRoot: process.cwd(),
      deployment: cloudflarePagesDeploymentFixture({
        secretRequirements: cloudflarePagesApiTokenRequirements(),
      }),
      env: {},
    }),
    /secret-consuming deployments require vault_runtime\.addr/,
  );
});

test("local direct deploy CLI prepares Infisical instead of Vault runtime", async () => {
  await runInTemp("deploy-cli-local-direct-infisical", async (tmp, $) => {
    const deploymentLabel = "//sandbox/deployments/demo-staging:deploy";
    const artifactDir = path.join(tmp, "artifact");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    const infisical = await startFakeInfisicalServer(
      { clientId: "mini-worker", clientSecret: "server-local-secret", accessToken: "token" },
      [infisicalSecret()],
    );
    await writeTempCloudflareValidationWorkspace(tmp, { infisicalSiteUrl: infisical.siteUrl });
    await writeArtifact(artifactDir);
    const deployment = await resolveDeploymentFromTarget(tmp, deploymentLabel);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    const server = await startCloudflarePagesPublicServer({
      deployment: deployment as any,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deployment,
      deploymentLabel,
    });
    const oldCwd = process.cwd();
    try {
      process.chdir(tmp);
      await withEnvOverrides(
        {
          PATH: `${fake.binDir}:${process.env.PATH || ""}`,
          VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
          VBR_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
          VBR_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
          VBR_MINI_INFISICAL_CLIENT_ID: "mini-worker",
          VBR_MINI_INFISICAL_CLIENT_SECRET: "server-local-secret",
        },
        async () => {
          await withArgv(
            [
              "--deployment",
              deploymentLabel,
              "--admission-evidence-json",
              admissionEvidenceJson,
              "--artifact-dir",
              artifactDir,
              "--smoke-connect-host",
              "127.0.0.1",
              "--smoke-connect-port",
              String(server.port),
              "--smoke-connect-protocol",
              "https:",
            ],
            async () => {
              await runDeployCli({
                workspaceRoot: tmp,
                publicFrontDoor: false,
                deploymentJsonErrorMessage: "deployment-json rejected",
              });
            },
          );
        },
      );
      assert.ok(infisical.calls.includes("mini-worker"));
      assert.ok(infisical.secretCalls.includes("cloudflare_api_token:true:3"));
    } finally {
      process.chdir(oldCwd);
      await server.close();
      await infisical.close();
    }
  });
});

test("local direct Infisical setup errors redact secret material", async () => {
  const secretValue = "server-local-secret";
  const ambientToken = "ambient-access-token";
  await assert.rejects(
    prepareDeploymentSecretRuntime({
      workspaceRoot: process.cwd(),
      deployment: {
        ...cloudflarePagesDeploymentFixture({
          secretRequirements: cloudflarePagesApiTokenRequirements(),
        }),
        secretBackend: "infisical",
        infisicalRuntime: {
          ...infisicalRuntime,
          machineIdentityClientIdEnv: "VBR_MINI_INFISICAL_CLIENT_ID",
          machineIdentityClientSecretEnv: "VBR_MINI_INFISICAL_CLIENT_SECRET",
          preferredCredentialSource: "machine_identity_universal_auth",
        },
      },
      env: {
        INFISICAL_ACCESS_TOKEN: ambientToken,
        VBR_MINI_INFISICAL_CLIENT_ID: "mini-worker",
        VBR_MINI_INFISICAL_CLIENT_SECRET: secretValue,
      },
    }),
    (error) =>
      error instanceof Error &&
      /ambient Infisical credential INFISICAL_ACCESS_TOKEN is not accepted/.test(error.message) &&
      !error.message.includes(secretValue) &&
      !error.message.includes(ambientToken),
  );
});
