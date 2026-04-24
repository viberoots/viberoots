#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  writeTempCloudflareValidationWorkspace,
  writeTempListedDeploymentWorkspace,
} from "./deploy.front-door.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

test("deploy --validate-only prints metadata-derived admission requirements", async () => {
  await runInTemp("deploy-validate-only-admission-requirements", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-dev:deploy --validate-only`;
    const payload = JSON.parse(String(result.stdout));
    assert.deepEqual(payload.admissionRequirements, {
      admission_policy: "//sandbox/deployments/shared:dev_release",
      allowed_refs: ["env/demo/dev"],
      required_checks: ["deploy/demo-dev"],
      required_approvals: [],
      mark_check_passed: {
        relevant_for_workflow: true,
        authorization_required: "admission_reporter",
      },
    });
  });
});

test("deploy --validate-only makes zero required checks explicit", async () => {
  await runInTemp("deploy-validate-only-no-required-checks", async (tmp, $) => {
    await writeTempCloudflareValidationWorkspace(tmp);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-staging:deploy --validate-only`;
    const payload = JSON.parse(String(result.stdout));
    assert.deepEqual(payload.admissionRequirements, {
      admission_policy: "//sandbox/deployments/shared:staging_release",
      allowed_refs: ["env/demo/staging"],
      required_checks: [],
      required_approvals: [],
      mark_check_passed: {
        relevant_for_workflow: false,
        authorization_required: "admission_reporter",
      },
    });
  });
});

test("deploy --mark-check-passed with no value suggests authoritative required checks", async () => {
  await runInTemp("deploy-mark-check-passed-missing-value", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-dev:deploy --mark-check-passed`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /--validate-only/);
    assert.match(
      String(result.stderr),
      /admission_policy: \/\/sandbox\/deployments\/shared:dev_release/,
    );
    assert.match(String(result.stderr), /required_checks: deploy\/demo-dev/);
    assert.match(String(result.stderr), /admission_reporter/);
  });
});

test("deploy --mark-check-passed with no value says when a deployment has no required checks", async () => {
  await runInTemp("deploy-mark-check-passed-no-required-checks", async (tmp, $) => {
    await writeTempCloudflareValidationWorkspace(tmp);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-staging:deploy --mark-check-passed`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /has no required_checks/);
    assert.match(String(result.stderr), /--validate-only/);
  });
});
