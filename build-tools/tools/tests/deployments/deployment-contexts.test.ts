#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";

function appNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return { name: "//projects/apps/pleomino:app", labels: ["kind:app", "webapp:pwa"], ...overrides };
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
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: {},
    ...overrides,
  };
}

test("deployment_context resolves distinct shared provider topology", () => {
  const { deployments, errors } = extractCloudflarePagesDeployments(
    nodes([
      deploymentNode({ deployment_context: "pleomino-staging" }),
      deploymentNode({
        name: "//projects/deployments/pleomino/prod:deploy",
        deployment_context: "pleomino-prod",
      }),
    ]),
  );
  assert.deepEqual(errors, []);
  const byLabel = new Map(deployments.map((deployment) => [deployment.label, deployment]));
  assert.equal(
    byLabel.get("//projects/deployments/pleomino/staging:deploy")?.providerTarget.account,
    "web-platform-staging",
  );
  assert.equal(
    byLabel.get("//projects/deployments/pleomino/staging:deploy")?.infisicalRuntime?.environment,
    "staging",
  );
  assert.equal(
    byLabel.get("//projects/deployments/pleomino/prod:deploy")?.providerTarget.account,
    "web-platform-prod",
  );
  assert.equal(
    byLabel.get("//projects/deployments/pleomino/prod:deploy")?.infisicalRuntime?.environment,
    "prod",
  );
});

test("context secretBackend fills omitted secret_backend and rejects disagreement", () => {
  const filled = extractCloudflarePagesDeployments(
    nodes([deploymentNode({ deployment_context: "pleomino-staging" })]),
  );
  assert.deepEqual(filled.errors, []);
  assert.equal(filled.deployments[0]?.secretBackendProfile, "infisical-default");

  const mismatch = extractCloudflarePagesDeployments(
    nodes([
      deploymentNode({ deployment_context: "pleomino-staging", secret_backend: "vault/default" }),
    ]),
  );
  assert.ok(mismatch.errors.some((entry) => entry.includes("disagrees with deployment_context")));
});

test("context provider defaults fill missing metadata and reject drift", () => {
  const filled = extractCloudflarePagesDeployments(
    nodes([
      deploymentNode({
        deployment_context: "pleomino-staging",
        provider_target: { id: "custom-id" },
      }),
    ]),
  );
  assert.deepEqual(filled.errors, []);
  assert.equal(filled.deployments[0]?.providerTarget.project, "pleomino-staging-pages");
  assert.equal(filled.deployments[0]?.providerTarget.id, "custom-id");

  const drift = extractCloudflarePagesDeployments(
    nodes([
      deploymentNode({
        deployment_context: "pleomino-staging",
        provider_target: { account: "other" },
      }),
    ]),
  );
  assert.ok(
    drift.errors.some((entry) => entry.includes("provider_target.account other disagrees")),
  );
});

test("deployment_context selector fails closed for malformed and unknown values", () => {
  for (const [value, expected] of [
    ["Bad Name", "backend-local kebab-case"],
    ["missing-prod", "unknown deployment_context"],
    [{ name: "pleomino-staging" }, "deployment_context must be a selector string"],
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
    async () => {
      await writeJson("projects/config/local.json", {
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
    appNode({ deployment_context: "pleomino-prod", secret_backend: "infisical/default" }),
  ]).errors;
  assert.ok(errors.some((entry) => entry.includes("apps cannot declare")));
});

async function withProjectConfig(shared: Record<string, unknown>, run: () => Promise<void>) {
  const oldCwd = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deployment-contexts-"));
  try {
    process.chdir(dir);
    await writeJson("projects/config/shared.json", {
      schemaVersion: "viberoots-project-config@1",
      ...shared,
    });
    await run();
  } finally {
    process.chdir(oldCwd);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeJson(relativePath: string, value: unknown) {
  await fs.mkdir(path.dirname(relativePath), { recursive: true });
  await fs.writeFile(relativePath, `${JSON.stringify(value, null, 2)}\n`);
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
