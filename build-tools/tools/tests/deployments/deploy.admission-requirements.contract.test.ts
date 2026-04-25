#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { resolveDeploymentAdmissionEvidence } from "../../deployments/deployment-admission-cli.ts";
import { resolveDeploymentForCli } from "../../deployments/deployment-cli-resolve.ts";
import {
  writeTempCloudflareValidationWorkspace,
  writeTempListedDeploymentWorkspace,
} from "./deploy.front-door.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

test("deploy --validate-only prints metadata-derived admission requirements", async () => {
  await runInTemp("deploy-validate-only-admission-requirements", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await $({ cwd: tmp, stdio: "pipe" })`git branch -f env/demo/dev HEAD`;
    const requiredSha = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse env/demo/dev`).stdout,
    ).trim();
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
      required_check_subject: {
        kind: "git_commit",
        ref: "env/demo/dev",
        sha: requiredSha,
      },
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
    await $({ cwd: tmp, stdio: "pipe" })`git branch -f env/demo/staging HEAD`;
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
    assert.match(
      String(result.stderr),
      /Run this instead: deploy --deployment \/\/sandbox\/deployments\/demo-dev:deploy --mark-check-passed deploy\/demo-dev/,
    );
    assert.match(
      String(result.stderr),
      /Inspect requirements only: deploy --deployment \/\/sandbox\/deployments\/demo-dev:deploy --validate-only/,
    );
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
    assert.match(String(result.stderr), /required_checks: none/);
    assert.match(
      String(result.stderr),
      /Run this instead: deploy --deployment \/\/sandbox\/deployments\/demo-staging:deploy/,
    );
    assert.doesNotMatch(String(result.stderr), /Run this instead: .*--mark-check-passed/);
  });
});

test("deploy --mark-check-passed defaults to HEAD and fails closed when the deployment requires another commit", async () => {
  await runInTemp("deploy-mark-check-passed-head-mismatch", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git config user.name Codex`;
    await $({ cwd: tmp })`git config user.email codex@example.test`;
    await $({ cwd: tmp })`git add .`;
    await $({ cwd: tmp })`git commit -m initial`;
    const stageRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout,
    ).trim();
    await $({ cwd: tmp })`git branch env/demo/dev ${stageRevision}`;
    await fsp.writeFile(`${tmp}/local-only.txt`, "local-only\n", "utf8");
    await $({ cwd: tmp })`git add local-only.txt`;
    await $({ cwd: tmp })`git commit -m local-only`;
    const headRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout,
    ).trim();
    assert.notEqual(headRevision, stageRevision);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-dev:deploy --mark-check-passed deploy/demo-dev`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /defaulted to local HEAD:/);
    assert.match(String(result.stderr), new RegExp(`requires checks for: ${stageRevision}`));
    assert.match(String(result.stderr), /deployment_source_ref: env\/demo\/dev/);
    assert.match(
      String(result.stderr),
      new RegExp(`--mark-check-for-commit ${stageRevision.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  });
});

test("deploy --mark-check-passed explains when the deployment source ref is unavailable locally", async () => {
  await runInTemp("deploy-mark-check-passed-missing-source-ref", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await $({ cwd: tmp, stdio: "pipe" })`git branch -D env/demo/dev`.nothrow();
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment //sandbox/deployments/demo-dev:deploy --mark-check-passed deploy/demo-dev`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stderr),
      /deployment source ref env\/demo\/dev is not available in this git workspace/,
    );
    assert.match(
      String(result.stderr),
      /Run this first \(replace <remote> with your git remote\): git fetch <remote> env\/demo\/dev:env\/demo\/dev/,
    );
    assert.match(
      String(result.stderr),
      /Then retry: deploy --deployment \/\/sandbox\/deployments\/demo-dev:deploy --mark-check-passed deploy\/demo-dev/,
    );
    assert.match(
      String(result.stderr),
      /Or rerun with --mark-check-for-commit <sha> if you already know the reviewed commit\./,
    );
    assert.doesNotMatch(String(result.stderr), /Inspect requirements only:/);
    assert.doesNotMatch(String(result.stderr), /Command failed: git rev-parse env\/demo\/dev/);
    assert.doesNotMatch(String(result.stderr), /Use '--' to separate paths from revisions/);
    assert.doesNotMatch(
      String(result.stderr),
      /at resolveDeploymentRequiredCheckSubject|at async resolveDeploymentAdmissionEvidence/,
    );
  });
});

test("deploy --mark-check-for-commit binds explicit evidence to the requested commit", async () => {
  await runInTemp("deploy-mark-check-for-commit-explicit", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git config user.name Codex`;
    await $({ cwd: tmp })`git config user.email codex@example.test`;
    await $({ cwd: tmp })`git add .`;
    await $({ cwd: tmp })`git commit -m initial`;
    const stageRevision = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout,
    ).trim();
    await $({ cwd: tmp })`git branch env/demo/dev ${stageRevision}`;
    await fsp.writeFile(`${tmp}/local-only.txt`, "local-only\n", "utf8");
    await $({ cwd: tmp })`git add local-only.txt`;
    await $({ cwd: tmp })`git commit -m local-only`;

    const priorArgv = (globalThis as { argv?: unknown }).argv;
    const priorCwd = process.cwd();
    (globalThis as { argv?: Record<string, unknown> }).argv = {
      deployment: "//sandbox/deployments/demo-dev:deploy",
      "mark-check-passed": ["deploy/demo-dev"],
      "mark-check-for-commit": stageRevision,
    };
    process.chdir(tmp);
    try {
      const deployment = await resolveDeploymentForCli(
        tmp,
        (name) => {
          const value = (globalThis as { argv?: Record<string, unknown> }).argv?.[name];
          if (typeof value === "string" && value.trim()) return value;
          throw new Error(`missing required --${name}`);
        },
        {
          deploymentJsonErrorMessage:
            "--deployment-json is not supported; use --deployment <label>",
        },
      );
      const evidence = await resolveDeploymentAdmissionEvidence({
        deployment,
        workspaceRoot: tmp,
      });
      assert.equal(evidence?.checks?.[0]?.subject, stageRevision);
    } finally {
      process.chdir(priorCwd);
      if (priorArgv === undefined) {
        delete (globalThis as { argv?: unknown }).argv;
      } else {
        (globalThis as { argv?: unknown }).argv = priorArgv;
      }
    }
  });
});
