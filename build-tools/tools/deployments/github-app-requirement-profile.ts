#!/usr/bin/env zx-wrapper
import type { DeploymentRequirement } from "./deployment-requirements";
import type { ExpectedRequirement } from "./external-deployment-requirements";

export const GITHUB_APP_REQUIREMENTS: ExpectedRequirement[] = [
  secret("github_app_private_key", "publish", "secret://deployments/"),
  runtime("github_app_id", "publish", "runtime://deployments/"),
];

const OPTIONAL_REQUIREMENTS = [
  secret("github_webhook_secret", "publish", "secret://deployments/"),
  runtime("github_callback_url", "publish", "runtime://deployments/"),
  runtime("github_webhook_url", "publish", "runtime://deployments/"),
];

const PRODUCT_STATE_REQUIREMENTS = new Set([
  "github_repository_owner",
  "github_repository_name",
  "github_repository_full_name",
  "github_installation_id",
  "github_selected_repository_id",
  "github_selected_repository_ids",
  "github_tenant_source_id",
  "github_refresh_state",
  "github_import_snapshot",
]);

export function validateGithubAppProfileRequirements(opts: {
  errors: string[];
  label: string;
  byField: Record<ExpectedRequirement["field"], DeploymentRequirement[]>;
}) {
  for (const expected of OPTIONAL_REQUIREMENTS) {
    for (const actual of opts.byField[expected.field].filter(
      (entry) => entry.name === expected.name,
    )) {
      pushMismatch(opts.errors, opts.label, expected, actual);
    }
  }
  for (const field of ["secret_requirements", "runtime_config_requirements"] as const) {
    for (const actual of opts.byField[field]) {
      if (PRODUCT_STATE_REQUIREMENTS.has(actual.name)) {
        opts.errors.push(
          `${opts.label}: github_app must not declare runtime product state ${actual.name}`,
        );
      }
    }
  }
}

function pushMismatch(
  errors: string[],
  label: string,
  expected: ExpectedRequirement,
  actual: DeploymentRequirement,
) {
  if (actual.step !== expected.step) {
    errors.push(`${label}: github_app ${actual.name} must use step ${expected.step}`);
  }
  if (!actual.contractId.startsWith(expected.contractPrefix)) {
    errors.push(`${label}: github_app ${actual.name} has wrong contract scope`);
  }
  if (actual.source && actual.source !== expected.targetScope) {
    errors.push(`${label}: github_app ${actual.name} must use ${expected.targetScope}`);
  }
}

function secret(
  name: string,
  step: DeploymentRequirement["step"],
  contractPrefix: string,
): ExpectedRequirement {
  return {
    field: "secret_requirements",
    name,
    step,
    contractPrefix,
    targetScope: "secret_runtime",
  };
}

function runtime(
  name: string,
  step: DeploymentRequirement["step"],
  contractPrefix: string,
): ExpectedRequirement {
  return {
    field: "runtime_config_requirements",
    name,
    step,
    contractPrefix,
    targetScope: "runtime_config",
  };
}
