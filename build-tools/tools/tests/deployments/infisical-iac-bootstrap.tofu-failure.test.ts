#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  buildTofuFailureMessage,
  runOpenTofu,
} from "../../deployments/infisical-iac-bootstrap-tofu";
import type { CommandRunner } from "../../deployments/infisical-iac-bootstrap-types";
import { reviewedMetadata } from "./infisical-iac-bootstrap.fixture";

const args = {
  ...DEFAULT_BOOTSTRAP_ARGS,
  organizationId: "org_1",
  tofuDir: "projects/deployments/pleomino-infisical/opentofu",
  tofuPlanFile: ".local/test.tfplan",
  yes: true,
};

test("OpenTofu init failure includes working directory and retry command", async () => {
  await assert.rejects(
    () => runOpenTofu({ args, credential: credential(), reviewedMetadata, runner: failOn("init") }),
    (error) => {
      const message = String((error as Error).message);
      assert.match(message, /OpenTofu init failed/);
      assert.match(message, /Working directory: .*pleomino-infisical\/opentofu/);
      assert.match(message, /Retry: cd .*pleomino-infisical\/opentofu && tofu init/);
      assert.doesNotMatch(
        message,
        /client-secret-value|personal-token-value|resolved-secret|alpha beta|gamma delta/,
      );
      return true;
    },
  );
});

test("OpenTofu plan failure includes saved plan path and retry command", async () => {
  await assert.rejects(
    () => runOpenTofu({ args, credential: credential(), reviewedMetadata, runner: failOn("plan") }),
    (error) => {
      const message = String((error as Error).message);
      assert.match(message, /OpenTofu plan failed/);
      assert.match(message, /Saved plan: .*\.local\/test\.tfplan/);
      assert.match(message, /Retry: cd .* && tofu plan -out=.*\.local\/test\.tfplan/);
      assert.doesNotMatch(
        message,
        /client-secret-value|personal-token-value|resolved-secret|alpha beta|gamma delta/,
      );
      return true;
    },
  );
});

test("OpenTofu apply failure includes saved plan path and redacted retry UX", async () => {
  await assert.rejects(
    () =>
      runOpenTofu({ args, credential: credential(), reviewedMetadata, runner: failOn("apply") }),
    (error) => {
      const message = String((error as Error).message);
      assert.match(message, /OpenTofu apply failed/);
      assert.match(message, /Saved plan: .*\.local\/test\.tfplan/);
      assert.match(message, /Retry: cd .* && tofu apply .*\.local\/test\.tfplan/);
      assert.match(message, /\[REDACTED\]/);
      assert.doesNotMatch(
        message,
        /client-secret-value|access-token-value|personal-token-value|resolved-secret|alpha beta|gamma delta/,
      );
      return true;
    },
  );
});

test("OpenTofu failure helper quotes retry command paths without secret material", () => {
  const message = buildTofuFailureMessage({
    stage: "plan",
    tofuDir: "/tmp/dir with spaces",
    savedPlan: "/tmp/plan with spaces.tfplan",
    retryArgs: ["plan", "-out=/tmp/plan with spaces.tfplan"],
    cause: "provider failed",
  });
  assert.match(
    message,
    /cd '\/tmp\/dir with spaces' && tofu plan '-out=\/tmp\/plan with spaces\.tfplan'/,
  );
});

function credential() {
  return { clientId: "client-id", clientSecret: "client-secret-value" };
}

function failOn(stage: "init" | "plan" | "apply"): CommandRunner {
  return ({ args: commandArgs }) => {
    if (commandArgs[0] === stage)
      throw new Error(
        [
          "failed with",
          "client_secret=client-secret-value",
          "access_token=access-token-value",
          "personal_token=personal-token-value",
          "personalToken: personal-token-value",
          '"personalToken":"personal-token-value"',
          "secret_value: resolved-secret",
          'secret_value: "alpha beta"',
          "personalToken='gamma delta'",
          '"secretValue":"resolved-secret"',
        ].join(" "),
      );
    return "";
  };
}
