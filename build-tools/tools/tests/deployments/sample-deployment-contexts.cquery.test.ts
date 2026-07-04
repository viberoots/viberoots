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
import {
  SAMPLE_CONTEXT_EXPECTED,
  SAMPLE_CONTEXT_LABELS,
  writeSampleDeploymentContextFixture,
} from "./sample-deployment-context.fixture";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const REVIEWED_COMMIT = "commit:0123456789abcdef0123456789abcdef01234567";

test("temp sample targets derive provider and Infisical topology from contexts", async () => {
  await runInTemp("sample-contexts-cquery", async (tmp, $) => {
    await writeSampleDeploymentContextFixture(tmp);
    const { deployments, nodes } = await readSampleDeployments(tmp, $);
    for (const stage of ["staging", "prod"] as const) {
      const node = nodes.find((entry) =>
        String(entry.name || "").includes(`/sample-webapp/${stage}:deploy`),
      );
      assert.equal(node?.deployment_context, SAMPLE_CONTEXT_EXPECTED[stage].context);
      assert.deepEqual(node?.infisical_runtime, {});
    }
    const byStage = new Map(
      deployments.map((deployment) => [deployment.environmentStage, deployment]),
    );
    for (const stage of ["staging", "prod"] as const) {
      const deployment = byStage.get(stage);
      const expected = SAMPLE_CONTEXT_EXPECTED[stage];
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
      assert.equal(
        deployment?.providerTarget.customDomainZoneId,
        "9411ac5903acb1c2e29b3d4c04ef7e6f",
      );
      assert.equal(deployment?.infisicalRuntime?.projectId, "5a927a1a-e78d-433e-affc-17cc051780c0");
      assert.equal(deployment?.infisicalRuntime?.projectName, "sample-webapp-deployments");
      assert.equal(deployment?.infisicalRuntime?.projectSlug, "sample-webapp-deployments");
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
});

test("temp sample admission evidence records context-derived Infisical identity", async () => {
  await runInTemp("sample-context-admission", async (tmp, $) => {
    await writeSampleDeploymentContextFixture(tmp);
    const { deployments } = await readSampleDeployments(tmp, $);
    for (const stage of ["staging", "prod"] as const) {
      const deployment = deployments.find((entry) => entry.environmentStage === stage);
      assert.ok(deployment);
      const expected = SAMPLE_CONTEXT_EXPECTED[stage];
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
        const admitted = await snapshotWithInfisicalSiteUrl(tmp, deployment, server.siteUrl);
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
});

async function snapshotWithInfisicalSiteUrl(
  workspaceRoot: string,
  deployment: CloudflarePagesDeployment,
  siteUrl: string,
) {
  const recordsRoot = path.resolve(
    workspaceRoot,
    "buck-out/tmp",
    `sample-context-admission-${deployment.environmentStage}`,
  );
  const snapshot = await createCloudflarePagesControlPlaneSnapshot(
    {
      workspaceRoot,
      deployment: deployableContextFixture(deployment, siteUrl),
      recordsRoot,
      operationKind: "deploy",
      artifact: {
        kind: "static-webapp",
        identity: `static-webapp:sample-webapp-${deployment.environmentStage}-context`,
        storedArtifactPath: path.join(recordsRoot, "artifact"),
        provenancePath: path.join(recordsRoot, "artifact.json"),
      },
    },
    `submission-sample-webapp-${deployment.environmentStage}-context`,
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

async function readSampleNodes(tmp: string, zx: typeof $) {
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const result = await zx({
    cwd: tmp,
    stdio: "pipe",
    env: {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
    },
  })`buck2 --isolation-dir ${inheritedBuckIsolation("sample-contexts")} cquery --target-platforms prelude//platforms:default ${`set(${SAMPLE_CONTEXT_LABELS.join(" ")})`} --json ${attrFlags}`.quiet();
  return nodesFromCqueryJson(JSON.parse(String(result.stdout || "{}")));
}

async function readSampleDeployments(tmp: string, zx: typeof $) {
  const nodes = await readSampleNodes(tmp, zx);
  const { deployments, errors } = extractCloudflarePagesDeployments(nodes, { workspaceRoot: tmp });
  assert.deepEqual(errors, []);
  return { deployments, nodes };
}
