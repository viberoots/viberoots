#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { $ } from "zx";
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

async function runInDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const old = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(old);
  }
}
