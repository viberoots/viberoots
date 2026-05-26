#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createCloudflarePagesControlPlaneSnapshot } from "../../deployments/cloudflare-pages-control-plane-snapshot";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import type { CloudflarePagesDeployment } from "../../deployments/contract";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";
import {
  infisicalRequirement,
  infisicalRuntime,
  infisicalSecret,
  infisicalTestContext,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { runInTemp } from "../lib/test-helpers";

const clientSecret = "client-secret-value";

function parsedDeployment(siteUrl: string): CloudflarePagesDeployment {
  const { deployments, errors } = extractCloudflarePagesDeployments([
    { name: "//projects/apps/pleomino:app", labels: ["kind:app", "webapp:pwa"] },
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    {
      name: "//projects/deployments/pleomino/staging:deploy",
      provider: "cloudflare-pages",
      component: "//projects/apps/pleomino:app",
      component_kind: "static-webapp",
      publisher: "wrangler-pages",
      publisher_config: "wrangler.jsonc",
      protection_class: "shared_nonprod",
      lane_policy: "//projects/deployments/pleomino/shared:lane",
      environment_stage: "staging",
      admission_policy: "//projects/deployments/pleomino/shared:staging_release",
      provider_target: { account: "web-platform-staging", project: "pleomino-staging-pages" },
      secret_backend: "infisical/regulated",
      secret_requirements: [
        {
          name: infisicalRequirement.name,
          step: infisicalRequirement.step,
          contract_id: infisicalRequirement.contractId,
          required: "true",
        },
      ],
      runtime_config_requirements: [],
      infisical_runtime: {
        site_url: siteUrl,
        project_id: infisicalRuntime.projectId,
        environment: infisicalRuntime.environment,
        secret_path: infisicalRuntime.secretPath,
        preferred_credential_source: "infisical_machine_identity_universal_auth",
        machine_identity_client_id_env: "INFISICAL_CLIENT_ID",
        machine_identity_client_secret_env: "INFISICAL_CLIENT_SECRET",
      },
    },
  ]);
  assert.deepEqual(errors, []);
  return deployments[0]!;
}

async function prepareReviewedSourceWorkspace(tmp: string, $: any): Promise<void> {
  await $({ cwd: tmp, stdio: "pipe" })`git init`;
  await $({ cwd: tmp, stdio: "pipe" })`git config user.email test@example.invalid`;
  await $({ cwd: tmp, stdio: "pipe" })`git config user.name Test`;
  await $({ cwd: tmp, stdio: "pipe" })`git config commit.gpgsign false`;
  await fsp.writeFile(path.join(tmp, ".reviewed-source-marker"), "reviewed\n", "utf8");
  await $({ cwd: tmp, stdio: "pipe" })`git add .reviewed-source-marker`;
  await $({ cwd: tmp, stdio: "pipe" })`git commit -m reviewed-source`;
  await $({ cwd: tmp, stdio: "pipe" })`git checkout -B main`;
}

test("unified selector parsing flows into admitted context and secret references", async () => {
  await runInTemp("cloudflare-unified-selector-admission", async (tmp, $) => {
    await prepareReviewedSourceWorkspace(tmp, $);
    const recordsRoot = path.join(tmp, "records");
    const server = await startFakeInfisicalServer(
      { clientId: "id", clientSecret, accessToken: "token" },
      [infisicalSecret()],
    );
    const restore = activateDeploymentSecretContext(
      infisicalTestContext(server.siteUrl, { clientSecret }),
    );
    try {
      const snapshot = await createCloudflarePagesControlPlaneSnapshot(
        {
          workspaceRoot: tmp,
          deployment: parsedDeployment(server.siteUrl),
          recordsRoot,
          operationKind: "promotion",
          artifact: {
            kind: "static-webapp",
            identity: "static-webapp:source-artifact",
            storedArtifactPath: path.join(recordsRoot, "artifacts", "source-artifact"),
            provenancePath: path.join(recordsRoot, "artifacts", "source-artifact.json"),
          },
          source: {
            record: { deployRunId: "deploy-source-1", deploymentId: "pleomino-dev" },
            replaySnapshotPath: path.join(
              recordsRoot,
              "replay",
              "deploy-source-1",
              "snapshot.json",
            ),
          },
        },
        "submission-unified-selector-admission",
      );
      const admitted = snapshot.admittedContext.admittedSecretReferences[0];
      assert.equal(snapshot.admittedContext.secretBackend, "infisical");
      assert.equal(snapshot.admittedContext.secretBackendProfile, "infisical-regulated");
      assert.equal(admitted?.backend, "infisical");
      assert.equal(admitted?.backendProfile, "infisical-regulated");
    } finally {
      restore();
      await server.close();
    }
  });
});
