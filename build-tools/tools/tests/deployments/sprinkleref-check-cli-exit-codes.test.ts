#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { $ } from "zx";
import { runSprinkleRefCli } from "../../deployments/sprinkleref-cli";

test("CLI check sets process exit code 0 for successful checks", async () => {
  const dir = await repoWithContract("runtime://deployments/cli/app_id");
  assert.equal(await runCliInDir(dir, ["--check"]), 0);
});

test("CLI check sets process exit code 1 for missing unmapped or invalid refs", async () => {
  const dir = await repoWithContract("secret://deployments/cli/api_token");
  const config = path.join(dir, "resolver.json");
  await fs.writeFile(
    config,
    `${JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: { main: { backend: "local-file", file: path.join(dir, "store.json") } },
    })}\n`,
  );
  assert.equal(await runCliInDir(dir, ["--check", "--config", config]), 1);
});

test("CLI check exposes backend config failures with exit code 2", async () => {
  const dir = await repoWithContract("secret://deployments/cli/api_token");
  await assert.rejects(
    () => runCliInDir(dir, ["--check", "--config", "/missing/resolver.json"]),
    (error: any) => error.exitCode === 2,
  );
});

test("CLI check exposes scanner and usage failures with exit code 3", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-cli-exit-no-git-"));
  await assert.rejects(
    () => runCliInDir(dir, ["--check"]),
    (error: any) => error.exitCode === 3,
  );
  await assert.rejects(
    () => runSprinkleRefCli({ argv: ["--check", "--unknown"] }),
    (error: any) => error.exitCode === 3,
  );
});

async function repoWithContract(ref: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-cli-exit-"));
  await $({ cwd: dir })`git init`.quiet();
  await fs.writeFile(path.join(dir, "contracts.txt"), `${ref}\n`);
  await $({ cwd: dir })`git add contracts.txt`.quiet();
  return dir;
}

async function runCliInDir(dir: string, argv: string[]): Promise<NodeJS.ProcessExitCode> {
  const oldCwd = process.cwd();
  const oldExitCode = process.exitCode;
  process.exitCode = undefined;
  process.chdir(dir);
  try {
    await runSprinkleRefCli({ argv, stdout: () => undefined });
    return process.exitCode;
  } finally {
    process.chdir(oldCwd);
    process.exitCode = oldExitCode;
  }
}
