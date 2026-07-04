#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";
import {
  SAMPLE_CONTEXT_EXPECTED,
  sampleProjectConfig,
  withProjectConfig,
} from "./sample-deployment-context.fixture";

const STAGING_DEPLOY = "//projects/deployments/sample-webapp/staging:deploy";
const PROD_DEPLOY = "//projects/deployments/sample-webapp/prod:deploy";
const STAGING_CONTEXT = SAMPLE_CONTEXT_EXPECTED.staging.context;
const PROD_CONTEXT = SAMPLE_CONTEXT_EXPECTED.prod.context;

function appNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/apps/sample-webapp:app",
    labels: ["kind:app", "webapp:pwa"],
    ...overrides,
  };
}

function nodes(deployments: GraphNode[]) {
  return [
    appNode(),
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    ...deployments,
  ];
}

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: STAGING_DEPLOY,
    provider: "cloudflare-pages",
    component: "//projects/apps/sample-webapp:app",
    component_kind: "static-webapp",
    publisher: "wrangler-pages",
    publisher_config: "wrangler.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/sample-webapp/shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/sample-webapp/shared:staging_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: {},
    ...overrides,
  };
}

test("deployment_context resolves distinct shared provider topology", async () => {
  await withProjectConfig(sampleProjectConfig(), async () => {
    const { deployments, errors } = extractCloudflarePagesDeployments(
      nodes([
        deploymentNode({ deployment_context: STAGING_CONTEXT }),
        deploymentNode({ name: PROD_DEPLOY, deployment_context: PROD_CONTEXT }),
      ]),
    );
    assert.deepEqual(errors, []);
    const byLabel = new Map(deployments.map((deployment) => [deployment.label, deployment]));
    const staging = byLabel.get(STAGING_DEPLOY);
    const prod = byLabel.get(PROD_DEPLOY);
    assert.equal(staging?.providerTarget.account, SAMPLE_CONTEXT_EXPECTED.staging.account);
    assert.equal(
      staging?.infisicalRuntime?.environment,
      SAMPLE_CONTEXT_EXPECTED.staging.environment,
    );
    assert.equal(prod?.providerTarget.account, SAMPLE_CONTEXT_EXPECTED.prod.account);
    assert.equal(prod?.infisicalRuntime?.environment, SAMPLE_CONTEXT_EXPECTED.prod.environment);
  });
});

test("context secretBackend fills omitted secret_backend and rejects disagreement", async () => {
  await withProjectConfig(sampleProjectConfig(), async () => {
    const filled = extractCloudflarePagesDeployments(
      nodes([deploymentNode({ deployment_context: STAGING_CONTEXT })]),
    );
    assert.deepEqual(filled.errors, []);
    assert.equal(filled.deployments[0]?.secretBackendProfile, "infisical-default");

    const mismatch = extractCloudflarePagesDeployments(
      nodes([
        deploymentNode({
          deployment_context: STAGING_CONTEXT,
          secret_backend: "vault/default",
        }),
      ]),
    );
    assert.ok(mismatch.errors.some((entry) => entry.includes("disagrees with deployment_context")));
  });
});

test("context provider defaults fill missing metadata and reject drift", async () => {
  await withProjectConfig(sampleProjectConfig(), async () => {
    const filled = extractCloudflarePagesDeployments(
      nodes([
        deploymentNode({
          deployment_context: STAGING_CONTEXT,
          provider_target: { id: "custom-id" },
        }),
      ]),
    );
    assert.deepEqual(filled.errors, []);
    assert.equal(
      filled.deployments[0]?.providerTarget.project,
      SAMPLE_CONTEXT_EXPECTED.staging.project,
    );
    assert.equal(filled.deployments[0]?.providerTarget.id, "custom-id");

    const drift = extractCloudflarePagesDeployments(
      nodes([
        deploymentNode({
          deployment_context: STAGING_CONTEXT,
          provider_target: { account: "other" },
        }),
      ]),
    );
    assert.ok(
      drift.errors.some((entry) => entry.includes("provider_target.account other disagrees")),
    );
  });
});

test("deployment_context selector fails closed for malformed and unknown values", () => {
  for (const [value, expected] of [
    ["Bad Name", "backend-local kebab-case"],
    ["missing-prod", "unknown deployment_context"],
    [{ name: "sample-webapp-staging" }, "deployment_context must be a selector string"],
  ] as const) {
    const errors = extractCloudflarePagesDeployments(
      nodes([deploymentNode({ deployment_context: value as unknown as string })]),
    ).errors;
    assert.ok(
      errors.some((entry) => entry.includes(expected)),
      String(expected),
    );
  }
});

test("deployment_context rejects malformed context secretBackend", async () => {
  await withProjectConfig(
    { deploymentContexts: { "bad-prod": { secretBackend: { backend: "infisical" } } } },
    async () => {
      const errors = extractCloudflarePagesDeployments(
        nodes([deploymentNode({ deployment_context: "bad-prod" })]),
      ).errors;
      assert.ok(errors.some((entry) => entry.includes("secretBackend must be a non-empty string")));
    },
  );
});

test("deployment context validation is field-aware for secret refs and plaintext secrets", async () => {
  await withProjectConfig(
    {
      controlPlanes: testControlPlanes(),
      deploymentContexts: {
        "safe-prod": {
          controlPlane: "test",
          secretBackend: "vault/default",
          cloudflare: {
            account: "team-secret-ops",
            projectName: "safe-prod",
            apiTokenRef: "secret://deployments/safe/prod/cloudflare-token",
          },
          infisical: {
            clientSecretEnv: "SAFE_PROD_INFISICAL_CLIENT_SECRET",
          },
        },
        "unsafe-prod": {
          cloudflare: { account: "team", apiTokenRef: "not-a-ref", client_secret: "plaintext" },
        },
      },
    },
    async () => {
      assert.deepEqual(
        extractCloudflarePagesDeployments(
          nodes([deploymentNode({ deployment_context: "safe-prod" })]),
        ).errors,
        [],
      );
      const errors = extractCloudflarePagesDeployments(
        nodes([deploymentNode({ deployment_context: "unsafe-prod" })]),
      ).errors;
      assert.ok(errors.some((entry) => entry.includes("apiTokenRef must be a secret:// ref")));
      assert.ok(errors.some((entry) => entry.includes("client_secret must not contain")));
    },
  );
});

test("local project config can fill missing shared context coordinates", async () => {
  await withProjectConfig(
    {
      controlPlanes: testControlPlanes(),
      deploymentContexts: {
        "admin-prod": { controlPlane: "test", cloudflare: { projectName: "admin-prod-pages" } },
      },
    },
    async (tmp) => {
      await writeJson(tmp, "projects/config/local.json", {
        deploymentContexts: { "admin-prod": { cloudflare: { account: "admin-platform" } } },
      });
      const { deployments, errors } = extractCloudflarePagesDeployments(
        nodes([deploymentNode({ deployment_context: "admin-prod" })]),
      );
      assert.deepEqual(errors, []);
      assert.equal(deployments[0]?.providerTarget.account, "admin-platform");
    },
  );
});

test("app packages cannot declare backend topology fields", () => {
  const errors = extractCloudflarePagesDeployments([
    appNode({ deployment_context: PROD_CONTEXT, secret_backend: "infisical/default" }),
  ]).errors;
  assert.ok(errors.some((entry) => entry.includes("apps cannot declare")));
});

async function writeJson(tmp: string, relativePath: string, value: unknown) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const target = path.join(tmp, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

function testControlPlanes() {
  return {
    test: {
      serviceClient: {
        controlPlaneUrl: "https://control.example",
        controlPlaneTokenRef: "runtime://github-actions/control-plane-token",
      },
    },
  };
}
