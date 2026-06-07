#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
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
import { runInTemp } from "../lib/test-helpers";
import { infisicalTestContext } from "./deployment-secret-infisical.fixture";
import {
  CUTOVER_FAMILY,
  CUTOVER_INFISICAL_IDENTITIES,
  CUTOVER_PROJECT_ID,
  CUTOVER_QUERY_LABELS,
  CUTOVER_TOKEN_CONTRACT,
  writeCutoverDeploymentFixture,
} from "./infisical-cutover.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { runDeploymentCquery } from "./nixos-shared-host.extraction.from-targets.helpers";
const expectedRuntime = {
  siteUrl: "https://app.infisical.com",
  projectId: CUTOVER_PROJECT_ID,
  projectName: "cutover-demo-deployments",
  projectSlug: "cutover-demo-deployments",
  secretPath: "/",
  preferredCredentialSource: "machine_identity_universal_auth",
};
let cachedDeployments:
  | { cloudflare: CloudflarePagesDeployment[]; nixos: NixosSharedHostDeployment[] }
  | undefined;
async function readCutoverDeployments() {
  if (cachedDeployments) return cachedDeployments;
  cachedDeployments = await runInTemp("infisical-cutover-fixture-cquery", async (tmp, _$) => {
    await writeCutoverDeploymentFixture(tmp);
    const nodes = await runDeploymentCquery(
      tmp,
      _$,
      "infisical-cutover-fixture",
      CUTOVER_QUERY_LABELS,
    );
    const cloudflare = extractCloudflarePagesDeployments(nodes);
    const nixos = extractNixosSharedHostDeployments(nodes);
    assert.deepEqual([...cloudflare.errors, ...nixos.errors], []);
    return { cloudflare: cloudflare.deployments, nixos: nixos.deployments };
  });
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
    machineIdentityClientIdFileName: `${CUTOVER_FAMILY}-${expected.environment}-infisical-client-id`,
    machineIdentityClientSecretFileName: `${CUTOVER_FAMILY}-${expected.environment}-infisical-client-secret`,
    machineIdentityId:
      expected.environment === "staging"
        ? CUTOVER_INFISICAL_IDENTITIES.staging
        : CUTOVER_INFISICAL_IDENTITIES.prod,
  });
}
function assertTokenContracts(deployment: CloudflarePagesDeployment) {
  assert.deepEqual(
    deployment.secretRequirements.map((req) => [req.name, req.step, req.contractId, req.required]),
    [
      ["cloudflare_api_token", "provision", CUTOVER_TOKEN_CONTRACT, true],
      ["cloudflare_api_token", "publish", CUTOVER_TOKEN_CONTRACT, true],
      ["cloudflare_api_token", "preview_cleanup", CUTOVER_TOKEN_CONTRACT, true],
    ],
  );
}
test("staging and prod select Infisical while dev stays Vault backed", async () => {
  const { cloudflare, nixos } = await readCutoverDeployments();
  const staging = cloudflare.find((entry) => entry.deploymentId === `${CUTOVER_FAMILY}-staging`);
  const prod = cloudflare.find((entry) => entry.deploymentId === `${CUTOVER_FAMILY}-prod`);
  assertRuntime(staging!, {
    environment: "staging",
    idEnv: "CUTOVER_STAGING_INFISICAL_CLIENT_ID",
    secretEnv: "CUTOVER_STAGING_INFISICAL_CLIENT_SECRET",
  });
  assertRuntime(prod!, {
    environment: "prod",
    idEnv: "CUTOVER_PROD_INFISICAL_CLIENT_ID",
    secretEnv: "CUTOVER_PROD_INFISICAL_CLIENT_SECRET",
  });
  assertTokenContracts(staging!);
  assertTokenContracts(prod!);
  const dev = nixos.find((entry) => entry.deploymentId === `${CUTOVER_FAMILY}-dev`);
  assert.equal(dev?.secretBackend, "vault");
  assert.ok(dev?.vaultRuntime);
  assert.equal(dev?.infisicalRuntime, undefined);
});
async function assertCutoverAdmissionAndAcquire(deployment: CloudflarePagesDeployment) {
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
test("staging and prod admit and acquire exact Infisical versions", async () => {
  const { cloudflare } = await readCutoverDeployments();
  await assertCutoverAdmissionAndAcquire(
    cloudflare.find((entry) => entry.deploymentId === `${CUTOVER_FAMILY}-staging`)!,
  );
  await assertCutoverAdmissionAndAcquire(
    cloudflare.find((entry) => entry.deploymentId === `${CUTOVER_FAMILY}-prod`)!,
  );
});
test("Vault-admitted replay references remain authoritative after cutover", async () => {
  const { cloudflare } = await readCutoverDeployments();
  const staging = cloudflare.find((entry) => entry.deploymentId === `${CUTOVER_FAMILY}-staging`)!;
  const recordedVault = staging.secretRequirements.map((requirement) => ({
    name: requirement.name,
    step: requirement.step,
    contractId: requirement.contractId,
    required: requirement.required,
    backend: "vault" as const,
    referenceId: `vault:${requirement.contractId}`,
    targetScope: `cloudflare-pages:web-platform/${CUTOVER_FAMILY}-staging-pages`,
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
    targetScope: `cloudflare-pages:web-platform/${CUTOVER_FAMILY}-staging-pages`,
  });
  assert.deepEqual(
    replayed.map((entry) => entry.backend),
    ["vault", "vault", "vault"],
  );
});
test("Infisical admin plan and check stay non-secret and read-only", async () => {
  const { cloudflare } = await readCutoverDeployments();
  for (const deployment of cloudflare) {
    const runtime = deployment.infisicalRuntime!;
    const env = {
      [runtime.machineIdentityClientIdEnv!]: "id",
      [runtime.machineIdentityClientSecretEnv!]: "cutover-client-secret-leak-sentinel",
    };
    const plan = buildDeploymentAdminInfisicalPlan(deployment, {});
    assert.equal(plan.readOnly, true);
    assert.equal(plan.providerMutation, false);
    assert.equal(plan.runtime?.projectId, expectedRuntime.projectId);
    assert.equal(plan.runtime?.siteUrl, expectedRuntime.siteUrl);
    const server = await startFakeInfisicalServer(
      {
        clientId: "id",
        clientSecret: "cutover-client-secret-leak-sentinel",
        accessToken: "cutover-access-token-leak-sentinel",
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
        /cutover-client-secret-leak-sentinel|cutover-access-token-leak-sentinel/,
      );
      assert.match(serialized, /cloudflare_api_token/);
    } finally {
      await server.close();
    }
  }
});
