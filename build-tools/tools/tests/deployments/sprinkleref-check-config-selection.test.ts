#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
const $ = globalThis.$;
import { runSprinkleRefCheck } from "../../deployments/sprinkleref-check";

test("check uses injected SPRINKLEREF_CONFIG env for resolver selection", async () => {
  const dir = await gitRepo();
  const { config, secretRef } = await writeResolverFixture(dir, "resolver.json");
  const output = await runInDir(dir, async () => {
    let output = "";
    const exitCode = await runSprinkleRefCheck({
      argv: ["--check", "--format", "json"],
      env: { SPRINKLEREF_CONFIG: config },
      stdout: (text) => (output = text),
    });
    assert.equal(exitCode, 0);
    return output;
  });
  assertPresentWithoutSecret(output, secretRef);
});

test("check uses canonical project config by default", async () => {
  const dir = await gitRepo();
  const { secretRef } = await writeResolverFixture(dir, "projects/config/shared.json");
  const output = await runInDir(dir, async () => {
    let output = "";
    const exitCode = await runSprinkleRefCheck({
      argv: ["--check", "--format", "json"],
      env: {},
      stdout: (text) => (output = text),
    });
    assert.equal(exitCode, 0);
    return output;
  });
  assertPresentWithoutSecret(output, secretRef);
});

async function writeResolverFixture(dir: string, configRelative: string) {
  const secretRef = "secret://deployments/demo/api_token";
  const store = path.join(dir, "store.json");
  const config = path.join(dir, configRelative);
  await writeTracked(dir, "contracts.txt", `${secretRef}\n`);
  await fs.mkdir(path.dirname(config), { recursive: true });
  await fs.writeFile(store, `${JSON.stringify({ [secretRef]: "hidden" })}\n`);
  const resolver = {
    version: 1,
    defaultCategory: "main",
    categories: { main: { backend: "local-file", file: store } },
  };
  const value =
    configRelative === "projects/config/shared.json" ? { sprinkleref: resolver } : resolver;
  await fs.writeFile(config, `${JSON.stringify(value)}\n`);
  return { config, secretRef };
}

function assertPresentWithoutSecret(output: string, secretRef: string) {
  const report = JSON.parse(output);
  assert.equal(report.refs.find((entry: any) => entry.ref === secretRef).status, "present");
  assert.doesNotMatch(output, /hidden/);
}

async function gitRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-check-config-"));
  await $({ cwd: dir })`git init`.quiet();
  return dir;
}

async function writeTracked(dir: string, file: string, text: string) {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text);
  await $({ cwd: dir })`git add ${file}`.quiet();
}

async function runInDir<T>(dir: string, fn: () => Promise<T>) {
  const old = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(old);
  }
}
