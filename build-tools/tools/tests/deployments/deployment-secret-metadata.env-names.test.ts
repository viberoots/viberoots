#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";

function appNode(): GraphNode {
  return { name: "//projects/apps/pleomino:app", labels: ["kind:app", "webapp:pwa"] };
}

function requirement() {
  return {
    name: "cloudflare_api_token",
    step: "publish",
    contract_id: "secret://deployments/pleomino/cloudflare_api_token",
    required: "true",
  };
}

function infisicalRuntime(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    site_url: "https://app.infisical.com",
    project_id: "proj_123",
    environment: "staging",
    preferred_credential_source: "machine_identity_universal_auth",
    machine_identity_client_id_env: "VBR_INFISICAL_CLIENT_ID",
    machine_identity_client_secret_env: "VBR_INFISICAL_CLIENT_SECRET",
    ...overrides,
  };
}

function errorsFor(runtime: Record<string, unknown>, secretRequirements = [requirement()]) {
  return extractCloudflarePagesDeployments([
    appNode(),
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    {
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
      secret_backend: "infisical",
      secret_requirements: secretRequirements,
      runtime_config_requirements: [],
      infisical_runtime: runtime,
      provider_target: {
        account: "web-platform-staging",
        project: "pleomino-staging-pages",
        id: "pleomino-staging-pages",
      },
    },
  ]).errors;
}

test("infisical metadata validation rejects missing or invalid Universal Auth env names", () => {
  for (const [field, value, expected] of [
    ["machine_identity_client_id_env", undefined, "is required"],
    ["machine_identity_client_id_env", "", "is required"],
    ["machine_identity_client_id_env", 123, "must be a valid environment-variable name"],
    ["machine_identity_client_id_env", "not-valid", "must be a valid environment-variable name"],
    ["machine_identity_client_secret_env", undefined, "is required"],
    ["machine_identity_client_secret_env", "", "is required"],
    ["machine_identity_client_secret_env", false, "must be a valid environment-variable name"],
    ["machine_identity_client_secret_env", "9_BAD", "must be a valid environment-variable name"],
  ] as const) {
    const runtime = infisicalRuntime();
    if (value === undefined) delete runtime[field];
    else runtime[field] = value;
    const errors = errorsFor(runtime);
    assert.ok(
      errors.some(
        (entry) => entry.includes(`infisical_runtime.${field}`) && entry.includes(expected),
      ),
      `${field}=${String(value)} should fail with ${expected}; errors: ${errors.join("\n")}`,
    );
  }
});

test("infisical env-name validation allows fixture and metadata-only deployments", () => {
  const previous = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = "/tmp/reviewed-secret-fixture.json";
  try {
    assert.deepEqual(errorsFor(infisicalRuntime({ machine_identity_client_id_env: "" })), []);
  } finally {
    if (previous === undefined) delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
    else process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = previous;
  }
  assert.deepEqual(errorsFor({}, []), []);
});

test("infisical env-name validation errors do not expose credential-shaped values", () => {
  const secretLikeValue = "client-secret-value-not-an-env-name";
  const errors = errorsFor(
    infisicalRuntime({ machine_identity_client_secret_env: secretLikeValue }),
  );
  assert.ok(errors.some((entry) => entry.includes("machine_identity_client_secret_env")));
  assert.ok(!errors.join("\n").includes(secretLikeValue));
});

test("infisical metadata validation rejects unsupported token-style env metadata", () => {
  const errors = errorsFor(
    infisicalRuntime({
      token_env: "INFISICAL_TOKEN",
      access_token_env: "INFISICAL_ACCESS_TOKEN",
      personal_token_env: "INFISICAL_PERSONAL_TOKEN",
      secret_value_env: "INFISICAL_SECRET_VALUE",
    }),
  );
  for (const key of ["token_env", "access_token_env", "personal_token_env", "secret_value_env"]) {
    assert.ok(
      errors.some((entry) => entry.includes(`infisical_runtime.${key} is unsupported`)),
      `${key} should be rejected; errors: ${errors.join("\n")}`,
    );
  }
});
