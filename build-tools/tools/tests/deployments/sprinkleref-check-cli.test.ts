#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
const $ = globalThis.$;
import { runSprinkleRefCli } from "../../deployments/sprinkleref-cli";

test("sprinkleref CLI check reports scanner usage errors with exit code 3", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-check-cli-no-git-"));
  await assert.rejects(
    () => runInDir(dir, () => runSprinkleRefCli({ argv: ["--check"] })),
    (error: any) => error.exitCode === 3 && /git ls-files/.test(error.message),
  );
});

test("sprinkleref CLI check reports unknown arguments with exit code 3", async () => {
  await assert.rejects(
    () => runSprinkleRefCli({ argv: ["--check", "--unknown"] }),
    (error: any) => error.exitCode === 3 && /unknown argument: --unknown/.test(error.message),
  );
});

test("sprinkleref CLI check emits JSON report", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-check-cli-"));
  await $({ cwd: dir })`git init`.quiet();
  await fs.writeFile(path.join(dir, "contracts.txt"), "runtime://deployments/demo/app_id\n");
  await $({ cwd: dir })`git add contracts.txt`.quiet();
  let output = "";
  await runInDir(dir, () =>
    runSprinkleRefCli({
      argv: ["--check", "--format", "json"],
      stdout: (text) => (output = text),
    }),
  );
  const report = JSON.parse(output);
  assert.equal(report.refs[0].ref, "runtime://deployments/demo/app_id");
  assert.equal(report.refs[0].locations[0], "contracts.txt:1");
});

test("sprinkleref list emits inventory without setting gate exit status", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-list-cli-"));
  await $({ cwd: dir })`git init`.quiet();
  await fs.writeFile(path.join(dir, "contracts.txt"), "secret://deployments/demo/api-token\n");
  await $({ cwd: dir })`git add contracts.txt`.quiet();
  let output = "";
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  await runInDir(dir, () =>
    runSprinkleRefCli({
      argv: ["list", "--format", "json"],
      stdout: (text) => (output = text),
    }),
  );
  assert.equal(process.exitCode, undefined);
  process.exitCode = previousExitCode;
  const report = JSON.parse(output);
  assert.equal(report.refs[0].ref, "secret://deployments/demo/api-token");
  assert.equal(report.summary.unchecked, 1);
});

test("sprinkleref positional check keeps check exit status", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-positional-check-cli-"));
  await $({ cwd: dir })`git init`.quiet();
  await fs.writeFile(path.join(dir, "contracts.txt"), "secret://deployments/demo/api-token\n");
  await $({ cwd: dir })`git add contracts.txt`.quiet();
  const config = path.join(dir, "sprinkleref.json");
  await fs.writeFile(
    config,
    JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: { main: { backend: "local-file", file: path.join(dir, "secrets.json") } },
    }),
  );
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  await runInDir(dir, () =>
    runSprinkleRefCli({
      argv: ["check", "--config", config, "--format", "json"],
      stdout: () => undefined,
    }),
  );
  assert.equal(process.exitCode, 1);
  process.exitCode = previousExitCode;
});

test("sprinkleref positional help and unknown commands are handled before secret actions", async () => {
  let output = "";
  await runSprinkleRefCli({ argv: ["help"], stdout: (text) => (output = text) });
  assert.match(output, /sprinkleref list/);
  await assert.rejects(
    () => runSprinkleRefCli({ argv: ["unknown"], stdout: () => undefined }),
    /unknown command: unknown/,
  );
});

async function runInDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const old = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(old);
  }
}
