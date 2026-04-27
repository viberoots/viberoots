#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorizeControlPlaneAdmissionReport,
  authorizeControlPlaneRunAction,
  authorizeControlPlaneSubmit,
  grantsFor,
} from "../../deployments/deployment-control-plane-authz.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";

test("authorization diagnostics distinguish missing submitter, admission_reporter, and approver grants", () => {
  const deployment = cloudflarePagesDeploymentFixture();
  assert.throws(
    () =>
      authorizeControlPlaneSubmit({
        deployment,
        operationKind: "deploy",
        authorization: grantsFor({ principalId: "app:ci-reporter" }, [
          {
            role: "admission_reporter",
            scope: { kind: "admission_domain", value: "all_deployments" },
          },
        ]),
      }),
    /submitter[\s\S]*expected automation groups include[\s\S]*deploy auth explain-groups/,
  );
  assert.throws(
    () =>
      authorizeControlPlaneAdmissionReport({
        deployment,
        authorization: grantsFor({ principalId: "user:submitter" }, [
          { role: "submitter", scope: { kind: "deployment_id", value: deployment.deploymentId } },
        ]),
      }),
    /admission_reporter[\s\S]*deploy-admission-reporters-pleomino-staging[\s\S]*grant yourself: deploy admin keycloak grant-user --deployment .* --profile mini --action report_checks --apply-host[\s\S]*add --user-email <user@example\.com> to grant another human/,
  );
  assert.throws(
    () =>
      authorizeControlPlaneRunAction({
        deployment,
        action: "approve",
        authorization: grantsFor({ principalId: "user:submitter" }, [
          { role: "submitter", scope: { kind: "deployment_id", value: deployment.deploymentId } },
        ]),
      }),
    /approver[\s\S]*deploy-approvers-pleomino-staging[\s\S]*grant yourself: deploy admin keycloak grant-user --deployment .* --profile mini --action approve --apply-host[\s\S]*add --user-email <user@example\.com> to grant another human/,
  );
});
