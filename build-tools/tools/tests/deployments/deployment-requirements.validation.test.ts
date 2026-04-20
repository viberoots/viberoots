#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDeploymentRequirements } from "../../deployments/deployment-requirements.ts";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture.ts";

function errorsFor(requirements: ReturnType<typeof deploymentRequirementFixture>[]) {
  const errors: string[] = [];
  validateDeploymentRequirements({
    label: "//projects/deployments/pleomino-staging:deploy",
    fieldPath: "secret_requirements",
    requirements,
    errors,
  });
  return errors;
}

test("deployment requirements accept preview_cleanup as a reviewed lifecycle step", () => {
  assert.deepEqual(
    errorsFor([
      deploymentRequirementFixture({
        name: "cloudflare_api_token",
        step: "publish",
      }),
      deploymentRequirementFixture({
        name: "cloudflare_api_token",
        step: "preview_cleanup",
      }),
    ]),
    [],
  );
});

test("deployment requirements fail closed for unknown secret lifecycle steps", () => {
  const errors = errorsFor([
    deploymentRequirementFixture({
      name: "cloudflare_api_token",
      step: "provider_cleanup" as any,
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes('unsupported step "provider_cleanup"')));
});
