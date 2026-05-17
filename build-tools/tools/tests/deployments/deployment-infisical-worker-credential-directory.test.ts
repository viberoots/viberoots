#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createControlPlaneCredentialDirectory } from "../../deployments/control-plane-credentials";
import { parseControlPlaneRuntimeConfig } from "../../deployments/control-plane-runtime-config";
import {
  cleanupWorkerDeploymentSecretRuntime,
  prepareWorkerDeploymentSecretRuntime,
} from "../../deployments/deployment-secret-runtime-worker";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { infisicalRequirement } from "./deployment-secret-infisical.fixture";
import { runInTemp } from "../lib/test-helpers";

function configYaml(credentials: string) {
  return `
instanceId: pleomino
service:
  publicUrl: https://deploy.example.test
storage:
  artifactStore:
    bucket: deploy-artifacts
    endpointFile: ${credentials}/artifact-store-endpoint
    accessKeyIdFile: ${credentials}/artifact-store-access-key-id
    secretAccessKeyFile: ${credentials}/artifact-store-secret-access-key
database:
  urlFile: ${credentials}/control-plane-database-url
credentials:
  directory: ${credentials}
reviewedSource:
  sshKeyFile: ${credentials}/reviewed-source-ssh-key
  sshKnownHostsFile: /etc/deployment-control-plane/github-known-hosts
`;
}

test("Pleomino Infisical workers read deployment credential files into scoped bindings", async () => {
  await runInTemp("pleomino-infisical-worker-credentials", async (tmp) => {
    const credentials = path.join(tmp, "credentials");
    await fsp.mkdir(credentials, { recursive: true });
    await fsp.writeFile(
      path.join(credentials, "pleomino-staging-infisical-client-id"),
      "file-client-id\n",
    );
    await fsp.writeFile(
      path.join(credentials, "pleomino-staging-infisical-client-secret"),
      "file-client-secret\n",
    );
    const directory = createControlPlaneCredentialDirectory(
      parseControlPlaneRuntimeConfig(configYaml(credentials), { repoRoot: path.join(tmp, "repo") }),
    );
    const processClientId = process.env.PLEOMINO_STAGING_INFISICAL_CLIENT_ID;
    const processClientSecret = process.env.PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET;
    delete process.env.PLEOMINO_STAGING_INFISICAL_CLIENT_ID;
    delete process.env.PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET;
    try {
      const prepared = await prepareWorkerDeploymentSecretRuntime({
        workspaceRoot: tmp,
        credentialDirectory: directory,
        env: {
          PLEOMINO_STAGING_INFISICAL_CLIENT_ID: "ambient-client-id",
          PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET: "ambient-client-secret",
        },
        deployment: {
          ...cloudflarePagesDeploymentFixture({
            secretRequirements: [infisicalRequirement],
            deploymentId: "pleomino-staging",
          }),
          secretBackend: "infisical" as const,
          infisicalRuntime: {
            siteUrl: "https://app.infisical.com",
            projectId: "proj_reviewed_pleomino",
            environment: "staging",
            secretPath: "/",
            preferredCredentialSource: "machine_identity_universal_auth",
            machineIdentityClientIdEnv: "PLEOMINO_STAGING_INFISICAL_CLIENT_ID",
            machineIdentityClientSecretEnv: "PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET",
            machineIdentityId: "identity_reviewed_staging",
          },
        },
      });
      assert.equal(prepared.secretContext?.kind, "infisical");
      assert.equal(prepared.secretContext?.credential.kind, "universal_auth");
      if (prepared.secretContext?.credential.kind !== "universal_auth") return;
      assert.equal(prepared.secretContext.credential.clientId, "file-client-id");
      assert.equal(prepared.secretContext.credential.clientSecret, "file-client-secret");
      assert.equal(process.env.PLEOMINO_STAGING_INFISICAL_CLIENT_ID, undefined);
      assert.equal(process.env.PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET, undefined);
      await cleanupWorkerDeploymentSecretRuntime(prepared);
      assert.equal(prepared.secretContext, undefined);
    } finally {
      if (processClientId === undefined) delete process.env.PLEOMINO_STAGING_INFISICAL_CLIENT_ID;
      else process.env.PLEOMINO_STAGING_INFISICAL_CLIENT_ID = processClientId;
      if (processClientSecret === undefined)
        delete process.env.PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET;
      else process.env.PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET = processClientSecret;
    }
  });
});
