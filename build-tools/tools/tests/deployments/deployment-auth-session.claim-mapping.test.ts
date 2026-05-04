#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizationForOidcPrincipal } from "../../deployments/deployment-auth-session-principal";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

function deployment() {
  return nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: "//projects/deployments/pleomino-dev:deploy",
    lanePolicyRef: "//projects/deployments/pleomino-shared:lane",
    environmentStage: "dev",
  });
}

test("human deployment groups derive deployment-scoped grants", () => {
  const authorization = authorizationForOidcPrincipal({
    deployment: deployment(),
    principal: { principalId: "oidc:human-1" },
    claims: {
      groups: [
        "deploy-submitters-pleomino-dev",
        "deploy-admission-reporters-pleomino-dev",
        "deploy-approvers-pleomino-prod",
      ],
    },
  });

  assert.deepEqual(authorization.grants, [
    { role: "submitter", scope: { kind: "deployment_id", value: "pleomino-dev" } },
    { role: "admission_reporter", scope: { kind: "deployment_id", value: "pleomino-dev" } },
  ]);
});

test("automation principal groups derive project, environment, and admission-domain grants", () => {
  const authorization = authorizationForOidcPrincipal({
    deployment: deployment(),
    principal: { principalId: "oidc:service-account-jenkins" },
    claims: {
      sub: "service-account-jenkins",
      preferred_username: "service-account-jenkins",
      groups: [
        "deploy-automation-jenkins-submitters-project-pleomino",
        "deploy-automation-jenkins-approvers-dev",
        "deploy-automation-jenkins-admission-reporters-all-deployments",
        "deploy-automation-other-submitters-project-pleomino",
        "deploy-automation-jenkins-submitters-prod",
      ],
    },
  });

  assert.deepEqual(authorization.grants, [
    { role: "submitter", scope: { kind: "project", value: "projects/deployments/pleomino" } },
    { role: "approver", scope: { kind: "environment_stage", value: "dev" } },
    { role: "admission_reporter", scope: { kind: "admission_domain", value: "all_deployments" } },
  ]);
});

test("human and automation mappings compose into one deterministic grant set", () => {
  const authorization = authorizationForOidcPrincipal({
    deployment: deployment(),
    principal: { principalId: "oidc:hybrid-principal" },
    claims: {
      sub: "service-account-jenkins",
      groups: [
        "deploy-submitters-pleomino-dev",
        "deploy-approvers-pleomino-dev",
        "deploy-automation-jenkins-admission-reporters-project-pleomino",
      ],
    },
  });

  assert.deepEqual(authorization.grants, [
    { role: "submitter", scope: { kind: "deployment_id", value: "pleomino-dev" } },
    { role: "approver", scope: { kind: "deployment_id", value: "pleomino-dev" } },
    {
      role: "admission_reporter",
      scope: { kind: "project", value: "projects/deployments/pleomino" },
    },
  ]);
});

test("missing or malformed groups do not create implicit grants", () => {
  const noGroups = authorizationForOidcPrincipal({
    deployment: deployment(),
    principal: { principalId: "oidc:service-account-jenkins" },
    claims: { sub: "service-account-jenkins" },
  });
  assert.deepEqual(noGroups.grants, []);

  const malformedGroups = authorizationForOidcPrincipal({
    deployment: deployment(),
    principal: { principalId: "oidc:human-1" },
    claims: {
      groups: [
        "deploy-submitters-pleomino",
        "deploy-automation-jenkins-submitters",
        "deploy-admission-reporters-pleomino-prod",
      ],
    },
  });
  assert.deepEqual(malformedGroups.grants, []);
});
