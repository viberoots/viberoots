#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  authorizeControlPlaneAdmissionReport,
  authorizeControlPlaneBootstrap,
  authorizeControlPlaneRunAction,
  authorizeControlPlaneSubmit,
  grantsFor,
} from "../../deployments/deployment-control-plane-authz";
import { resolveSubmitIdempotency } from "../../deployments/deployment-control-plane-idempotency";
import { runInTemp } from "../lib/test-helpers";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("control-plane RBAC keeps submitter and operator scopes distinct", () => {
  const deployment = cloudflarePagesDeploymentFixture();
  const submitter = grantsFor({ principalId: "user:submitter" }, [
    { role: "submitter", scope: { kind: "deployment_id", value: deployment.deploymentId } },
  ]);
  const operator = grantsFor({ principalId: "user:operator" }, [
    {
      role: "operator",
      scope: {
        kind: "provider_target_identity",
        value: deployment.providerTarget.providerTargetIdentity,
      },
    },
  ]);
  const submitDecision = authorizeControlPlaneSubmit({
    deployment,
    operationKind: "deploy",
    authorization: submitter,
  });
  assert.equal(submitDecision.role, "submitter");
  assert.equal(submitDecision.scope.kind, "deployment_id");
  assert.equal(submitDecision.scope.value, deployment.deploymentId);
  assert.throws(
    () =>
      authorizeControlPlaneRunAction({
        deployment,
        action: "cancel",
        authorization: submitter,
      }),
    /not authorized/,
  );
  const actionDecision = authorizeControlPlaneRunAction({
    deployment,
    action: "cancel",
    authorization: operator,
  });
  assert.equal(actionDecision.role, "operator");
  assert.equal(actionDecision.scope.kind, "provider_target_identity");
  assert.equal(actionDecision.scope.value, deployment.providerTarget.providerTargetIdentity);
});

test("approve run actions require approver-scoped authority", () => {
  const deployment = cloudflarePagesDeploymentFixture();
  const approver = grantsFor({ principalId: "user:reviewer" }, [
    { role: "approver", scope: { kind: "deployment_id", value: deployment.deploymentId } },
  ]);
  const decision = authorizeControlPlaneRunAction({
    deployment,
    action: "approve",
    authorization: approver,
  });
  assert.equal(decision.role, "approver");
  assert.equal(decision.scope.kind, "deployment_id");
  assert.throws(
    () =>
      authorizeControlPlaneRunAction({
        deployment,
        action: "approve",
        authorization: grantsFor({ principalId: "user:wrong-scope" }, [
          {
            role: "approver",
            scope: { kind: "deployment_id", value: `${deployment.deploymentId}-other` },
          },
        ]),
      }),
    /not authorized/,
  );
});

test("project and environment scopes authorize only matching deployment families and stages", () => {
  const deployment = cloudflarePagesDeploymentFixture();
  const projectScoped = grantsFor({ principalId: "app:ci-submit" }, [
    { role: "submitter", scope: { kind: "project", value: "projects/deployments/pleomino" } },
  ]);
  const projectDecision = authorizeControlPlaneSubmit({
    deployment,
    operationKind: "deploy",
    authorization: projectScoped,
  });
  assert.equal(projectDecision.role, "submitter");
  assert.equal(projectDecision.scope.kind, "project");

  const environmentScoped = grantsFor({ principalId: "user:reviewer" }, [
    { role: "approver", scope: { kind: "environment_stage", value: "staging" } },
  ]);
  const environmentDecision = authorizeControlPlaneRunAction({
    deployment,
    action: "approve",
    authorization: environmentScoped,
  });
  assert.equal(environmentDecision.role, "approver");
  assert.equal(environmentDecision.scope.kind, "environment_stage");

  assert.throws(
    () =>
      authorizeControlPlaneSubmit({
        deployment,
        operationKind: "deploy",
        authorization: grantsFor({ principalId: "app:wrong-project" }, [
          { role: "submitter", scope: { kind: "project", value: "projects/deployments/other" } },
        ]),
      }),
    /not authorized/,
  );
  assert.throws(
    () =>
      authorizeControlPlaneRunAction({
        deployment,
        action: "approve",
        authorization: grantsFor({ principalId: "user:wrong-stage" }, [
          { role: "approver", scope: { kind: "environment_stage", value: "prod" } },
        ]),
      }),
    /not authorized/,
  );
});

test("admission reporters stay distinct from submitters and approvers", () => {
  const deployment = cloudflarePagesDeploymentFixture();
  const reporter = grantsFor({ principalId: "app:deploy-bot" }, [
    {
      role: "admission_reporter",
      scope: { kind: "admission_domain", value: "all_deployments" },
    },
  ]);
  const decision = authorizeControlPlaneAdmissionReport({
    deployment,
    authorization: reporter,
  });
  assert.equal(decision.role, "admission_reporter");
  assert.equal(decision.scope.kind, "admission_domain");
  assert.throws(
    () =>
      authorizeControlPlaneSubmit({
        deployment,
        operationKind: "deploy",
        authorization: reporter,
      }),
    /not authorized/,
  );
  assert.throws(
    () =>
      authorizeControlPlaneRunAction({
        deployment,
        action: "approve",
        authorization: reporter,
      }),
    /not authorized/,
  );
});

test("submit idempotency reuses matching requests and fails closed on payload drift", async () => {
  await runInTemp("deployment-control-plane-submit-idempotency", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const created = await resolveSubmitIdempotency({
      recordsRoot,
      idempotencyKey: "submit-key-1",
      requestFingerprint: "sha256:first",
      submissionId: "submission-1",
    });
    assert.equal(created.mode, "created");
    assert.equal(created.targetId, "submission-1");
    const reused = await resolveSubmitIdempotency({
      recordsRoot,
      idempotencyKey: "submit-key-1",
      requestFingerprint: "sha256:first",
      submissionId: "submission-2",
    });
    assert.equal(reused.mode, "reused");
    assert.equal(reused.targetId, "submission-1");
    await assert.rejects(
      async () =>
        await resolveSubmitIdempotency({
          recordsRoot,
          idempotencyKey: "submit-key-1",
          requestFingerprint: "sha256:drifted",
          submissionId: "submission-3",
        }),
      /idempotency key submit-key-1 does not match the previous request/,
    );
  });
});

test("bootstrap RBAC is distinct from ordinary submit authority", () => {
  const deployment = nixosSharedHostDeploymentFixture({
    bootstrap: {
      scope: "deployment_authority",
      modes: ["first_install"],
    },
  });
  const submitter = grantsFor({ principalId: "user:submitter" }, [
    { role: "submitter", scope: { kind: "deployment_id", value: deployment.deploymentId } },
  ]);
  assert.throws(
    () =>
      authorizeControlPlaneBootstrap({
        deployment,
        authorization: submitter,
      }),
    /not authorized for bootstrap/,
  );
  const bootstrap = grantsFor({ principalId: "user:bootstrap" }, [
    { role: "bootstrap", scope: { kind: "bootstrap_deployment", value: deployment.deploymentId } },
  ]);
  const decision = authorizeControlPlaneBootstrap({
    deployment,
    authorization: bootstrap,
  });
  assert.equal(decision.role, "bootstrap");
  assert.equal(decision.scope.kind, "bootstrap_deployment");
});
