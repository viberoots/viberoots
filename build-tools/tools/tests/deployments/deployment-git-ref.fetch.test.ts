#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentGitCommit } from "../../deployments/deployment-git-ref.ts";
import { runInTemp } from "../lib/test-helpers.ts";

test("deployment git commit resolution fetches missing reviewed source revisions", async () => {
  await runInTemp("deployment-git-ref-fetch-source", async (tmp) => {
    const remoteRepo = path.join(tmp, "remote.git");
    const sourceRepo = path.join(tmp, "source");
    const serviceRepo = path.join(tmp, "service");
    await $({ cwd: tmp })`git init --bare ${remoteRepo}`;
    await fsp.mkdir(sourceRepo);
    await $({ cwd: sourceRepo })`git init`;
    await $({ cwd: sourceRepo })`git config user.email test@example.invalid`;
    await $({ cwd: sourceRepo })`git config user.name Test`;
    await fsp.writeFile(path.join(sourceRepo, "source.txt"), "one\n", "utf8");
    await $({ cwd: sourceRepo })`git add source.txt`;
    await $({ cwd: sourceRepo })`git commit -m initial`;
    await $({ cwd: sourceRepo })`git remote add origin ${remoteRepo}`;
    await $({ cwd: sourceRepo })`git push origin HEAD`;
    await $({ cwd: tmp })`git clone ${remoteRepo} ${serviceRepo}`;

    await fsp.writeFile(path.join(sourceRepo, "source.txt"), "two\n", "utf8");
    await $({ cwd: sourceRepo })`git commit -am second`;
    await $({ cwd: sourceRepo })`git push origin HEAD`;
    const revisionOut = await $({ cwd: sourceRepo, stdio: "pipe" })`git rev-parse HEAD`;
    const sourceRevision = String((revisionOut as any).stdout || "").trim();
    const verifyRevisionArgs = ["rev-parse", "--verify", `${sourceRevision}^{commit}`];
    const missingBeforeFetch = await $({
      cwd: serviceRepo,
      stdio: "pipe",
    })`git ${verifyRevisionArgs}`.nothrow();
    assert.notEqual((missingBeforeFetch as any).exitCode, 0);

    const resolved = await resolveDeploymentGitCommit({
      workspaceRoot: serviceRepo,
      revision: sourceRevision,
      purpose: "test reviewed source revision",
    });

    assert.equal(resolved, sourceRevision);
    const serviceHasRevision = await $({
      cwd: serviceRepo,
      stdio: "pipe",
    })`git ${verifyRevisionArgs}`.nothrow();
    assert.equal((serviceHasRevision as any).exitCode, 0);
  });
});
