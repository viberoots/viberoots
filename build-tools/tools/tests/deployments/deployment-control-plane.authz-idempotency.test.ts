#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  authorizeControlPlaneRunAction,
  authorizeControlPlaneSubmit,
  grantsFor,
} from "../../deployments/deployment-control-plane-authz.ts";
import { resolveSubmitIdempotency } from "../../deployments/deployment-control-plane-idempotency.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";

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
