#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import { deploymentSecretContractBindings } from "../../deployments/deployment-sprinkle-ref";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";

function appNode(): GraphNode {
  return {
    name: "//projects/apps/pleomino:app",
    labels: ["kind:app", "webapp:pwa"],
  };
}

function policyNodes(): GraphNode[] {
  return [
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
  ];
}

function requirement(overrides: Record<string, string> = {}) {
  return {
    name: "cloudflare_api_token",
    step: "publish",
    contract_id: "secret://deployments/pleomino/cloudflare_api_token",
    required: "true",
    ...overrides,
  };
}

function infisicalRuntime(overrides: Record<string, unknown> = {}) {
  return {
    site_url: "https://app.infisical.com",
    project_id: "proj_123",
    environment: "staging",
    preferred_credential_source: "infisical_machine_identity_universal_auth",
    machine_identity_client_id_env: "VBR_INFISICAL_CLIENT_ID",
    machine_identity_client_secret_env: "VBR_INFISICAL_CLIENT_SECRET",
    ...overrides,
  };
}

function deploymentNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/pleomino-staging:deploy",
    provider: "cloudflare-pages",
    component: "//projects/apps/pleomino:app",
    component_kind: "static-webapp",
    publisher: "wrangler-pages",
    publisher_config: "wrangler.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/pleomino-shared:staging_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: {
      account: "web-platform-staging",
      project: "pleomino-staging-pages",
      id: "pleomino-staging-pages",
    },
    ...overrides,
  };
}

function errorsFor(overrides: Partial<GraphNode>) {
  return extractCloudflarePagesDeployments([appNode(), ...policyNodes(), deploymentNode(overrides)])
    .errors;
}

test("DeploymentSecretBackendKind accepts vault and infisical contract bindings", () => {
  const requirements = [deploymentRequirementFixture()];
  assert.equal(deploymentSecretContractBindings(requirements)[0]?.backend, "vault");
  assert.equal(
    deploymentSecretContractBindings(requirements, "infisical")[0]?.backend,
    "infisical",
  );
});

test("omitted secret_backend normalizes extracted metadata to vault", () => {
  const { deployments, errors } = extractCloudflarePagesDeployments([
    appNode(),
    ...policyNodes(),
    deploymentNode(),
  ]);
  assert.deepEqual(errors, []);
  assert.equal(deployments[0]?.secretBackend, "vault");
  assert.equal(deployments[0]?.secretBackendProfile, "vault-default");
});

test("infisical backend exposes only non-secret routing metadata", () => {
  const { deployments, errors } = extractCloudflarePagesDeployments([
    appNode(),
    ...policyNodes(),
    deploymentNode({
      secret_backend: "infisical/default",
      secret_requirements: [requirement()],
      infisical_runtime: infisicalRuntime({
        secret_path: "/deployments/pleomino",
      }),
      infisical_secret_mappings: {
        "secret://deployments/pleomino/cloudflare_api_token": {
          secret_path: "/cloudflare/pleomino",
          secret_name: "CLOUDFLARE_API_TOKEN",
        },
      },
    }),
  ]);
  assert.deepEqual(errors, []);
  assert.equal(deployments[0]?.secretBackend, "infisical");
  assert.equal(deployments[0]?.secretBackendProfile, "infisical-default");
  assert.equal(deployments[0]?.infisicalRuntime?.projectId, "proj_123");
  assert.equal(
    deployments[0]?.infisicalSecretMappings?.["secret://deployments/pleomino/cloudflare_api_token"]
      ?.secretName,
    "CLOUDFLARE_API_TOKEN",
  );
});

test("deployment metadata extracts explicit backend profile aliases", () => {
  const { deployments, errors } = extractCloudflarePagesDeployments([
    appNode(),
    ...policyNodes(),
    deploymentNode({
      secret_backend: "infisical/regulated",
      secret_requirements: [],
    }),
  ]);
  assert.deepEqual(errors, []);
  assert.equal(deployments[0]?.secretBackendProfile, "infisical-regulated");
});

test("infisical deployment with no secret requirements does not require credentials", () => {
  assert.deepEqual(errorsFor({ secret_backend: "infisical/default", secret_requirements: [] }), []);
});

test("infisical metadata validation rejects unsafe or stale metadata", () => {
  const errors = errorsFor({
    secret_backend: "infisical/default",
    secret_requirements: [requirement()],
    infisical_runtime: infisicalRuntime({
      token: "not-reviewed",
      client_id: "not-reviewed",
      client_secret: "not-reviewed",
      machine_identity_client_id: "not-reviewed",
    }),
    infisical_secret_mappings: {
      "secret://deployments/pleomino/stale": {
        secret_path: "relative",
        secret_name: "",
      },
    },
  });
  assert.ok(errors.some((entry) => entry.includes("infisical_runtime.token is unsupported")));
  assert.ok(errors.some((entry) => entry.includes("infisical_runtime.client_id is unsupported")));
  assert.ok(
    errors.some((entry) => entry.includes("infisical_runtime.client_secret is unsupported")),
  );
  assert.ok(
    errors.some((entry) =>
      entry.includes("infisical_runtime.machine_identity_client_id is unsupported"),
    ),
  );
  assert.ok(
    errors.some((entry) => entry.includes("stale key secret://deployments/pleomino/stale")),
  );
  assert.ok(errors.some((entry) => entry.includes("secret_path must start with /")));
  assert.ok(errors.some((entry) => entry.includes("secret_name is required")));
});

test("infisical metadata validation rejects missing runtime for secret requirements", () => {
  const errors = errorsFor({
    secret_backend: "infisical/default",
    secret_requirements: [requirement()],
  });
  assert.ok(errors.some((entry) => entry.includes("infisical_runtime.site_url is required")));
  assert.ok(
    errors.some((entry) =>
      entry.includes("infisical_runtime.machine_identity_client_id_env is required"),
    ),
  );
  assert.ok(errors.some((entry) => entry.includes("preferred_credential_source")));
});

test("infisical metadata validation requires backend-qualified credential source", () => {
  const errors = errorsFor({
    secret_backend: "infisical/default",
    secret_requirements: [requirement()],
    infisical_runtime: infisicalRuntime({
      preferred_credential_source: "machine_identity_universal_auth",
    }),
  });
  assert.ok(
    errors.some((entry) =>
      entry.includes(
        "infisical_runtime.preferred_credential_source must be infisical_machine_identity_universal_auth",
      ),
    ),
  );
});

test("deployment secret metadata validation rejects unsupported backends", () => {
  const errors = errorsFor({ secret_backend: "other" });
  assert.ok(errors.some((entry) => entry.includes('unsupported secret_backend backend "other"')));
});

test("deployment secret metadata extraction does not contact Infisical", () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("unexpected network call");
  }) as typeof fetch;
  try {
    assert.deepEqual(
      errorsFor({
        secret_backend: "infisical/default",
        secret_requirements: [requirement()],
        infisical_runtime: {
          site_url: "https://app.infisical.com",
          project_id: "proj_123",
          environment: "staging",
          preferred_credential_source: "infisical_machine_identity_universal_auth",
          machine_identity_client_id_env: "VBR_INFISICAL_CLIENT_ID",
          machine_identity_client_secret_env: "VBR_INFISICAL_CLIENT_SECRET",
        },
      }),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
