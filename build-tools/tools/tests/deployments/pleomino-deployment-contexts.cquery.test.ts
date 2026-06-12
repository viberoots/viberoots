#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { createCloudflarePagesControlPlaneSnapshot } from "../../deployments/cloudflare-pages-control-plane-snapshot";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import type { CloudflarePagesDeployment } from "../../deployments/contract";
import { DEPLOYMENT_CQUERY_ATTRS } from "../../deployments/deployment-query-attrs";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import { infisicalTestContext } from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { inheritedBuckIsolation } from "../lib/test-helpers";

const LABELS = [
  "//projects/apps/pleomino:app",
  "//projects/deployments:defaults",
  "//projects/deployments/pleomino/shared:lane",
  "//projects/deployments/pleomino/shared:lane_governance",
  "//projects/deployments/pleomino/shared:staging_release",
  "//projects/deployments/pleomino/shared:prod_release",
  "//projects/deployments/pleomino/staging:deploy",
  "//projects/deployments/pleomino/prod:deploy",
];
const REVIEWED_COMMIT = "commit:0123456789abcdef0123456789abcdef01234567";

const EXPECTED = {
  staging: {
    context: "pleomino-staging",
    account: "web-platform-staging",
    project: "pleomino-staging-pages",
    customDomain: "staging.pleomino.com",
    environment: "staging",
    clientIdEnv: "PLEOMINO_STAGING_INFISICAL_CLIENT_ID",
    clientSecretEnv: "PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET",
    clientIdRef: "secret://deployments/pleomino/staging/infisical-client-id",
    clientSecretRef: "secret://deployments/pleomino/staging/infisical-client-secret",
    clientIdFile: "pleomino-staging-infisical-client-id",
    clientSecretFile: "pleomino-staging-infisical-client-secret",
    machineIdentityId: "8b9bc77a-ad32-459f-82a9-b72cd7a3530d",
    controlPlaneUrl: "https://staging.control-plane.viberoots.example",
    controlPlaneTokenRef: "secret://control-plane/pleomino/staging/service-token",
  },
  prod: {
    context: "pleomino-prod",
    account: "web-platform-prod",
    project: "pleomino-prod-pages",
    customDomain: "pleomino.com",
    environment: "prod",
    clientIdEnv: "PLEOMINO_PROD_INFISICAL_CLIENT_ID",
    clientSecretEnv: "PLEOMINO_PROD_INFISICAL_CLIENT_SECRET",
    clientIdRef: "secret://deployments/pleomino/prod/infisical-client-id",
    clientSecretRef: "secret://deployments/pleomino/prod/infisical-client-secret",
    clientIdFile: "pleomino-prod-infisical-client-id",
    clientSecretFile: "pleomino-prod-infisical-client-secret",
    machineIdentityId: "ceca24df-0e8b-457e-a5a8-cf20a122d2da",
    controlPlaneUrl: "https://control-plane.viberoots.example",
    controlPlaneTokenRef: "secret://control-plane/pleomino/prod/service-token",
  },
};

test("checked-in Pleomino targets derive provider and Infisical topology from contexts", async () => {
  const { deployments, nodes } = await readPleominoDeployments();
  for (const stage of ["staging", "prod"] as const) {
    const node = nodes.find((entry) =>
      String(entry.name || "").includes(`/pleomino/${stage}:deploy`),
    );
    assert.equal(node?.deployment_context, EXPECTED[stage].context);
    assert.deepEqual(node?.infisical_runtime, {});
  }
  const byStage = new Map(
    deployments.map((deployment) => [deployment.environmentStage, deployment]),
  );
  for (const stage of ["staging", "prod"] as const) {
    const deployment = byStage.get(stage);
    const expected = EXPECTED[stage];
    assert.equal(deployment?.deploymentContext?.name, expected.context);
    assert.equal(deployment?.deploymentContext?.controlPlane?.name, expected.context);
    assert.equal(
      deployment?.deploymentContext?.controlPlane?.serviceClient.controlPlaneUrl,
      expected.controlPlaneUrl,
    );
    assert.equal(deployment?.secretBackend, "infisical");
    assert.equal(deployment?.providerTarget.account, expected.account);
    assert.equal(deployment?.providerTarget.project, expected.project);
    assert.equal(deployment?.providerTarget.customDomain, expected.customDomain);
    assert.equal(deployment?.providerTarget.customDomainZoneId, "9411ac5903acb1c2e29b3d4c04ef7e6f");
    assert.equal(deployment?.infisicalRuntime?.projectId, "5a927a1a-e78d-433e-affc-17cc051780c0");
    assert.equal(deployment?.infisicalRuntime?.projectName, "pleomino-deployments");
    assert.equal(deployment?.infisicalRuntime?.projectSlug, "pleomino-deployments");
    assert.equal(deployment?.infisicalRuntime?.environment, expected.environment);
    assert.equal(deployment?.infisicalRuntime?.secretPath, "/");
    assert.equal(deployment?.infisicalRuntime?.machineIdentityClientIdEnv, expected.clientIdEnv);
    assert.equal(
      deployment?.infisicalRuntime?.machineIdentityClientSecretEnv,
      expected.clientSecretEnv,
    );
    assert.equal(deployment?.infisicalRuntime?.machineIdentityClientIdRef, expected.clientIdRef);
    assert.equal(
      deployment?.infisicalRuntime?.machineIdentityClientSecretRef,
      expected.clientSecretRef,
    );
    assert.equal(
      deployment?.infisicalRuntime?.machineIdentityClientIdFileName,
      expected.clientIdFile,
    );
    assert.equal(
      deployment?.infisicalRuntime?.machineIdentityClientSecretFileName,
      expected.clientSecretFile,
    );
    assert.equal(deployment?.infisicalRuntime?.machineIdentityId, expected.machineIdentityId);
  }
});

test("checked-in Pleomino admission evidence records context-derived Infisical identity", async () => {
  const { deployments } = await readPleominoDeployments();
  for (const stage of ["staging", "prod"] as const) {
    const deployment = deployments.find((entry) => entry.environmentStage === stage);
    assert.ok(deployment);
    const expected = EXPECTED[stage];
    const runtime = deployment.infisicalRuntime;
    assert.ok(runtime?.projectId);
    assert.ok(runtime.secretPath);
    const server = await startFakeInfisicalServer(
      { clientId: "id", clientSecret: "secret", accessToken: "token" },
      [
        {
          id: `sec_${stage}`,
          projectId: runtime.projectId,
          environment: expected.environment,
          secretPath: runtime.secretPath,
          secretName: "cloudflare_api_token",
          version: "7",
          secretValue: `runtime-token-${stage}`,
        },
      ],
      {
        projectId: runtime.projectId,
        environment: expected.environment,
      },
    );
    const restore = activateDeploymentSecretContext(infisicalTestContext(server.siteUrl));
    try {
      const admitted = await snapshotWithInfisicalSiteUrl(deployment, server.siteUrl);
      assert.equal(admitted.deploymentContext?.name, expected.context);
      assert.equal(admitted.infisicalRuntime?.projectId, deployment.infisicalRuntime?.projectId);
      assert.equal(admitted.infisicalRuntime?.environment, expected.environment);
      assert.equal(admitted.infisicalRuntime?.secretPath, "/");
      assert.ok(admitted.admittedSecretReferences.length > 0);
      for (const reference of admitted.admittedSecretReferences) {
        assert.equal(reference.backend, "infisical");
        const selectorRef = `${runtime.projectId}:${expected.environment}:/:cloudflare_api_token@7`;
        assert.equal(reference.selectorRef, selectorRef);
        assert.equal(
          reference.referenceId,
          `infisical:${selectorRef.replace("@7", `#sec_${stage}`)}@7`,
        );
      }
    } finally {
      restore();
      await server.close();
    }
  }
});

async function snapshotWithInfisicalSiteUrl(
  deployment: CloudflarePagesDeployment,
  siteUrl: string,
) {
  const recordsRoot = path.resolve(
    "buck-out/tmp",
    `pleomino-context-admission-${deployment.environmentStage}`,
  );
  const snapshot = await createCloudflarePagesControlPlaneSnapshot(
    {
      workspaceRoot: process.cwd(),
      deployment: deployableContextFixture(deployment, siteUrl),
      recordsRoot,
      operationKind: "deploy",
      artifact: {
        kind: "static-webapp",
        identity: `static-webapp:pleomino-${deployment.environmentStage}-context`,
        storedArtifactPath: path.join(recordsRoot, "artifact"),
        provenancePath: path.join(recordsRoot, "artifact.json"),
      },
    },
    `submission-pleomino-${deployment.environmentStage}-context`,
  );
  return snapshot.admittedContext;
}

function deployableContextFixture(deployment: CloudflarePagesDeployment, siteUrl: string) {
  return {
    ...deployment,
    lanePolicy: {
      ...deployment.lanePolicy,
      sourceRefPolicy: {
        ...deployment.lanePolicy.sourceRefPolicy,
        [deployment.environmentStage]: REVIEWED_COMMIT,
      },
    },
    admissionPolicy: {
      ...deployment.admissionPolicy,
      allowedRefs: [REVIEWED_COMMIT],
      requiredChecks: [],
    },
    infisicalRuntime: { ...deployment.infisicalRuntime!, siteUrl },
  };
}

async function readPleominoNodes() {
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const result = await $({
    stdio: "pipe",
    env: {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
    },
  })`buck2 --isolation-dir ${inheritedBuckIsolation("pleomino-contexts")} cquery --target-platforms prelude//platforms:default ${`set(${LABELS.join(" ")})`} --json ${attrFlags}`.quiet();
  return nodesFromCqueryJson(JSON.parse(String(result.stdout || "{}")));
}

async function readPleominoDeployments() {
  const nodes = await readPleominoNodes();
  const { deployments, errors } = extractCloudflarePagesDeployments(nodes);
  assert.deepEqual(errors, []);
  return { deployments, nodes };
}
