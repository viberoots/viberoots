#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteServiceSubmissionError } from "../../deployments/nixos-shared-host-remote-execution-transport";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("remote service submission error explains when the service requires a different commit than the submitted admission evidence", () => {
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      requiredChecks: ["deploy/pleomino-dev"],
    },
  });
  const error = remoteServiceSubmissionError(
    Object.assign(
      new Error(
        "protected/shared admission requires check deploy/pleomino-dev for subject(s) 85e2c9ee8dd909fc041f693fe8e937e34e7b36ef",
      ),
      {
        status: {
          serviceInstance: {
            hostname: "mini",
            workspaceRoot: "/srv/viberoots",
            gitHead: "8f00f5cd723bed179a48847d2daeea3e0c2dcce1",
            reviewedRef: "main",
            reviewedRepository: "viberoots/viberoots",
            reviewedRemoteName: "origin",
            reviewedRemoteUrl: "git@github.com:viberoots/viberoots.git",
          },
        },
      },
    ),
    {
      deployment,
      admissionEvidence: {
        checks: [
          {
            name: "deploy/pleomino-dev",
            subject: "a6df216710fa35b28fa24475eac69fb24cfa6de7",
            status: "passed",
            checkedAt: "2026-04-25T00:00:00.000Z",
            reporterIdentity:
              deployment.lanePolicy.governance.trustedReporterIdentities[0] || "app:deploy-bot",
          },
        ],
      },
    },
  );
  assert.match(
    String(error.message),
    /requires check deploy\/pleomino-dev for commit 85e2c9ee8dd909fc041f693fe8e937e34e7b36ef, but this client submitted passed deploy\/pleomino-dev for commit a6df216710fa35b28fa24475eac69fb24cfa6de7/,
  );
  assert.match(String(error.message), /deployment_source_ref: main/);
  assert.match(
    String(error.message),
    /remote control-plane repo state does not match your local git workspace/,
  );
  assert.match(
    String(error.message),
    /deployment source ref is up to date and pushed before retrying/,
  );
  assert.match(
    String(error.message),
    /--admit-for-commit 85e2c9ee8dd909fc041f693fe8e937e34e7b36ef/,
  );
  assert.match(String(error.message), /service_hostname: mini/);
  assert.match(String(error.message), /service_workspace_root: \/srv\/viberoots/);
  assert.match(String(error.message), /service_git_head: 8f00f5cd723bed179a48847d2daeea3e0c2dcce1/);
  assert.match(String(error.message), /service_reviewed_remote: origin/);
});

test("remote service submission error rewrites legacy human missing-grant admin commands", () => {
  const deployment = nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: "//projects/deployments/pleomino/dev:deploy",
    environmentStage: "dev",
  });
  const error = remoteServiceSubmissionError(
    new Error(
      "principal oidc:187bf26e-ee7b-4163-aed3-2440aa706bbf is not authorized to report admission evidence on pleomino-dev: missing admission_reporter grant; expected human group deploy-admission-reporters-pleomino-dev; example admin command: deploy admin identity grant-user --deployment //projects/deployments/pleomino/dev:deploy --action report_checks --user-email <user@example.com> --membership-file ./deployment-host/identity-provider/deployment-auth-memberships.json --acting-principal <principal> --admin-group <deploy-admin-identity-membership-admin-...>; inspect deploy auth explain-groups --deployment //projects/deployments/pleomino/dev:deploy --action report_checks",
    ),
    { deployment },
  );
  assert.match(
    String(error.message),
    /missing admission_reporter grant; expected human group deploy-admission-reporters-pleomino-dev; grant yourself: deploy admin identity grant-user --deployment \/\/projects\/deployments\/pleomino\/dev:deploy --profile mini --action report_checks --apply-host; add --user-email <user@example\.com> to grant another human/,
  );
  assert.doesNotMatch(String(error.message), /--membership-file|--acting-principal|--admin-group/);
});
