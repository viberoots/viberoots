#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ambientProviderEnvBypassErrors,
  validateExternalRequirementProfiles,
} from "../../deployments/external-deployment-requirements";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture";

test("github_app profile validates platform app credentials and optional webhook material", () => {
  const errors = validateExternalRequirementProfiles({
    label: "//projects/deployments/data-room-web-dev:deploy",
    profiles: ["github_app"],
    secretRequirements: [
      deploymentRequirementFixture({
        name: "github_app_private_key",
        step: "publish",
        contractId: "secret://deployments/data-room-web-dev/github/app_private_key",
        source: "secret_runtime",
      }),
      deploymentRequirementFixture({
        name: "github_webhook_secret",
        step: "publish",
        contractId: "secret://deployments/data-room-web-dev/github/webhook_secret",
        source: "secret_runtime",
      }),
    ],
    runtimeConfigRequirements: [
      deploymentRequirementFixture({
        name: "github_app_id",
        step: "publish",
        contractId: "runtime://deployments/data-room-web-dev/github/app_id",
        source: "runtime_config",
      }),
      deploymentRequirementFixture({
        name: "github_webhook_url",
        step: "publish",
        contractId: "runtime://deployments/data-room-web-dev/github/webhook_url",
        source: "runtime_config",
      }),
    ],
  });
  assert.deepEqual(errors, []);
});

test("github_app profile fails closed for missing and misplaced platform app requirements", () => {
  const errors = validateExternalRequirementProfiles({
    label: "//projects/deployments/data-room-worker-dev:deploy",
    profiles: ["github_app"],
    secretRequirements: [
      deploymentRequirementFixture({
        name: "github_app_private_key",
        step: "readiness",
        contractId: "secret://deployments/data-room-worker-dev/github/app_private_key",
        source: "secret_runtime",
      }),
    ],
    runtimeConfigRequirements: [
      deploymentRequirementFixture({
        name: "github_app_id",
        step: "publish",
        contractId: "runtime://other/github/app_id",
        source: "runtime_config",
      }),
    ],
  });
  assert.ok(errors.some((entry) => entry.includes("github_app_private_key must use step publish")));
  assert.ok(errors.some((entry) => entry.includes("github_app_id has wrong contract scope")));
});

test("github_app profile rejects runtime product state as deployment requirements", () => {
  const errors = validateExternalRequirementProfiles({
    label: "//projects/deployments/data-room-worker-dev:deploy",
    profiles: ["github_app"],
    secretRequirements: [
      deploymentRequirementFixture({
        name: "github_app_private_key",
        step: "publish",
        contractId: "secret://deployments/data-room-worker-dev/github/app_private_key",
        source: "secret_runtime",
      }),
    ],
    runtimeConfigRequirements: [
      deploymentRequirementFixture({
        name: "github_app_id",
        step: "publish",
        contractId: "runtime://deployments/data-room-worker-dev/github/app_id",
        source: "runtime_config",
      }),
      deploymentRequirementFixture({
        name: "github_installation_id",
        step: "publish",
        contractId: "runtime://deployments/data-room-worker-dev/github/installation_id",
        source: "runtime_config",
      }),
    ],
  });
  assert.ok(
    errors.some((entry) =>
      entry.includes("github_app must not declare runtime product state github_installation_id"),
    ),
  );
});

test("github_app ambient GitHub env vars cannot satisfy secret requirements", () => {
  const errors = ambientProviderEnvBypassErrors({
    label: "//projects/deployments/data-room-web-dev:deploy",
    env: { GITHUB_APP_PRIVATE_KEY: "live-secret" },
    profiles: ["github_app"],
    secretRequirements: [
      deploymentRequirementFixture({
        name: "github_app_private_key",
        step: "publish",
        contractId: "secret://deployments/data-room-web-dev/github/app_private_key",
      }),
    ],
  });
  assert.deepEqual(errors, [
    "//projects/deployments/data-room-web-dev:deploy: ambient provider env GITHUB_APP_PRIVATE_KEY cannot satisfy secret_requirements",
  ]);
});
