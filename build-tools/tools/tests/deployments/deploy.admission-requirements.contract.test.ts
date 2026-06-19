#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { resolveDeploymentAdmissionEvidence } from "../../deployments/deployment-admission-cli";
import { resolveDeploymentForCli } from "../../deployments/deployment-cli-resolve";
import {
  writeTempCloudflareValidationWorkspace,
  writeTempListedDeploymentWorkspace,
} from "./deploy.front-door.fixture";
import { runInTemp } from "../lib/test-helpers";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function configureGitIdentity(tmp: string, $: any): Promise<void> {
  await $({ cwd: tmp, stdio: "pipe" })`git config user.name Codex`;
  await $({ cwd: tmp, stdio: "pipe" })`git config user.email codex@example.test`;
}

async function commitFixture(tmp: string, $: any): Promise<string> {
  await configureGitIdentity(tmp, $);
  await $({ cwd: tmp, stdio: "pipe" })`git add .`;
  await $({ cwd: tmp, stdio: "pipe" })`git commit -m admission-fixture --allow-empty`;
  return String((await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout).trim();
}

async function resetToFixture(tmp: string, $: any, fixtureRevision: string): Promise<void> {
  await $({ cwd: tmp, stdio: "pipe" })`git reset --hard ${fixtureRevision}`;
  await $({ cwd: tmp, stdio: "pipe" })`git clean -fd`;
}

test("deploy admission requirements for listed deployments", async (t) => {
  await runInTemp("deploy-admission-requirements-listed", async (tmp, $) => {
    await writeTempListedDeploymentWorkspace(tmp);
    await t.test("validate-only prints metadata-derived admission requirements", async () => {
      const requiredSha = String(
        (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse main`).stdout,
      ).trim();
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment //sandbox/deployments/demo-dev:deploy --validate-only`;
      const payload = JSON.parse(String(result.stdout));
      assert.deepEqual(payload.admissionRequirements, {
        admission_policy: "//sandbox/deployments/shared:dev_release",
        source_ref_policy: {
          stage: "dev",
          ref: "main",
          kind: "protected_main",
        },
        allowed_refs: ["main"],
        required_checks: ["deploy/demo-dev"],
        required_approvals: [],
        trusted_admission_reporters: ["app:deploy-bot"],
        required_check_subject: {
          kind: "git_commit",
          ref: "main",
          sha: requiredSha,
        },
        admit: {
          relevant_for_workflow: true,
          authorization_required: "admission_reporter",
          deploy_flag: "--admit-and-deploy",
          evidence_only_flag: "--admit-only",
        },
      });
    });

    await t.test("admit-and-deploy with no value suggests authoritative checks", async () => {
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment //sandbox/deployments/demo-dev:deploy --admit-and-deploy`.nothrow();
      assert.notEqual(result.exitCode, 0);
      assert.match(
        String(result.stderr),
        /Run this instead: deploy --deployment \/\/sandbox\/deployments\/demo-dev:deploy --admit-and-deploy deploy\/demo-dev/,
      );
      assert.match(
        String(result.stderr),
        /Inspect requirements only: deploy --deployment \/\/sandbox\/deployments\/demo-dev:deploy --validate-only/,
      );
      assert.match(String(result.stderr), /required_checks: deploy\/demo-dev/);
      assert.match(String(result.stderr), /admission_reporter/);
    });

    const fixtureRevision = await commitFixture(tmp, $);

    await t.test("defaults to HEAD and fails closed when another commit is required", async () => {
      await resetToFixture(tmp, $, fixtureRevision);
      await $({ cwd: tmp, stdio: "pipe" })`git checkout -B local-work ${fixtureRevision}`;
      await $({ cwd: tmp, stdio: "pipe" })`git branch -f main ${fixtureRevision}`;
      await fsp.writeFile(`${tmp}/local-only.txt`, "local-only\n", "utf8");
      await $({ cwd: tmp, stdio: "pipe" })`git add local-only.txt`;
      await $({ cwd: tmp, stdio: "pipe" })`git commit -m local-only`;
      const headRevision = String(
        (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout,
      ).trim();
      assert.notEqual(headRevision, fixtureRevision);
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment //sandbox/deployments/demo-dev:deploy --admit-and-deploy deploy/demo-dev`.nothrow();
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /defaulted to local HEAD:/);
      assert.match(String(result.stderr), new RegExp(`requires checks for: ${fixtureRevision}`));
      assert.match(String(result.stderr), /deployment_source_ref: main/);
      assert.match(
        String(result.stderr),
        /deployment source ref is up to date and pushed before retrying/,
      );
      assert.match(
        String(result.stderr),
        new RegExp(`--admit-for-commit ${escapeRegExp(fixtureRevision)}`),
      );
    });

    await t.test("explains when the deployment source ref is unavailable locally", async () => {
      await resetToFixture(tmp, $, fixtureRevision);
      await $({ cwd: tmp, stdio: "pipe" })`git checkout -B local-work`;
      await $({ cwd: tmp, stdio: "pipe" })`git branch -D main`.nothrow();
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment //sandbox/deployments/demo-dev:deploy --admit-and-deploy deploy/demo-dev`.nothrow();
      assert.notEqual(result.exitCode, 0);
      assert.match(
        String(result.stderr),
        /deployment source ref main is not available in this git workspace/,
      );
      assert.match(
        String(result.stderr),
        /Run this first \(replace <remote> with your git remote\): git fetch <remote> main:main/,
      );
      assert.match(
        String(result.stderr),
        /Then retry: deploy --deployment \/\/sandbox\/deployments\/demo-dev:deploy --admit-and-deploy deploy\/demo-dev/,
      );
      assert.match(
        String(result.stderr),
        /Or rerun with --admit-for-commit <sha> if you already know the reviewed commit\./,
      );
      assert.doesNotMatch(String(result.stderr), /Command failed: git rev-parse main/);
    });

    await t.test("admit-for-commit binds explicit evidence to the requested commit", async () => {
      await resetToFixture(tmp, $, fixtureRevision);
      await $({ cwd: tmp, stdio: "pipe" })`git checkout -B local-work ${fixtureRevision}`;
      await $({ cwd: tmp, stdio: "pipe" })`git branch -f main ${fixtureRevision}`;
      await fsp.writeFile(`${tmp}/local-only.txt`, "local-only\n", "utf8");
      await $({ cwd: tmp, stdio: "pipe" })`git add local-only.txt`;
      await $({ cwd: tmp, stdio: "pipe" })`git commit -m local-only`;

      const priorArgv = (globalThis as { argv?: unknown }).argv;
      const priorCwd = process.cwd();
      (globalThis as { argv?: Record<string, unknown> }).argv = {
        deployment: "//sandbox/deployments/demo-dev:deploy",
        "admit-and-deploy": ["deploy/demo-dev"],
        "admit-for-commit": fixtureRevision,
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
        const deploymentWithExplicitCommitRef = {
          ...deployment,
          admissionPolicy: {
            ...deployment.admissionPolicy,
            allowedRefs: [...deployment.admissionPolicy.allowedRefs, "commit:*"],
          },
        };
        const evidence = await resolveDeploymentAdmissionEvidence({
          deployment: deploymentWithExplicitCommitRef,
          workspaceRoot: tmp,
        });
        assert.deepEqual(evidence?.reviewedSource, {
          ref: `commit:${fixtureRevision}`,
          revision: fixtureRevision,
        });
        assert.equal(evidence?.checks?.[0]?.subject, fixtureRevision);
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
});

test("deploy admission requirements for deployments with no required checks", async (t) => {
  await runInTemp("deploy-admission-requirements-no-required-checks", async (tmp, $) => {
    await writeTempCloudflareValidationWorkspace(tmp);

    await t.test("validate-only makes zero required checks explicit", async () => {
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment //sandbox/deployments/demo-staging:deploy --validate-only`;
      const payload = JSON.parse(String(result.stdout));
      assert.deepEqual(payload.admissionRequirements, {
        admission_policy: "//sandbox/deployments/shared:staging_release",
        source_ref_policy: {
          stage: "staging",
          ref: "main",
          kind: "protected_main",
        },
        allowed_refs: ["main"],
        required_checks: [],
        required_approvals: [],
        trusted_admission_reporters: ["app:deploy-bot"],
        admit: {
          relevant_for_workflow: false,
          authorization_required: "admission_reporter",
          deploy_flag: "--admit-and-deploy",
          evidence_only_flag: "--admit-only",
        },
      });
    });

    await t.test("admit-and-deploy with no value explains no required checks", async () => {
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment //sandbox/deployments/demo-staging:deploy --admit-and-deploy`.nothrow();
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /required_checks: none/);
      assert.match(
        String(result.stderr),
        /Run this instead: deploy --deployment \/\/sandbox\/deployments\/demo-staging:deploy/,
      );
      assert.doesNotMatch(String(result.stderr), /Run this instead: .*--admit-and-deploy/);
    });
  });
});
