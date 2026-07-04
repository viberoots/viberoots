#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentAdmissionEvidence } from "../../deployments/deployment-admission-cli";
import { resolveDeploymentForCli } from "../../deployments/deployment-cli-resolve";
import { writeTempListedDeploymentWorkspace } from "./deploy.front-door.fixture";
import { runInTemp } from "../lib/test-helpers";

function withSyntheticArgv(args: string[], fn: () => Promise<void>): Promise<void> {
  const oldGlobal = (globalThis as Record<string, unknown>).argv;
  const oldArgv = process.argv.slice();
  delete (globalThis as Record<string, unknown>).argv;
  process.argv = ["node", "script", ...args];
  return fn().finally(() => {
    (globalThis as Record<string, unknown>).argv = oldGlobal;
    process.argv = oldArgv;
  });
}

test("admit-and-deploy infers the current HEAD subject and synthesizes passed checks", async () => {
  await runInTemp("deployment-admission-cli-admit-and-deploy", async (tmp, $) => {
    const oldCwd = process.cwd();
    try {
      process.chdir(tmp);
      const head = String((await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout).trim();
      await withSyntheticArgv(
        ["--admit-and-deploy=deploy/sample-webapp-dev, deploy/sample-webapp-dev"],
        async () => {
          const evidence = await resolveDeploymentAdmissionEvidence();
          assert.ok(evidence);
          assert.deepEqual(
            evidence.checks?.map((entry) => entry.name),
            ["deploy/sample-webapp-dev"],
          );
          assert.equal(evidence.checks?.[0]?.subject, head);
          assert.equal(evidence.checks?.[0]?.status, "passed");
          assert.match(String(evidence.checks?.[0]?.checkedAt), /^\d{4}-\d{2}-\d{2}T/);
          assert.equal(evidence.checks?.[0]?.recordRef, "manual-check://deploy/sample-webapp-dev");
          assert.equal(evidence.checks?.[0]?.reportingKind, "human_manual");
        },
      );
    } finally {
      process.chdir(oldCwd);
    }
  });
});

test("admit-and-deploy accepts an explicit admit-for-commit override", async () => {
  await runInTemp("deployment-admission-cli-admit-for-commit", async (tmp, $) => {
    const oldCwd = process.cwd();
    try {
      process.chdir(tmp);
      const head = String((await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout).trim();
      await withSyntheticArgv(
        ["--admit-and-deploy=deploy/sample-webapp-dev", "--admit-for-commit", head],
        async () => {
          const evidence = await resolveDeploymentAdmissionEvidence();
          assert.equal(evidence?.checks?.[0]?.subject, head);
        },
      );
    } finally {
      process.chdir(oldCwd);
    }
  });
});

test("admit-and-deploy scopes synthesized check evidence to the selected deployment", async () => {
  await runInTemp("deployment-admission-cli-scoped-admit", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git config user.name Codex`;
    await $({ cwd: tmp })`git config user.email codex@example.test`;
    await $({ cwd: tmp })`git add .`;
    await $({ cwd: tmp })`git commit -m initial`;
    const head = String((await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout).trim();
    const oldCwd = process.cwd();
    try {
      process.chdir(tmp);
      const deployment = await resolveDeploymentForCli(
        tmp,
        (name) => {
          if (name === "deployment") return "//sandbox/deployments/demo-dev:deploy";
          throw new Error(`missing required --${name}`);
        },
        {
          deploymentJsonErrorMessage:
            "--deployment-json is not supported; use --deployment <label>",
        },
      );
      await withSyntheticArgv(["--admit-and-deploy=deploy/demo-dev"], async () => {
        const evidence = await resolveDeploymentAdmissionEvidence({
          deployment,
          workspaceRoot: tmp,
        });
        assert.equal(evidence?.checks?.[0]?.deploymentId, "demo-dev");
        assert.equal(evidence?.checks?.[0]?.environmentStage, "dev");
        assert.equal(
          evidence?.checks?.[0]?.admissionPolicyRef,
          "//sandbox/deployments/shared:dev_release",
        );
      });
    } finally {
      process.chdir(oldCwd);
    }
  });
});

test("admission-evidence-json checks inherit ci_pipeline reporting in CI when kind is omitted", async () => {
  await runInTemp("deployment-admission-cli-ci-reporting-kind", async (tmp) => {
    const oldCwd = process.cwd();
    const oldCi = process.env.CI;
    try {
      process.chdir(tmp);
      process.env.CI = "1";
      const evidencePath = path.join(tmp, "admission-evidence.json");
      await fsp.writeFile(
        evidencePath,
        JSON.stringify({
          checks: [
            {
              name: "deploy/sample-webapp-dev",
              subject: "sha256:head",
              status: "passed",
              checkedAt: "2026-04-23T00:00:00.000Z",
            },
          ],
        }),
      );
      await withSyntheticArgv(["--admission-evidence-json", evidencePath], async () => {
        const evidence = await resolveDeploymentAdmissionEvidence();
        assert.equal(evidence?.checks?.[0]?.reportingKind, "ci_pipeline");
      });
    } finally {
      process.chdir(oldCwd);
      if (oldCi === undefined) delete process.env.CI;
      else process.env.CI = oldCi;
    }
  });
});

test("admit-and-deploy fails closed when local HEAD does not match the deployment-required commit", async () => {
  await runInTemp("deployment-admission-cli-admit-head-mismatch", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git config user.name Codex`;
    await $({ cwd: tmp })`git config user.email codex@example.test`;
    await $({ cwd: tmp })`git add .`;
    await $({ cwd: tmp })`git commit -m initial`;
    const requiredSha = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout,
    ).trim();
    await $({ cwd: tmp })`git checkout -b local-work`;
    await fsp.writeFile(path.join(tmp, "local-only.txt"), "local-only\n", "utf8");
    await $({ cwd: tmp })`git add local-only.txt`;
    await $({ cwd: tmp })`git commit -m local-only`;
    const oldCwd = process.cwd();
    try {
      process.chdir(tmp);
      const deployment = await resolveDeploymentForCli(
        tmp,
        (name) => {
          if (name === "deployment") return "//sandbox/deployments/demo-dev:deploy";
          throw new Error(`missing required --${name}`);
        },
        {
          deploymentJsonErrorMessage:
            "--deployment-json is not supported; use --deployment <label>",
        },
      );
      await withSyntheticArgv(["--admit-and-deploy=deploy/demo-dev"], async () => {
        await assert.rejects(
          () =>
            resolveDeploymentAdmissionEvidence({
              deployment,
              workspaceRoot: tmp,
            }),
          new RegExp(
            `defaulted to local HEAD: [0-9a-f]{40}[\\s\\S]*requires checks for: ${requiredSha}[\\s\\S]*--admit-for-commit ${requiredSha}`,
          ),
        );
      });
    } finally {
      process.chdir(oldCwd);
    }
  });
});

test("admit-and-deploy merges with admission-evidence-json and overrides duplicate checks", async () => {
  await runInTemp("deployment-admission-cli-merge", async (tmp, $) => {
    const oldCwd = process.cwd();
    try {
      process.chdir(tmp);
      const head = String((await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout).trim();
      const evidencePath = path.join(tmp, "admission-evidence.json");
      await fsp.writeFile(
        evidencePath,
        JSON.stringify({
          requestedBy: { principalId: "user:bootstrap" },
          checks: [
            {
              name: "deploy/sample-webapp-dev",
              subject: head,
              status: "failed",
              checkedAt: "2026-04-23T00:00:00.000Z",
              recordRef: "manual://old",
            },
            {
              name: "deploy/other",
              subject: "sha256:elsewhere",
              status: "passed",
              checkedAt: "2026-04-23T00:00:00.000Z",
              recordRef: "manual://other",
            },
          ],
        }),
      );
      await withSyntheticArgv(
        ["--admission-evidence-json", evidencePath, "--admit-and-deploy=deploy/sample-webapp-dev"],
        async () => {
          const evidence = await resolveDeploymentAdmissionEvidence();
          assert.equal(evidence?.requestedBy?.principalId, "user:bootstrap");
          assert.deepEqual(
            evidence?.checks?.map((entry) => [
              entry.name,
              entry.subject,
              entry.status,
              entry.recordRef,
            ]),
            [
              [
                "deploy/sample-webapp-dev",
                head,
                "passed",
                "manual-check://deploy/sample-webapp-dev",
              ],
              ["deploy/other", "sha256:elsewhere", "passed", "manual://other"],
            ],
          );
        },
      );
    } finally {
      process.chdir(oldCwd);
    }
  });
});
