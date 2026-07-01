#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
const $ = globalThis.$;
import { runSprinkleRefCheck } from "../../deployments/sprinkleref-check";

test("check reports scanner failures as usage exit code 3", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-check-no-git-"));
  await assert.rejects(
    () => runInDir(dir, () => runSprinkleRefCheck({ argv: ["--check"] })),
    (error: any) => error.exitCode === 3 && /git ls-files/.test(error.message),
  );
});

test("check redacts backend error diagnostics", async () => {
  const { dir, config } = await configuredSecretRepo();
  await assert.rejects(
    () =>
      runInDir(dir, () =>
        runSprinkleRefCheck({
          argv: ["--check", "--config", config],
          storeFactory: () => ({
            describe: () => "fixture",
            has: async () => {
              throw new Error('backend failed {"secretValue":"raw-token","clientSecret":"leak"}');
            },
            read: async () => undefined,
            add: async () => undefined,
            update: async () => undefined,
            remove: async () => undefined,
          }),
        }),
      ),
    redactedBackendError,
  );
});

test("check redacts backend construction failures as backend exit code 2", async () => {
  const { dir, config } = await configuredSecretRepo();
  await assert.rejects(
    () =>
      runInDir(dir, () =>
        runSprinkleRefCheck({
          argv: ["--check", "--config", config],
          storeFactory: () => {
            throw new Error("create failed client_secret=raw-token");
          },
        }),
      ),
    redactedBackendError,
  );
});

function redactedBackendError(error: any): boolean {
  return (
    error.exitCode === 2 &&
    !/raw-token|leak/.test(error.message) &&
    /\[redacted:deployment-auth-secret\]/.test(error.message)
  );
}

async function configuredSecretRepo(): Promise<{ dir: string; config: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-check-errors-"));
  await $({ cwd: dir })`git init`.quiet();
  const config = path.join(dir, "resolver.json");
  await fs.writeFile(path.join(dir, "contracts.txt"), "secret://deployments/demo/api_token\n");
  await fs.writeFile(
    config,
    `${JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: { main: { backend: "local-file", file: "unused.json" } },
    })}\n`,
  );
  await $({ cwd: dir })`git add contracts.txt`.quiet();
  return { dir, config };
}

async function runInDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const old = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(old);
  }
}
