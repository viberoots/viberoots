#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ambientProviderEnvBypassErrors,
  validateExternalRequirementProfiles,
} from "../../deployments/external-deployment-requirements";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture";

test("external requirement profiles validate required secrets and runtime config", () => {
  const errors = validateExternalRequirementProfiles({
    label: "//projects/deployments/console-prod:deploy",
    profiles: ["workos_authkit", "supabase", "console_web_base_url"],
    secretRequirements: [
      deploymentRequirementFixture({
        name: "workos_client_secret",
        step: "publish",
        contractId: "secret://deployments/workos/client_secret/prod",
        source: "secret_runtime",
      }),
      deploymentRequirementFixture({
        name: "supabase_service_role_key",
        step: "publish",
        contractId: "secret://deployments/supabase/service_role_key/prod",
        source: "secret_runtime",
      }),
    ],
    runtimeConfigRequirements: [
      deploymentRequirementFixture({
        name: "workos_client_id",
        step: "publish",
        contractId: "config://deployments/workos/client_id/prod",
        source: "runtime_config",
      }),
      deploymentRequirementFixture({
        name: "workos_redirect_uri",
        step: "publish",
        contractId: "config://deployments/workos/redirect_uri/prod",
        source: "runtime_config",
      }),
      deploymentRequirementFixture({
        name: "supabase_public_url",
        step: "publish",
        contractId: "config://deployments/supabase/public_url/prod",
        source: "runtime_config",
      }),
      deploymentRequirementFixture({
        name: "console_to_web_base_url",
        step: "publish",
        contractId: "config://deployments/console/web_base_url/prod",
        source: "runtime_config",
      }),
    ],
  });
  assert.deepEqual(errors, []);
});

test("external requirement profiles fail closed for wrong step and scope", () => {
  const errors = validateExternalRequirementProfiles({
    label: "//projects/deployments/console-prod:deploy",
    profiles: ["ragie"],
    secretRequirements: [
      deploymentRequirementFixture({
        name: "ragie_api_key",
        step: "smoke",
        contractId: "secret://deployments/other/api_key",
        source: "env",
      }),
    ],
    runtimeConfigRequirements: [],
  });
  assert.ok(errors.some((entry) => entry.includes("must use step publish")));
  assert.ok(errors.some((entry) => entry.includes("wrong contract scope")));
  assert.ok(errors.some((entry) => entry.includes("must use secret_runtime")));
});

test("external requirement profiles fail closed for missing secrets and runtime config separately", () => {
  const errors = validateExternalRequirementProfiles({
    label: "//projects/deployments/console-prod:deploy",
    profiles: ["workos_authkit"],
    secretRequirements: [],
    runtimeConfigRequirements: [
      deploymentRequirementFixture({
        name: "workos_client_id",
        step: "publish",
        contractId: "config://deployments/workos/client_id/prod",
      }),
    ],
  });
  assert.ok(
    errors.some((entry) => entry.includes("missing secret_requirements workos_client_secret")),
  );
  assert.ok(
    errors.some((entry) =>
      entry.includes("missing runtime_config_requirements workos_redirect_uri"),
    ),
  );
});

test("external requirement profiles reject duplicate declarations", () => {
  const errors = validateExternalRequirementProfiles({
    label: "//projects/deployments/console-prod:deploy",
    profiles: ["ragie", "console_web_base_url"],
    secretRequirements: [
      deploymentRequirementFixture({ name: "ragie_api_key" }),
      deploymentRequirementFixture({ name: "ragie_api_key" }),
    ],
    runtimeConfigRequirements: [
      deploymentRequirementFixture({ name: "console_to_web_base_url" }),
      deploymentRequirementFixture({ name: "console_to_web_base_url" }),
    ],
  });
  assert.ok(
    errors.some((entry) =>
      entry.includes("duplicate secret_requirements declaration ragie_api_key"),
    ),
  );
  assert.ok(
    errors.some((entry) =>
      entry.includes("duplicate runtime_config_requirements declaration console_to_web_base_url"),
    ),
  );
});

test("provider secrets cannot be satisfied from ambient env vars", () => {
  const errors = ambientProviderEnvBypassErrors({
    label: "//projects/deployments/console-prod:deploy",
    env: { RAGIE_API_KEY: "live-secret", VERCEL_TOKEN: "live-token" },
    secretRequirements: [
      deploymentRequirementFixture({
        name: "ragie_api_key",
        step: "publish",
        contractId: "secret://deployments/ragie/api_key/prod",
      }),
    ],
  });
  assert.equal(errors.length, 2);
});
