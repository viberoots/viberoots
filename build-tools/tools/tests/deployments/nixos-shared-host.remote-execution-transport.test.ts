#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteServiceSubmissionError } from "../../deployments/nixos-shared-host-remote-execution-transport.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

test("remote service submission error explains when the service requires a different commit than the submitted mark-check evidence", () => {
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      requiredChecks: ["deploy/pleomino-dev"],
    },
  });
  const error = remoteServiceSubmissionError(
    new Error(
      "protected/shared admission requires check deploy/pleomino-dev for subject(s) 85e2c9ee8dd909fc041f693fe8e937e34e7b36ef",
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
          },
        ],
      },
    },
  );
  assert.match(
    String(error.message),
    /requires check deploy\/pleomino-dev for commit 85e2c9ee8dd909fc041f693fe8e937e34e7b36ef, but this client submitted passed deploy\/pleomino-dev for commit a6df216710fa35b28fa24475eac69fb24cfa6de7/,
  );
  assert.match(String(error.message), /deployment_source_ref: env\/pleomino\/dev/);
  assert.match(
    String(error.message),
    /remote control-plane repo state does not match your local git workspace/,
  );
  assert.match(
    String(error.message),
    /--mark-check-for-commit 85e2c9ee8dd909fc041f693fe8e937e34e7b36ef/,
  );
});
