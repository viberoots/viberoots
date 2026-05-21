#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import {
  extractCloudflarePagesDeployments,
  extractNixosSharedHostDeployments,
  type CloudflarePagesDeployment,
  type NixosSharedHostDeployment,
} from "../../deployments/contract";
import {
  buildDeploymentAdminInfisicalPlan,
  checkDeploymentAdminInfisical,
} from "../../deployments/deployment-admin-infisical";
import {
  resolveInitialAdmittedSecretReferences,
  resolveSourceRunAdmittedSecretReferences,
} from "../../deployments/deployment-secret-admission";
import { createDeploymentInfisicalSecretBackend } from "../../deployments/deployment-secret-infisical";
import { createDeploymentSecretRuntime } from "../../deployments/deployment-secret-runtime";
import { DEPLOYMENT_CQUERY_ATTRS } from "../../deployments/deployment-query-attrs";
import { inheritedBuckIsolation } from "../lib/test-helpers";
import { infisicalTestContext } from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
const expectedRuntime = {
  siteUrl: "https://app.infisical.com",
  projectId: "proj_pleomino_deployments",
  secretPath: "/",
  preferredCredentialSource: "machine_identity_universal_auth",
};
const expectedIdentities = {
  staging: "identity_pleomino_staging_deploy",
  prod: "identity_pleomino_prod_deploy",
};
const tokenContract = "secret://deployments/pleomino/cloudflare_api_token";
const query = `set(${[
  "//projects/deployments/pleomino/dev:deploy",
  "//projects/deployments/pleomino/staging:deploy",
  "//projects/deployments/pleomino/prod:deploy",
  "//projects/apps/pleomino:app",
  "//projects/deployments/pleomino/shared:lane",
  "//projects/deployments:defaults",
  "//projects/deployments/pleomino/shared:lane_governance",
  "//projects/deployments/pleomino/shared:dev_release",
  "//projects/deployments/pleomino/shared:staging_release",
  "//projects/deployments/pleomino/shared:prod_release",
].join(" ")})`;
let cachedDeployments:
  | { cloudflare: CloudflarePagesDeployment[]; nixos: NixosSharedHostDeployment[] }
  | undefined;
async function readPleominoDeployments() {
  if (cachedDeployments) return cachedDeployments;
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const cquery = await $({
    stdio: "pipe",
    env: {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
    },
  })`buck2 --isolation-dir ${inheritedBuckIsolation("pleomino-infisical-cutover")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
  const nodes = nodesFromCqueryJson(JSON.parse(String(cquery.stdout || "")));
  const cloudflare = extractCloudflarePagesDeployments(nodes);
  const nixos = extractNixosSharedHostDeployments(nodes);
  assert.deepEqual([...cloudflare.errors, ...nixos.errors], []);
  cachedDeployments = { cloudflare: cloudflare.deployments, nixos: nixos.deployments };
  return cachedDeployments;
}
function assertRuntime(
  deployment: CloudflarePagesDeployment,
  expected: { environment: string; idEnv: string; secretEnv: string },
) {
  assert.equal(deployment.secretBackend, "infisical");
  assert.equal(deployment.infisicalSecretMappings, undefined);
  assert.deepEqual(deployment.infisicalRuntime, {
    ...expectedRuntime,
    environment: expected.environment,
    machineIdentityClientIdEnv: expected.idEnv,
    machineIdentityClientSecretEnv: expected.secretEnv,
    machineIdentityClientIdFileName: `pleomino-${expected.environment}-infisical-client-id`,
    machineIdentityClientSecretFileName: `pleomino-${expected.environment}-infisical-client-secret`,
    machineIdentityId:
      expected.environment === "staging" ? expectedIdentities.staging : expectedIdentities.prod,
  });
}
function assertTokenContracts(deployment: CloudflarePagesDeployment) {
  assert.deepEqual(
    deployment.secretRequirements.map((req) => [req.name, req.step, req.contractId, req.required]),
    [
      ["cloudflare_api_token", "provision", tokenContract, true],
      ["cloudflare_api_token", "publish", tokenContract, true],
      ["cloudflare_api_token", "preview_cleanup", tokenContract, true],
    ],
  );
}
test("Pleomino staging and prod select Infisical while dev stays Vault backed", async () => {
  const { cloudflare, nixos } = await readPleominoDeployments();
  const staging = cloudflare.find((entry) => entry.deploymentId === "pleomino-staging");
  const prod = cloudflare.find((entry) => entry.deploymentId === "pleomino-prod");
  assertRuntime(staging!, {
    environment: "staging",
    idEnv: "PLEOMINO_STAGING_INFISICAL_CLIENT_ID",
    secretEnv: "PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET",
  });
  assertRuntime(prod!, {
    environment: "prod",
    idEnv: "PLEOMINO_PROD_INFISICAL_CLIENT_ID",
    secretEnv: "PLEOMINO_PROD_INFISICAL_CLIENT_SECRET",
  });
  assertTokenContracts(staging!);
  assertTokenContracts(prod!);
  const dev = nixos.find((entry) => entry.deploymentId === "pleomino-dev");
  assert.equal(dev?.secretBackend, "vault");
  assert.ok(dev?.vaultRuntime);
  assert.equal(dev?.infisicalRuntime, undefined);
});
async function assertPleominoAdmissionAndAcquire(deployment: CloudflarePagesDeployment) {
  const runtime = deployment.infisicalRuntime!;
  const server = await startFakeInfisicalServer(
    { clientId: "id", clientSecret: "secret", accessToken: "token" },
    [
      {
        id: `sec_${runtime.environment}`,
        projectId: runtime.projectId,
        environment: runtime.environment,
        secretPath: runtime.secretPath || "/",
        secretName: "cloudflare_api_token",
        version: "12",
        secretValue: `runtime-token-${runtime.environment}`,
      },
    ],
    {
      projectId: runtime.projectId,
      environment: runtime.environment,
      machineIdentityId: runtime.machineIdentityId,
    },
  );
  try {
    const secretContext = infisicalTestContext(server.siteUrl);
    const admitted = await resolveInitialAdmittedSecretReferences({
      requirements: deployment.secretRequirements,
      targetScope: `cloudflare-pages:${deployment.providerTarget.account}/${deployment.providerTarget.project}`,
      secretBackend: "infisical",
      infisicalRuntime: { ...runtime, siteUrl: server.siteUrl },
      secretContext,
    });
    assert.equal(admitted.length, 3);
    assert.ok(admitted.every((entry) => entry.backend === "infisical"));
    assert.ok(admitted.every((entry) => entry.resolvedVersion === "12"));
    const secretRuntime = createDeploymentSecretRuntime({
      backend: createDeploymentInfisicalSecretBackend(secretContext),
      admittedReferences: admitted,
      targetScope: admitted[0]!.targetScope,
    });
    const material = await secretRuntime.enterStep("publish");
    assert.equal(material.cloudflare_api_token, `runtime-token-${runtime.environment}`);
    assert.ok(server.secretCalls.includes("cloudflare_api_token:false:"));
    assert.ok(server.secretCalls.includes("cloudflare_api_token:true:12"));
  } finally {
    await server.close();
  }
}
test("Pleomino staging and prod admit and acquire exact Infisical versions", async () => {
  const { cloudflare } = await readPleominoDeployments();
  await assertPleominoAdmissionAndAcquire(
    cloudflare.find((entry) => entry.deploymentId === "pleomino-staging")!,
  );
  await assertPleominoAdmissionAndAcquire(
    cloudflare.find((entry) => entry.deploymentId === "pleomino-prod")!,
  );
});
test("Pleomino Vault-admitted replay references remain authoritative after cutover", async () => {
  const { cloudflare } = await readPleominoDeployments();
  const staging = cloudflare.find((entry) => entry.deploymentId === "pleomino-staging")!;
  const recordedVault = staging.secretRequirements.map((requirement) => ({
    name: requirement.name,
    step: requirement.step,
    contractId: requirement.contractId,
    required: requirement.required,
    backend: "vault" as const,
    referenceId: `vault:${requirement.contractId}`,
    targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    backendRef: `secret/data/${requirement.name}`,
    selectorRef: `secret/data/${requirement.name}@4`,
    resolvedVersion: "4",
    resolvedAt: "2026-05-15T00:00:00.000Z",
    refreshMode: "none" as const,
    credentialClass: "routine" as const,
  }));
  const replayed = await resolveSourceRunAdmittedSecretReferences({
    sourceAdmittedContext: { admittedSecretReferences: recordedVault },
    requirements: staging.secretRequirements,
    targetScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
  });
  assert.deepEqual(
    replayed.map((entry) => entry.backend),
    ["vault", "vault", "vault"],
  );
});
test("Pleomino Infisical admin plan and check stay non-secret and read-only", async () => {
  const { cloudflare } = await readPleominoDeployments();
  for (const deployment of cloudflare) {
    const runtime = deployment.infisicalRuntime!;
    const env = {
      [runtime.machineIdentityClientIdEnv!]: "id",
      [runtime.machineIdentityClientSecretEnv!]: "pleomino-client-secret-leak-sentinel",
    };
    const plan = buildDeploymentAdminInfisicalPlan(deployment, {});
    assert.equal(plan.readOnly, true);
    assert.equal(plan.providerMutation, false);
    assert.equal(plan.runtime?.projectId, expectedRuntime.projectId);
    assert.equal(plan.runtime?.siteUrl, expectedRuntime.siteUrl);
    const server = await startFakeInfisicalServer(
      {
        clientId: "id",
        clientSecret: "pleomino-client-secret-leak-sentinel",
        accessToken: "pleomino-access-token-leak-sentinel",
      },
      [
        {
          projectId: runtime.projectId,
          environment: runtime.environment,
          secretPath: runtime.secretPath || "/",
          secretName: "cloudflare_api_token",
          version: "12",
        },
      ],
      {
        projectId: runtime.projectId,
        environment: runtime.environment,
        machineIdentityId: runtime.machineIdentityId,
      },
    );
    try {
      const check = await checkDeploymentAdminInfisical({
        deployment: { ...deployment, infisicalRuntime: { ...runtime, siteUrl: server.siteUrl } },
        env,
      });
      const serialized = JSON.stringify({ plan, check });
      assert.equal(check.inSync, true);
      assert.doesNotMatch(
        serialized,
        /pleomino-client-secret-leak-sentinel|pleomino-access-token-leak-sentinel/,
      );
      assert.match(serialized, /cloudflare_api_token/);
    } finally {
      await server.close();
    }
  }
});
